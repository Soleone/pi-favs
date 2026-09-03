import assert from "node:assert/strict";
import test from "node:test";

import { openInHerdrTab, parseCreatedTab, shellQuote } from "../src/herdr.ts";

const success = (stdout = "") => ({ stdout, stderr: "", code: 0, killed: false });

test("parses Herdr tab creation response", () => {
  assert.deepEqual(
    parseCreatedTab(JSON.stringify({ result: {
      tab: { tab_id: "w1:t2" },
      root_pane: { pane_id: "w1:p2" },
    } })),
    { tabId: "w1:t2", paneId: "w1:p2" },
  );
  assert.equal(parseCreatedTab("not json"), undefined);
});

test("quotes shell arguments without allowing path injection", () => {
  assert.equal(shellQuote("/tmp/it's fine"), "'/tmp/it'\\''s fine'");
});

test("creates a new tab and starts Helix with a file relative to its directory", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const pi = {
    async exec(command: string, args: string[]) {
      calls.push({ command, args: [...args] });
      if (args[0] === "tab" && args[1] === "create") {
        return success(JSON.stringify({ result: {
          tab: { tab_id: "w1:t2" },
          root_pane: { pane_id: "w1:p2" },
        } }));
      }
      return success();
    },
  };

  const result = await openInHerdrTab(pi, {
    name: "Notes",
    path: "/tmp/my project/notes.md",
    kind: "file",
  }, { workspaceId: "w1", herdrBin: "/custom/herdr", hxBin: "/custom/hx" });

  assert.deepEqual(result, { tabId: "w1:t2", paneId: "w1:p2" });
  assert.deepEqual(calls, [
    {
      command: "/custom/herdr",
      args: ["tab", "create", "--workspace", "w1", "--cwd", "/tmp/my project", "--label", "Notes", "--focus"],
    },
    {
      command: "/custom/herdr",
      args: ["pane", "run", "w1:p2", "'/custom/hx' '--working-dir' '.' 'notes.md'"],
    },
  ]);
});

test("opens a directory through Helix's file picker", async () => {
  const calls: string[][] = [];
  const pi = {
    async exec(_command: string, args: string[]) {
      calls.push([...args]);
      if (args[0] === "tab" && args[1] === "create") {
        return success(JSON.stringify({ result: {
          tab: { tab_id: "w1:t2" },
          root_pane: { pane_id: "w1:p2" },
        } }));
      }
      return success();
    },
  };

  await openInHerdrTab(pi, { name: "Plans", path: "/home/user/plans", kind: "directory" }, { workspaceId: "w1" });
  assert.deepEqual(calls[1], ["pane", "run", "w1:p2", "'hx' '--working-dir' '.' '.'"]);
});

test("closes the new tab when Helix cannot start", async () => {
  const calls: string[][] = [];
  const pi = {
    async exec(_command: string, args: string[]) {
      calls.push([...args]);
      if (args[0] === "tab" && args[1] === "create") {
        return success(JSON.stringify({ result: {
          tab: { tab_id: "w1:t2" },
          root_pane: { pane_id: "w1:p2" },
        } }));
      }
      if (args[0] === "pane") return { stdout: "", stderr: "boom", code: 1, killed: false };
      return success();
    },
  };

  await assert.rejects(
    () => openInHerdrTab(pi, { name: "Dir", path: "/tmp", kind: "directory" }, { workspaceId: "w1" }),
    /boom/,
  );
  assert.deepEqual(calls.at(-1), ["tab", "close", "w1:t2"]);
});
