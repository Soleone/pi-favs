import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import registerPiFavs from "../src/index.ts";

function tempDirectory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pi-favs-add-"));
}

async function withEnv<T>(values: Record<string, string | undefined>, callback: () => Promise<T>): Promise<T> {
  const previous = new Map(Object.keys(values).map((name) => [name, process.env[name]]));
  try {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    return await callback();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("guided add flow saves a favorite and can open it immediately", async () => {
  const root = tempDirectory();
  const filePath = path.join(root, "notes.md");
  const configPath = path.join(root, "pi-favs.json");
  fs.writeFileSync(filePath, "notes");
  const calls: string[][] = [];
  let commandHandler: ((args: string, ctx: any) => Promise<void>) | undefined;
  const notices: string[] = [];

  const pi = {
    registerCommand(_name: string, options: { handler: typeof commandHandler }) {
      commandHandler = options.handler;
    },
    async exec(_command: string, args: string[]) {
      calls.push([...args]);
      if (args[0] === "tab" && args[1] === "create") {
        return {
          stdout: JSON.stringify({ result: {
            tab: { tab_id: "w1:t3" },
            root_pane: { pane_id: "w1:p3" },
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
  }, async () => {
    registerPiFavs(pi as never);
    await commandHandler!("add", {
      cwd: root,
      hasUI: true,
      isProjectTrusted: () => false,
      ui: {
        select: async (_title: string, choices: string[]) => choices[0],
        input: async (title: string) => title === "Path to file" ? filePath : "Meeting notes",
        confirm: async () => true,
        notify: (message: string) => notices.push(message),
      },
    });
  });

  const saved = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    favorites: Array<{ name: string; path: string }>;
  };
  assert.deepEqual(saved.favorites, [{ name: "Meeting notes", path: filePath }]);
  assert.match(notices.join("\n"), /Added/);
  assert.deepEqual(calls.map((args) => args.slice(0, 2)), [["tab", "create"], ["pane", "run"]]);
});
