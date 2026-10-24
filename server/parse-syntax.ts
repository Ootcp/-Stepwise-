/**
 * Tolerant parser for the analyze reply's sentence-part breakdown.
 *
 * The model is asked for whole-sentence blocks — `{"analysis": "...", "parts": [{"w": "...",
 * "r": "主"}]}` — where a block may be a word, a phrase or a clause, and a clause carries its
 * own parts under `sub`. Like every other model endpoint in this app it sometimes wraps the
 * JSON in prose or a code fence, renames fields, or labels the same role in different ways;
 * the same leniency as the word lookup keeps one parsing policy across the project.
 */

export const ROLES = ["主", "谓", "宾", "定", "状", "补", "表", "同"] as const;

/** Deepest nested breakdown accepted. Real replies use two levels; this only stops bad loops. */
const MAX_PART_DEPTH = 4;

/** One block of the original sentence and the sentence role the model assigned to it. */
export interface SentencePart {
	/** A contiguous slice of the original sentence: a word, a phrase or a clause. */
	w: string;
	/** 主/谓/宾/定/状/补/表/同, or "" for punctuation and words without a role. */
	r: string;
	/** True when this block is a clause. */
	clause?: boolean;
	/** Nested blocks: the clause's own components, or the clauses inside a phrase. */
	sub?: SentencePart[];
}

/** The structured skeleton of a grading reply. `analysis` may be empty for reference-only. */
export interface AnalyzeReply {
	analysis: string;
	parts: SentencePart[];
}

const FENCE = /^```(?:json)?\s*/i;
const TRAILING_FENCE = /\s*```$/;
const THINK_BLOCK = / think[\s\S]*?<\/think>/gi;
const WRAP_KEYS = ["reply", "result", "data", "output", "syntax"];
const PART_KEYS = ["parts", "roles", "components", "tokens", "segments", "items"];
const SUB_KEYS = ["sub", "children", "inner", "parts", "components", "segments", "items"];

const WORD_KEYS = ["w", "word", "text", "token", "segment", "词"];
const ROLE_KEYS = ["r", "role", "pos", "label", "tag", "成分"];
const CLAUSE_KEYS = ["clause", "c", "isClause", "is_clause", "从句"];

/**
 * Roles may arrive in long form, as a clause name, or in English. They all collapse to one of
 * the eight short roles; a "…从句" name also marks the block as a clause.
 */
const ROLE_ALIASES: Record<string, string> = {
	主语: "主",
	谓语: "谓",
	谓语动词: "谓",
	宾语: "宾",
	定语: "定",
	状语: "状",
	补语: "补",
	补足语: "补",
	宾补: "补",
	宾语补足语: "补",
	表语: "表",
	系表: "表",
	系表结构: "表",
	同位语: "同",
	同位: "同",
	subject: "主",
	predicate: "谓",
	verb: "谓",
	object: "宾",
	attributive: "定",
	adverbial: "状",
	complement: "补",
	predicative: "表",
	appositive: "同",
};

function stripDecoration(text: string): string {
	return text.replace(THINK_BLOCK, "").replace(FENCE, "").replace(TRAILING_FENCE, "").trim();
}

/** Finds the outermost balanced `{...}` span, ignoring anything around it. */
function sliceObject(text: string): string | undefined {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start === -1 || end <= start) return undefined;
	return text.slice(start, end + 1);
}

