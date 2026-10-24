import type { ExportContent, ExportTemplateId } from "../shared/export-catalog.ts";
import type { WordEntry } from "./glossary.ts";

export interface ArticleSummary {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	preview: string;
}

export interface SentenceRecord {
	index: number;
	text: string;
	translation: string;
	analysis: string;
	userTranslation: string;
	/** Sentence-part breakdown of the original sentence, when the last analysis provided one. */
	parts?: SentencePart[];
	updatedAt: number;
}

/**
 * One block of the original sentence and the sentence role the model assigned it.
 *
 * A block is a word, a phrase or a clause. `clause` marks a clause; `sub` holds the block's
 * nested components (a clause's own subject/predicate/..., or the clauses inside a phrase).
 */
export interface SentencePart {
	w: string;
	r: string;
	clause?: boolean;
	sub?: SentencePart[];
}

/** Grading response: the reference translation, the markdown-free analysis, and the breakdown. */
export interface AnalyzeResult {
	official: string;
	analysis: string;
	parts: SentencePart[];
}

export interface ArticleRecord {
	version: 1;
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	text: string;
	sentences: SentenceRecord[];
	/** Per-article word clicks, lowercase word to count. Absent on files written before this field. */
	clicks?: Record<string, number>;
	/** Per-article grammar review result, cached so the review is not repeated. */
	weakGrammar?: GrammarWeakness[];
}

export interface WordRecord {
	word: string;
	ipa: string;
	pos: string;
	meanings: string[];
	clicks: number;
	firstSeenAt: number;
	lastSeenAt: number;
}

/** One weakness the learner showed on a single article. */
export interface GrammarWeakness {
	key: string;
	label: string;
	note: string;
	count: number;
}

/** A graded attempt, the evidence the grammar review reasons about. */
export interface GradeSample {
	sentence: string;
	user: string;
	analysis: string;
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
	const init: RequestInit = { method, headers: { "content-type": "application/json" }, signal };
	if (body !== undefined) init.body = JSON.stringify(body);
	const response = await fetch(path, init);
	const text = await response.text();
	let payload: unknown;
	try {
		payload = text ? JSON.parse(text) : {};
	} catch {
		throw new Error(`The server returned a non-JSON response (${response.status}).`);
	}
	if (!response.ok) {
		const message = (payload as { error?: string }).error;
		throw new Error(message ?? `Request failed with status ${response.status}.`);
	}
	return payload as T;
}

const postJson = <T>(path: string, body: unknown): Promise<T> => request<T>("POST", path, body);

/**
 * Asks the local server for part-of-speech and Chinese meaning of each word.
 * Words the model did not answer are simply missing from `entries`.
 */
export function lookupWords(words: string[], signal?: AbortSignal): Promise<Record<string, WordEntry>> {
	return request<{ entries: Record<string, WordEntry> }>("POST", "/api/lookup", { words }, signal).then(
		(payload) => payload.entries ?? {},
	);
}

/** Translates one sentence into Simplified Chinese. */
export function translateSentence(sentence: string, signal?: AbortSignal): Promise<string> {
	return request<{ translation: string }>("POST", "/api/translate", { sentence }, signal).then((payload) => payload.translation);
}

/**
 * Grades the reader's own translation, or — with an empty `user` — requests the reference
 * translation plus the original sentence's subject/predicate/object breakdown. Returns the
 * official translation alongside the analysis and parts so the panel renders from one call.
 */
export function analyzeTranslation(
	input: { sentence: string; user: string; official?: string },
	signal?: AbortSignal,
): Promise<AnalyzeResult> {
	const payload: { sentence: string; user: string; official?: string } = {
		sentence: input.sentence,
		user: input.user,
	};
	if (input.official !== undefined) payload.official = input.official;
	return request<AnalyzeResult>("POST", "/api/analyze", payload, signal);
}

export type { ExportContent, ExportTemplateId } from "../shared/export-catalog.ts";

export interface ExportWordInput {
	word: string;
	ipa?: string;
	pos?: string;
	gloss?: string;
}

