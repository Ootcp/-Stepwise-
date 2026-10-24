import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "english-app-practice-"));
process.env.ENGLISH_APP_DATA_DIR = dataDir;

// Imported after the env var is set so the module resolves the temp directory at load time.
const { listPractice, practicePath, recordAttempt } = await import("../server/store/practice.ts");

function file(): string {
	return readFileSync(practicePath(), "utf8");
}

afterEach(() => {
	rmSync(practicePath(), { force: true });
	rmSync(`${practicePath()}.tmp`, { force: true });
});

describe("recordAttempt", () => {
	it("starts a word at one attempt and no misses", () => {
		const record = recordAttempt("Study", true);
		expect(record.word).toBe("study");
		expect(record.attempts).toBe(1);
		expect(record.misses).toBe(0);
		expect(record.lastCorrectAt).toBeGreaterThan(0);
		expect(record.lastWrongAt).toBe(0);
	});

	it("counts a miss and remembers when it happened", () => {
		const before = Date.now();
		const record = recordAttempt("study", false);
		expect(record.misses).toBe(1);
		expect(record.lastWrongAt).toBeGreaterThanOrEqual(before);
	});

	it("accumulates across attempts of the same word", () => {
		recordAttempt("study", false);
		recordAttempt("study", true);
		const third = recordAttempt("study", false);
		expect(third.attempts).toBe(3);
		expect(third.misses).toBe(2);
	});

	it("normalizes case and refuses an unusable key", () => {
		expect(recordAttempt("  Well-Grounded  ", true).word).toBe("well-grounded");
		expect(() => recordAttempt("two words", true)).toThrow();
		expect(() => recordAttempt("33letter", true)).toThrow();
	});

	it("writes an indented file and leaves no temp behind", () => {
		recordAttempt("study", true);
		expect(file()).toContain('\n\t"words":');
		expect(() => readFileSync(`${practicePath()}.tmp`)).toThrow();
	});
});

describe("listPractice", () => {
	it("starts empty when the file is missing or corrupt", () => {
		expect(listPractice().words).toEqual({});
		writeFileSync(practicePath(), "{ not json", "utf8");
		expect(listPractice().words).toEqual({});
	});

	it("drops records whose key is not a word", () => {
		writeFileSync(
			practicePath(),
			JSON.stringify({
				version: 1,
				words: {
					study: { word: "study", attempts: 4, misses: 2, lastWrongAt: 100, lastCorrectAt: 200, updatedAt: 200 },
					"not a word": { word: "not a word", attempts: 9, misses: 9, lastWrongAt: 1, lastCorrectAt: 1, updatedAt: 1 },
					bad: { word: "bad", attempts: "many", misses: -3, lastWrongAt: "soon", updatedAt: 5 },
				},
			}),
			"utf8",
		);
		const words = listPractice().words;
		expect(Object.keys(words)).toEqual(["study", "bad"]);
		expect(words.study.attempts).toBe(4);
		// A non-numeric count becomes 0 rather than NaN, and a future timestamp is dropped.
		expect(words.bad.attempts).toBe(0);
		expect(words.bad.lastWrongAt).toBe(0);
	});

	it("never lets misses exceed attempts", () => {
		writeFileSync(
			practicePath(),
			JSON.stringify({
				version: 1,
				words: { law: { word: "law", attempts: 2, misses: 9, lastWrongAt: 1, lastCorrectAt: 0, updatedAt: 1 } },
			}),
			"utf8",
		);
		expect(listPractice().words.law.misses).toBe(2);
	});
});
