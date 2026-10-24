import type { IncomingMessage, ServerResponse } from "node:http";
import { buildChatPrompt, ChatInputError, normalizeChatRequest } from "./chat.ts";
import { ecdictInfo } from "./ecdict.ts";
import { reviewGrammar } from "./grammar.ts";
import {
	completeWithModel,
	fetchProviderModels,
	invalidateModelRuntime,
	isChatModelId,
	isMissingKeyError,
	llmChat,
	MissingModelError,
	primaryTargetLabel,
	testModelAvailability,
} from "./llm.ts";
import {
	createProvider,
	deleteProvider,
	resolveProvider,
	settingsView,
	SettingsError,
	updateProvider,
	updateProviderModels,
	updateSettings,
} from "./settings.ts";
import { analyzeTranslation, lookupWords, translateSentence } from "./services.ts";
import { normalizeSentenceParts } from "./parse-syntax.ts";
import type { GradeSample } from "./parse-grammar.ts";
import type { WordEntry } from "./parse.ts";
import { buildWordDocx, contentDisposition, ExportError, exportFilename, normalizeExportRequest } from "./export-word/index.ts";
import { createArticle, deleteArticle, isValidArticleId, listArticles, readArticle, updateArticle } from "./store/articles.ts";
import type { SentenceRecord, WeakGrammarPoint } from "./store/articles.ts";
import { listWords, upsert } from "./store/words.ts";
import { listPractice, recordAttempt } from "./store/practice.ts";
import { ensureSyllables, SYLLABLE_BATCH } from "./syllables.ts";
import { fillMissingDefinitions } from "./word-list.ts";

const SMALL_BODY_BYTES = 64 * 1024;
/** Articles carry the full text plus every translation, so they need far more room. */
const ARTICLE_BODY_BYTES = 1024 * 1024;
/** Provider keys and model caches are larger than the average JSON body. */
const SETTINGS_BODY_BYTES = 256 * 1024;
/** A full weak-word list with IPA and glosses, still well under this limit. */
const EXPORT_BODY_BYTES = 256 * 1024;

/** At most this many LLM calls run at once; the browser queue keeps well under it. */
const MAX_INFLIGHT = 4;
/** Settings model queries/tests have their own small budget so they cannot starve grading. */
const TEST_MAX_INFLIGHT = 2;

let inflight = 0;
let testInflight = 0;

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(body),
		"cache-control": "no-store",
	});
	res.end(res.statusCode === 204 ? undefined : body);
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function sendBinary(res: ServerResponse, status: number, body: Buffer, filename: string): void {
	res.writeHead(status, {
		"content-type": DOCX_MIME,
		"content-length": body.length,
		"cache-control": "no-store",
		"content-disposition": contentDisposition(filename),
	});
	res.end(body);
}

function handleExportWord(body: unknown, res: ServerResponse): void {
	const input = normalizeExportRequest(body);
	const filename = exportFilename(input.template, input.title, new Date());
	sendBinary(res, 200, buildWordDocx(input), filename);
}

async function readJsonBody(req: IncomingMessage, maxBytes = SMALL_BODY_BYTES): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk as Buffer;
		size += buffer.length;
		if (size > maxBytes) throw new Error("Request body too large.");
		chunks.push(buffer);
	}
	const raw = Buffer.concat(chunks).toString("utf8").trim();
	if (!raw) return {};
	return JSON.parse(raw);
}

function fieldOf(body: unknown, name: string): unknown {
	if (typeof body !== "object" || body === null) return undefined;
	return (body as Record<string, unknown>)[name];
}

function asWords(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is string => typeof item === "string" && /^[A-Za-z][A-Za-z'-]*$/.test(item.trim()))
		.map((item) => item.trim().slice(0, 48));
}

function asSentence(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > 2000) return undefined;
	return trimmed;
}

function asText(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	return value.length > ARTICLE_BODY_BYTES ? undefined : value;
}

