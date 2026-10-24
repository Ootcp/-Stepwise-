import { describe, expect, it } from "vitest";
import { GRAMMAR_TOPICS, reviewGrammar, scanTopics } from "../server/grammar.ts";
import { extractJsonArray, type GradeSample, usableSamples } from "../server/parse-grammar.ts";

function sample(overrides: Partial<GradeSample> = {}): GradeSample {
	return {
		sentence: "The early bird catches the worm.",
		user: "早起的鸟儿会抓虫。",
		analysis: "整体不错,但用了将来时“会”,这里应该用一般现在时。",
		...overrides,
	};
}

/** Stands in for the language-model call so the fallback path can be tested offline. */
function failing(): GrammarReviewOptionsStub {
	return async () => {
		throw new Error("model unavailable");
	};
}

type GrammarReviewOptionsStub = (systemPrompt: string, userPrompt: string) => Promise<never>;

function replying(content: unknown, stopReason = "stop"): GrammarReviewOptionsStub {
	return async () => ({ stopReason, content: [{ type: "text", text: content }] }) as never;
}

describe("scanTopics", () => {
	it("finds the topics a grading note talks about", () => {
		const points = scanTopics([
			sample({ analysis: "这里应该用一般现在时,而不是过去时。" }),
			sample({ sentence: "He go home.", user: "他回家。", analysis: "主谓不一致,第三人称单数要用 goes。" }),
		]);
		const labels = points.map((point) => point.label);
		expect(labels).toContain("时态");
		expect(labels).toContain("主谓一致");
	});

	it("counts how many samples raised each topic", () => {
		const points = scanTopics([
			sample({ analysis: "时态用错了。" }),
			sample({ sentence: "She walk fast.", user: "她走得快。", analysis: "时态不对,还要考虑主谓一致。" }),
		]);
		expect(points[0].label).toBe("时态");
		expect(points[0].count).toBe(2);
	});

	it("sorts the most frequent topic first", () => {
		const points = scanTopics([
			sample({ analysis: "介词用错。" }),
			sample({ sentence: "She walk.", user: "x", analysis: "时态错了,而且主谓一致也有问题。" }),
		]);
		expect(points.map((point) => point.count)).toEqual([...points.map((point) => point.count)].sort((a, b) => b - a));
		expect(points[0].count).toBeGreaterThanOrEqual(points[points.length - 1].count);
	});

	it("returns nothing when no topic is mentioned", () => {
		expect(scanTopics([sample({ analysis: "这句话翻译得很好。" })])).toEqual([]);
	});

	it("has no duplicate labels in the topic table", () => {
		const labels = GRAMMAR_TOPICS.map((topic) => topic.label);
		expect(new Set(labels).size).toBe(labels.length);
	});
});

describe("reviewGrammar", () => {
	it("prefers the model answer when it is usable", async () => {
		const points = await reviewGrammar([sample()], {
			complete: replying('[{"label":"时态","note":"老是混用一般现在时和过去时","count":2}]'),
		});
		expect(points).toEqual([{ key: "时态", label: "时态", note: "老是混用一般现在时和过去时", count: 2 }]);
	});

	it("falls back to the keyword scan when the model fails", async () => {
		const points = await reviewGrammar([sample({ analysis: "介词用错了。" })], { complete: failing() });
		expect(points.map((point) => point.label)).toContain("介词");
	});

	it("falls back when the model answers with prose instead of JSON", async () => {
		const points = await reviewGrammar([sample({ analysis: "主谓一致有问题。" })], {
			complete: replying("我认为你的主要问题是主谓一致。"),
		});
		expect(points.map((point) => point.label)).toContain("主谓一致");
	});

	it("falls back when the model reports an error", async () => {
		const points = await reviewGrammar([sample({ analysis: "冠词用错。" })], {
			complete: replying("", "error"),
		});
		expect(points.map((point) => point.label)).toContain("冠词");
	});

	it("keeps at most six points", async () => {
		const many = Array.from({ length: 12 }, (_, index) => ({ label: `点${index}`, note: "n", count: index + 1 }));
		const points = await reviewGrammar([sample()], { complete: replying(JSON.stringify(many)) });
		expect(points).toHaveLength(6);
	});

	it("drops rows with no label", async () => {
		const points = await reviewGrammar([sample()], {
			complete: replying('[{"note":"没有标签"},{"label":"时态"}]'),
		});
		expect(points).toHaveLength(1);
		expect(points[0].count).toBe(1);
	});
});

describe("extractJsonArray", () => {
	it("parses a bare array", () => {
		expect(extractJsonArray('[{"label":"时态"}]')).toEqual([{ label: "时态" }]);
	});

	it("strips a code fence", () => {
		expect(extractJsonArray('```json\n[{"label":"时态"}]\n```')).toEqual([{ label: "时态" }]);
	});

	it("keeps the array out of surrounding prose", () => {
		expect(extractJsonArray('好的:[{"label":"时态"}] 以上。')).toEqual([{ label: "时态" }]);
	});

	it("unwraps a known container key", () => {
		expect(extractJsonArray('{"points":[{"label":"时态"}]}')).toEqual([{ label: "时态" }]);
	});

	it("returns an empty array rather than throwing", () => {
		expect(extractJsonArray("完全不是 JSON")).toEqual([]);
		expect(extractJsonArray("{ broken")).toEqual([]);
		expect(extractJsonArray("")).toEqual([]);
	});
});

describe("usableSamples", () => {
	it("keeps only sentences that carry a graded attempt", () => {
		const kept = usableSamples([
			sample(),
			sample({ user: "   " }),
			sample({ analysis: "" }),
			sample({ sentence: "" }),
		]);
		expect(kept).toHaveLength(1);
	});

	it("trims the fields it keeps", () => {
		const [kept] = usableSamples([sample({ user: " 早起的鸟儿  ", analysis: " 时态错了。 " })]);
		expect(kept.user).toBe("早起的鸟儿");
		expect(kept.analysis).toBe("时态错了。");
	});
});
