import { describe, expect, it } from "vitest";
import { parseAnalyzeReply } from "../server/parse-syntax.ts";

describe("parseAnalyzeReply", () => {
	it("parses the shape the prompt asks for", () => {
		const reply =
			'{"analysis": "整体不错。", "parts": [{"w": "The", "r": "定"}, {"w": "serene library", "r": "主"}, {"w": "invites", "r": "谓"}]}';
		expect(parseAnalyzeReply(reply)).toEqual({
			analysis: "整体不错。",
			parts: [
				{ w: "The", r: "定" },
				{ w: "serene library", r: "主" },
				{ w: "invites", r: "谓" },
			],
		});
	});

	it("returns only the breakdown for a reference-only request", () => {
		const reply = '{"parts": [{"w": "Hello", "r": "主"}]}';
		expect(parseAnalyzeReply(reply).analysis).toBe("");
		expect(parseAnalyzeReply(reply).parts).toEqual([{ w: "Hello", r: "主" }]);
	});

	it("accepts wrapped and fenced replies", () => {
		const fenced = "```json\n{\"analysis\": \"a\", \"parts\": [{\"w\": \"x\", \"r\": \"主\"}]}\n```";
		const wrapped = "好的,结果是 {\"analysis\": \"a\", \"parts\": [{\"w\": \"x\", \"r\": \"谓\"}]} 供参考。";
		expect(parseAnalyzeReply(fenced).parts).toHaveLength(1);
		expect(parseAnalyzeReply(wrapped).parts[0].r).toBe("谓");
	});

	it("removes a think block before parsing", () => {
		const reply = ' thinkingno{"parts": [{"w": "Hi", "r": "主"}]}';
		expect(parseAnalyzeReply(reply).parts).toEqual([{ w: "Hi", r: "主" }]);
	});

	it("normalizes long-form role names to the short form", () => {
		const reply = '{"parts": [{"w": "you", "r": "宾语"}, {"w": "run", "r": "谓"}]}';
		expect(parseAnalyzeReply(reply).parts).toEqual([
			{ w: "you", r: "宾" },
			{ w: "run", r: "谓" },
		]);
	});

	it("reads parts under a wrapper key as well as a roles key", () => {
		const wrapped = '{"syntax": {"roles": [{"w": "a", "r": "主"}, {"w": "b", "r": "状"}]}}';
		expect(parseAnalyzeReply(wrapped).parts).toHaveLength(2);
	});

	it("accepts renamed word and role fields", () => {
		const reply = '{"analysis": "ok", "components": [{"text": "slowly", "label": "副词"}, {"word": "sits", "tag": "谓"}]}';
		const { analysis, parts } = parseAnalyzeReply(reply);
		expect(analysis).toBe("ok");
		expect(parts).toEqual([
			{ w: "slowly", r: "" },
			{ w: "sits", r: "谓" },
		]);
	});

	it("treats a bare parts array as valid", () => {
		const reply = '[{"w": "a", "r": "主"}, {"w": "b", "r": "宾"}]';
		expect(parseAnalyzeReply(reply).parts).toHaveLength(2);
	});

	it("keeps tokens with an unknown role but blanks the role", () => {
		const reply = '{"parts": [{"w": "the", "r": "定"}, {"w": "and", "r": "连词"}, {"w": ".", "r": ""}]}';
		expect(parseAnalyzeReply(reply).parts).toEqual([
			{ w: "the", r: "定" },
			{ w: "and", r: "" },
			{ w: ".", r: "" },
		]);
	});

	it("drops part rows with no word", () => {
		const reply = '{"parts": [{"w": "", "r": "主"}, {"w": "x", "r": "谓"}, "主"]}';
		expect(parseAnalyzeReply(reply).parts).toEqual([{ w: "x", r: "谓" }]);
	});

	it("returns empty analysis and parts for an unparseable reply", () => {
		expect(parseAnalyzeReply("I cannot help with that.")).toEqual({ analysis: "", parts: [] });
		expect(parseAnalyzeReply("")).toEqual({ analysis: "", parts: [] });
		expect(parseAnalyzeReply("not { json at all")).toEqual({ analysis: "", parts: [] });
	});

	it("maps 表语 and 同位语 to their short roles", () => {
		const reply = '{"parts": [{"w": "is", "r": "表语"}, {"w": "a doctor", "r": "同位语"}]}';
		expect(parseAnalyzeReply(reply).parts).toEqual([
			{ w: "is", r: "表" },
			{ w: "a doctor", r: "同" },
		]);
	});

	it("reads a clause role as its base role plus a clause flag", () => {
		const reply =
			'{"parts": [{"w": "that he is right", "r": "宾语从句", "sub": [{"w": "he", "r": "主"}, {"w": "is", "r": "谓"}, {"w": "right", "r": "表"}]}]}';
		expect(parseAnalyzeReply(reply).parts).toEqual([
			{
				w: "that he is right",
				r: "宾",
				clause: true,
				sub: [
					{ w: "he", r: "主" },
					{ w: "is", r: "谓" },
					{ w: "right", r: "表" },
				],
			},
		]);
	});

	it("accepts the explicit clause flag", () => {
		const reply = '{"parts": [{"w": "that I bought", "r": "定", "c": true}]}';
		expect(parseAnalyzeReply(reply).parts).toEqual([{ w: "that I bought", r: "定", clause: true }]);
	});

	it("parses nested blocks under renamed keys", () => {
		const reply =
			'{"parts": [{"w": "The book", "r": "主", "children": {"components": [{"w": "on the table", "r": "定语从句"}]}}]}';
		expect(parseAnalyzeReply(reply).parts).toEqual([
			{
				w: "The book",
				r: "主",
				sub: [{ w: "on the table", r: "定", clause: true }],
			},
		]);
	});

	it("drops malformed nested rows but keeps the outer block", () => {
		const reply = '{"parts": [{"w": "The book", "r": "主", "sub": [{"w": "", "r": "定"}, "bad", {"w": "on it", "r": "定"}]}]}';
		expect(parseAnalyzeReply(reply).parts).toEqual([
			{ w: "The book", r: "主", sub: [{ w: "on it", r: "定" }] },
		]);
	});
});