/**
 * Tolerant parser for the grammar-review reply.
 *
 * The model is asked for a JSON array but, like every other model endpoint in this app, it
 * sometimes wraps the array in prose or a code fence. Reusing the same leniency as the word
 * lookup keeps one parsing policy across the project.
 */

export interface GrammarPoint {
	key: string;
	label: string;
	note: string;
	count: number;
}

export interface GradeSample {
	sentence: string;
	user: string;
	analysis: string;
}

const FENCE = /^```(?:json)?\s*/i;
const TRAILING_FENCE = /\s*```$/;
const ARRAY_KEYS = ["points", "weaknesses", "items", "data", "result", "results", "list"];

function stripDecoration(text: string): string {
	return text.replace(FENCE, "").replace(TRAILING_FENCE, "").trim();
}

/** Finds the outermost balanced `[...]`, ignoring anything around it. */
function sliceArray(text: string): string | undefined {
	const start = text.indexOf("[");
	const end = text.lastIndexOf("]");
	if (start === -1 || end <= start) return undefined;
	return text.slice(start, end + 1);
}

/** Expands an object that wraps the rows under a key such as `points`. */
function unwrapArray(value: Record<string, unknown>): unknown[] | undefined {
	for (const key of ARRAY_KEYS) {
		const nested = value[key];
		if (Array.isArray(nested)) return nested;
	}
	return undefined;
}

/** Returns the rows, or an empty array when the reply contains nothing usable. */
export function extractJsonArray(text: string): unknown[] {
	const cleaned = stripDecoration(text);
	let parsed: unknown;
	try {
		parsed = JSON.parse(cleaned);
	} catch {
		const slice = sliceArray(cleaned);
		if (!slice) return [];
		try {
			parsed = JSON.parse(slice);
		} catch {
			return [];
		}
	}
	if (Array.isArray(parsed)) return parsed;
	if (typeof parsed === "object" && parsed !== null) {
		const nested = unwrapArray(parsed as Record<string, unknown>);
		if (nested) return nested;
	}
	return [];
}

/** Only samples with a graded attempt are useful evidence. Fields are trimmed on the way in. */
export function usableSamples(samples: GradeSample[]): GradeSample[] {
	return samples
		.map((sample) => ({
			sentence: sample.sentence.trim(),
			user: sample.user.trim(),
			analysis: sample.analysis.trim(),
		}))
		.filter(
			(sample) => sample.sentence.length > 0 && sample.user.length > 0 && sample.analysis.length > 0,
		);
}