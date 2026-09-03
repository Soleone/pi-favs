import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import registerPiFavs from "../src/index.ts";

function tempDirectory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pi-favs-filter-"));
}

test("typing filters the favorites list before selection", async () => {
  const root = tempDirectory();
  const plans = path.join(root, "plans");
  const notes = path.join(root, "notes.md");
  const configPath = path.join(root, "pi-favs.json");
  fs.mkdirSync(plans);
  fs.writeFileSync(notes, "notes");
  fs.writeFileSync(configPath, JSON.stringify({ favorites: [
    { name: "Notes", path: notes },
    { name: "Plans", path: plans },
  ] }));

  let commandHandler: ((args: string, ctx: any) => Promise<void>) | undefined;
  const opened: string[][] = [];
  const pi = {
    registerCommand(_name: string, options: { handler: typeof commandHandler }) {
      commandHandler = options.handler;
    },
    async exec(_command: string, args: string[]) {
      opened.push([...args]);
      if (args[0] === "tab" && args[1] === "create") {
        return {
          stdout: JSON.stringify({ result: {
            tab: { tab_id: "w1:t4" },
            root_pane: { pane_id: "w1:p4" },
          } }),
          stderr: "",
          code: 0,
          killed: false,
        };
      }
      return { stdout: "", stderr: "", code: 0, killed: false };
    },
  };

  const previousConfig = process.env.PI_FAVS_CONFIG;
  const previousEnv = process.env.HERDR_ENV;
  const previousWorkspace = process.env.HERDR_WORKSPACE_ID;
  process.env.PI_FAVS_CONFIG = configPath;
  process.env.HERDR_ENV = "1";
  process.env.HERDR_WORKSPACE_ID = "w1";
  try {
    registerPiFavs(pi as never);
    await commandHandler!("", {
      cwd: root,
      hasUI: true,
      isProjectTrusted: () => false,
      ui: {
        custom: async (factory: any) => {
          let selected: string | undefined;
          const component = factory(
            { requestRender() {} },
            { fg: (_color: string, text: string) => text, bold: (text: string) => text },
            {},
            (value: string | undefined) => { selected = value; },
          );
          component.handleInput("p");
          component.handleInput("\r");
          return selected;
        },
        notify() {},
      },
    });
  } finally {
    restoreEnv("PI_FAVS_CONFIG", previousConfig);
    restoreEnv("HERDR_ENV", previousEnv);
    restoreEnv("HERDR_WORKSPACE_ID", previousWorkspace);
  }

  assert.equal(opened[0]?.[7], "Plans");
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
