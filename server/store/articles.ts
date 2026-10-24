import {
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { dataRoot } from "../paths.ts";
import { normalizeSentenceParts, type SentencePart } from "../parse-syntax.ts";

export type { SentencePart } from "../parse-syntax.ts";

/**
 * Article library on disk.
 *
 * One file per article under `data/articles/`. A single JSON blob would be simpler but
 * rewriting it on every keystroke-sized edit is wasteful, and a crash mid-write would lose
 * the whole library; per-article files with an atomic rename bound the damage to one article.
 */

function articlesPath(): string {
	return join(dataRoot(), "articles");
}

/** Anything that is not exactly this shape is rejected before it can touch the filesystem. */
const ID_PATTERN = /^art-[a-z0-9-]+$/;

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

/** One weakness the learner showed on this article, as consolidated by the grammar review. */
export interface WeakGrammarPoint {
	key: string;
	label: string;
	note: string;
	count: number;
}

export interface ArticleRecord {
	version: 1;
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	text: string;
	sentences: SentenceRecord[];
	/** How often each word was clicked while reading THIS article. Lowercase keys. */
	clicks: Record<string, number>;
	weakGrammar: WeakGrammarPoint[];
}

export interface ArticleSummary {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	preview: string;
}

function ensureDir(): void {
	mkdirSync(articlesPath(), { recursive: true });
}

/** Writes through a temp file so a crash mid-write cannot truncate an existing article. */
function writeAtomic(path: string, value: unknown): void {
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(value, null, "\t")}\n`, "utf8");
	renameSync(tmp, path);
}

function randomSuffix(): string {
	return Math.floor(Math.random() * 0x10000)
		.toString(16)
		.padStart(4, "0");
}

export function isValidArticleId(id: unknown): id is string {
	return typeof id === "string" && ID_PATTERN.test(id);
}

/** First sentence, trimmed to a title length; the fallback keeps untitled articles identifiable. */
function deriveTitle(text: string): string {
	const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "";
	if (firstLine.length === 0) return "未命名文章";
	if (firstLine.length <= 60) return firstLine;
	const cut = firstLine.slice(0, 59);
	const space = cut.lastIndexOf(" ");
	return `${(space > 20 ? cut.slice(0, space) : cut).trim()}…`;
}

function normalizeWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function previewOf(text: string): string {
	const flat = normalizeWhitespace(text);
	return flat.length > 80 ? flat.slice(0, 80) : flat;
}

function pathOf(id: string): string {
	return join(articlesPath(), `${id}.json`);
}

function isSentenceRecord(value: unknown): value is SentenceRecord {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	return typeof record.text === "string" && typeof record.index === "number";
}

/** Drops entries that are not `label + count`, so the UI never has to guard on partial data. */
function normalizeWeakGrammar(value: unknown): WeakGrammarPoint[] {
	if (!Array.isArray(value)) return [];
	const points: WeakGrammarPoint[] = [];
	for (const item of value) {
		if (typeof item !== "object" || item === null) continue;
		const record = item as Record<string, unknown>;
		const label = typeof record.label === "string" ? record.label.trim() : "";
		if (!label) continue;
		points.push({
			key: typeof record.key === "string" && record.key.trim() ? record.key.trim() : label,
			label,
			note: typeof record.note === "string" ? record.note.trim() : "",
			count: typeof record.count === "number" && record.count > 0 ? Math.round(record.count) : 1,
		});
	}
	return points;
}

/** Word click counts are per article, so a word only counts here if it looks like a word. */
function normalizeClicks(value: unknown): Record<string, number> {
	if (typeof value !== "object" || value === null) return {};
	const clicks: Record<string, number> = {};
	for (const [word, count] of Object.entries(value as Record<string, unknown>)) {
		const key = word.trim().toLowerCase();
		if (!/^[a-z][a-z'-]*$/.test(key)) continue;
		if (typeof count !== "number" || count <= 0) continue;
		clicks[key] = Math.round(count);
	}
	return clicks;
}

/** Fills in every field so downstream code never has to check for undefined. */
function normalizeSentences(value: unknown): SentenceRecord[] {
	if (!Array.isArray(value)) return [];
	return value.filter(isSentenceRecord).map((record) => ({
		index: record.index,
		text: record.text,
		translation: typeof record.translation === "string" ? record.translation : "",
		analysis: typeof record.analysis === "string" ? record.analysis : "",
		userTranslation: typeof record.userTranslation === "string" ? record.userTranslation : "",
		parts: normalizeSentenceParts(record.parts),
		updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now(),
	}));
}

function normalizeArticle(value: unknown, fallbackId: string): ArticleRecord | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const record = value as Record<string, unknown>;
	const id = typeof record.id === "string" ? record.id : fallbackId;
	if (!isValidArticleId(id)) return undefined;
	const text = typeof record.text === "string" ? record.text : "";
	const now = Date.now();
	return {
		version: 1,
		id,
		title: typeof record.title === "string" && record.title.length > 0 ? record.title : deriveTitle(text),
		createdAt: typeof record.createdAt === "number" ? record.createdAt : now,
		updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : now,
		text,
		sentences: normalizeSentences(record.sentences),
		clicks: normalizeClicks(record.clicks),
		weakGrammar: normalizeWeakGrammar(record.weakGrammar),
	};
}

/**
 * Reads one article. Returns undefined for an unknown or malformed id. A corrupt file is
 * treated as absent rather than crashing the library listing.
 */
export function readArticle(id: string): ArticleRecord | undefined {
	if (!isValidArticleId(id)) return undefined;
	try {
		const raw = readFileSync(pathOf(id), "utf8");
		return normalizeArticle(JSON.parse(raw), id);
	} catch {
		return undefined;
	}
}

/** All articles, newest first. Corrupt files are skipped instead of failing the request. */
export function listArticles(): ArticleSummary[] {
	ensureDir();
	let names: string[];
	try {
		names = readdirSync(articlesPath());
	} catch {
		return [];
	}
	const summaries: ArticleSummary[] = [];
	for (const name of names) {
		if (!name.endsWith(".json")) continue;
		const id = name.slice(0, -".json".length);
		if (!isValidArticleId(id)) continue;
		const article = readArticle(id);
		if (!article) continue;
		summaries.push({
			id: article.id,
			title: article.title,
			createdAt: article.createdAt,
			updatedAt: article.updatedAt,
			preview: previewOf(article.text),
		});
	}
	return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}

export interface CreateInput {
	title?: string;
	text: string;
	sentences?: SentenceRecord[];
}

function resolveTitle(title: string | undefined, text: string): string {
	const explicit = typeof title === "string" ? title.trim() : "";
	const value = explicit || deriveTitle(text);
	return value.slice(0, 120) || "未命名文章";
}

export function createArticle(input: CreateInput): ArticleRecord {
	ensureDir();
	const now = Date.now();
	const text = input.text.trim();
	if (text.length === 0) throw new Error("text must not be empty");
	const article: ArticleRecord = {
		version: 1,
		id: `art-${now.toString(36)}-${randomSuffix()}`,
		title: resolveTitle(input.title, text),
		createdAt: now,
		updatedAt: now,
		text,
		sentences: normalizeSentences(input.sentences),
		clicks: {},
		weakGrammar: [],
	};
	writeAtomic(pathOf(article.id), article);
	return article;
}

export interface UpdateInput {
	title?: string;
	text?: string;
	sentences?: SentenceRecord[];
	clicks?: Record<string, number>;
	weakGrammar?: WeakGrammarPoint[];
}

/** Partial update. Omitted fields keep their previous value. */
export function updateArticle(id: string, input: UpdateInput): ArticleRecord | undefined {
	const existing = readArticle(id);
	if (!existing) return undefined;
	const text = input.text === undefined ? existing.text : input.text.trim();
	if (input.text !== undefined && text.length === 0) throw new Error("text must not be empty");
	const title =
		input.title !== undefined
			? resolveTitle(input.title, text)
			: input.text !== undefined
				? resolveTitle(undefined, text)
				: existing.title;
	const article: ArticleRecord = {
		...existing,
		text,
		title,
		updatedAt: Date.now(),
		sentences: input.sentences === undefined ? existing.sentences : normalizeSentences(input.sentences),
		clicks: input.clicks === undefined ? existing.clicks : normalizeClicks(input.clicks),
		weakGrammar: input.weakGrammar === undefined ? existing.weakGrammar : normalizeWeakGrammar(input.weakGrammar),
	};
	writeAtomic(pathOf(id), article);
	return article;
}

export function deleteArticle(id: string): boolean {
	if (!isValidArticleId(id)) return false;
	try {
		unlinkSync(pathOf(id));
		return true;
	} catch {
		return false;
	}
}

/** Test seam: where articles live, so a test can assert against the right directory. */
export function articlesDir(): string {
	return articlesPath();
}