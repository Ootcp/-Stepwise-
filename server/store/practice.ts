import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataRoot } from "../paths.ts";

/**
 * Spelling-drill history on disk, one `practice.json` for the whole library.
 *
 * This is the only place that knows how often a word was misspelled, which is what the drill's
 * 易错 order is built from. It is deliberately separate from `words.json`: the word list is a
 * click log that other pages read, and mixing attempt counts into it would mean every drill
 * submit rewrites the vocabulary records.
 */

const WORD_PATTERN = /^[a-z][a-z'-]{0,47}$/;
/** A year of daily drills is a few hundred records; this keeps a rogue writer from growing the file forever. */
export const MAX_PRACTICE_RECORDS = 5000;
const MAX_COUNT = 1_000_000;
const CLOCK_SLACK_MS = 60_000;

export interface PracticeRecord {
	word: string;
	attempts: number;
	misses: number;
	lastWrongAt: number;
	lastCorrectAt: number;
	updatedAt: number;
}

export interface PracticeFile {
	version: 1;
	words: Record<string, PracticeRecord>;
}

function practiceFilePath(): string {
	return join(dataRoot(), "practice.json");
}

function count(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
	return Math.min(Math.floor(value), MAX_COUNT);
}

function stamp(value: unknown, now: number): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
	return value > now + CLOCK_SLACK_MS ? now : value;
}

function normalizeRecord(word: string, raw: unknown, now: number): PracticeRecord | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const record = raw as Record<string, unknown>;
	const attempts = count(record.attempts);
	const misses = Math.min(count(record.misses), attempts);
	const lastWrongAt = stamp(record.lastWrongAt, now);
	const lastCorrectAt = stamp(record.lastCorrectAt, now);
	return {
		word,
		attempts,
		misses,
		lastWrongAt,
		lastCorrectAt,
		updatedAt: stamp(record.updatedAt, now) || Math.max(lastWrongAt, lastCorrectAt) || now,
	};
}

/** A corrupt or missing file starts an empty log rather than taking the drill down. */
function load(): PracticeFile {
	const now = Date.now();
	try {
		const parsed: unknown = JSON.parse(readFileSync(practiceFilePath(), "utf8"));
		if (typeof parsed !== "object" || parsed === null) return { version: 1, words: {} };
		const raw = (parsed as Record<string, unknown>).words;
		const words: Record<string, PracticeRecord> = {};
		if (typeof raw === "object" && raw !== null) {
			for (const [word, value] of Object.entries(raw)) {
				if (!WORD_PATTERN.test(word)) continue;
				const normalized = normalizeRecord(word, value, now);
				if (normalized) words[word] = normalized;
			}
		}
		return { version: 1, words };
	} catch {
		return { version: 1, words: {} };
	}
}

function save(file: PracticeFile): void {
	mkdirSync(dataRoot(), { recursive: true });
	const path = practiceFilePath();
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(file, null, "\t")}\n`, "utf8");
	renameSync(tmp, path);
}

/**
 * Drops the records that tell the reader the least: fewest attempts first, then the oldest.
 * A word with one miss out of one try is kept over a word with one attempt long ago, because
 * the order a reader picks is about what they get wrong now.
 */
function prune(words: Record<string, PracticeRecord>): void {
	const entries = Object.values(words);
	if (entries.length <= MAX_PRACTICE_RECORDS) return;
	const surplus = entries
		.sort((a, b) => a.attempts - b.attempts || a.updatedAt - b.updatedAt || a.word.localeCompare(b.word))
		.slice(0, entries.length - MAX_PRACTICE_RECORDS);
	for (const record of surplus) delete words[record.word];
}

export function listPractice(): PracticeFile {
	return load();
}

/**
 * Records one submitted answer and returns the record.
 *
 * The timestamp is the server's, never the browser's: the 易错 order ties scores on
 * `lastWrongAt`, and a skewed client clock would file a word under the wrong year.
 */
export function recordAttempt(word: string, correct: boolean): PracticeRecord {
	const key = word.trim().toLowerCase();
	if (!WORD_PATTERN.test(key)) throw new Error("无效单词");

	const file = load();
	const now = Date.now();
	const record: PracticeRecord = file.words[key] ?? {
		word: key,
		attempts: 0,
		misses: 0,
		lastWrongAt: 0,
		lastCorrectAt: 0,
		updatedAt: now,
	};

	record.attempts = Math.min(record.attempts + 1, MAX_COUNT);
	if (correct) record.lastCorrectAt = now;
	else {
		record.misses = Math.min(record.misses + 1, record.attempts);
		record.lastWrongAt = now;
	}
	record.updatedAt = now;
	file.words[key] = record;

	prune(file.words);
	save(file);
	return record;
}

/** Test seam so tests can assert the file landed in the temp directory. */
export function practicePath(): string {
	return practiceFilePath();
}