function asEntries(value: unknown): Record<string, { pos?: string; meaning?: string; ipa?: string }> {
	if (typeof value !== "object" || value === null) return {};
	const result: Record<string, { pos?: string; meaning?: string; ipa?: string }> = {};
	for (const [word, entry] of Object.entries(value as Record<string, unknown>)) {
		if (typeof entry !== "object" || entry === null) continue;
		const record = entry as Record<string, unknown>;
		result[word] = {
			pos: typeof record.pos === "string" ? record.pos : undefined,
			meaning: typeof record.meaning === "string" ? record.meaning : undefined,
			ipa: typeof record.ipa === "string" ? record.ipa : undefined,
		};
	}
	return result;
}

function asSentences(value: unknown): SentenceRecord[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const records: SentenceRecord[] = [];
	for (const item of value) {
		if (typeof item !== "object" || item === null) continue;
		const record = item as Record<string, unknown>;
		if (typeof record.text !== "string" || typeof record.index !== "number") continue;
		records.push({
			index: record.index,
			text: record.text,
			translation: typeof record.translation === "string" ? record.translation : "",
			analysis: typeof record.analysis === "string" ? record.analysis : "",
			userTranslation: typeof record.userTranslation === "string" ? record.userTranslation : "",
			parts: normalizeSentenceParts(record.parts),
			updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now(),
		});
	}
	return records;
}

/** Extracts the id from `/api/articles/<id>`, rejecting anything that is not a valid id. */
function articleIdOf(url: string): string | undefined {
	const rest = url.slice("/api/articles/".length).split("?")[0];
	return isValidArticleId(rest) ? rest : undefined;
}

/** Per-article click counts: a plain map of lowercase word to a positive integer. */
function asClicks(value: unknown): Record<string, number> | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const clicks: Record<string, number> = {};
	for (const [word, count] of Object.entries(value as Record<string, unknown>)) {
		if (typeof count !== "number" || !Number.isFinite(count)) continue;
		clicks[word.toLowerCase()] = Math.max(0, Math.round(count));
	}
	return clicks;
}

function asWeakGrammar(value: unknown): WeakGrammarPoint[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const points: WeakGrammarPoint[] = [];
	for (const item of value) {
		if (typeof item !== "object" || item === null) continue;
		const record = item as Record<string, unknown>;
		if (typeof record.label !== "string" || record.label.trim().length === 0) continue;
		points.push({
			key: typeof record.key === "string" && record.key.trim() ? record.key.trim() : record.label.trim(),
			label: record.label.trim(),
			note: typeof record.note === "string" ? record.note.trim() : "",
			count: typeof record.count === "number" && record.count > 0 ? Math.round(record.count) : 1,
		});
	}
	return points;
}

// ── Read and translation endpoints, all limited by MAX_INFLIGHT ────────────────────

async function handleLookup(body: unknown, res: ServerResponse): Promise<void> {
	const words = Array.from(new Set(asWords(fieldOf(body, "words")))).slice(0, 120);
	if (words.length === 0) {
		sendJson(res, 400, { error: "words must be a non-empty array of English words." });
		return;
	}
	const entries: Record<string, WordEntry> = await lookupWords(words);
	sendJson(res, 200, { entries });
}

async function handleTranslate(body: unknown, res: ServerResponse): Promise<void> {
	const sentence = asSentence(fieldOf(body, "sentence"));
	if (!sentence) {
		sendJson(res, 400, { error: "sentence must be a non-empty string." });
		return;
	}
	const translation = await translateSentence(sentence);
	sendJson(res, 200, { translation });
}

async function handleAnalyze(body: unknown, res: ServerResponse): Promise<void> {
	const sentence = asSentence(fieldOf(body, "sentence"));
	if (!sentence) {
		sendJson(res, 400, { error: "sentence must be a non-empty string." });
		return;
	}
	// An empty user translation is a reference-only request: the LLM still breaks the
	// original sentence into parts, but skips the grading.
	const user = asSentence(fieldOf(body, "user")) ?? "";
	// The reference translation comes from the free service, so the LLM only grades.
	const official = asSentence(fieldOf(body, "official")) ?? (await translateSentence(sentence));
	const result = await analyzeTranslation({ sentence, official, user });
	sendJson(res, 200, { official, analysis: result.analysis, parts: result.parts });
}

