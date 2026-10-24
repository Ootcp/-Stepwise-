import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { dataRoot, ensureDataRoot } from "../server/paths.ts";
import { articlesDir } from "../server/store/articles.ts";
import { wordsPath } from "../server/store/words.ts";
import { settingsPath } from "../server/settings.ts";

/**
 * Where writable state lives. The installed copy must not write next to its own program files,
 * so the decision moved out of the three stores into one lazy resolver; these are the three
 * cases it has to keep apart.
 */

const created: string[] = [];
const saved = {
	ENGLISH_APP_DATA_DIR: process.env.ENGLISH_APP_DATA_DIR,
	ENGLISH_APP_PACKAGED: process.env.ENGLISH_APP_PACKAGED,
	LOCALAPPDATA: process.env.LOCALAPPDATA,
};

function tempRoot(): string {
	const dir = mkTemp();
	created.push(dir);
	return dir;
}

function mkTemp(): string {
	const dir = join(tmpdir(), `shiji-paths-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

afterEach(() => {
	for (const key of ["ENGLISH_APP_DATA_DIR", "ENGLISH_APP_PACKAGED", "LOCALAPPDATA"] as const) {
		const value = saved[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("dataRoot", () => {
	it("lets an explicit directory win over everything else", () => {
		const dir = tempRoot();
		process.env.ENGLISH_APP_DATA_DIR = dir;
		process.env.ENGLISH_APP_PACKAGED = "1";
		expect(dataRoot()).toBe(dir);
	});

	it("moves to the per-user application data when running from an installation", () => {
		const local = tempRoot();
		delete process.env.ENGLISH_APP_DATA_DIR;
		process.env.ENGLISH_APP_PACKAGED = "1";
		process.env.LOCALAPPDATA = local;
		expect(dataRoot()).toBe(join(local, "english-app", "data"));
	});

	it("falls back to the home directory when LOCALAPPDATA is missing", () => {
		delete process.env.ENGLISH_APP_DATA_DIR;
		delete process.env.LOCALAPPDATA;
		process.env.ENGLISH_APP_PACKAGED = "1";
		expect(isAbsolute(dataRoot())).toBe(true);
		expect(dataRoot()).toContain(join("english-app", "data"));
	});

	it("keeps a source checkout writing inside the package", () => {
		delete process.env.ENGLISH_APP_DATA_DIR;
		delete process.env.ENGLISH_APP_PACKAGED;
		const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
		expect(dataRoot()).toBe(join(packageRoot, "data"));
		// Development never reaches outside the package, so an untouched install cannot
		// mistake these files for program data.
		expect(dataRoot().startsWith(packageRoot)).toBe(true);
	});
});

describe("ensureDataRoot", () => {
	it("creates the directory and returns it", () => {
		const dir = join(tempRoot(), "not", "there", "yet");
		process.env.ENGLISH_APP_DATA_DIR = dir;
		expect(existsSync(dir)).toBe(false);
		expect(ensureDataRoot()).toBe(dir);
		expect(existsSync(dir)).toBe(true);
	});
});

describe("stores follow the resolved directory", () => {
	it("re-reading the environment is enough to move all three", () => {
		const first = tempRoot();
		process.env.ENGLISH_APP_DATA_DIR = first;
		writeFileSync(join(first, "keep.txt"), "x", "utf8");
		expect(articlesDir()).toBe(join(first, "articles"));
		expect(wordsPath()).toBe(join(first, "words.json"));
		expect(settingsPath()).toBe(join(first, "settings.json"));

		const second = tempRoot();
		process.env.ENGLISH_APP_DATA_DIR = second;
		expect(articlesDir()).toBe(join(second, "articles"));
		expect(wordsPath()).toBe(join(second, "words.json"));
		expect(settingsPath()).toBe(join(second, "settings.json"));
	});
});
