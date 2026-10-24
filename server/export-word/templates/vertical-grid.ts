import { chunk, footerPartFor, pageCount } from "../layout.ts";
import type { ExportContent, ExportInput, ExportWord, RenderedTemplate } from "../schema.ts";
import { cell, paragraph, row, run, table, type BorderSet, type FontKind } from "../xml.ts";

/**
 * The vertical word tables: 高密度背诵版 (five columns, zebra rows) and 经典完整版
 * (six columns with a blank example column, no zebra). Both use Calibri and the same
 * title + rule + header treatment.
 */

interface GridSpec {
	capacity: number;
	columns: number[];
	title: string;
	titleColor: string;
	titleSize: number;
	titleAfter: number;
	subtitle: string;
	subtitleAfter: number;
	header: string[];
	headerHeight: number;
	headerFill: string;
	headerSize: number;
	borders: BorderSet;
	cellMargins: { top: number; left: number; bottom: number; right: number };
	zebra?: string;
	font?: FontKind;
}

const HIGH_DENSITY: GridSpec = {
	capacity: 34,
	columns: [600, 2000, 2600, 900, 4672],
	title: "单词表 · 高密度背诵版",
	titleColor: "2E7D32",
	titleSize: 16,
	titleAfter: 40,
	subtitle: "",
	subtitleAfter: 80,
	header: ["序号", "单词", "音标", "词性", "释义"],
	headerHeight: 340,
	headerFill: "2E7D32",
	headerSize: 10,
	borders: {
		top: { val: "single", size: 6, color: "A5D6A7" },
		left: { val: "single", size: 6, color: "A5D6A7" },
		bottom: { val: "single", size: 6, color: "A5D6A7" },
		right: { val: "single", size: 6, color: "A5D6A7" },
		insideH: { val: "single", size: 4, color: "E8F5E9" },
		insideV: { val: "single", size: 6, color: "A5D6A7" },
	},
	cellMargins: { top: 50, left: 30, bottom: 50, right: 30 },
	zebra: "EAF6EB",
};

const CLASSIC_COMPLETE: GridSpec = {
	capacity: 30,
	columns: [600, 1900, 2500, 800, 2400, 2572],
	title: "英语单词表 · 经典完整版",
	titleColor: "1F4E79",
	titleSize: 18,
	titleAfter: 40,
	subtitle: "",
	subtitleAfter: 120,
	header: ["序号", "单词", "音标", "词性", "释义", "例句"],
	headerHeight: 369,
	headerFill: "1F4E79",
	headerSize: 10.5,
	borders: {
		top: { val: "single", size: 6, color: "8EAADB" },
		left: { val: "single", size: 6, color: "8EAADB" },
		bottom: { val: "single", size: 6, color: "8EAADB" },
		right: { val: "single", size: 6, color: "8EAADB" },
		insideH: { val: "single", size: 4, color: "B4C7E7" },
		insideV: { val: "single", size: 6, color: "8EAADB" },
	},
	cellMargins: { top: 60, left: 30, bottom: 60, right: 30 },
};

function titleBlock(spec: GridSpec, count: number, today: string): string {
	const subtitle =
		spec.capacity === 34
			? `List：____________　姓名：____________　第 1–${count} 词`
			: `单元：____________　姓名：____________　日期：${today}`;
	return [
		paragraph(run(spec.title, { size: spec.titleSize, color: spec.titleColor, bold: true }), {
			after: spec.titleAfter,
		}),
		paragraph(run(subtitle, { size: 10, color: "595959" }), {
			after: spec.subtitleAfter,
			borderBottom: { color: spec.titleColor, size: 8 },
		}),
	].join("");
}

function headerRow(spec: GridSpec): string {
	return row(
		spec.header.map((label, index) =>
			cell({
				width: spec.columns[index]!,
				fill: spec.headerFill,
				margins: spec.cellMargins,
				paragraphs: [paragraph(run(label, { size: spec.headerSize, color: "FFFFFF", bold: true }), { align: index === 0 ? "center" : "left" })],
			}),
		),
		{ height: spec.headerHeight, header: true },
	);
}

function dataRow(entry: ExportWord, number: number, spec: GridSpec, content: ExportContent, fill: string | undefined): string {
	const withWord = content !== "meaning";
	const withMeaning = content !== "word";
	const cells = [
		cell({
			width: spec.columns[0]!,
			fill,
			margins: spec.cellMargins,
			paragraphs: [paragraph(run(`${number}.`, { size: 9, color: "000000" }), { align: "center" })],
		}),
		cell({
			width: spec.columns[1]!,
			fill,
			margins: spec.cellMargins,
			paragraphs: [paragraph(withWord ? run(entry.word, { size: 9, color: "000000", noProof: true }) : "", {})],
		}),
		cell({
			width: spec.columns[2]!,
			fill,
			margins: spec.cellMargins,
			paragraphs: [paragraph(withWord && entry.ipa ? run(entry.ipa, { size: 9, color: "000000", noProof: true }) : "", { align: "center" })],
		}),
		cell({
			width: spec.columns[3]!,
			fill,
			margins: spec.cellMargins,
			paragraphs: [paragraph(withWord && entry.pos ? run(entry.pos, { size: 9, color: "000000" }) : "", { align: "center" })],
		}),
		cell({
			width: spec.columns[4]!,
			fill,
			margins: spec.cellMargins,
			paragraphs: [paragraph(withMeaning ? run(entry.gloss ?? "", { size: 9, color: "000000" }) : "", {})],
		}),
	];
	if (spec.columns.length === 6) {
		cells.push(
			cell({
				width: spec.columns[5]!,
				fill,
				margins: spec.cellMargins,
				paragraphs: [paragraph("", {})],
			}),
		);
	}
	return row(cells, { cantSplit: false });
}

function pageTable(words: ExportWord[], startNumber: number, spec: GridSpec, content: ExportContent): string {
	const rows = [headerRow(spec)];
	words.forEach((entry, index) => {
		const fill = spec.zebra ? (index % 2 === 0 ? spec.zebra : undefined) : undefined;
		rows.push(dataRow(entry, startNumber + index, spec, content, fill));
	});
	return table({ columns: spec.columns, rows, borders: spec.borders });
}

function renderGrid(spec: GridSpec, input: ExportInput): RenderedTemplate {
	const pages = pageCount(input.words.length, spec.capacity);
	const tables = chunk(input.words, spec.capacity)
		.map((page, index) => `${index > 0 ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : ""}${pageTable(page, index * spec.capacity + 1, spec, input.content)}`)
		.join("");
	return {
		body: titleBlock(spec, input.words.length, input.today) + tables,
		margins: { top: 650, right: 567, bottom: 650, left: 567 },
		footer: footerPartFor({ align: "center", font: "calibri", size: 8, color: "A6A6A6", total: false, pages }),
	};
}

export function renderHighDensity(input: ExportInput): RenderedTemplate {
	return renderGrid(HIGH_DENSITY, input);
}

export function renderClassicComplete(input: ExportInput): RenderedTemplate {
	return renderGrid(CLASSIC_COMPLETE, input);
}