async function handleChat(body: unknown, res: ServerResponse): Promise<void> {
	let request;
	try {
		request = normalizeChatRequest(body);
	} catch (error) {
		sendJson(res, 400, {
			error: {
				code: "bad_request",
				message: error instanceof ChatInputError ? error.message : "对话请求格式不对。",
				retryable: false,
			},
		});
		return;
	}

	try {
		const reply = await llmChat(buildChatPrompt(request.context), request.messages);
		sendJson(res, 200, { reply: reply.slice(0, 6000) });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (isMissingKeyError(error) || /未配置 .*API Key/.test(message)) {
			sendJson(res, 503, { error: { code: "no_key", message: message || "未配置 API Key。", retryable: false } });
			return;
		}
		if (error instanceof MissingModelError) {
			sendJson(res, 503, { error: { code: "no_model", message: error.message, retryable: false } });
			return;
		}
		const rateLimited = /429|限流|请求过快|rate/i.test(message);
		sendJson(res, rateLimited ? 429 : 502, {
			error: {
				code: rateLimited ? "rate_limited" : "upstream",
				message: message.slice(0, 400) || "模型接口暂时不可用，请稍后再试。",
				retryable: true,
			},
		});
	}
}

// ── Library and vocabulary CRUD, never rate limited ─────────────────────────────────

function handleArticlesList(res: ServerResponse): void {
	sendJson(res, 200, { articles: listArticles() });
}

function handleArticleCreate(body: unknown, res: ServerResponse): void {
	const text = asText(fieldOf(body, "text"));
	if (text === undefined || text.trim().length === 0) {
		sendJson(res, 400, { error: "text must be a non-empty string." });
		return;
	}
	const rawTitle = fieldOf(body, "title");
	const title = rawTitle === undefined ? undefined : asText(rawTitle);
	if (rawTitle !== undefined && title === undefined) {
		sendJson(res, 400, { error: "title is too long." });
		return;
	}
	sendJson(res, 201, { article: createArticle({ text, title, sentences: asSentences(fieldOf(body, "sentences")) }) });
}

function handleArticleRead(url: string, res: ServerResponse): void {
	const id = articleIdOf(url);
	if (!id) {
		sendJson(res, 400, { error: "Invalid article id." });
		return;
	}
	const article = readArticle(id);
	if (!article) {
		sendJson(res, 404, { error: "Article not found." });
		return;
	}
	sendJson(res, 200, { article });
}

function handleArticleUpdate(url: string, body: unknown, res: ServerResponse): void {
	const id = articleIdOf(url);
	if (!id) {
		sendJson(res, 400, { error: "Invalid article id." });
		return;
	}
	const text = fieldOf(body, "text");
	const rawTitle = fieldOf(body, "title");
	const sentences = asSentences(fieldOf(body, "sentences"));
	const clicks = fieldOf(body, "clicks");
	const weakGrammar = asWeakGrammar(fieldOf(body, "weakGrammar"));
	if (text !== undefined && (asText(text) === undefined || String(text).trim().length === 0)) {
		sendJson(res, 400, { error: "text must be a non-empty string." });
		return;
	}
	const title = rawTitle === undefined ? undefined : asText(rawTitle);
	if (rawTitle !== undefined && title === undefined) {
		sendJson(res, 400, { error: "title is too long." });
		return;
	}
	const patch: { title?: string; text?: string; sentences?: SentenceRecord[]; clicks?: Record<string, number>; weakGrammar?: WeakGrammarPoint[] } = {};
	if (title !== undefined) patch.title = title;
	if (text !== undefined) patch.text = text as string;
	if (sentences !== undefined) patch.sentences = sentences;
	if (clicks !== undefined && asClicks(clicks) !== undefined) patch.clicks = asClicks(clicks)!;
	if (weakGrammar !== undefined) patch.weakGrammar = weakGrammar;
	const article = updateArticle(id, patch);
	if (!article) {
		sendJson(res, 404, { error: "Article not found." });
		return;
	}
	sendJson(res, 200, { article });
}

