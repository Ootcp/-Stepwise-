import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "english-app-syllable-service-"));
process.env.ENGLISH_APP_DATA_DIR = dataDir;

// Imported after the env var is set so the store resolves the temp directory at load time.
const { SYLLABLE_BATCH, ensureSyllables } = await import("../server/syllables.ts");
const { syllablesPath } = await import("../server/store/syllables.ts");

beforeEach(() => {
	rmSync(syllablesPath(), { force: true });
	rmSync(`${syllablesPath()}.tmp`, { force: true });
});

afterEach(() => {
	rmSync(syllablesPath(), { force: true });
});

describe("ensureSyllables", () => {
	it("asks for the words the cache has never seen and returns everything", async () => {
		const asked: string[][] = [];
		const first = await ensureSyllables(["study", "law"], (words) => {
			asked.push(words);
			return Promise.resolve({ study: ["stud", "y"], law: ["l", "aw"] });
		});
		expect(asked).toEqual([["study", "law"]]);
		expect(first).toEqual({ study: ["stud", "y"], law: ["l", "aw"] });

		// The second call is served from the cache and does not reach the model again.
		const second = await ensureSyllables(["study", "law"], () => Promise.reject(new Error("should not run")));
		expect(second).toEqual({ study: ["stud", "y"], law: ["l", "aw"] });
	});

	it("shares one model call between concurrent loads", async () => {
		let calls = 0;
		const split = (words: string[]) => {
			calls += 1;
			return Promise.resolve(Object.fromEntries(words.map((word) => [word, [word]])));
		};
		const [a, b] = await Promise.all([ensureSyllables(["study"], split), ensureSyllables(["law"], split)]);
		// The second load joins the call already running instead of hammering the provider, so
		// it is served from whatever that call cached — divisions are a nicety, not a gate.
		expect(calls).toBe(1);
		expect(a.study).toEqual(["study"]);
		expect(b.law).toBeUndefined();

		// The word it missed is picked up by the next load, which asks only for what is missing.
		const later = await ensureSyllables(["law"], () => Promise.resolve({ law: ["law"] }));
		expect(calls).toBe(1);
		expect(later.law).toEqual(["law"]);
	});

	it("dedupes and caps the batch", async () => {
		const many = Array.from({ length: SYLLABLE_BATCH + 10 }, (_, index) => `w${index}`);
		const asked: string[][] = [];
		await ensureSyllables([...many, ...many], (words) => {
			asked.push(words);
			return Promise.resolve({});
		});
		expect(asked[0]).toHaveLength(SYLLABLE_BATCH);
	});

	it("returns nothing and stays quiet when the model fails", async () => {
		const result = await ensureSyllables(["study"], () => Promise.reject(new Error("no key")));
		expect(result).toEqual({});
	});

	it("does not ask at all when every word is already cached", async () => {
		await ensureSyllables(["study"], (words) => Promise.resolve(Object.fromEntries(words.map((w) => [w, [w]]))));
		let calls = 0;
		await ensureSyllables(["study"], () => {
			calls += 1;
			return Promise.resolve({});
		});
		expect(calls).toBe(0);
	});

	it("drops a division that does not re-form the word before caching it", async () => {
		await ensureSyllables(["study"], () => Promise.resolve({ study: ["wrong", "way"] }));
		const result = await ensureSyllables(["other"], () => Promise.resolve({ other: ["other"] }));
		expect(result.study).toBeUndefined();
	});
});
