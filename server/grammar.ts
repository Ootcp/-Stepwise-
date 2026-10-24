import { contentText } from "@earendil-works/pi-ai";
import { extractJsonArray } from "./parse-grammar.ts";
import type { GrammarPoint, GradeSample } from "./parse-grammar.ts";

/**
 * Works out which grammar points a learner is still weak at, from the grading they already
 * received on one article.
 *
 * Two passes, and the cheap one runs first. The keyword scan reads the existing grading text
 * and needs no request at all, so the summary is populated the moment an article is opened.
 * The language model pass then refines it, because it can tell that "the book write is
 * wrong" is a tense problem whereas keyword matching can only see the word "write".
 */

export interface GrammarTopic {
	key: string;
	label: string;
	/** Words that appear in a grading note when this topic is the one being discussed. */
	patterns: string[];
}

/**
 * Deliberately coarse. These are the points Chinese learners of English actually trip on,
 * and every pattern is a phrase the grading prompt itself tends to produce, so a match really
 * does indicate the topic was raised.
 */
export const GRAMMAR_TOPICS: GrammarTopic[] = [
	{
		key: "tense",
		label: "时态",
		// "一般现在时" and "过去时" are the phrases a grading note actually writes; listing
		// only "时态" would miss every note that names the tense directly.
		patterns: [
			"时态",
			"现在时",
			"过去时",
			"将来时",
			"完成时",
			"进行时",
			"时态混用",
			"时间状语",
			"tense",
		],
	},
	{ key: "voice", label: "被动语态", patterns: ["被动", "语态", "passive"] },
	{ key: "article", label: "冠词", patterns: ["冠词", "a / an", "the 的", "不定冠词", "定冠词", "article"] },
	{ key: "plural", label: "名词单复数", patterns: ["单复数", "复数", "复数形式", "plural"] },
	{ key: "prep", label: "介词", patterns: ["介词", "in / on / at", "preposition"] },
	{ key: "agreement", label: "主谓一致", patterns: ["主谓一致", "一致", "第三人称单数", "agreement"] },
	{ key: "clause", label: "从句", patterns: ["从句", "定语从句", "宾语从句", "状语从句", "subordinate clause"] },
	{ key: "nonfinite", label: "非谓语动词", patterns: ["非谓语", "不定式", "动名词", "分词", "gerund", "infinitive"] },
	{ key: "tense2", label: "虚拟语气", patterns: ["虚拟语气", "虚拟", "subjunctive"] },
	{ key: "wordorder", label: "语序", patterns: ["语序", "词序", "语序问题", "word order"] },
	{ key: "collocation", label: "固定搭配", patterns: ["搭配", "collocation", "习惯用法"] },
	{ key: "partsofspeech", label: "词性误用", patterns: ["词性", "误用", "名词性", "形容词性", "part of speech"] },
	{ key: "modal", label: "情态动词", patterns: ["情态动词", "modal"] },
	{ key: "relative", label: "关系词", patterns: ["关系代词", "关系副词", "which / that", "relative"] },
	{ key: "comparison", label: "比较级", patterns: ["比较级", "最高级", "comparative"] },
	{ key: "pronoun", label: "代词", patterns: ["代词", "指代", "pronoun"] },
];

/** Counts how many graded samples mention each topic. */
export function scanTopics(samples: GradeSample[]): GrammarPoint[] {
	const hits = new Map<string, { label: string; sentences: string[] }>();
	for (const sample of samples) {
		const haystack = `${sample.analysis} ${sample.user}`.toLowerCase();
		for (const topic of GRAMMAR_TOPICS) {
			if (!topic.patterns.some((pattern) => haystack.includes(pattern.toLowerCase()))) continue;
			const existing = hits.get(topic.key) ?? { label: topic.label, sentences: [] };
			existing.sentences.push(sample.sentence);
			hits.set(topic.key, existing);
		}
	}
	return [...hits.entries()]
		.map(([key, value]) => ({
			key,
			label: value.label,
			count: value.sentences.length,
			note: value.sentences.slice(0, 2).join(" / "),
		}))
		.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

const REVIEW_SYSTEM_PROMPT = [
	"你是英语学习者的语法老师。下面给出若干条「英文原句 / 用户的译文 / 老师的批改」,都是同一篇文章里的。",
	"请归纳这个学习者在本篇中**仍然薄弱**的语法点,只保留出现两次及以上、或虽只出现一次但错误典型的。",
	'只输出 JSON 数组,每个元素形如 {"label":"<语法点中文名,6 字以内>","note":"<一句话说明他反复出现的具体问题>","count":<出现次数>}。',
	"按严重程度从高到低排序,最多 6 条。不要复述句子,不要给修改建议,只写弱点本身。",
].join("\n");

function normalizeRows(rows: unknown[]): GrammarPoint[] {
	const points: GrammarPoint[] = [];
	for (const row of rows) {
		if (typeof row !== "object" || row === null) continue;
		const record = row as Record<string, unknown>;
		const label = typeof record.label === "string" ? record.label.trim() : "";
		if (!label) continue;
		const note = typeof record.note === "string" ? record.note.trim() : "";
		const count = typeof record.count === "number" && record.count > 0 ? Math.round(record.count) : 1;
		points.push({ key: label, label: label.slice(0, 12), note, count });
	}
	return points.slice(0, 6);
}

/**
 * Asks the language model for a consolidated list. Returns undefined when the model is
 * unavailable or answers with something unusable, so the caller can keep the keyword result.
 */
async function refineWithModel(
	complete: GrammarReviewOptions["complete"],
	samples: GradeSample[],
): Promise<GrammarPoint[] | undefined> {
	if (samples.length === 0) return undefined;
	const prompt = samples
		.slice(0, 12)
		.map((sample) => `英文:${sample.sentence}\n用户:${sample.user}\n批改:${sample.analysis}`)
		.join("\n\n");
	try {
		const message = await complete(REVIEW_SYSTEM_PROMPT, prompt);
		if (message.stopReason === "error" || message.stopReason === "aborted") return undefined;
		const text = contentText(message.content).trim();
		if (text.length === 0) return undefined;
		const rows = extractJsonArray(text);
		return rows.length > 0 ? normalizeRows(rows) : undefined;
	} catch {
		return undefined;
	}
}

export interface GrammarReviewOptions {
	/** Same completion path the sentence grading uses, so both share one key and one model. */
	complete: (
		systemPrompt: string,
		userPrompt: string,
	) => Promise<import("@earendil-works/pi-ai").AssistantMessage>;
}

/**
 * The merged answer: the model's view when it succeeds, otherwise the keyword scan, and if
 * neither produced anything an empty list so the section can say "no issues yet".
 */
export async function reviewGrammar(samples: GradeSample[], options: GrammarReviewOptions): Promise<GrammarPoint[]> {
	const refined = await refineWithModel(options.complete, samples);
	if (refined && refined.length > 0) return refined;
	return scanTopics(samples);
}
