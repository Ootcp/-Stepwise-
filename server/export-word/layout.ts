import type { ExportWord } from "./schema.ts";
import { field, footerPart, headerPart, paragraph, run, type FontKind } from "./xml.ts";

export function chunk<T>(items: T[], size: number): T[][] {
	const pages: T[][] = [];
	for (let index = 0; index < items.length; index += size) pages.push(items.slice(index, index + size));
	return pages.length > 0 ? pages : [[]];
}

export function pageCount(count: number, capacity: number): number {
	return Math.max(1, Math.ceil(count / capacity));
}

export interface FooterOptions {
	align: "left" | "center" | "right";
	font: FontKind;
	size: number;
	color: string;
	/** Reference templates split: color cards and quick table show "Page X / Y". */
	total: boolean;
	pages: number;
}

export function footerPartFor(options: FooterOptions): string {
	const style = { size: options.size, color: options.color, font: options.font };
	const runs =
		run("Page ", style) +
		field("PAGE", "1", style) +
		(options.total ? run(" / ", style) + field("NUMPAGES", String(options.pages), style) : "");
	return footerPart(paragraph(runs, { align: options.align, line: 240 }));
}

export interface HeaderOptions {
	text: string;
	font: FontKind;
	size: number;
	color: string;
	borderColor: string;
}

export function headerPartFor(options: HeaderOptions): string {
	const style = { size: options.size, color: options.color, font: options.font };
	return headerPart(
		paragraph(run(options.text, style), {
			align: "right",
			borderBottom: { color: options.borderColor, size: 4, space: 4 },
		}),
	);
}

export interface PosGroup {
	label: string;
	words: ExportWord[];
}

/** Fixed lookup order for the quick table; empty groups disappear. */
const POS_GROUPS: Array<{ prefix: string; label: string }> = [
	{ prefix: "n", label: "名词　Nouns" },
	{ prefix: "v", label: "动词　Verbs" },
	{ prefix: "adj", label: "形容词　Adjectives" },
	{ prefix: "adv", label: "副词　Adverbs" },
	{ prefix: "", label: "其他　Others" },
];

function classify(pos: string): string {
	const value = pos.toLowerCase().trim();
	if (value.startsWith("adj")) return "adj";
	if (value.startsWith("adv")) return "adv";
	if (value.startsWith("v")) return "v";
	if (value.startsWith("n")) return "n";
	return "";
}

export function groupByPos(words: ExportWord[]): PosGroup[] {
	const buckets = new Map<string, ExportWord[]>();
	for (const word of words) {
		const key = classify(word.pos ?? "");
		const bucket = buckets.get(key) ?? [];
		bucket.push(word);
		buckets.set(key, bucket);
	}
	return POS_GROUPS.flatMap((group) => {
		const bucket = buckets.get(group.prefix);
		return bucket && bucket.length > 0 ? [{ label: group.label, words: bucket }] : [];
	});
}
