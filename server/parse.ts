/**
 * Tolerant parser for the model reply to a word-lookup prompt.
 *
 * Why this is so defensive: the endpoint rate-limits aggressively, and a throttled reply
 * arrives as an empty or prose-wrapped string. Reporting "the model returned nothing" is
 * useless, so this accepts every shape the model has actually been observed to produce:
 * a bare array, an array inside a fenced block, an object wrapping that array
 * (`{"words": [...]}`), and a plain `word -> entry` map. Field names vary too, so
 * `pos`/`part_of_speech` and `meaning`/`meanings`/`translation` are all accepted.
 */

export interface WordEntry {
	/** Part of speech abbreviation, e.g. "adj.". */
	pos: string;
	/** Chinese meaning, short enough for a tooltip. */
	meaning: string;
	/** IPA transcription in slashes, or "" when no source provided one. */
	ipa: string;
}

export interface LookupRow {
	word: string;
	entry: WordEntry;
}

const FENCE = /^```(?:json)?\s*/i;
const TRAILING_FENCE = /\s*```$/;
const THINK_BLOCK = /<think>[\s\S]*?<\/thinking>/gi;

const WORD_KEYS = ["word", "term", "text", "name"];
const POS_KEYS = ["pos", "part_of_speech", "partOfSpeech", "word_type", "词性"];
const MEANING_KEYS = ["meaning", "meanings", "translation", "definition", "definitions", "释义", "中文"];
const IPA_KEYS = ["ipa", "phonetic", "phonetics", "pronunciation"];
const ARRAY_KEYS = ["words", "result", "results", "data", "entries", "list", "items"];

/** CJK ranges. A model asked for IPA sometimes answers with Chinese instead. */
const CJK = /[㐀-䶿一-鿿豈-﫿぀-ヿ]/;

/**
 * Normalizes an IPA transcription.
 *
 * Returns "" rather than a best guess: a wrong phonetic transcription is worse than none,
 * because the reader has no way to tell it was invented. Anything containing CJK, longer
 * than 40 characters, or not slash-delimited after cleanup is discarded.
 */
