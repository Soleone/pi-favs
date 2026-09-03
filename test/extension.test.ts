import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import registerPiFavs from "../src/index.ts";

type Handler = (args: string, ctx: any) => Promise<void>;

function tempDirectory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pi-favs-extension-"));
}

async function withEnv<T>(values: Record<string, string | undefined>, callback: () => Promise<T>): Promise<T> {
  const names = Object.keys(values);
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) {
      const value = values[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    return await callback();
  } finally {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("/favs selects a favorite and opens it in a new Herdr tab", async () => {
  const root = tempDirectory();
  const filePath = path.join(root, "README.md");
  const configPath = path.join(root, "pi-favs.json");
  fs.writeFileSync(filePath, "hello");
  fs.writeFileSync(configPath, JSON.stringify({ favorites: [{ name: "Read me", path: filePath }] }));

  const calls: Array<{ command: string; args: string[] }> = [];
  let commandHandler: Handler | undefined;
  let notice = "";
  const pi = {
    registerCommand(_name: string, options: { handler: Handler }) {
      commandHandler = options.handler;
    },
    async exec(command: string, args: string[]) {
      calls.push({ command, args: [...args] });
      if (args[0] === "tab" && args[1] === "create") {
        return {
          stdout: JSON.stringify({ result: {
            tab: { tab_id: "w1:t9" },
            root_pane: { pane_id: "w1:p9" },
          } }),
          stderr: "",
          code: 0,
          killed: false,
        };
      }
      return { stdout: "", stderr: "", code: 0, killed: false };
    },
  };

  await withEnv({
    PI_FAVS_CONFIG: configPath,
    HERDR_ENV: "1",
    HERDR_WORKSPACE_ID: "w1",
    HERDR_BIN_PATH: "/custom/herdr",
    PI_FAVS_HX_BIN: "/custom/hx",
  }, async () => {
    registerPiFavs(pi as never);
    assert.ok(commandHandler);
    await commandHandler!("", {
      cwd: root,
      hasUI: true,
      isProjectTrusted: () => false,
      ui: {
        select: async (_title: string, choices: string[]) => choices[1] ?? choices[0],
        notify: (message: string) => { notice = message; },
      },
    });
  });

  assert.match(notice, /Opened Read me/);
  assert.deepEqual(calls.map((call) => call.args), [
    ["tab", "create", "--workspace", "w1", "--cwd", root, "--label", "Read me", "--focus"],
    ["pane", "run", "w1:p9", "'/custom/hx' '--working-dir' '.' 'README.md'"],
  ]);
});

test("reports that /favs must run inside Herdr", async () => {
  const root = tempDirectory();
  const filePath = path.join(root, "README.md");
  const configPath = path.join(root, "pi-favs.json");
  fs.writeFileSync(filePath, "hello");
  fs.writeFileSync(configPath, JSON.stringify([filePath]));

  let commandHandler: Handler | undefined;
  let notice = "";
  const pi = {
    registerCommand(_name: string, options: { handler: Handler }) {
      commandHandler = options.handler;
    },
    async exec() {
      throw new Error("must not execute");
    },
  };

  await withEnv({ PI_FAVS_CONFIG: configPath, HERDR_ENV: undefined }, async () => {
    registerPiFavs(pi as never);
    await commandHandler!("", {
      cwd: root,
      hasUI: true,
      isProjectTrusted: () => false,
      ui: {
        select: async (_title: string, choices: string[]) => choices[1] ?? choices[0],
        notify: (message: string) => { notice = message; },
      },
    });
  });

  assert.match(notice, /inside a Herdr pane/);
});