function handleArticleDelete(url: string, res: ServerResponse): void {
	const id = articleIdOf(url);
	if (!id) {
		sendJson(res, 400, { error: "Invalid article id." });
		return;
	}
	if (!deleteArticle(id)) {
		sendJson(res, 404, { error: "Article not found." });
		return;
	}
	sendJson(res, 200, { ok: true });
}

function handleWordsList(res: ServerResponse): void {
	// Definitions are filled on the way out, not written back: the file stays a click log.
	sendJson(res, 200, fillMissingDefinitions(listWords()));
}

function handleWordsRecord(body: unknown, res: ServerResponse): void {
	const words = Array.from(new Set(asWords(fieldOf(body, "words")))).slice(0, 200);
	if (words.length === 0) {
		sendJson(res, 400, { error: "words must be a non-empty array of English words." });
		return;
	}
	sendJson(res, 200, { updated: upsert(words, asEntries(fieldOf(body, "entries"))) });
}

function handlePracticeList(res: ServerResponse): void {
	sendJson(res, 200, listPractice());
}

/**
 * Records one drill answer.
 *
 * The timestamp is the server's: the drill's 易错 order ranks on it, and a browser clock that
 * ran a year fast would otherwise file the word under the wrong date forever.
 */
function handlePracticeRecord(body: unknown, res: ServerResponse): void {
	const [word] = asWords([fieldOf(body, "word")]);
	const correct = fieldOf(body, "correct");
	if (!word || typeof correct !== "boolean") {
		sendJson(res, 400, { error: "word and a boolean correct are required." });
		return;
	}
	sendJson(res, 200, { record: recordAttempt(word, correct) });
}

/** Syllable divisions for the drill: cached first, then one bounded model call. */
async function handleSyllables(body: unknown, res: ServerResponse): Promise<void> {
	const words = Array.from(new Set(asWords(fieldOf(body, "words")))).slice(0, SYLLABLE_BATCH);
	if (words.length === 0) {
		sendJson(res, 400, { error: "words must be a non-empty array of English words." });
		return;
	}
	sendJson(res, 200, { words: await ensureSyllables(words) });
}

/** Keeps only the sentences that actually carry a graded attempt. */
function asGradeSamples(value: unknown): GradeSample[] {
	if (!Array.isArray(value)) return [];
	const samples: GradeSample[] = [];
	for (const item of value) {
		if (typeof item !== "object" || item === null) continue;
		const record = item as Record<string, unknown>;
		const sentence = typeof record.sentence === "string" ? record.sentence.trim() : "";
		const user = typeof record.user === "string" ? record.user.trim() : "";
		const analysis = typeof record.analysis === "string" ? record.analysis.trim() : "";
		if (!sentence || !user || !analysis) continue;
		samples.push({ sentence, user, analysis });
	}
	return samples.slice(0, 40);
}

async function handleGrammarReview(body: unknown, res: ServerResponse): Promise<void> {
	const samples = asGradeSamples(fieldOf(body, "samples"));
	if (samples.length === 0) {
		sendJson(res, 400, { error: "samples must contain at least one graded sentence." });
		return;
	}
	const points = await reviewGrammar(samples, { complete: completeWithModel() });
	sendJson(res, 200, { points });
}

// ── Settings and provider management ───────────────────────────────────────────────

