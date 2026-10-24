import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "english-app-syllables-"));
process.env.ENGLISH_APP_DATA_DIR = dataDir;

// Imported after the env var is set so the module resolves the temp directory at load time.
const { listSyllables, missingSyllables, normalizeSegments, saveSyllables, syllablesPath } = await import(
	"../server/store/syllables.ts"
);

afterEach(() => {
	rmSync(syllablesPath(), { force: true });
	rmSync(`${syllablesPath()}.tmp`, { force: true });
});

describe("normalizeSegments", () => {
	it("accepts a division that re-forms the word", () => {
		expect(normalizeSegments("study", ["stud", "y"])).toEqual(["stud", "y"]);
	});

	it("rejects a division that loses or invents letters", () => {
		expect(normalizeSegments("study", ["stud", "dee"])).toBeUndefined();
		expect(normalizeSegments("study", ["stud"])).toBeUndefined();
	});

	it("rejects a non-array or an empty segment", () => {
		expect(normalizeSegments("study", "stu-dy")).toBeUndefined();
		expect(normalizeSegments("study", ["", "study"])).toBeUndefined();
	});
});

describe("saveSyllables and listSyllables", () => {
	it("keeps only the entries that belong to their key", () => {
		const saved = saveSyllables({
			study: ["stud", "y"],
			law: ["la", "w"],
			bad: ["no", "t"],
		});
		// `bad` is counted as rejected: ["no","t"] does not re-form it.
		expect(saved).toBe(2);
		const words = listSyllables();
		expect(words.study).toEqual(["stud", "y"]);
		// A division that does not re-form the key is dropped instead of being shown as truth.
		expect(words.bad).toBeUndefined();
	});

	it("reports which words the cache has never seen", () => {
		saveSyllables({ study: ["stud", "y"] });
		expect(missingSyllables(["Study", "law", "study"])).toEqual(["law"]);
	});

	it("reads back an entry stored as an object", () => {
		writeFileSync(
			syllablesPath(),
			JSON.stringify({ version: 1, words: { law: { segments: ["l", "aw"], at: 123 } } }),
			"utf8",
		);
		expect(listSyllables().law).toEqual(["l", "aw"]);
	});

	it("starts empty when the file is missing or corrupt", () => {
		expect(listSyllables()).toEqual({});
		writeFileSync(syllablesPath(), "not json", "utf8");
		expect(listSyllables()).toEqual({});
	});

	it("writes an indented file and leaves no temp behind", () => {
		saveSyllables({ law: ["l", "aw"] });
		expect(readFileSync(syllablesPath(), "utf8")).toContain('\n\t"words":');
		expect(() => readFileSync(`${syllablesPath()}.tmp`)).toThrow();
	});

	it("saves nothing when the batch is empty", () => {
		expect(saveSyllables({})).toBe(0);
	});
});
