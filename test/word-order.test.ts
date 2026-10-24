import { describe, expect, it } from "vitest";
import type { WordRecord } from "../web/api.ts";
import { isWordOrder, isWordSort, makeComparator, normalize, searchText, type MissStat } from "../web/word-order.ts";

function record(word: string, overrides: Partial<WordRecord> = {}): WordRecord {
	return {
		word,
		ipa: "",
		pos: "",
		meanings: [],
		clicks: 1,
		firstSeenAt: 0,
		lastSeenAt: 0,
		...overrides,
	};
}

function sorted(records: WordRecord[], order: "recent" | "frequent" | "alpha" | "error", misses: Record<string, MissStat> = {}): string[] {
	return [...records]
		.sort(makeComparator(order, (word) => misses[word] ?? { misses: 0, lastWrongAt: 0 }))
		.map((record) => record.word);
}

const law = record("law", { clicks: 3, lastSeenAt: 100 });
const study = record("study", { clicks: 6, lastSeenAt: 300 });
const apply = record("apply", { clicks: 1, lastSeenAt: 200 });

describe("makeComparator", () => {
	it("orders by most recently seen", () => {
		expect(sorted([law, study, apply], "recent")).toEqual(["study", "apply", "law"]);
	});

	it("orders by click count and falls back to recency", () => {
		expect(sorted([law, study, apply], "frequent")).toEqual(["study", "law", "apply"]);
		expect(sorted([record("a", { clicks: 2, lastSeenAt: 5 }), record("b", { clicks: 2, lastSeenAt: 9 })], "frequent")).toEqual([
			"b",
			"a",
		]);
	});

	it("orders alphabetically and ignores the other scores", () => {
		expect(sorted([study, law, apply], "alpha")).toEqual(["apply", "law", "study"]);
	});

	it("puts the most misspelled words first", () => {
		const misses = { law: { misses: 4, lastWrongAt: 10 }, apply: { misses: 4, lastWrongAt: 20 }, study: { misses: 1, lastWrongAt: 99 } };
		expect(sorted([study, law, apply], "error", misses)).toEqual(["apply", "law", "study"]);
	});

	it("sorts words that were never misspelled by recency", () => {
		const misses = { law: { misses: 2, lastWrongAt: 5 } };
		expect(sorted([study, law, apply], "error", misses)).toEqual(["law", "study", "apply"]);
	});

	it("breaks every tie on the word so a re-render cannot reshuffle", () => {
		const pair = [record("zeta", { clicks: 1, lastSeenAt: 1 }), record("alpha", { clicks: 1, lastSeenAt: 1 })];
		expect(sorted(pair, "recent")).toEqual(["alpha", "zeta"]);
		expect(sorted(pair, "error")).toEqual(["alpha", "zeta"]);
	});
});

describe("searchText", () => {
	it("matches the word, the gloss, the part of speech and the IPA", () => {
		const entry = record("study", { ipa: "/'stʌdi/", pos: "n.", meanings: ["学习", "研究"] });
		for (const needle of ["study", "学习", "n.", "stʌdi"]) {
			expect(searchText(entry).includes(normalize(needle)), needle).toBe(true);
		}
		expect(searchText(entry).includes("zzz")).toBe(false);
	});
});

describe("order guards", () => {
	it("accepts the ledger's three orders and the drill's fourth", () => {
		expect(isWordSort("recent")).toBe(true);
		expect(isWordSort("error")).toBe(false);
		expect(isWordOrder("error")).toBe(true);
		expect(isWordOrder("nonsense")).toBe(false);
		expect(isWordOrder(null)).toBe(false);
		expect(isWordOrder(undefined)).toBe(false);
	});
});
