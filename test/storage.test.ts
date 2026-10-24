import { describe, expect, it } from "vitest";
import { GlossaryCache } from "../web/glossary.ts";
import { browserStorage } from "../web/storage.ts";

/**
 * The definition cache that makes a second click on the same word instant. It is a local
 * mirror of the server dictionary, kept separate on purpose: the server owns the canonical
 * record, this only avoids a round trip.
 */
describe("GlossaryCache", () => {
	it("round-trips definitions and persists them", () => {
		const storage = browserStorage();
		const cache = new GlossaryCache(storage);
		cache.set("serene", { pos: "形容词", meaning: "宁静的", ipa: "/səˈriːn/" });
		expect(cache.get("serene")).toEqual({ pos: "形容词", meaning: "宁静的", ipa: "/səˈriːn/" });
		expect(new GlossaryCache(storage).get("serene")).toEqual({ pos: "形容词", meaning: "宁静的", ipa: "/səˈriːn/" });
	});

	it("stores a batch in one pass", () => {
		const cache = new GlossaryCache(browserStorage());
		cache.setMany({ a: { pos: "冠词", meaning: "一个", ipa: "" }, b: { pos: "名词", meaning: "书", ipa: "" } });
		expect(cache.get("b")?.meaning).toBe("书");
	});

	it("evicts the oldest entry once the cap is exceeded", () => {
		const cache = new GlossaryCache(browserStorage());
		const batch: Record<string, { pos: string; meaning: string; ipa: string }> = {};
		for (let index = 0; index < 850; index += 1) batch[`w${index}`] = { pos: "n", meaning: `m${index}`, ipa: "" };
		cache.setMany(batch);
		expect(cache.size()).toBe(800);
		expect(cache.get("w0")).toBeUndefined();
		expect(cache.get("w849")).toEqual({ pos: "n", meaning: "m849", ipa: "" });
	});

	it("keeps the most recently written definition for a repeated word", () => {
		const cache = new GlossaryCache(browserStorage());
		cache.setMany({ w: { pos: "n", meaning: "旧", ipa: "" }, x: { pos: "n", meaning: "新", ipa: "" } });
		cache.set("w", { pos: "adj", meaning: "新", ipa: "" });
		expect(cache.get("w")?.meaning).toBe("新");
	});

	it("survives a corrupt storage payload", () => {
		const storage = browserStorage();
		storage.setItem("english-app:glossary", "][");
		expect(new GlossaryCache(storage).get("anything")).toBeUndefined();
	});
});
