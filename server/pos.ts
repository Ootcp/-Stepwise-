/**
 * Part-of-speech normalization.
 *
 * The dictionary models answer with whatever they like: "adj.", "adjective", "形容词", or
 * nothing at all. The UI needs one stable token, so every source is mapped to the canonical
 * abbreviation here and the browser renders exactly what it receives.
 */


/** English words and abbreviations that all mean the same part of speech. */
const ALIASES: Record<string, string> = {
	n: "n.",
	"n.": "n.",
	noun: "n.",
	nouns: "n.",
	v: "v.",
	"v.": "v.",
	verb: "v.",
	verbs: "v.",
	vt: "vt.",
	vi: "vi.",
	a: "adj.",
	adj: "adj.",
	"adj.": "adj.",
	adjective: "adj.",
	adjectives: "adj.",
	adp: "adj.",
	adv: "adv.",
	"adv.": "adv.",
	adverb: "adv.",
	adverbs: "adv.",
prep: "prep.",
	"prep.": "prep.",
	preposition: "prep.",
	conj: "conj.",
	"conj.": "conj.",
	conjunction: "conj.",
	pron: "pron.",
	"pron.": "pron.",
	pronoun: "pron.",
	det: "det.",
	"det.": "det.",
	determiner: "det.",
	article: "art.",
	art: "art.",
	"art.": "art.",
	num: "num.",
	"num.": "num.",
	numeral: "num.",
	int: "int.",
	"int.": "int.",
	interjection: "int.",
	aux: "aux.",
	"aux.": "aux.",
	modal: "modal.",
	"modal.": "modal.",
	phrase: "phr.",
	"phr.": "phr.",
	abbreviation: "abbr.",
	abbr: "abbr.",
};

/** Chinese names mapped back to abbreviations, so a Chinese reply normalizes too. */
const CHINESE_LABELS: Record<string, string> = {
	名词: "n.",
	动词: "v.",
	及物动词: "vt.",
	不及物动词: "vi.",
	形容词: "adj.",
	副词: "adv.",
	介词: "prep.",
	连词: "conj.",
	代词: "pron.",
	限定词: "det.",
	冠词: "art.",
	数词: "num.",
	感叹词: "int.",
	助动词: "aux.",
	情态动词: "modal.",
	短语: "phr.",
	缩写: "abbr.",
};

function lookup(raw: string): string | undefined {
	const trimmed = raw.trim();
	if (!trimmed) return undefined;
	const byAlias = ALIASES[trimmed.toLowerCase()];
	if (byAlias) return byAlias;
	const byChinese = CHINESE_LABELS[trimmed];
	if (byChinese) return byChinese;
	// Longest label first so "名词(复数)" wins over a bare "名词" match.
	const best = Object.keys(CHINESE_LABELS)
		.filter((name) => trimmed.includes(name))
		.sort((a, b) => b.length - a.length)[0];
	return best ? CHINESE_LABELS[best] : undefined;
}

/**
 * Returns the canonical abbreviation only, e.g. "n." or "adj.". The Chinese names above
 * exist purely for normalization: they let a Chinese reply from a model map onto the same
 * abbreviation an English one produces. Nothing Chinese is shown to the reader, and an
 * unrecognized input returns an empty string rather than a guess.
 */
export function normalizePos(raw: string | undefined): string {
	if (!raw) return "";
	return lookup(raw) ?? "";
}