export interface ExportWordRequest {
	template: ExportTemplateId;
	content: ExportContent;
	title: string;
	words: ExportWordInput[];
}

/** Downloads the reader's weak words as a .docx built by the local server. */
export async function exportWordList(input: ExportWordRequest): Promise<Blob> {
	const response = await fetch("/api/export/word", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
	if (!response.ok) {
		let message = `导出失败(${response.status})。`;
		try {
			const payload = (await response.json()) as { error?: string };
			if (payload.error) message = payload.error;
		} catch {
			// A non-JSON failure still gets the status-based message above.
		}
		throw new Error(message);
	}
	return response.blob();
}

/** Reports which services the server will use. Shown in the startup hint. */
export async function checkHealth(): Promise<{	ok: boolean;
	dictionary: string;
	llmModel: string;
	ecdictPath: string | null;
	providers?: number;
	hint?: string;
}> {
	const response = await fetch("/api/health");
	return (await response.json()) as {
		ok: boolean;
		dictionary: string;
		llmModel: string;
		ecdictPath: string | null;
		providers?: number;
		hint?: string;
	};
}

// ── API providers and model selection ───────────────────────────────────────────────

export type SettingsKeySource = "env" | "models-json" | "settings" | "none";
export type ModelTestStatus = "healthy" | "unavailable" | "unverified";
export type ModelSelection =
	| { mode: "auto" }
	| { mode: "pinned"; providerId: string; modelId: string };

export interface ProviderCompat {
	jsonMode?: boolean;
	maxTokensField?: "max_tokens" | "max_completion_tokens";
}

export interface ProviderView {
	id: string;
	name: string;
	baseUrl: string;
	kind: "builtin" | "custom";
	enabled: boolean;
	keySource: SettingsKeySource;
	hasKey: boolean;
	keyMasked: string;
	defaultModelId?: string;
	models: string[];
	modelsAt?: number;
	compat: ProviderCompat;
	editable: boolean;
	deletable: boolean;
	createdAt?: number;
	updatedAt?: number;
}

export interface SettingsView {
	version: 1;
	providers: ProviderView[];
	defaultProviderId: string;
	crossApiFallback: boolean;
	manualModelSelection: boolean;
	structured: ModelSelection;
	prose: ModelSelection;
	warnings: string[];
}

export interface ProviderInput {
	name: string;
	baseUrl: string;
	apiKey: string;
	models?: string[];
	defaultModelId?: string;
	compat?: ProviderCompat;
}

export interface ProviderPatch {
	name?: string;
	baseUrl?: string;
	apiKey?: string;
	clearKey?: boolean;
	enabled?: boolean;
	models?: string[];
	defaultModelId?: string;
	compat?: ProviderCompat;
}

export interface SettingsPatch {
	defaultProviderId?: string;
	crossApiFallback?: boolean;
	manualModelSelection?: boolean;
	structured?: ModelSelection;
	prose?: ModelSelection;
}

export interface ProviderModelRow {
	id: string;
	chat: boolean;
}

export interface ModelTestResult {
	model: string;
	status: ModelTestStatus;
	latencyMs: number;
	error?: string;
}

export function getSettings(): Promise<SettingsView> {
	return request<{ settings: SettingsView }>("GET", "/api/settings").then((payload) => payload.settings);
}

export function saveSettings(patch: SettingsPatch): Promise<SettingsView> {
	return request<{ settings: SettingsView }>("PUT", "/api/settings", patch).then((payload) => payload.settings);
}

export function createProvider(input: ProviderInput): Promise<{ provider: ProviderView; settings: SettingsView }> {
	return request<{ provider: ProviderView; settings: SettingsView }>("POST", "/api/settings/providers", input);
}

export function updateProvider(id: string, patch: ProviderPatch): Promise<{ provider: ProviderView; settings: SettingsView }> {
	return request<{ provider: ProviderView; settings: SettingsView }>(
		"PUT",
		`/api/settings/providers/${encodeURIComponent(id)}`,
		patch,
	);
}

export function removeProvider(id: string): Promise<SettingsView> {
	return request<{ settings: SettingsView }>(
		"DELETE",
		`/api/settings/providers/${encodeURIComponent(id)}`,
	).then((payload) => payload.settings);
}

export function queryProviderModels(input: {
	providerId?: string;
	baseUrl?: string;
	apiKey?: string;
}): Promise<{ models: ProviderModelRow[]; at: number }> {
	return request<{ models: ProviderModelRow[]; at: number }>("POST", "/api/settings/models", input);
}

export function testProviderModel(input: {
	providerId?: string;
	baseUrl?: string;
	apiKey?: string;
	name?: string;
	model: string;
	compat?: ProviderCompat;
}): Promise<ModelTestResult> {
	return request<ModelTestResult>("POST", "/api/settings/test-model", input);
}

// ── Library and vocabulary endpoints ───────────────────────────────────────────────

export function listArticles(signal?: AbortSignal): Promise<{ articles: ArticleSummary[] }> {
	return request<{ articles: ArticleSummary[] }>("GET", "/api/articles", undefined, signal);
}

export function createArticle(text: string, title?: string, sentences?: SentenceRecord[]): Promise<{ article: ArticleRecord }> {
	return request<{ article: ArticleRecord }>("POST", "/api/articles", { text, title, sentences });
}

export function getArticle(id: string): Promise<{ article: ArticleRecord }> {
	return request<{ article: ArticleRecord }>("GET", `/api/articles/${encodeURIComponent(id)}`);
}

export function updateArticle(
	id: string,
	patch: {
		title?: string;
		text?: string;
		sentences?: SentenceRecord[];
		clicks?: Record<string, number>;
		weakGrammar?: GrammarWeakness[];
	},
): Promise<{ article: ArticleRecord }> {
	return request<{ article: ArticleRecord }>("PUT", `/api/articles/${encodeURIComponent(id)}`, patch);
}

export function deleteArticle(id: string): Promise<{ ok: boolean }> {
	return request<{ ok: boolean }>("DELETE", `/api/articles/${encodeURIComponent(id)}`);
}

export function listWords(): Promise<{ words: Record<string, WordRecord> }> {
	return request<{ words: Record<string, WordRecord> }>("GET", "/api/words");
}

export function recordWords(
	words: string[],
	entries: Record<string, { pos: string; meaning: string; ipa: string }>,
): Promise<{ updated: Record<string, WordRecord> }> {
	return postJson<{ updated: Record<string, WordRecord> }>("/api/words/record", { words, entries });
}

/** One word's spelling-drill history, as the server counts it. */
export interface PracticeRecord {
	word: string;
	attempts: number;
	misses: number;
	lastWrongAt: number;
	lastCorrectAt: number;
	updatedAt: number;
}

export interface PracticeFile {
	words: Record<string, PracticeRecord>;
}

export function listPractice(): Promise<PracticeFile> {
	return request<PracticeFile>("GET", "/api/practice");
}

/**
 * Reports one submitted answer.
 *
 * The server stamps the time: the drill's 易错 order ranks on it, and a browser clock that
 * ran fast would otherwise file the word under the wrong date for good.
 */
export function recordPractice(word: string, correct: boolean): Promise<{ record: PracticeRecord }> {
	return postJson<{ record: PracticeRecord }>("/api/practice/record", { word, correct });
}

/**
 * Asks for syllable divisions.
 *
 * A failure here is not an error the reader cares about — the drill shows the correct word
 * without separators — so this swallows everything and returns an empty map.
 */
export async function fetchSyllables(words: string[]): Promise<Record<string, string[]>> {
	try {
		const payload = await postJson<{ words: Record<string, string[]> }>("/api/syllables", { words });
		return payload.words ?? {};
	} catch {
		return {};
	}
}

/**
 * Consolidates the grammar weaknesses across one article's graded sentences. The result is
 * cached in the article file so reopening it does not repeat the language-model call.
 */
export function reviewGrammar(samples: GradeSample[]): Promise<GrammarWeakness[]> {
	return postJson<{ points: GrammarWeakness[] }>("/api/grammar-review", { samples }).then((payload) => payload.points ?? []);
}