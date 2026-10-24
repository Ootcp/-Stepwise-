import { describe, expect, it } from "vitest";
import {
	allSentences,
	normalizeWord,
	parseArticle,
	sentenceMarker,
	splitParagraphs,
	splitSentences,
	tokenize,
} from "../web/text.ts";

describe("splitParagraphs", () => {
	it("treats a blank line and a single newline both as paragraph breaks", () => {
		expect(splitParagraphs("First block.\n\nSecond block.")).toEqual(["First block.", "Second block."]);
		expect(splitParagraphs("Line one.\nLine two.")).toEqual(["Line one.", "Line two."]);
	});

	it("drops blank lines and surrounding whitespace", () => {
		expect(splitParagraphs("\n\n  Hello.  \n\n\n  World.\n")).toEqual(["Hello.", "World."]);
	});
});

describe("splitSentences", () => {
	it("splits on terminal punctuation", () => {
		expect(splitSentences("I came. I saw! Did you?")).toEqual(["I came.", "I saw!", "Did you?"]);
	});

	it("keeps abbreviations attached to the following word", () => {
		expect(splitSentences("Mr. Smith arrived. He waited.")).toEqual(["Mr. Smith arrived.", "He waited."]);
		expect(splitSentences("Bring pens, etc. and paper.")).toEqual(["Bring pens, etc. and paper."]);
	});

	it("keeps decimal numbers intact", () => {
		expect(splitSentences("Pi is about 3.14 in value. It matters.")).toEqual([
			"Pi is about 3.14 in value.",
			"It matters.",
		]);
	});

	it("recovers a missing space after a sentence period", () => {
		expect(splitSentences("That is the news.For example, evidence matters.")).toEqual([
			"That is the news.",
			"For example, evidence matters.",
		]);
		expect(splitSentences("Their judgments.These can only come from study.")).toEqual([
			"Their judgments.",
			"These can only come from study.",
		]);
	});

	it("keeps an abbreviation with internal periods in one sentence", () => {
		expect(splitSentences("He has a Ph.D. in physics. She left.")).toEqual([
			"He has a Ph.D. in physics.",
			"She left.",
		]);
	});

	it("returns nothing for an empty paragraph", () => {
		expect(splitSentences("   ")).toEqual([]);
	});
});

describe("parseArticle", () => {
	it("numbers sentences across the whole article, not per paragraph", () => {
		const paragraphs = parseArticle("One. Two.\n\nThree.");
		expect(allSentences(paragraphs)).toEqual(["One.", "Two.", "Three."]);
		expect(paragraphs).toHaveLength(2);
	});
});

describe("sentenceMarker", () => {
	it("uses circled digits for the first twenty sentences", () => {
		expect(sentenceMarker(0)).toBe("①");
		expect(sentenceMarker(19)).toBe("⑳");
	});

	it("falls back to parenthesized digits past twenty", () => {
		expect(sentenceMarker(20)).toBe("(21)");
	});
});

describe("tokenize", () => {
	it("marks English words and keeps punctuation as plain text", () => {
		const tokens = tokenize("Hello, world!");
		expect(tokens.map((token) => token.text).join("")).toBe("Hello, world!");
		expect(tokens.filter((token) => token.word !== undefined).map((token) => token.word)).toEqual(["Hello", "world"]);
	});

	it("treats apostrophes and hyphens as part of a word", () => {
		expect(
			tokenize("It's well-known.")
				.filter((token) => token.word)
				.map((token) => token.word),
		).toEqual(["It's", "well-known"]);
	});

	it("does not treat numbers as lookupable words", () => {
		expect(
			tokenize("In 2024 we shipped.")
				.filter((token) => token.word)
				.map((token) => token.word),
		).toEqual(["In", "we", "shipped"]);
	});
});

describe("normalizeWord", () => {
	it("lowercases and strips a possessive or trailing hyphen", () => {
		expect(normalizeWord("Running")).toBe("running");
		expect(normalizeWord("it's")).toBe("it");
		expect(normalizeWord("well-")).toBe("well");
	});
});
