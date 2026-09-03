import fs from "node:fs";
import path from "node:path";

import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Container, Key, matchesKey, SelectList, Text, type SelectItem } from "@earendil-works/pi-tui";

import {
  displayPath,
  getGlobalConfigPath,
  getProjectConfigPath,
  loadFavorites,
  resolveInputPath,
  writeFavorite,
  type Favorite,
} from "./config.ts";
import { openInHerdrTab } from "./herdr.ts";

const ADD_CHOICE = "＋ Add a favorite…";

export default function registerPiFavs(pi: ExtensionAPI): void {
  pi.registerCommand("favs", {
    description: "Pick, add, or search favorite files and directories",
    handler: async (args, ctx) => {
      await runFavoritesCommand(pi, args, ctx);
    },
  });
}

async function runFavoritesCommand(
  pi: ExtensionAPI,
  args: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("/favs needs an interactive pi UI.", "error");
    return;
  }

  const trimmedArgs = args.trim();
  if (/^(add|new)$/i.test(trimmedArgs)) {
    await addFavoriteFlow(pi, ctx);
    return;
  }

  const loaded = loadFavorites(ctx.cwd, ctx.isProjectTrusted());
  for (const warning of loaded.warnings) ctx.ui.notify(warning, "warning");

  const query = trimmedArgs.toLocaleLowerCase();
  const matching = query
    ? loaded.favorites.filter((favorite) => `${favorite.name} ${favorite.path}`.toLocaleLowerCase().includes(query))
    : loaded.favorites;
  const numberWidth = String(Math.max(matching.length, 1)).length;
  const items: FavoriteListItem[] = [
    {
      value: "add",
      label: ADD_CHOICE,
      description: "add a file or folder",
    },
    ...matching.map((favorite, index) => formatChoice(favorite, index, numberWidth)),
  ];

  const selected = await selectFavoriteList(ctx, items);
  if (!selected) return;
  if (selected === "add") {
    await addFavoriteFlow(pi, ctx);
    return;
  }

  const favorite = matching.find((candidate) => candidate.name === selected);
  if (!favorite) return;
  await openFavorite(pi, favorite, ctx);
}

async function addFavoriteFlow(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const kindChoice = await ctx.ui.select("Add a favorite  ·  what should open?", [
    "File  ·  open one file in Helix",
    "Folder  ·  start Helix in this directory",
  ]);
  if (!kindChoice) return;

  const expectedKind = kindChoice.startsWith("File") ? "file" : "directory";
  const input = await ctx.ui.input(
    expectedKind === "file" ? "Path to file" : "Path to folder",
    `${ctx.cwd}/...`,
  );
  if (!input?.trim()) return;

  const resolvedPath = resolveInputPath(input, ctx.cwd);
  let actualKind: Favorite["kind"];
  try {
    actualKind = fs.statSync(resolvedPath).isDirectory() ? "directory" : "file";
  } catch {
    ctx.ui.notify(`That path does not exist: ${resolvedPath}`, "error");
    return;
  }
  if (actualKind !== expectedKind) {
    ctx.ui.notify(`That path is a ${actualKind}, not a ${expectedKind}.`, "error");
    return;
  }

  const defaultName = path.basename(resolvedPath) || resolvedPath;
  const enteredName = await ctx.ui.input("Favorite name", defaultName);
  if (enteredName === undefined) return;
  const name = enteredName.trim() || defaultName;

  const projectTrusted = ctx.isProjectTrusted();
  const destinations = ["Global favorites  ·  available everywhere"];
  if (projectTrusted) destinations.push("This project  ·  .pi/favs.json");
  const destination = destinations.length === 1
    ? destinations[0]
    : await ctx.ui.select("Save favorite to", destinations);
  if (!destination) return;

  const configPath = destination.startsWith("This project")
    ? getProjectConfigPath(ctx.cwd)
    : getGlobalConfigPath();
  try {
    const result = writeFavorite(configPath, { name, path: resolvedPath });
    const verb = result === "created" ? "Added" : "Updated";
    ctx.ui.notify(`${verb} “${name}” in ${displayPath(configPath)}.`, "info");
  } catch (error) {
    ctx.ui.notify(`Could not save favorite: ${errorMessage(error)}`, "error");
    return;
  }

  const openNow = await ctx.ui.confirm("Open it now?", `${name}  ·  ${displayPath(resolvedPath)}`);
  if (openNow) {
    await openFavorite(pi, { name, path: resolvedPath, kind: actualKind }, ctx);
  }
}

