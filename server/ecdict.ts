import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { cleanIpa } from "./parse.ts";
import type { WordEntry } from "./parse.ts";
import { normalizePos } from "./pos.ts";

/**
 * Offline dictionary backed by ECDICT (skywind3000/ECDICT).
 *
 * Why this source matters more than the online ones: it is the only source here whose
 * phonetics and Chinese definitions are curated rather than generated, and it answers from
 * disk in about a millisecond. It also carries `tag` (CET/GRE/TOEFL exam level) and `frq`
 * (frequency rank), which the online services cannot give us at all.
 *
 * The installed file is a slimmed rebuild of the official SQLite release: one row per word
 * (the most common sense), with the long English definitions and audio blobs dropped. The
 * original is 812 MB and 3.4M rows including one row per sense; the slim file is ~310 MB and
 * holds every distinct lowercase word.
 *
 * Optional by design. If the file is missing the app silently skips this source and falls
 * through to the online chain, so a fresh clone works without downloading anything.
 */

const CANDIDATE_PATHS = (): string[] => {
	const override = process.env.ENGLISH_APP_ECDICT_PATH;
	if (override) return [override];
	const localAppData = process.env.LOCALAPPDATA;
	if (localAppData) return [join(localAppData, "english-app", "ecdict", "english-words.db")];
	return [join(homedir(), ".english-app", "ecdict", "english-words.db")];
};

let cachedPath: string | undefined;
let database: DatabaseSync | undefined;
let lookup: ((words: string[]) => EcdictRow[]) | undefined;

interface EcdictRow {
	word: string;
	phonetic: string | null;
	translation: string | null;
	pos: string | null;
	tag: string | null;
	frq: number | null;
}

/**
 * ECDICT's `pos` column is a weighted list of internal one- and two-letter codes
 * (`"n:15/v:85"` means 85% verb). These are the codes that actually occur in the shipped
 * file, measured by counting every distinct value in the column.
 */
const POS_CODES: Record<string, string> = {
	n: "n.",
	j: "adj.",
	a: "art.",
	v: "v.",
	r: "adv.",
	i: "conj.",
	c: "conj.",
	p: "prep.",
	u: "int.",
	m: "num.",
	d: "adv.",
	t: "phr.",
};

/**
 * The translation line is more reliable than the `pos` column: it is written with standard
 * English abbreviations ("a. 宁静的", "vi. 唱, 唱歌"), so it wins whenever it is present.
 */
export function posFromMeaningLine(line: string): string {
	const match = /^([a-z]{1,5})\.\s/.exec(line.trim());
	return match ? normalizePos(match[1]) : "";
}

/** The dominant sense: the code with the highest usage percentage. */
export function posFromCodes(raw: string | null): string {
	if (!raw) return "";
	const best = raw
		.split("/")
		.map((part) => part.split(":"))
		.filter((parts): parts is [string, string] => parts.length === 2)
		.sort((a, b) => Number(b[1]) - Number(a[1]))[0];
	if (!best) return normalizePos(raw);
	return normalizePos(POS_CODES[best[0].trim()] ?? raw);
}

/** First line of the ECDICT translation, with its leading part-of-speech code removed. */
function firstLine(raw: string | null): string {
	return (raw ?? "").split("\n")[0] ?? "";
}

/** ECDICT lines look like `"a. 宁静的, 沉着的\nn. 晴朗"`. Only the first sense is shown. */
export function pickMeaning(raw: string | null): string {
	const cleaned = firstLine(raw)
		.replace(/^[a-z]{1,5}\.\s*/i, "")
		.replace(/\s+/g, " ")
		.trim();
	// Keep the tooltip readable; a full ECDICT sense list can run to dozens of glosses.
	const senses = cleaned
		.split(/[,，;；]/)
		.map((sense) => sense.trim())
		.filter((sense) => sense.length > 0);
	return senses.slice(0, 3).join("、");
}

function open(): ((words: string[]) => EcdictRow[]) | undefined {
	if (lookup) return lookup;
	const path = CANDIDATE_PATHS().find((candidate) => existsSync(candidate));
	if (!path) return undefined;
	try {
		const connection = new DatabaseSync(path, { readOnly: true });
		const select = connection.prepare(
			"select word, phonetic, translation, pos, tag, frq from words where word = ?",
		);
		lookup = (words: string[]): EcdictRow[] => {
			const rows: EcdictRow[] = [];
			for (const word of words) {
				const row = select.get(word) as EcdictRow | undefined;
				if (row) rows.push(row);
			}
			return rows;
		};
		database = connection;
		cachedPath = path;
	} catch {
		lookup = undefined;
	}
	return lookup;
}

/** Where the dictionary was found, for the status line and for diagnosing a missing install. */
export function ecdictInfo(): { installed: boolean; path: string | undefined } {
	const discovered = CANDIDATE_PATHS().find((candidate) => existsSync(candidate));
	return { installed: cachedPath !== undefined || discovered !== undefined, path: cachedPath ?? discovered };
}

/** Test seam so tests can drop the cached handle. */
export function resetEcdict(): void {
	database?.close();
	database = undefined;
	lookup = undefined;
	cachedPath = undefined;
}

/** Entries for the requested words, in the shape the rest of the chain produces. */
export function lookupFromEcdict(words: string[]): Record<string, WordEntry> {
	const query = open();
	if (!query) return {};
	const entries: Record<string, WordEntry> = {};
	for (const row of query(words.map((word) => word.toLowerCase()))) {
		const meaning = pickMeaning(row.translation);
		if (!meaning) continue;
		const pos = posFromMeaningLine(firstLine(row.translation)) || posFromCodes(row.pos);
		entries[row.word] = {
			pos,
			meaning,
			ipa: cleanIpa(row.phonetic ? `/${row.phonetic}/` : ""),
		};
	}
	return entries;
}

/** Exam tags such as "cet6 ky toefl"; empty when the word has none. Exposed for the vocabulary list. */
export function examTags(words: string[]): Record<string, string[]> {
	const query = open();
	if (!query) return {};
	const tags: Record<string, string[]> = {};
	for (const row of query(words.map((word) => word.toLowerCase()))) {
		if (!row.tag) continue;
		tags[row.word] = row.tag.split(/\s+/).filter((tag) => tag.length > 0);
	}
	return tags;
}