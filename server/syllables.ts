import { llmSplitSyllables } from "./llm.ts";
import { missingSyllables, saveSyllables, syllablesFor } from "./store/syllables.ts";

/**
 * Syllable divisions for the drill, cache first.
 *
 * The reader sees these as "the correct spelling", so they come from the model only when the
 * local cache has nothing, and only for a bounded batch per request. Everything here fails
 * soft: a missing key, a rate limit or a model that answers nonsense costs the reader the
 * separators and nothing else — the drill still shows the correct word undivided.
 */

/** One structured call carries this many words; the vocabulary ledger grows far more slowly. */
export const SYLLABLE_BATCH = 40;

export type SyllableSplit = (words: string[]) => Promise<Record<string, string[]>>;

/** Cached divisions for these words; unknown words are simply absent from the result. */
export function cachedSyllables(words: readonly string[]): Record<string, string[]> {
	return syllablesFor(words);
}

/**
 * Returns divisions for as many of `words` as possible, filling the cache from the model.
 *
 * Concurrent queue loads share one in-flight call, so entering the drill twice in a row does
 * not send the same batch to the provider twice.
 */
let inflight: Promise<void> | undefined;

async function fill(words: string[], split: SyllableSplit): Promise<void> {
	try {
		saveSyllables(await split(words));
	} catch {
		// No key, no model, no answer: the caller still gets whatever is cached.
	}
}

export async function ensureSyllables(
	words: readonly string[],
	split: SyllableSplit = llmSplitSyllables,
): Promise<Record<string, string[]>> {
	const wanted = words.map((word) => word.trim().toLowerCase()).filter((word) => word.length > 0);
	const missing = missingSyllables(wanted).slice(0, SYLLABLE_BATCH);

	if (missing.length > 0) {
		inflight ??= fill(missing, split).then(() => {
			inflight = undefined;
		});
		await inflight;
	}

	return cachedSyllables(wanted);
}
