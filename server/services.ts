import { getJson, postJson, usableText } from "./http.ts";
import { llmAnalyze, llmLookupWords, llmTranslateSentence } from "./llm.ts";
import { cleanIpa, parseLookupReply } from "./parse.ts";
import type { LookupRow, WordEntry } from "./parse.ts";
import { normalizePos } from "./pos.ts";
import { lookupFromEcdict } from "./ecdict.ts";

/**
 * Translation chain.
 *
 * Every free service was probed before being wired in. The results decided the order:
 *
 * - Bilibili Index-Translate: alive, 0.3s per sentence, and it returns part-of-speech plus a
 *   Chinese gloss for a whole batch of words in one call. Primary for both jobs.
 * - MyMemory: alive, no key needed, slower and single-string only. Secondary.
 * - Free Dictionary API: returns 522 (origin down), so it is not used at all.
 * - Youdao / iciba / Tencent / Azure / Volcano / Alibaba / DeepL: all need an account key.
 * - SenseNova via pi-ai: last resort only. Reserving it for the translation analysis is what
 *   keeps "rpm exhausted" away, since lookups and sentence translations never reach it.
 *
 * Every step falls through on failure, so losing one service degrades quality, not function.
 */

const BILI_URL = "https://index-translate.bilibili.com/v1/chat/completions";
const BILI_MODEL = "Index-Translate-35B-A3B";
const MYMEMORY_URL = "https://api.mymemory.translated.net/get";

/** Sentences are sent with this instruction; without it the model paraphrases instead of translating. */
const TRANSLATE_SYSTEM = [
	"你是一个翻译引擎。把用户输入的英文翻译成简体中文。",
	"只输出译文本身,不要扩写、不要解释、不要加标题。",
].join("\n");

const LOOKUP_SYSTEM = [
	"你是英汉词典。输入是英文单词的 JSON 数组。",
	'只输出 JSON 对象,key 是原样的小写单词,value 是 {"ipa":"/音标/","pos":"<英文词性缩写>","meaning":"<中文释义,不超过12字>"}。',
	"ipa 用国际音标,前后用斜杠包住,例如 /səˈriːn/;没有把握就填空字符串。",
	"pos 从 n. / v. / adj. / adv. / prep. / conj. / pron. / det. / num. / int. / aux. 中选最贴切的一个。",
	"没有合适释义就填空字符串。不要解释。",
].join("\n");

interface BiliResponse {
	choices?: { message?: { content?: string } }[];
}

function extractContent(body: BiliResponse): string {
	return body.choices?.[0]?.message?.content?.trim() ?? "";
}

async function biliComplete(system: string, user: string, maxTokens: number): Promise<string> {
	const body = {
		model: BILI_MODEL,
		stream: false,
		temperature: 0,
		max_tokens: maxTokens,
		messages: [
			{ role: "system", content: system },
			{ role: "user", content: user },
		],
	};
	const response = await postJson<BiliResponse>(BILI_URL, body, "index-translate");
	return extractContent(response);
}

interface MyMemoryResponse {
	responseData?: { translatedText?: string };
	responseStatus?: number;
}

async function myMemory(text: string): Promise<string> {
	const url = `${MYMEMORY_URL}?q=${encodeURIComponent(text)}&langpair=en|zh-CN`;
	const response = await getJson<MyMemoryResponse>(url, "mymemory");
	const translated = response.responseData?.translatedText;
	if (response.responseStatus !== undefined && response.responseStatus !== 200) {
		throw new Error(`mymemory status ${response.responseStatus}`);
	}
	if (!usableText(translated)) throw new Error("mymemory returned no translation");
	return translated;
}

/** Strips a leading "词性 " prefix the model sometimes adds to a Chinese gloss. */
function cleanMeaning(raw: string): string {
	return raw.replace(/^(n|v|adj|adv|prep|conj|pron|det|num|int|aux)\.\s*/i, "").trim();
}

