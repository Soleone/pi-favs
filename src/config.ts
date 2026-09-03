import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

export interface Favorite {
  name: string;
  path: string;
  kind: "file" | "directory";
}

export interface LoadedFavorites {
  favorites: Favorite[];
  paths: string[];
  warnings: string[];
}

export interface FavoriteInput {
  name: string;
  path: string;
}

export type FavoriteWriteResult = "created" | "updated";

type RawFavorite = string | { name?: unknown; label?: unknown; path?: unknown };

/**
 * Load global favorites and, when trusted, project-local favorites.
 * Project entries are loaded after global entries and replace duplicates by path.
 */
export function loadFavorites(
  cwd: string,
  trustedProject: boolean,
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory = os.homedir(),
): LoadedFavorites {
  const globalPath = getGlobalConfigPath(env, homeDirectory);
  const candidates = [globalPath];
  if (trustedProject) candidates.push(getProjectConfigPath(cwd));

  const warnings: string[] = [];
  const favoritesByPath = new Map<string, Favorite>();
  const loadedPaths: string[] = [];

  for (const configPath of candidates) {
    const parsed = readConfig(configPath, warnings);
    if (!parsed) continue;
    loadedPaths.push(configPath);
    for (const favorite of parsed) {
      const resolved = resolveFavorite(favorite, path.dirname(configPath), warnings, configPath, env, homeDirectory);
      if (resolved) favoritesByPath.set(resolved.path, resolved);
    }
  }

  return {
    favorites: [...favoritesByPath.values()],
    paths: loadedPaths,
    warnings,
  };
}

export function getGlobalConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory = os.homedir(),
): string {
  const explicit = env.PI_FAVS_CONFIG?.trim();
  if (explicit) return expandPath(explicit, homeDirectory);

  const directory = env.PI_CODING_AGENT_DIR?.trim() || path.join(homeDirectory, ".pi", "agent");
  return path.join(directory, "pi-favs.json");
}

export function getProjectConfigPath(cwd: string): string {
  return path.join(cwd, CONFIG_DIR_NAME, "favs.json");
}

export function resolveInputPath(
  value: string,
  baseDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory = os.homedir(),
): string {
  return path.resolve(baseDirectory, expandPath(value.trim(), homeDirectory, env));
}

export function writeFavorite(
  configPath: string,
  favorite: FavoriteInput,
): FavoriteWriteResult {
  const directory = path.dirname(configPath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
  } catch (error) {
    if (!isMissingFile(error)) throw new Error(`${configPath}: ${errorMessage(error)}`);
  }

  const entries: RawFavorite[] = Array.isArray(raw)
    ? raw.filter(isRawFavorite)
    : isRecord(raw) && Array.isArray(raw.favorites)
      ? raw.favorites.filter(isRawFavorite)
      : [];
  const resolvedPath = path.resolve(favorite.path);
  const existingIndex = entries.findIndex((entry) => {
    const entryPath = typeof entry === "string" ? entry : entry.path;
    if (typeof entryPath !== "string") return false;
    return resolveInputPath(entryPath, directory) === resolvedPath;
  });
  const nextEntry = { name: favorite.name.trim(), path: resolvedPath };
  const result: FavoriteWriteResult = existingIndex >= 0 ? "updated" : "created";
  if (existingIndex >= 0) entries[existingIndex] = nextEntry;
  else entries.push(nextEntry);

  const serialized = `${JSON.stringify({ version: 1, favorites: entries }, null, 2)}\n`;
  const temporary = path.join(directory, `.pi-favs.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temporary, serialized, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, configPath);
    try {
      fs.chmodSync(configPath, 0o600);
    } catch {
      // Permissions are best effort on platforms without chmod support.
    }
  } catch (error) {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // Preserve the original write error.
    }
    throw error;
  }
  return result;
}

export function displayPath(filePath: string, homeDirectory = os.homedir()): string {
  const home = path.resolve(homeDirectory);
  const resolved = path.resolve(filePath);
  if (resolved === home) return "~";
  if (resolved.startsWith(`${home}${path.sep}`)) return `~${resolved.slice(home.length)}`;
  return resolved;
}

function readConfig(configPath: string, warnings: string[]): RawFavorite[] | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    warnings.push(`Could not read ${configPath}: ${errorMessage(error)}`);
    return undefined;
  }

  const values = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.favorites)
      ? raw.favorites
      : undefined;
  if (!values) {
    warnings.push(`${configPath}: expected an array or an object with a "favorites" array.`);
    return undefined;
  }

  return values.filter(isRawFavorite);
}

function resolveFavorite(
  raw: RawFavorite,
  baseDirectory: string,
  warnings: string[],
  configPath: string,
  env: NodeJS.ProcessEnv,
  homeDirectory: string,
): Favorite | undefined {
  const configuredPath = typeof raw === "string" ? raw : raw.path;
  if (typeof configuredPath !== "string" || configuredPath.trim() === "") {
    warnings.push(`${configPath}: ignored a favorite without a path.`);
    return undefined;
  }

  const resolvedPath = path.resolve(baseDirectory, expandPath(configuredPath.trim(), homeDirectory, env));
  let kind: Favorite["kind"];
  try {
    kind = fs.statSync(resolvedPath).isDirectory() ? "directory" : "file";
  } catch (error) {
    warnings.push(`${configPath}: favorite does not exist: ${resolvedPath}`);
    return undefined;
  }

  const configuredName = typeof raw === "string" ? undefined : raw.name ?? raw.label;
  const name = typeof configuredName === "string" && configuredName.trim()
    ? configuredName.trim()
    : path.basename(resolvedPath) || resolvedPath;

  return { name, path: resolvedPath, kind };
}

function expandPath(value: string, homeDirectory: string, env: NodeJS.ProcessEnv = process.env): string {
  let expanded = value;
  if (expanded === "~" || expanded.startsWith("~/")) {
    expanded = path.join(homeDirectory, expanded.slice(2));
  }
  return expanded.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, variable: string) => {
    if (variable === "HOME") return homeDirectory;
    return env[variable] ?? `$${variable}`;
  });
}

function isRawFavorite(value: unknown): value is RawFavorite {
  return typeof value === "string" || isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return isNodeError(error) && error.code === "ENOENT";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
