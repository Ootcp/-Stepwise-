import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "english-app-words-"));
process.env.ENGLISH_APP_DATA_DIR = dataDir;

// Imported after the env var is set so the module resolves the temp directory at load time.
const { listWords, upsert, wordsPath } = await import("../server/store/words.ts");

function file(): ReturnType<typeof readFileSync> {
	return readFileSync(wordsPath(), "utf8");
}

afterEach(() => {
	rmSync(wordsPath(), { force: true });
	rmSync(`${wordsPath()}.tmp`, { force: true });
});

describe("upsert creates new records", () => {
	it("stores a word with its first meaning and click count of one", () => {
		const updated = upsert(["Ephemeral"], { ephemeral: { pos: "adj.", meaning: "短暂的", ipa: "/x/" } });
		expect(updated.ephemeral.clicks).toBe(1);
		expect(updated.ephemeral.pos).toBe("adj.");
		expect(updated.ephemeral.ipa).toBe("/x/");
		expect(updated.ephemeral.meanings).toEqual(["短暂的"]);
		expect(updated.ephemeral.firstSeenAt).toBe(updated.ephemeral.lastSeenAt);
	});

	it("normalizes the word to lowercase", () => {
		upsert(["Serene"], {});
		expect(Object.keys(listWords().words)).toEqual(["serene"]);
	});

	it("writes an indented file", () => {
		upsert(["serene"], { serene: { meaning: "宁静的" } });
		expect(file().toString()).toContain('\n\t"words":');
	});
});

describe("upsert merges with what is already stored", () => {
	it("accumulates clicks on repeated words", () => {
		upsert(["serene"], { serene: { meaning: "宁静的" } });
		upsert(["serene"], { serene: { meaning: "宁静的" } });
		expect(listWords().words.serene.clicks).toBe(2);
	});

	it("appends a different meaning instead of replacing", () => {
		upsert(["linger"], { linger: { meaning: "逗留" } });
		upsert(["linger"], { linger: { meaning: "徘徊" } });
		expect(listWords().words.linger.meanings).toEqual(["逗留", "徘徊"]);
	});

	it("does not append the same meaning twice", () => {
		upsert(["linger"], { linger: { meaning: "逗留" } });
		upsert(["linger"], { linger: { meaning: "逗留" } });
		expect(listWords().words.linger.meanings).toEqual(["逗留"]);
	});

	it("never overwrites a non-empty pos or ipa", () => {
		upsert(["serene"], { serene: { pos: "adj.", ipa: "/good/" } });
		upsert(["serene"], { serene: { pos: "n.", ipa: "/bad/" } });
		const record = listWords().words.serene;
		expect(record.pos).toBe("adj.");
		expect(record.ipa).toBe("/good/");
	});

	it("fills an empty pos and ipa from a later source", () => {
		upsert(["serene"], { serene: { meaning: "宁静的" } });
		upsert(["serene"], { serene: { pos: "adj.", ipa: "/səˈriːn/" } });
		const record = listWords().words.serene;
		expect(record.pos).toBe("adj.");
		expect(record.ipa).toBe("/səˈriːn/");
	});

	it("keeps firstSeenAt but advances lastSeenAt", async () => {
		upsert(["serene"], { serene: { meaning: "宁静的" } });
		const first = listWords().words.serene.firstSeenAt;
		await new Promise((resolve) => setTimeout(resolve, 5));
		upsert(["serene"], { serene: { meaning: "平静的" } });
		const record = listWords().words.serene;
		expect(record.firstSeenAt).toBe(first);
		expect(record.lastSeenAt).toBeGreaterThan(first);
	});

	it("counts a click even when no definition is supplied yet", () => {
		upsert(["serene"], {});
		upsert(["serene"], {});
		const record = listWords().words.serene;
		expect(record.clicks).toBe(2);
		expect(record.meanings).toEqual([]);
	});
});

describe("listWords resilience", () => {
	it("starts empty when the file is missing", () => {
		expect(listWords()).toEqual({ version: 1, words: {} });
	});

	it("starts empty when the file is corrupt", () => {
		upsert(["serene"], { serene: { meaning: "宁静的" } });
		writeFileSync(wordsPath(), "{ broken", "utf8");
		expect(listWords().words).toEqual({});
	});

	it("drops malformed records", () => {
		upsert(["serene"], { serene: { meaning: "宁静的" } });
		const parsed = JSON.parse(file().toString()) as { words: Record<string, unknown> };
		parsed.words.broken = "not an object";
		parsed.words.numbers = { word: "x", clicks: "many", meanings: [1, 2] };
		writeFileSync(wordsPath(), JSON.stringify(parsed), "utf8");
		const words = listWords().words;
		expect(words.serene).toBeDefined();
		expect(words.broken).toBeUndefined();
		expect(words.numbers?.clicks).toBe(0);
		expect(words.numbers?.meanings).toEqual([]);
	});
});

describe("upsert with nothing to do", () => {
	it("skips blank words and does not create the file", () => {
		upsert(["   ", ""], {});
		expect(existsSync(wordsPath())).toBe(false);
	});
});