async function biliLookup(words: string[]): Promise<Record<string, WordEntry>> {
	const answer = await biliComplete(LOOKUP_SYSTEM, JSON.stringify(words), 900);
	const rows: LookupRow[] = parseLookupReply(answer);
	const entries: Record<string, WordEntry> = {};
	const byLower = new Map(words.map((word) => [word.toLowerCase(), word]));
	for (const row of rows) {
		const requested = byLower.get(row.word.toLowerCase());
		if (!requested) continue;
		const meaning = cleanMeaning(row.entry.meaning);
		if (!meaning) continue;
		entries[requested] = { pos: normalizePos(row.entry.pos), meaning, ipa: cleanIpa(row.entry.ipa) };
	}
	return entries;
}

/** Fills the words the dictionary did not answer, one call each, and only for a few of them. */
async function myMemoryLookup(words: string[]): Promise<Record<string, WordEntry>> {
	const entries: Record<string, WordEntry> = {};
	for (const word of words.slice(0, 12)) {
		try {
			const meaning = cleanMeaning(await myMemory(word));
			if (meaning) entries[word] = { pos: "", meaning, ipa: "" };
		} catch {
			// A single failed word must not abort the rest of the batch.
		}
	}
	return entries;
}

async function llmLookup(words: string[]): Promise<Record<string, WordEntry>> {
	const raw = await llmLookupWords(words);
	const entries: Record<string, WordEntry> = {};
	for (const [word, entry] of Object.entries(raw)) {
		entries[word] = {
			pos: normalizePos(entry.pos),
			meaning: cleanMeaning(entry.meaning),
			ipa: cleanIpa(entry.ipa),
		};
	}
	return entries;
}

/**
 * Part of speech, IPA and Chinese meaning for each word.
 *
 * ECDICT goes first when it is installed: it is offline, instant, and the only source here
 * whose phonetics and Chinese definitions are curated rather than generated. It only covers
 * common vocabulary, so anything it misses falls through to the free dictionary model, then
 * MyMemory, then the LLM. A word every source misses is simply absent.
 */
export async function lookupWords(words: string[]): Promise<Record<string, WordEntry>> {
	const wanted = Array.from(new Set(words.map((word) => word.trim()).filter((word) => word.length > 0)));
	if (wanted.length === 0) return {};

	const entries: Record<string, WordEntry> = {};
	Object.assign(entries, lookupFromEcdict(wanted));

	const offlineMissing = wanted.filter((word) => entries[word] === undefined);
	if (offlineMissing.length > 0) {
		try {
			Object.assign(entries, await biliLookup(offlineMissing));
		} catch {
			// Fall through: MyMemory and the LLM still cover the request.
		}
	}

	const missing = wanted.filter((word) => entries[word] === undefined);
	if (missing.length > 0) {
		Object.assign(entries, await myMemoryLookup(missing));
	}

	const stillMissing = wanted.filter((word) => entries[word] === undefined);
	if (stillMissing.length > 0) {
		try {
			Object.assign(entries, await llmLookup(stillMissing));
		} catch {
			// Report what we have rather than failing the whole batch.
		}
	}
	return entries;
}

/** Whole-sentence translation. Free services first, LLM only if both are down. */
export async function translateSentence(sentence: string): Promise<string> {
	try {
		const answer = await biliComplete(TRANSLATE_SYSTEM, sentence, 400);
		if (usableText(answer)) return answer;
	} catch {
		// Try the next service.
	}
	try {
		return await myMemory(sentence);
	} catch {
		// Last resort below.
	}
	return llmTranslateSentence(sentence);
}

/**
 * Compares the reader's translation with the official one. This genuinely needs a language
 * model, so it is the only path that spends SenseNova quota, and only when a reader submits
 * a translation of their own — or asks for a reference-only breakdown, which is the same
 * cheap structural task.
 */
export async function analyzeTranslation(input: {
	sentence: string;
	official: string;
	user: string;
}): Promise<import("./parse-syntax.ts").AnalyzeReply> {
	return llmAnalyze(input);
}