async function openFavorite(
  pi: ExtensionAPI,
  favorite: Favorite,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (process.env.HERDR_ENV !== "1") {
    ctx.ui.notify("/favs must run inside a Herdr pane.", "error");
    return;
  }

  try {
    await openInHerdrTab(pi, favorite, {
      workspaceId: process.env.HERDR_WORKSPACE_ID,
      herdrBin: process.env.HERDR_BIN_PATH,
      hxBin: process.env.PI_FAVS_HX_BIN,
    });
    ctx.ui.notify(`Opened ${favorite.name} in a new Herdr tab.`, "info");
  } catch (error) {
    ctx.ui.notify(`Could not open ${favorite.name}: ${errorMessage(error)}`, "error");
  }
}

type FavoriteListItem = SelectItem & { value: string };

async function selectFavoriteList(
  ctx: ExtensionCommandContext,
  items: FavoriteListItem[],
): Promise<string | undefined> {
  // Keep a small fallback for RPC/test contexts that do not expose custom TUI.
  if (typeof ctx.ui.custom !== "function") {
    const choices = items.map((item) => formatFallbackChoice(item));
    const selected = await ctx.ui.select("Favorites  ·  choose an item", choices);
    return items.find((item) => formatFallbackChoice(item) === selected)?.value;
  }

  return await ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
    const container = new Container();
    const filterLine = new Text("", 1, 0);
    const list = new SelectList(items, Math.min(Math.max(items.length, 1), 10), {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });
    let query = "";

    const updateFilter = (): void => {
      list.setFilter(query);
      filterLine.setText(
        theme.fg("muted", "Filter  ") +
        (query ? theme.fg("accent", query) : theme.fg("dim", "type to search")),
      );
      tui.requestRender();
    };

    list.onSelect = (item) => done(item.value);
    list.onCancel = () => done(undefined);
    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
    container.addChild(new Text(theme.fg("accent", theme.bold("Favorites")), 1, 0));
    container.addChild(filterLine);
    container.addChild(list);
    container.addChild(new Text(theme.fg("dim", "Type to filter · ↑↓ navigate · Enter open · Esc cancel"), 1, 0));
    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
    updateFilter();

    return {
      render: (width) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data) => {
        if (matchesKey(data, Key.backspace)) {
          if (query.length > 0) {
            query = query.slice(0, -1);
            updateFilter();
          }
          return;
        }
        if (matchesKey(data, Key.ctrl("u"))) {
          query = "";
          updateFilter();
          return;
        }
        if (matchesKey(data, Key.up) || matchesKey(data, Key.down) ||
            matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) {
          list.handleInput(data);
          tui.requestRender();
          return;
        }
        if (/^[\x20-\x7e]+$/.test(data)) {
          query += data;
          updateFilter();
        }
      },
    };
  });
}

function formatChoice(favorite: Favorite, index: number, numberWidth: number): FavoriteListItem {
  const kind = favorite.kind === "directory" ? "folder" : "file";
  const ordinal = `${String(index + 1).padStart(numberWidth, " ")}.`;
  return {
    value: favorite.name,
    label: `${ordinal} ${favorite.name}`,
    description: `${kind.padEnd(6, " ")}  ${displayPath(favorite.path)}`,
  };
}

function formatFallbackChoice(item: FavoriteListItem): string {
  return item.description ? `${item.label}  ${item.description}` : item.label;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export {
  displayPath,
  getGlobalConfigPath,
  getProjectConfigPath,
  loadFavorites,
  resolveInputPath,
  writeFavorite,
} from "./config.ts";
export type { Favorite, FavoriteInput, FavoriteWriteResult, LoadedFavorites } from "./config.ts";
export { openInHerdrTab, parseCreatedTab, shellQuote } from "./herdr.ts";