export function cleanIpa(raw: string | undefined): string {
	if (!raw) return "";
	const compact = raw.trim().replace(/\s+/g, "");
	if (compact.length === 0 || compact.length > 40) return "";
	if (CJK.test(compact)) return "";
	// Some sources answer "[dɪˈkʌʃən]" or "dɪˈkʌʃən"; both become /dɪˈkʌʃən/.
	const bare = compact.replace(/^[[/(]+/, "").replace(/[\]/()]+$/, "");
	if (bare.length === 0) return "";
	return `/${bare}/`;
}

function stripDecoration(text: string): string {
	return text.replace(THINK_BLOCK, "").replace(FENCE, "").replace(TRAILING_FENCE, "").trim();
}

function pickString(source: Record<string, unknown>, keys: string[]): string {
	for (const key of keys) {
		const value = source[key];
		if (typeof value === "string" && value.trim()) return value.trim();
		if (Array.isArray(value) && value.length > 0) {
			const joined = value.filter((item) => typeof item === "string").join("、").trim();
			if (joined) return joined;
		}
	}
	return "";
}

function toEntry(source: unknown): WordEntry | undefined {
	if (typeof source === "string") {
		const meaning = source.trim();
		return meaning ? { pos: "", meaning, ipa: "" } : undefined;
	}
	if (typeof source !== "object" || source === null) return undefined;
	const record = source as Record<string, unknown>;
	const meaning = pickString(record, MEANING_KEYS);
	if (!meaning) return undefined;
	return { pos: pickString(record, POS_KEYS), meaning, ipa: cleanIpa(pickString(record, IPA_KEYS)) };
}

/** Finds the outermost balanced `{...}` or `[...]` span, ignoring anything around it. */
function sliceJson(text: string): string | undefined {
	for (const [open, close] of [
		["[", "]"],
		["{", "}"],
	] as const) {
		const start = text.indexOf(open);
		const end = text.lastIndexOf(close);
		if (start !== -1 && end > start) return text.slice(start, end + 1);
	}
	return undefined;
}

function parseJson(candidate: string | undefined): unknown {
	if (!candidate) return undefined;
	try {
		return JSON.parse(candidate);
	} catch {
		return undefined;
	}
}

/** Expands an object that wraps the real rows under a key such as `words` or `data`. */
function unwrapArray(value: Record<string, unknown>): unknown[] | undefined {
	for (const key of ARRAY_KEYS) {
		const nested = value[key];
		if (Array.isArray(nested)) return nested;
	}
	return undefined;
}

function collectArray(rows: unknown[], output: LookupRow[]): void {
	for (const row of rows) {
		if (typeof row !== "object" || row === null) continue;
		const record = row as Record<string, unknown>;
		const entry = toEntry(record);
		const word = pickString(record, WORD_KEYS);
		if (entry && word) output.push({ word, entry });
	}
}

function collectMap(map: Record<string, unknown>, output: LookupRow[]): void {
	for (const [word, value] of Object.entries(map)) {
		const entry = toEntry(value);
		if (entry) output.push({ word, entry });
	}
}

/**
 * Extracts word/entry rows from a model reply. Returns an empty array when nothing
 * parseable is present, which the caller reports as "no definitions", not as a crash.
 */
export function parseLookupReply(text: string): LookupRow[] {
	const cleaned = stripDecoration(text);
	const parsed = parseJson(cleaned) ?? parseJson(sliceJson(cleaned));
	const output: LookupRow[] = [];

	if (Array.isArray(parsed)) {
		collectArray(parsed, output);
		return output;
	}
	if (typeof parsed === "object" && parsed !== null) {
		const record = parsed as Record<string, unknown>;
		const nested = unwrapArray(record);
		if (nested) {
			collectArray(nested, output);
			return output;
		}
		collectMap(record, output);
	}
	return output;
}
const SYLLABLE_KEYS = ["syllables", "segments", "分节", "音节"];

/** Removes the separators a model likes to insert (`·`, spaces, `/`), keeping real word characters. */
function stripSeparators(part: string): string {
	return part.replace(/[·・‧\s/|]/g, "");
}

function toSegments(raw: unknown): string[] | undefined {
	if (typeof raw === "string") {
		const parts = raw.split(/[·・‧|/]/).map((part) => stripSeparators(part.trim()));
		return parts.length > 0 ? parts : undefined;
	}
	if (!Array.isArray(raw)) return undefined;
	const parts = raw.map((part) => (typeof part === "string" ? stripSeparators(part.trim()) : "")).filter((part) => part.length > 0);
	return parts.length > 0 ? parts : undefined;
}

/** The first array or `·`-joined string found under one of the syllable keys. */
function pickSegments(record: Record<string, unknown>, keys: string[]): string[] | undefined {
	for (const key of keys) {
		const segments = toSegments(record[key]);
		if (segments) return segments;
	}
	return undefined;
}

function collectSyllableRows(rows: unknown[], output: Record<string, string[]>): void {
	for (const row of rows) {
		if (typeof row !== "object" || row === null) continue;
		const record = row as Record<string, unknown>;
		const word = pickString(record, WORD_KEYS);
		const segments = pickSegments(record, SYLLABLE_KEYS);
		if (word.length > 0 && segments) output[word.toLowerCase()] = segments;
	}
}

/**
 * Extracts `word -> syllable segments` from a model reply.
 *
 * Same defensive shape as `parseLookupReply`: a nested `{"items": [...]}` array, a bare array,
 * or a `word -> segments` map. Callers must still check that the segments re-form the word.
 */
export function parseSyllableReply(text: string): Record<string, string[]> {
	const cleaned = stripDecoration(text);
	const parsed = parseJson(cleaned) ?? parseJson(sliceJson(cleaned));
	const output: Record<string, string[]> = {};

	if (Array.isArray(parsed)) {
		collectSyllableRows(parsed, output);
		return output;
	}
	if (typeof parsed !== "object" || parsed === null) return output;

	const record = parsed as Record<string, unknown>;
	const nested = unwrapArray(record);
	if (nested) {
		collectSyllableRows(nested, output);
		return output;
	}
	for (const [word, value] of Object.entries(record)) {
		if (Array.isArray(value) || typeof value === "string") {
			const segments = toSegments(value);
			if (segments) output[word.toLowerCase()] = segments;
			continue;
		}
		if (typeof value === "object" && value !== null) {
			const inner = value as Record<string, unknown>;
			const segments = pickSegments(inner, SYLLABLE_KEYS);
			if (segments) output[word.toLowerCase()] = segments;
		}
	}
	return output;
}