function unquote(value: string): string {
	return value.replace(/^["'`]+|["'`]+$/g, "").trim();
}

function pickString(source: Record<string, unknown>, keys: string[]): string {
	for (const key of keys) {
		const value = source[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return "";
}

/** Normalizes a role label and reports whether the label itself said "clause". */
function normalizeRole(raw: string): { role: string; clause: boolean } {
	const cleaned = unquote(raw.toLowerCase());
	if (!cleaned) return { role: "", clause: false };
	const englishClause = /\sclause$/.test(cleaned);
	const chineseClause = /从句$/.test(cleaned) || /从$/.test(cleaned);
	const clause = englishClause || chineseClause;
	const stem = cleaned.replace(/从句$/, "").replace(/从$/, "").replace(/\sclause$/, "").trim();
	const direct = ROLE_ALIASES[cleaned];
	if (direct !== undefined) return { role: direct, clause: clause && direct !== "" };
	const aliased = ROLE_ALIASES[stem];
	if (aliased !== undefined) return { role: aliased, clause: clause && aliased !== "" };
	if ((ROLES as readonly string[]).includes(cleaned)) return { role: cleaned, clause: false };
	if ((ROLES as readonly string[]).includes(stem)) return { role: stem, clause: clause && stem !== "" };
	return { role: "", clause: false };
}

/** Extracts the parts array from a parsed reply, following whatever shape the model chose. */
function extractParts(value: unknown): unknown[] | undefined {
	if (Array.isArray(value)) return value;
	if (typeof value !== "object" || value === null) return undefined;
	const record = value as Record<string, unknown>;
	for (const key of [...PART_KEYS, ...WRAP_KEYS]) {
		const nested = record[key];
		const found = extractParts(nested);
		if (found) return found;
	}
	return undefined;
}

/**
 * Reads a nested block list. Accepts the array directly, a single block object, or a wrapper
 * like `{"parts": [...]}`; anything else means the detail is unusable and is dropped.
 */
function partRows(value: unknown, depth: number): unknown[] | undefined {
	if (Array.isArray(value)) return value;
	if (typeof value !== "object" || value === null || depth > 2) return undefined;
	const record = value as Record<string, unknown>;
	if (typeof record.w === "string" && typeof record.r === "string") return [value];
	for (const key of [...SUB_KEYS, ...PART_KEYS, ...WRAP_KEYS]) {
		const nested = record[key];
		if (nested === undefined) continue;
		const found = partRows(nested, depth + 1);
		if (found) return found;
	}
	return undefined;
}

function pickSubRows(record: Record<string, unknown>): unknown[] | undefined {
	for (const key of SUB_KEYS) {
		if (!(key in record)) continue;
		const found = partRows(record[key], 0);
		if (found) return found;
	}
	return undefined;
}

function readsAsClause(record: Record<string, unknown>): boolean {
	for (const key of CLAUSE_KEYS) {
		const value = record[key];
		if (value === true || value === 1) return true;
		if (typeof value === "string" && /^(true|yes|1|从句|clause)$/i.test(unquote(value))) return true;
	}
	return false;
}

function toPart(value: unknown, depth: number): SentencePart | undefined {
	if (depth > MAX_PART_DEPTH) return undefined;
	if (typeof value === "string") {
		// A bare string like "主" carries no text, which is useless for rendering.
		return undefined;
	}
	if (typeof value !== "object" || value === null) return undefined;
	const record = value as Record<string, unknown>;
	const w = pickString(record, WORD_KEYS);
	if (!w) return undefined;
	const { role, clause: roleClause } = normalizeRole(pickString(record, ROLE_KEYS));
	const clause = roleClause || readsAsClause(record);
	const sub = pickSubRows(record)
		?.map((item) => toPart(item, depth + 1))
		.filter((part): part is SentencePart => part !== undefined);
	const part: SentencePart = { w, r: role };
	if (clause) part.clause = true;
	if (sub && sub.length > 0) part.sub = sub;
	return part;
}

/**
 * Normalizes already-shaped blocks, as stored in an article or posted back by the browser.
 * Bad rows are dropped instead of failing the request; an empty result is undefined.
 */
export function normalizeSentenceParts(value: unknown): SentencePart[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const parts = value
		.map((item) => toPart(item, 0))
		.filter((part): part is SentencePart => part !== undefined);
	return parts.length > 0 ? parts : undefined;
}

/**
 * Parses the model's analyze reply. Returns the analysis text plus the blocks that could be
 * read, dropping anything unusable. An unparseable reply yields an empty reply rather than
 * throwing, so grading still survives even when the model returns prose.
 */
export function parseAnalyzeReply(text: string): AnalyzeReply {
	const cleaned = stripDecoration(text);
	let parsed: unknown;
	try {
		parsed = JSON.parse(cleaned);
	} catch {
		const slice = sliceObject(cleaned);
		if (!slice) return { analysis: "", parts: [] };
		try {
			parsed = JSON.parse(slice);
		} catch {
			return { analysis: "", parts: [] };
		}
	}

	let record: Record<string, unknown>;
	if (Array.isArray(parsed)) {
		// A lone array of parts with no analysis block.
		record = { parts: parsed };
	} else if (typeof parsed !== "object" || parsed === null) {
		return { analysis: "", parts: [] };
	} else {
		record = parsed as Record<string, unknown>;
	}

	let analysis = pickString(record, ["analysis", "analyses", "critique", "comment", "批改"]);
	// Some models nest the analysis under a wrapper; dig if the top level came up empty.
	if (!analysis) {
		for (const key of [...WRAP_KEYS, ...PART_KEYS]) {
			const nested = record[key];
			if (typeof nested !== "object" || nested === null) continue;
			const dug = pickString(nested as Record<string, unknown>, ["analysis", "text", "批改"]);
			if (dug) {
				analysis = dug;
				break;
			}
		}
	}

	const parts = (extractParts(record) ?? [])
		.map((item) => toPart(item, 0))
		.filter((part): part is SentencePart => part !== undefined);

	return { analysis, parts };
}
