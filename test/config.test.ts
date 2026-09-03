import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getGlobalConfigPath, loadFavorites, writeFavorite } from "../src/config.ts";

function tempDirectory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pi-favs-"));
}

test("loads labeled files and directories from global and trusted project configs", () => {
  const root = tempDirectory();
  const home = path.join(root, "home");
  const cwd = path.join(root, "project");
  fs.mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
  fs.mkdirSync(path.join(root, "source"), { recursive: true });
  fs.writeFileSync(path.join(root, "README.md"), "read me");
  fs.writeFileSync(path.join(root, "source", "index.ts"), "export {};");

  fs.writeFileSync(
    getGlobalConfigPath({}, home),
    JSON.stringify({ favorites: [
      { name: "Global README", path: "../../../README.md" },
      { name: "Old label", path: "../../../source" },
    ] }),
  );
  fs.writeFileSync(
    path.join(cwd, ".pi", "favs.json"),
    JSON.stringify({ favorites: [
      { name: "Project source", path: "../../source" },
      "../../source/index.ts",
    ] }),
  );

  const loaded = loadFavorites(cwd, true, {}, home);
  assert.deepEqual(loaded.favorites.map((favorite) => [favorite.name, favorite.kind]), [
    ["Global README", "file"],
    ["Project source", "directory"],
    ["index.ts", "file"],
  ]);
  assert.equal(loaded.warnings.length, 0);
});

test("does not load project config for an untrusted project", () => {
  const root = tempDirectory();
  const cwd = path.join(root, "project");
  fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".pi", "favs.json"), JSON.stringify(["."]));

  const loaded = loadFavorites(cwd, false, {}, path.join(root, "home"));
  assert.equal(loaded.favorites.length, 0);
  assert.equal(loaded.paths.length, 0);
});

test("writes new favorites and updates an existing path", () => {
  const root = tempDirectory();
  const configPath = path.join(root, ".pi", "agent", "pi-favs.json");
  const filePath = path.join(root, "README.md");
  fs.writeFileSync(filePath, "hello");

  assert.equal(writeFavorite(configPath, { name: "Read me", path: filePath }), "created");
  assert.equal(writeFavorite(configPath, { name: "Read this", path: filePath }), "updated");
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as { favorites: Array<{ name: string; path: string }> };
  assert.deepEqual(parsed.favorites, [{ name: "Read this", path: filePath }]);
});

test("warns and skips missing favorites", () => {
  const root = tempDirectory();
  const home = path.join(root, "home");
  fs.mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });
  fs.writeFileSync(
    getGlobalConfigPath({}, home),
    JSON.stringify({ favorites: ["./missing", { name: "No path" }] }),
  );

  const loaded = loadFavorites(root, false, {}, home);
  assert.equal(loaded.favorites.length, 0);
  assert.equal(loaded.warnings.length, 2);
});
