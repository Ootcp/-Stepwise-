import { describe, expect, it } from "vitest";
import { countLetters, diffColumns, isAccepted, segmentedWord, targetColumns } from "../web/spell-diff.ts";

const letters = (cells: ReturnType<typeof diffColumns>) => cells.filter((cell) => cell.kind === "char");

describe("targetColumns", () => {
	it("inserts a separator column at every syllable boundary", () => {
		expect(targetColumns("study", ["stud", "y"]).map((cell) => cell.target)).toEqual(["s", "t", "u", "d", "·", "y"]);
	});

	it("leaves the word alone when there are no usable segments", () => {
		expect(targetColumns("study")).toHaveLength(5);
		expect(targetColumns("study", ["stud"])).toHaveLength(5);
		expect(targetColumns("study", ["wrong", "way"])).toHaveLength(5);
	});

	it("keeps the separator out of the way of a real hyphen", () => {
		// `well-grounded` already owns a hyphen; a second one next to it reads like a typo.
		expect(targetColumns("well-grounded", ["well-", "grounded"]).filter((cell) => cell.kind === "sep")).toHaveLength(0);
		expect(targetColumns("everyday", ["ev", "ery", "day"]).filter((cell) => cell.kind === "sep")).toHaveLength(2);
	});
});

describe("diffColumns", () => {
	it("marks every letter right when the answer matches", () => {
		const cells = diffColumns("law", "law");
		expect(cells.every((cell) => cell.state === "right")).toBe(true);
		expect(isAccepted(cells)).toBe(true);
	});

	it("ignores case and surrounding spaces", () => {
		expect(isAccepted(diffColumns("study", "  Study "))).toBe(true);
	});

	it("marks the matching letters green and the wrong ones red, showing what was typed", () => {
		const cells = letters(diffColumns("study", "skudy"));
		expect(cells.map((cell) => cell.state)).toEqual(["right", "wrong", "right", "right", "right"]);
		expect(cells[1].typed).toBe("k");
		expect(cells[1].target).toBe("t");
		expect(isAccepted(cells)).toBe(false);
	});

	it("marks the letters the answer left out, and keeps the target visible", () => {
		const cells = letters(diffColumns("study", "stu"));
		expect(cells.map((cell) => cell.state)).toEqual(["right", "right", "right", "missing", "missing"]);
		expect(cells[3].target).toBe("d");
		expect(cells[3].mark).toBe("缺");
	});

	it("marks the extra letters the answer added", () => {
		const cells = diffColumns("law", "laww");
		expect(cells.map((cell) => cell.state)).toEqual(["right", "right", "right", "extra"]);
		expect(cells[3].target).toBe("");
		expect(cells[3].mark).toBe("多");
	});

	it("puts the separator only on the target side so both rows keep the same column count", () => {
		const cells = diffColumns("study", "skudy", ["stud", "y"]);
		expect(cells).toHaveLength(6);
		expect(cells[4].kind).toBe("sep");
		expect(countLetters(cells)).toEqual({ right: 4, total: 5 });
	});

	it("counts only letters, never separators", () => {
		expect(countLetters(diffColumns("study", "study", ["stud", "y"]))).toEqual({ right: 5, total: 5 });
	});
});

describe("segmentedWord", () => {
	it("is the text form of the correction line", () => {
		expect(segmentedWord("traditionally", ["tra", "di", "tion", "al", "ly"])).toBe("tra·di·tion·al·ly");
	});

	it("falls back to the bare word when the segments do not fit", () => {
		expect(segmentedWord("study", ["nope"])).toBe("study");
		expect(segmentedWord("study")).toBe("study");
	});
});
