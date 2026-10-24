import { describe, expect, it } from "vitest";
import { fillMissingDefinitions } from "../server/word-list.ts";
import type { WordFile, WordRecord } from "../server/store/words.ts";

function record(word: string, overrides: Partial<WordRecord> = {}): WordRecord {
	return {
		word,
		ipa: "",
		pos: "",
		meanings: [],
		clicks: 3,
		firstSeenAt: 100,
		lastSeenAt: 200,
		...overrides,
	};
}

function file(...records: WordRecord[]): WordFile {
	return { version: 1, words: Object.fromEntries(records.map((entry) => [entry.word, entry])) };
}

describe("fillMissingDefinitions", () => {
	it("fills every empty field from the local dictionary", () => {
		const result = fillMissingDefinitions(file(record("study")), () => ({
			study: { pos: "n.", meaning: "学习", ipa: "/'stʌdi/" },
		}));
		expect(result.words.study).toMatchObject({ ipa: "/'stʌdi/", pos: "n.", meanings: ["学习"] });
	});

	it("only fills the holes and never replaces a good value", () => {
		const partial = record("serene", { ipa: "/səˈriːn/", pos: "", meanings: ["宁静的"] });
		const result = fillMissingDefinitions(file(partial), () => ({
			serene: { pos: "adj.", meaning: "平静的", ipa: "/wrong/" },
		}));

		expect(result.words.serene.ipa).toBe("/səˈriːn/");
		expect(result.words.serene.meanings).toEqual(["宁静的"]);
		expect(result.words.serene.pos).toBe("adj.");
	});

	it("leaves clicks and timestamps exactly as they were", () => {
		const before = record("apply");
		const result = fillMissingDefinitions(file(before), () => ({
			apply: { pos: "v.", meaning: "申请", ipa: "/əˈplaɪ/" },
		}));

		expect(result.words.apply.clicks).toBe(3);
		expect(result.words.apply.firstSeenAt).toBe(100);
		expect(result.words.apply.lastSeenAt).toBe(200);
		expect(before.ipa).toBe("");
		expect(before.meanings).toEqual([]);
	});

	it("keeps a word the dictionary does not know", () => {
		const result = fillMissingDefinitions(file(record("zzzqqq")), () => ({}));
		expect(result.words.zzzqqq).toEqual(record("zzzqqq"));
	});

	it("returns the file untouched when a source throws", () => {
		const original = file(record("study"));
		const result = fillMissingDefinitions(original, () => {
			throw new Error("dictionary offline");
		});
		expect(result).toBe(original);
	});

	it("does not open the dictionary when every record is complete", () => {
		let calls = 0;
		const original = file(record("study", { ipa: "/a/", pos: "n.", meanings: ["学习"] }));
		const result = fillMissingDefinitions(original, () => {
			calls += 1;
			return {};
		});
		expect(calls).toBe(0);
		expect(result).toBe(original);
	});

	it("asks only for the incomplete words, once each", () => {
		const seen: string[][] = [];
		fillMissingDefinitions(
			file(record("study"), record("law"), record("the", { ipa: "/ðə/", pos: "art.", meanings: ["这"] })),
			(words) => {
				seen.push(words);
				return {};
			},
		);
		expect(seen).toEqual([["study", "law"]]);
	});
});
