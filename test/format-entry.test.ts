import { describe, expect, it } from "vitest";
import { formatEntry } from "../web/glossary.ts";

/**
 * The tooltip line is the only place the phonetics are shown, so the formatting rules matter:
 * every segment is optional and none of them may leave a stray space behind.
 */
describe("formatEntry", () => {
	it("shows phonetics, part of speech and meaning in that order", () => {
		expect(formatEntry({ word: "x", ipa: "/səˈriːn/", pos: "adj.", meaning: "宁静的" } as never)).toBe(
			"/səˈriːn/ adj. 宁静的",
		);
	});

	it("omits the phonetics when there is none", () => {
		expect(formatEntry({ ipa: "", pos: "n.", meaning: "图书馆" } as never)).toBe("n. 图书馆");
	});

	it("omits the part of speech when there is none", () => {
		expect(formatEntry({ ipa: "/lib.rəri/", pos: "", meaning: "图书馆" } as never)).toBe("/lib.rəri/ 图书馆");
	});

	it("shows only the meaning when neither is known", () => {
		expect(formatEntry({ ipa: "", pos: "", meaning: "图书馆" } as never)).toBe("图书馆");
	});

	it("never leaves leading, trailing or doubled spaces", () => {
		expect(formatEntry({ ipa: " ", pos: " ", meaning: "词" } as never)).toBe("词");
	});
});