function providerIdOf(url: string): string | undefined {
	const rest = url.slice("/api/settings/providers/".length).split("?")[0];
	return /^[a-z0-9][a-z0-9-]{0,31}$/.test(rest) ? rest : undefined;
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function redactSecret(text: string, secret: string | undefined): string {
	const clipped = text.slice(0, 400);
	return secret ? clipped.split(secret).join("••••") : clipped;
}

function handleSettingsGet(res: ServerResponse): void {
	sendJson(res, 200, { settings: settingsView() });
}

function handleSettingsUpdate(body: unknown, res: ServerResponse): void {
	const settings = updateSettings(body);
	invalidateModelRuntime();
	sendJson(res, 200, { settings });
}

function handleProviderCreate(body: unknown, res: ServerResponse): void {
	const provider = createProvider(body);
	invalidateModelRuntime();
	sendJson(res, 201, { provider, settings: settingsView() });
}

function handleProviderUpdate(url: string, body: unknown, res: ServerResponse): void {
	const id = providerIdOf(url);
	if (!id) {
		sendJson(res, 400, { error: "Invalid provider id." });
		return;
	}
	const provider = updateProvider(id, body);
	invalidateModelRuntime();
	sendJson(res, 200, { provider, settings: settingsView() });
}

function handleProviderDelete(url: string, res: ServerResponse): void {
	const id = providerIdOf(url);
	if (!id) {
		sendJson(res, 400, { error: "Invalid provider id." });
		return;
	}
	const settings = deleteProvider(id);
	invalidateModelRuntime();
	sendJson(res, 200, { settings });
}

async function handleSettingsModels(body: unknown, res: ServerResponse): Promise<void> {
	const providerId = typeof fieldOf(body, "providerId") === "string" ? String(fieldOf(body, "providerId")).trim() : "";
	const provider = providerId ? resolveProvider(providerId) : undefined;
	if (providerId && !provider) throw new SettingsError("服务不存在。", 404);
	const draftBaseUrl = typeof fieldOf(body, "baseUrl") === "string" ? String(fieldOf(body, "baseUrl")).trim() : undefined;
	const draftApiKey = typeof fieldOf(body, "apiKey") === "string" ? String(fieldOf(body, "apiKey")).trim() : undefined;
	const baseUrl = draftBaseUrl || provider?.baseUrl;
	const apiKey = draftApiKey || provider?.apiKey;
	if (!baseUrl) throw new SettingsError("Base URL 不能为空。");
	if (!apiKey) throw new SettingsError("这个服务还没有 API Key。");
	let models: string[];
	try {
		models = await fetchProviderModels(baseUrl, apiKey, 8_000);
	} catch (error) {
		throw new SettingsError(redactSecret(errorText(error), apiKey), 502);
	}
	const draft = draftBaseUrl !== undefined || draftApiKey !== undefined;
	if (provider && provider.kind === "custom" && !draft) {
		updateProviderModels(provider.id, models);
		invalidateModelRuntime();
	}
	sendJson(res, 200, {
		models: models.map((id) => ({ id, chat: isChatModelId(id) })),
		at: Date.now(),
	});
}

async function handleSettingsTestModel(body: unknown, res: ServerResponse): Promise<void> {
	const providerId = typeof fieldOf(body, "providerId") === "string" ? String(fieldOf(body, "providerId")).trim() : "";
	const provider = providerId ? resolveProvider(providerId) : undefined;
	if (providerId && !provider) throw new SettingsError("服务不存在。", 404);
	const model = typeof fieldOf(body, "model") === "string" ? String(fieldOf(body, "model")).trim() : "";
	if (!model) throw new SettingsError("请选择一个模型。");
	const draftBaseUrl = typeof fieldOf(body, "baseUrl") === "string" ? String(fieldOf(body, "baseUrl")).trim() : undefined;
	const draftApiKey = typeof fieldOf(body, "apiKey") === "string" ? String(fieldOf(body, "apiKey")).trim() : undefined;
	const baseUrl = draftBaseUrl || provider?.baseUrl;
	const apiKey = draftApiKey || provider?.apiKey;
	const name = typeof fieldOf(body, "name") === "string" ? String(fieldOf(body, "name")).trim() : (provider?.name ?? "API");
	const kind = provider?.kind ?? "custom";
	const compatValue = fieldOf(body, "compat");
	const compat =
		typeof compatValue === "object" && compatValue !== null
			? (compatValue as { jsonMode?: boolean; maxTokensField?: "max_tokens" | "max_completion_tokens" })
			: provider?.compat;
	if (!baseUrl) throw new SettingsError("Base URL 不能为空。");
	if (!apiKey) throw new SettingsError("这个服务还没有 API Key。");
	const result = await testModelAvailability({
		name: name || "API",
		baseUrl,
		apiKey,
		model,
		kind,
		compat,
	});
	sendJson(res, 200, {
		model,
		status: result.status,
		latencyMs: result.latencyMs,
		...(result.error ? { error: redactSecret(result.error, apiKey) } : {}),
	});
}

/**
 * Table-driven routes. Keeping the CRUD handlers separate from the LLM handlers makes the
 * rate-limit policy explicit: only the three expensive calls share the inflight counter.
 */
const ROUTES: Record<string, (req: IncomingMessage, res: ServerResponse, url: string, body: unknown) => Promise<void> | void> = {
	"POST /api/lookup": (_req, res, _url, body) => handleLookup(body, res),
	"POST /api/translate": (_req, res, _url, body) => handleTranslate(body, res),
	"POST /api/analyze": (_req, res, _url, body) => handleAnalyze(body, res),
	"POST /api/chat": (_req, res, _url, body) => handleChat(body, res),
	"GET /api/articles": (_req, res) => handleArticlesList(res),
	"POST /api/articles": (_req, res, _url, body) => handleArticleCreate(body, res),
	"PUT /api/articles": (_req, res, url, body) => handleArticleUpdate(url, body, res),
	"DELETE /api/articles": (_req, res, url) => handleArticleDelete(url, res),
	"GET /api/articles/": (_req, res, url) => handleArticleRead(url, res),
	"PUT /api/articles/": (_req, res, url, body) => handleArticleUpdate(url, body, res),
	"DELETE /api/articles/": (_req, res, url) => handleArticleDelete(url, res),
	"GET /api/words": (_req, res) => handleWordsList(res),
	"POST /api/words/record": (_req, res, _url, body) => handleWordsRecord(body, res),
	"GET /api/practice": (_req, res) => handlePracticeList(res),
	"POST /api/practice/record": (_req, res, _url, body) => handlePracticeRecord(body, res),
	"POST /api/syllables": (_req, res, _url, body) => handleSyllables(body, res),
	"POST /api/grammar-review": (_req, res, _url, body) => handleGrammarReview(body, res),
	"POST /api/export/word": (_req, res, _url, body) => handleExportWord(body, res),
	"GET /api/settings": (_req, res) => handleSettingsGet(res),
	"PUT /api/settings": (_req, res, _url, body) => handleSettingsUpdate(body, res),
	"POST /api/settings/providers": (_req, res, _url, body) => handleProviderCreate(body, res),
	"PUT /api/settings/providers/": (_req, res, url, body) => handleProviderUpdate(url, body, res),
	"DELETE /api/settings/providers/": (_req, res, url) => handleProviderDelete(url, res),
	"POST /api/settings/models": (_req, res, _url, body) => handleSettingsModels(body, res),
	"POST /api/settings/test-model": (_req, res, _url, body) => handleSettingsTestModel(body, res),
};

/** The LLM-backed endpoints share the inflight budget; CRUD is always allowed. */
const LIMITED = new Set([
	"POST /api/lookup",
	"POST /api/translate",
	"POST /api/analyze",
	"POST /api/chat",
	"POST /api/grammar-review",
]);

/** Model discovery/testing from the settings page has a smaller, separate budget. */
const TEST_LIMITED = new Set([
	"POST /api/settings/models",
	"POST /api/settings/test-model",
	// Syllables are a background nicety: the drill works without them, so this gets the small
	// budget rather than a share of the grading quota.
	"POST /api/syllables",
]);

function matchRoute(method: string | undefined, url: string): keyof typeof ROUTES | undefined {
	const path = url.split("?")[0];
	if (path.startsWith("/api/settings/providers/")) {
		const key = `${method} /api/settings/providers/`;
		return ROUTES[key] ? (key as keyof typeof ROUTES) : undefined;
	}
	const candidates = path.startsWith("/api/articles/") ? [`${method} /api/articles/`, `${method} /api/articles`] : [`${method} ${path}`];
	for (const candidate of candidates) {
		if (ROUTES[candidate]) return candidate as keyof typeof ROUTES;
	}
	return undefined;
}

/**
 * Connect-style handler mounted by the Vite plugin. Owns every `/api/*` route so the
 * browser never talks to a third-party service or SenseNova directly (no CORS, and the
 * key stays server-side).
 */
export function createApiHandler(): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
	return (req, res, next) => {
		const url = req.url ?? "";
		if (!url.startsWith("/api/")) {
			next();
			return;
		}

		if (url.startsWith("/api/health")) {
			const dictionary = ecdictInfo();
			const settings = settingsView();
			sendJson(res, 200, {
				ok: true,
				dictionary: dictionary.installed ? "ecdict + index-translate + mymemory" : "index-translate + mymemory",
				ecdictPath: dictionary.path ?? null,
				llmModel: primaryTargetLabel(),
				providers: settings.providers.length,
				hint: settings.warnings.join(" "),
			});
			return;
		}

		const route = matchRoute(req.method, url);
		if (!route) {
			sendJson(res, 404, { error: "Unknown endpoint." });
			return;
		}

		if (LIMITED.has(route) && inflight >= MAX_INFLIGHT) {
			sendJson(res, 429, { error: "Too many concurrent requests. Retry shortly." });
			return;
		}
		if (TEST_LIMITED.has(route) && testInflight >= TEST_MAX_INFLIGHT) {
			sendJson(res, 429, { error: "Too many model tests running. Retry shortly." });
			return;
		}

		void (async () => {
			if (LIMITED.has(route)) inflight += 1;
			if (TEST_LIMITED.has(route)) testInflight += 1;
			try {
				const maxBytes = route.includes("/api/export")
					? EXPORT_BODY_BYTES
					: route.includes("articles")
						? ARTICLE_BODY_BYTES
						: route.includes("/api/settings")
							? SETTINGS_BODY_BYTES
							: SMALL_BODY_BYTES;
				const body = req.method === "GET" || req.method === "DELETE" ? {} : await readJsonBody(req, maxBytes);
				await ROUTES[route](req, res, url, body);
			} catch (error) {
				if (error instanceof ExportError) {
					sendJson(res, error.status, { error: error.message });
					return;
				}
				if (error instanceof Error && error.message === "Request body too large.") {
					sendJson(res, 413, { error: "请求内容过大。" });
					return;
				}
				if (error instanceof SyntaxError) {
					sendJson(res, 400, { error: "请求内容不是有效的 JSON。" });
					return;
				}
				if (error instanceof SettingsError) {
					sendJson(res, error.status, { error: error.message });
					return;
				}
				if (isMissingKeyError(error)) {
					sendJson(res, 503, { error: errorText(error) });
					return;
				}
				if (error instanceof MissingModelError) {
					sendJson(res, 503, { error: error.message });
					return;
				}
				const message = errorText(error);
				const rateLimited = /429|限流|请求过快|rate/i.test(message);
				// Surface the provider's own message: a rate limit must not look like a parse failure.
				sendJson(res, rateLimited ? 429 : 502, { error: message.slice(0, 400) });
			} finally {
				if (LIMITED.has(route)) inflight -= 1;
				if (TEST_LIMITED.has(route)) testInflight -= 1;
			}
		})();
	};
}