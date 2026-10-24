import { lookupFromEcdict } from "./ecdict.ts";
import type { WordEntry } from "./parse.ts";
import type { WordFile, WordRecord } from "./store/words.ts";

export type DefinitionLookup = (words: string[]) => Record<string, WordEntry>;

function needsDefinition(record: WordRecord): boolean {
	return record.ipa.length === 0 || record.pos.length === 0 || record.meanings.length === 0;
}

/**
 * Fills the holes left by lookups that only ever recorded a click.
 *
 * Older records often carry a word, a count and two timestamps but no definition: the reader
 * clicked through before any source answered, and the definition report never arrived. The
 * vocabulary page still has to show something, so this fills `ipa` / `pos` / `meanings` from
 * the local ECDICT at read time.
 *
 * Deliberately read-only: clicks and timestamps are the reader's history, and opening a page
 * must not rewrite them. The returned file is a copy; `words.json` is never touched.
 */
export function fillMissingDefinitions(file: WordFile, lookup: DefinitionLookup = lookupFromEcdict): WordFile {
	const missing = Object.values(file.words)
		.filter(needsDefinition)
		.map((record) => record.word);
	if (missing.length === 0) return file;

	let entries: Record<string, WordEntry> = {};
	try {
		entries = lookup(missing);
	} catch {
		// A missing or broken dictionary must not take the page down; the cards fall back to
		// "词典暂未收录释义" and the click history is still visible.
		return file;
	}

	const words: Record<string, WordRecord> = {};
	for (const [key, record] of Object.entries(file.words)) {
		const entry = entries[key];
		if (!entry) {
			words[key] = record;
			continue;
		}
		const meaning = entry.meaning.trim();
		words[key] = {
			...record,
			ipa: record.ipa || entry.ipa,
			pos: record.pos || entry.pos,
			meanings: record.meanings.length > 0 || meaning.length === 0 ? record.meanings : [meaning],
		};
	}
	return { version: 1, words };
}
