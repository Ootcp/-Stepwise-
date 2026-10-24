import { describe, expect, it } from "vitest";
import { normalizePos } from "../server/pos.ts";

describe("normalizePos", () => {
	it("returns only the abbreviation", () => {
		expect(normalizePos("n.")).toBe("n.");
		expect(normalizePos("adj.")).toBe("adj.");
		expect(normalizePos("v.")).toBe("v.");
		expect(normalizePos("prep.")).toBe("prep.");
	});

	it("accepts full English words", () => {
		expect(normalizePos("noun")).toBe("n.");
		expect(normalizePos("adjective")).toBe("adj.");
		expect(normalizePos("Adverb")).toBe("adv.");
	});

	it("accepts a Chinese answer from a model and still outputs the abbreviation", () => {
		expect(normalizePos("形容词")).toBe("adj.");
		expect(normalizePos("介词")).toBe("prep.");
		expect(normalizePos("名词")).toBe("n.");
	});

	it("returns an empty string rather than guessing", () => {
		expect(normalizePos(undefined)).toBe("");
		expect(normalizePos("")).toBe("");
		expect(normalizePos("something else")).toBe("");
	});

	it("resolves the longer match when a label contains another", () => {
		expect(normalizePos("情态动词")).toBe("modal.");
		expect(normalizePos("不及物动词")).toBe("vi.");
		expect(normalizePos("及物动词")).toBe("vt.");
	});
});
