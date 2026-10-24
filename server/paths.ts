import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The one place that decides where writable state lives: articles, the word list and
 * settings.json.
 *
 * Each store used to resolve this from `import.meta.url` at module load, which is right while
 * the app runs from its source tree but wrong once it is installed — an installed copy sits
 * under a directory the user may not write to. The packaged launcher therefore sets
 * `ENGLISH_APP_PACKAGED=1` and the data moves to `%LOCALAPPDATA%\english-app\data`, the same
 * `english-app` folder the offline dictionary already uses.
 *
 * Resolution happens per call, never at import time, so a test can point the whole app at a
 * temporary directory by setting `ENGLISH_APP_DATA_DIR` after the modules are loaded.
 */
export function dataRoot(): string {
	const override = process.env.ENGLISH_APP_DATA_DIR;
	if (override) return override;
	if (process.env.ENGLISH_APP_PACKAGED === "1") {
		const local = process.env.LOCALAPPDATA?.trim();
		return join(local && local.length > 0 ? local : join(homedir(), "AppData", "Local"), "english-app", "data");
	}
	// Development: this file lives in server/, so the package root is one level up.
	return join(dirname(fileURLToPath(import.meta.url)), "..", "data");
}

/** The data root, created. Writers call this instead of `dataRoot()` so the directory exists. */
export function ensureDataRoot(): string {
	const root = dataRoot();
	mkdirSync(root, { recursive: true, mode: 0o700 });
	return root;
}
