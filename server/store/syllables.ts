import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataRoot } from "../paths.ts";

/**
 * Cached syllable divisions, one `syllables.json` for the whole library.
 *
 * The local ECDICT has no syllable column, so the drill asks the model once per word and keeps
 * the answer. This file is disposable cache, not user history: it is deliberately separate from
 * `practice.json` so a bad write here can never damage the records the 易错 order reads.
 */

const SEGMENT_PATTERN = /^[A-Za-z'-]{1,48}$/;
/** Roughly the whole reading vocabulary of a patient reader; oldest entries are dropped first. */
export const MAX_SYLLABLE_ENTRIES = 20_000;

export interface SyllableEntry {
	segments: string[];
	at: number;
}

export interface SyllableFile {
	version: 1;
	words: Record<string, SyllableEntry>;
}

function syllablesFilePath(): string {
	return join(dataRoot(), "syllables.json");
}

/**
 * Accepts a division only when it re-forms the word.
 *
 * A model that answers `["tradition","ally"]` for `traditionally` would teach a wrong spelling,
 * and the drill prints these segments as the correct answer — so anything that does not
 * reconstruct the key letter for letter is dropped rather than displayed.
 */
export function normalizeSegments(word: string, raw: unknown): string[] | undefined {
	if (!Array.isArray(raw) || raw.length < 1) return undefined;
	const segments = raw.map((part) => (typeof part === "string" ? part.trim() : ""));
	if (segments.some((part) => !SEGMENT_PATTERN.test(part))) return undefined;
	if (segments.join("").toLowerCase() !== word) return undefined;
	return segments;
}

function normalizeEntry(word: string, raw: unknown): SyllableEntry | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const entry = raw as Record<string, unknown>;
	const segments = Array.isArray(entry.segments) ? entry.segments : raw;
	const clean = normalizeSegments(word, segments);
	if (!clean) return undefined;
	const at = typeof entry.at === "number" && Number.isFinite(entry.at) && entry.at >= 0 ? entry.at : Date.now();
	return { segments: clean, at };
}

function load(): SyllableFile {
	try {
		const parsed: unknown = JSON.parse(readFileSync(syllablesFilePath(), "utf8"));
		if (typeof parsed !== "object" || parsed === null) return { version: 1, words: {} };
		const raw = (parsed as Record<string, unknown>).words;
		const words: Record<string, SyllableEntry> = {};
		if (typeof raw === "object" && raw !== null) {
			for (const [word, value] of Object.entries(raw)) {
				const key = word.toLowerCase();
				const entry = normalizeEntry(key, value);
				if (entry) words[key] = entry;
			}
		}
		return { version: 1, words };
	} catch {
		return { version: 1, words: {} };
	}
}

function save(file: SyllableFile): void {
	mkdirSync(dataRoot(), { recursive: true });
	const path = syllablesFilePath();
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(file, null, "\t")}\n`, "utf8");
	renameSync(tmp, path);
}

export function listSyllables(): Record<string, string[]> {
	const file = load();
	return Object.fromEntries(Object.entries(file.words).map(([word, entry]) => [word, entry.segments]));
}

/** Word → segments, for the subset the caller asked about. Unknown words are simply absent. */
export function syllablesFor(words: readonly string[]): Record<string, string[]> {
	const cached = listSyllables();
	const picked: Record<string, string[]> = {};
	for (const word of words) {
		const key = word.trim().toLowerCase();
		const segments = cached[key];
		if (segments) picked[key] = segments;
	}
	return picked;
}

/** Merges fresh divisions into the cache, dropping the oldest entries past the cap. */
export function saveSyllables(entries: Record<string, string[]>): number {
	const keys = Object.entries(entries);
	if (keys.length === 0) return 0;

	const file = load();
	const at = Date.now();
	for (const [word, segments] of keys) {
		const key = word.trim().toLowerCase();
		const clean = normalizeSegments(key, segments);
		if (!clean) continue;
		file.words[key] = { segments: clean, at };
	}

	const all = Object.entries(file.words);
	if (all.length > MAX_SYLLABLE_ENTRIES) {
		const oldest = all.sort((a, b) => a[1].at - b[1].at).slice(0, all.length - MAX_SYLLABLE_ENTRIES);
		for (const [word] of oldest) delete file.words[word];
	}

	save(file);
	return Object.keys(entries).filter((word) => file.words[word.trim().toLowerCase()] !== undefined).length;
}

/** Words the cache has never seen, in the caller's order. */
export function missingSyllables(words: readonly string[]): string[] {
	const file = load();
	return [...new Set(words.map((word) => word.trim().toLowerCase()).filter((word) => word.length > 0))].filter(
		(word) => file.words[word] === undefined,
	);
}

/** Test seam so tests can assert the file landed in the temp directory. */
export function syllablesPath(): string {
	return syllablesFilePath();
}
