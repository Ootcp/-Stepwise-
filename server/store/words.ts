import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataRoot } from "../paths.ts";

/**
 * Authoritative vocabulary dictionary on disk.
 *
 * One `words.json` for the whole library rather than a file per word: the whole file is a few
 * hundred KB even after years of reading, it is read on every page load, and a directory with
 * 100k tiny files is far slower to list than one parse.
 */

function wordsFilePath(): string {
	return join(dataRoot(), "words.json");
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

export interface WordFile {
	version: 1;
	words: Record<string, WordRecord>;
}

export interface WordEntryInput {
	pos?: string;
	meaning?: string;
	ipa?: string;
}

function normalizeRecord(word: string, raw: unknown): WordRecord | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const record = raw as Record<string, unknown>;
	const now = Date.now();
	return {
		word,
		ipa: typeof record.ipa === "string" ? record.ipa : "",
		pos: typeof record.pos === "string" ? record.pos : "",
		meanings: Array.isArray(record.meanings) ? record.meanings.filter((item): item is string => typeof item === "string") : [],
		clicks: typeof record.clicks === "number" && record.clicks > 0 ? record.clicks : 0,
		firstSeenAt: typeof record.firstSeenAt === "number" ? record.firstSeenAt : now,
		lastSeenAt: typeof record.lastSeenAt === "number" ? record.lastSeenAt : now,
	};
}

/** A corrupt or missing file starts an empty dictionary rather than taking the app down. */
function load(): WordFile {
	try {
		const parsed: unknown = JSON.parse(readFileSync(wordsFilePath(), "utf8"));
		if (typeof parsed !== "object" || parsed === null) return { version: 1, words: {} };
		const raw = (parsed as Record<string, unknown>).words;
		const words: Record<string, WordRecord> = {};
		if (typeof raw === "object" && raw !== null) {
			for (const [word, value] of Object.entries(raw)) {
				const normalized = normalizeRecord(word, value);
				if (normalized) words[word] = normalized;
			}
		}
		return { version: 1, words };
	} catch {
		return { version: 1, words: {} };
	}
}

function save(file: WordFile): void {
	mkdirSync(dataRoot(), { recursive: true });
	const path = wordsFilePath();
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(file, null, "\t")}\n`, "utf8");
	renameSync(tmp, path);
}

export function listWords(): WordFile {
	return load();
}

/**
 * Merges one batch of words into the dictionary and returns the records that changed.
 *
 * The merge rules follow the requirement "add only if absent, and only append this session's
 * meaning when the sense differs": click counts accumulate, new meanings are appended rather
 * than replacing, and `pos`/`ipa` only fill an empty slot so a later source cannot overwrite
 * a good value with a worse one.
 */
export function upsert(words: string[], entries: Record<string, WordEntryInput>): Record<string, WordRecord> {
	const file = load();
	const now = Date.now();
	const updated: Record<string, WordRecord> = {};

	for (const rawWord of words) {
		const word = rawWord.trim().toLowerCase();
		if (word.length === 0) continue;
		const entry = entries[word] ?? entries[rawWord] ?? {};
		const existing = file.words[word];

		if (!existing) {
			const meaning = entry.meaning?.trim();
			const record: WordRecord = {
				word,
				ipa: entry.ipa?.trim() ?? "",
				pos: entry.pos?.trim() ?? "",
				meanings: meaning ? [meaning] : [],
				clicks: 1,
				firstSeenAt: now,
				lastSeenAt: now,
			};
			file.words[word] = record;
			updated[word] = record;
			continue;
		}

		existing.clicks += 1;
		existing.lastSeenAt = now;
		const meaning = entry.meaning?.trim();
		if (meaning && !existing.meanings.includes(meaning)) existing.meanings.push(meaning);
		if (!existing.pos && entry.pos) existing.pos = entry.pos.trim();
		if (!existing.ipa && entry.ipa) existing.ipa = entry.ipa.trim();
		updated[word] = existing;
	}

	if (Object.keys(updated).length > 0) save(file);
	return updated;
}

/** Test seam so tests can assert the file landed in the temp directory. */
export function wordsPath(): string {
	return wordsFilePath();
}