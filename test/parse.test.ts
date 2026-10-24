import { describe, expect, it } from "vitest";
import { cleanIpa, parseLookupReply } from "../server/parse.ts";

describe("parseLookupReply", () => {
	it("parses the map shape the prompt asks for", () => {
		const reply = '{"serene": {"pos": "形容词", "meaning": "平静的", "ipa": "/səˈriːn/"}}';
		expect(parseLookupReply(reply)).toEqual([
			{ word: "serene", entry: { pos: "形容词", meaning: "平静的", ipa: "/səˈriːn/" } },
		]);
	});

	it("parses an array of rows", () => {
		const reply = '[{"word": "serene", "pos": "形容词", "meaning": "平静的"}]';
		expect(parseLookupReply(reply)).toEqual([
			{ word: "serene", entry: { pos: "形容词", meaning: "平静的", ipa: "" } },
		]);
	});

	it("parses an array wrapped in a code fence", () => {
		const reply = '```json\n[{"word": "serene", "meaning": "平静的"}]\n```';
		expect(parseLookupReply(reply)).toHaveLength(1);
	});

	it("parses an array nested under a wrapper key", () => {
		const reply = '{"words": [{"word": "serene", "pos": "形容词", "meaning": "平静的"}]}';
		expect(parseLookupReply(reply)).toHaveLength(1);
	});

	it("ignores prose around the JSON", () => {
		const reply = '好的,结果如下: {"serene": {"pos": "形容词", "meaning": "平静的"}} 希望有帮助。';
		expect(parseLookupReply(reply)).toHaveLength(1);
	});

	it("drops <think> blocks", () => {
		const reply = '<think>user said hi</think>{"a": {"meaning": "甲"}}';
		expect(parseLookupReply(reply)).toEqual([{ word: "a", entry: { pos: "", meaning: "甲", ipa: "" } }]);
	});

	it("accepts part_of_speech and a meanings array", () => {
		const reply = '[{"word": "good", "part_of_speech": "形容词", "meanings": ["好的", "擅长的"]}]';
		expect(parseLookupReply(reply)).toEqual([
			{ word: "good", entry: { pos: "形容词", meaning: "好的、擅长的", ipa: "" } },
		]);
	});

	it("reads the phonetic under any of its aliases", () => {
		expect(parseLookupReply('{"a": {"meaning": "甲", "phonetic": "/t/"}}')[0].entry.ipa).toBe("/t/");
		expect(parseLookupReply('{"a": {"meaning": "甲", "pronunciation": "/p/"}}')[0].entry.ipa).toBe("/p/");
	});

	it("defaults the part of speech to empty when the model omits it", () => {
		expect(parseLookupReply('{"the": {"meaning": "这"}}')).toEqual([
			{ word: "the", entry: { pos: "", meaning: "这", ipa: "" } },
		]);
	});

	it("skips rows with no meaning", () => {
		const reply = '{"a": {"pos": "名词"}, "b": {"meaning": "乙"}}';
		expect(parseLookupReply(reply).map((row) => row.word)).toEqual(["b"]);
	});

	it("returns an empty array for an unparseable reply instead of throwing", () => {
		expect(parseLookupReply("I cannot help with that.")).toEqual([]);
		expect(parseLookupReply("")).toEqual([]);
		expect(parseLookupReply("not { json at all")).toEqual([]);
	});
});

describe("cleanIpa", () => {
	it("keeps a slash-delimited transcription", () => {
		expect(cleanIpa("/səˈriːn/")).toBe("/səˈriːn/");
	});

	it("adds slashes when the source omits them", () => {
		expect(cleanIpa("səˈriːn")).toBe("/səˈriːn/");
		expect(cleanIpa("[dɪˈkʌʃən]")).toBe("/dɪˈkʌʃən/");
		expect(cleanIpa("(dɪˈkʌʃən)")).toBe("/dɪˈkʌʃən/");
	});

	it("strips whitespace", () => {
		expect(cleanIpa("  /sə ˈriːn/  ")).toBe("/səˈriːn/");
	});

	it("discards a Chinese answer instead of inventing phonetics", () => {
		expect(cleanIpa("读作思瑞恩")).toBe("");
		expect(cleanIpa("宁静的")).toBe("");
	});

	it("discards anything implausibly long", () => {
		expect(cleanIpa(`/${"x".repeat(60)}/`)).toBe("");
	});

	it("treats empty input as no transcription", () => {
		expect(cleanIpa("")).toBe("");
		expect(cleanIpa(undefined)).toBe("");
		expect(cleanIpa("///")).toBe("");
	});
});
