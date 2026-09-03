import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { Favorite } from "./config.ts";

export interface HerdrOpenResult {
  tabId: string;
  paneId: string;
}

type ExecResult = {
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
};

type PiExec = Pick<ExtensionAPI, "exec">;

export async function openInHerdrTab(
  pi: PiExec,
  favorite: Favorite,
  options: {
    workspaceId?: string;
    herdrBin?: string;
    hxBin?: string;
    timeoutMs?: number;
  } = {},
): Promise<HerdrOpenResult> {
  const workspaceId = options.workspaceId?.trim();
  if (!workspaceId) throw new Error("HERDR_WORKSPACE_ID is not available.");

  const herdrBin = options.herdrBin?.trim() || "herdr";
  const hxBin = options.hxBin?.trim() || "hx";
  const timeout = options.timeoutMs ?? 5_000;
  const workingDirectory = favorite.kind === "directory" ? favorite.path : dirname(favorite.path);

  const created = await pi.exec(
    herdrBin,
    [
      "tab",
      "create",
      "--workspace",
      workspaceId,
      "--cwd",
      workingDirectory,
      "--label",
      favorite.name,
      "--focus",
    ],
    { timeout },
  );
  if (!successful(created)) {
    throw new Error(created.stderr.trim() || "Herdr could not create a tab.");
  }

  const target = parseCreatedTab(created.stdout);
  if (!target) throw new Error("Herdr created a tab but did not return its root pane id.");

  const hxArgs = favorite.kind === "directory"
    // Helix needs `.` as an input to open its file picker. `--working-dir`
    // alone only changes the process cwd and leaves no buffer to open.
    ? [hxBin, "--working-dir", ".", "."]
    : [hxBin, "--working-dir", ".", basename(favorite.path)];
  const command = hxArgs.map(shellQuote).join(" ");
  const started = await pi.exec(herdrBin, ["pane", "run", target.paneId, command], { timeout });
  if (!successful(started)) {
    // Do not leave an empty tab behind when starting Helix fails.
    await pi.exec(herdrBin, ["tab", "close", target.tabId], { timeout }).catch(() => undefined);
    throw new Error(started.stderr.trim() || "Herdr could not start Helix.");
  }

  return target;
}

export function parseCreatedTab(stdout: string): HerdrOpenResult | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout) as unknown;
  } catch {
    return undefined;
  }

  const root = asRecord(raw);
  const result = asRecord(root?.result) ?? root;
  const tab = result?.tab;
  const pane = result?.root_pane ?? result?.rootPane ?? result?.pane;
  const tabId = getId(tab, ["tab_id", "tabId", "id"]);
  const paneId = getId(pane, ["pane_id", "paneId", "id"]);
  if (!tabId || !paneId) return undefined;
  return { tabId, paneId };
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function successful(result: ExecResult): boolean {
  return result.code === 0 && !result.killed;
}

function getId(value: unknown, keys: string[]): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function dirname(filePath: string): string {
  return filePath.slice(0, Math.max(1, filePath.lastIndexOf("/"))) || "/";
}

function basename(filePath: string): string {
  return filePath.slice(filePath.lastIndexOf("/") + 1);
}
