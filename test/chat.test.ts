import { describe, expect, it } from "vitest";
import { buildChatPrompt, ChatInputError, normalizeChatRequest } from "../server/chat.ts";

const context = {
	title: "A Test Article",
	layout: "sentence",
	currentIndex: 2,
	currentSentence: "The second sentence.",
	focusSource: "word",
	sentences: [
		{ index: 1, text: "The first sentence." },
		{ index: 2, text: "The second sentence." },
	],
	weakWords: [{ word: "patience", count: 2, gloss: "n. 耐心" }],
	attempts: [{ index: 2, text: "第二句的译文", ref: "参考译文", analysis: "用词可以更自然" }],
};

describe("normalizeChatRequest", () => {
	it("keeps the conversation and clips context fields", () => {
		const request = normalizeChatRequest({
			messages: [
				{ role: "user", content: "第一问" },
				{ role: "assistant", content: "第一答" },
				{ role: "user", content: "第二问" },
			],
			context,
		});
		expect(request.messages).toHaveLength(3);
		expect(request.context.currentIndex).toBe(2);
		expect(request.context.focusSource).toBe("word");
		expect(request.context.sentences).toHaveLength(2);
	});

	it("rejects an empty conversation or an assistant-last history", () => {
		expect(() => normalizeChatRequest({ messages: [], context })).toThrow(ChatInputError);
		expect(() =>
			normalizeChatRequest({
				messages: [{ role: "assistant", content: "只有回答" }],
				context,
			}),
		).toThrow(ChatInputError);
	});

	it("defaults an unknown focus source to scroll", () => {
		const request = normalizeChatRequest({
			messages: [{ role: "user", content: "问" }],
			context: { ...context, focusSource: "other" },
		});
		expect(request.context.focusSource).toBe("scroll");
	});
});

describe("buildChatPrompt", () => {
	it("names the current sentence, its source and the learning state", () => {
		const request = normalizeChatRequest({
			messages: [{ role: "user", content: "问" }],
			context,
		});
		const prompt = buildChatPrompt(request.context);
		expect(prompt).toContain("A Test Article");
		expect(prompt).toContain("← 用户最近的句子");
		expect(prompt).toContain('source="word"');
		expect(prompt).toContain("查词");
		expect(prompt).toContain("patience ×2");
		expect(prompt).toContain("第二句的译文");
		expect(prompt).toContain("只陪读这篇文章");
	});
});
