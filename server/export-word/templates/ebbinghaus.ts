import { chunk, footerPartFor, pageCount } from "../layout.ts";
import type { ExportContent, ExportInput, ExportWord, RenderedTemplate } from "../schema.ts";
import { cell, paragraph, row, run, table, type BorderSet } from "../xml.ts";

/** 单词表模板-艾宾浩斯-空白.docx: three header rows and eight empty review cells. */

const COLUMNS = [510, 1474, 4366, 524, 524, 524, 524, 524, 524, 524, 524];
const REVIEW_DAYS = ["D1", "D2", "D4", "D7", "D15", "D30", "D60", "D90"];
const CELL_MARGINS = { top: 0, left: 40, bottom: 0, right: 40 };
const BORDERS: BorderSet = {
	top: { val: "single", size: 4, color: "C9C9C9" },
	left: { val: "single", size: 4, color: "C9C9C9" },
	bottom: { val: "single", size: 4, color: "C9C9C9" },
	right: { val: "single", size: 4, color: "C9C9C9" },
	insideH: { val: "single", size: 4, color: "C9C9C9" },
	insideV: { val: "single", size: 4, color: "C9C9C9" },
};

function titleBlock(count: number, today: string): string {
	return [
		paragraph(run("我的词表 - 艾宾浩斯抗遗忘", { size: 21, color: "1A1A1A", bold: true, font: "noto" }), {
			align: "center",
			after: 140,
		}),
		paragraph(
			run("■  ", { size: 6, color: "BDBDBD", font: "noto" }) +
				run(`英语单词表 · ${count} 词`, { size: 7, color: "9AA0A6", font: "noto" }) +
				run(`\tDate : ${today}`, { size: 9, color: "666666", italic: true, font: "noto" }),
			{ tabs: [{ pos: 10484, val: "right" }], line: 240 },
		),
	].join("");
}

function headerRows(): string[] {
	const head = (text: string, width: number | undefined, span?: number, center = false) =>
		cell({
			width,
			gridSpan: span,
			fill: "F2F2F2",
			margins: CELL_MARGINS,
			paragraphs: [paragraph(run(text, { size: 9.5, color: "333333", italic: true, font: "noto" }), { align: center ? "center" : undefined, line: 240 })],
		});
	return [
		row(
			[
				head("No.", COLUMNS[0]),
				head("Word", COLUMNS[1]),
				head("Meaning", COLUMNS[2]),
				head("Review", COLUMNS.slice(3).reduce((sum, width) => sum + width, 0), 8),
			],
			{ height: 368, header: true },
		),
		row(
			[
				head("", COLUMNS[0]),
				head("", COLUMNS[1]),
				head("", COLUMNS[2]),
				...REVIEW_DAYS.map((day, index) => head(day, COLUMNS[3 + index], undefined, true)),
			],
			{ height: 396, header: true },
		),
	];
}

function dataRow(entry: ExportWord, number: number, content: ExportContent, fill: string): string {
	const withWord = content !== "meaning";
	const withMeaning = content !== "word";
	const cells = [
		cell({
			width: COLUMNS[0],
			fill,
			margins: CELL_MARGINS,
			paragraphs: [paragraph(run(String(number), { size: 9, color: "333333", font: "noto" }), { align: "center", line: 240 })],
		}),
		cell({
			width: COLUMNS[1],
			fill,
			margins: CELL_MARGINS,
			paragraphs: [paragraph(withWord ? run(entry.word, { size: 10, color: "222222", font: "noto" }) : "", { line: 240 })],
		}),
		cell({
			width: COLUMNS[2],
			fill,
			margins: CELL_MARGINS,
			paragraphs: [paragraph(withMeaning ? run(entry.gloss ?? "", { size: 7.5, color: "4A4A4A", font: "noto" }) : "", { line: 220 })],
		}),
		...REVIEW_DAYS.map((_, index) => cell({ width: COLUMNS[3 + index], fill, margins: CELL_MARGINS })),
	];
	return row(cells, { height: 521 });
}

function pageTable(words: ExportWord[], startNumber: number, content: ExportContent): string {
	const rows = headerRows();
	words.forEach((entry, index) => {
		rows.push(dataRow(entry, startNumber + index, content, index % 2 === 0 ? "FFFFFF" : "F8F8F8"));
	});
	return table({ columns: COLUMNS, rows, borders: BORDERS });
}

export function renderEbbinghaus(input: ExportInput): RenderedTemplate {
	const pages = pageCount(input.words.length, 25);
	const tables = chunk(input.words, 25)
		.map((page, index) => `${index > 0 ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : ""}${pageTable(page, index * 25 + 1, input.content)}`)
		.join("");
	return {
		body: titleBlock(input.words.length, input.today) + tables,
		margins: { top: 567, right: 680, bottom: 397, left: 680 },
		footer: footerPartFor({ align: "right", font: "noto", size: 7, color: "A6A6A6", total: false, pages }),
	};
}
