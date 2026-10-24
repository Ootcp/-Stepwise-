import { chunk, footerPartFor, pageCount } from "../layout.ts";
import type { ExportContent, ExportInput, ExportWord, RenderedTemplate } from "../schema.ts";
import { cell, NIL_BORDERS, paragraph, row, run, table, type BorderSet } from "../xml.ts";

/**
 * The two-block word lists: 经典绿 / 清新蓝 / 拼写测试 all share the same 7-column
 * grid, header height, row height and spacer column. The first two differ only in
 * palette; the spelling sheet is a fixed two-way self-test.
 */

const COLUMNS = [510, 1417, 3175, 340, 510, 1417, 3175];
const CELL_MARGINS = { top: 0, left: 100, bottom: 0, right: 100 };
const HEADER_HEIGHT = 566;
const ROW_HEIGHT = 521;

interface ListPalette {
	title: string;
	titleColor: string;
	accent: string;
	headerFill: string;
	zebra: string;
	indexColor: string;
	wordColor: string;
	meaningColor: string;
	borders?: BorderSet;
}

const GREEN: ListPalette = {
	title: "我的词表",
	titleColor: "2AA88C",
	accent: "28A387",
	headerFill: "28A387",
	zebra: "EAF7F2",
	indexColor: "1C8C74",
	wordColor: "F06A3A",
	meaningColor: "4A4A4A",
};

const BLUE: ListPalette = {
	title: "我的词表",
	titleColor: "1C78F4",
	accent: "1C78F4",
	headerFill: "1C78F4",
	zebra: "E4F1FE",
	indexColor: "1C78F4",
	wordColor: "1F4FA8",
	meaningColor: "4A4A4A",
	borders: {
		top: { val: "single", size: 4, color: "CFE2FB" },
		left: { val: "single", size: 4, color: "CFE2FB" },
		bottom: { val: "single", size: 4, color: "CFE2FB" },
		right: { val: "single", size: 4, color: "CFE2FB" },
		insideH: { val: "single", size: 4, color: "CFE2FB" },
		insideV: { val: "single", size: 4, color: "CFE2FB" },
	},
};

function titleBlock(palette: ListPalette, count: number, today: string): string {
	return [
		paragraph(run(palette.title, { size: 21, color: palette.titleColor, bold: true, font: "noto" }), {
			align: "center",
			after: 140,
		}),
		paragraph(
			run("■  ", { size: 6, color: palette.accent, font: "noto" }) +
				run(`英语单词表 · ${count} 词`, { size: 7, color: "9AA0A6", font: "noto" }) +
				run(`\tDate : ${today}`, { size: 9, color: "666666", italic: true, font: "noto" }),
			{ tabs: [{ pos: 10484, val: "right" }], after: 160, line: 240 },
		),
	].join("");
}

function headerCell(text: string, width: number, fill: string): string {
	return cell({
		width,
		fill,
		margins: CELL_MARGINS,
		paragraphs: [paragraph(run(text, { size: 9.5, color: "FFFFFF", italic: true, font: "noto" }), { line: 240 })],
	});
}

function gapCell(): string {
	return cell({ width: 340, borders: NIL_BORDERS });
}

function headerRow(fill: string): string {
	return row(
		[
			headerCell("No.", COLUMNS[0], fill),
			headerCell("Word", COLUMNS[1], fill),
			headerCell("Meaning", COLUMNS[2], fill),
			gapCell(),
			headerCell("No.", COLUMNS[4], fill),
			headerCell("Word", COLUMNS[5], fill),
			headerCell("Meaning", COLUMNS[6], fill),
		],
		{ height: HEADER_HEIGHT, header: true },
	);
}

function numberCell(number: number, color: string, fill: string): string {
	return cell({
		width: COLUMNS[0],
		fill,
		margins: CELL_MARGINS,
		paragraphs: [paragraph(run(String(number), { size: 9, color, font: "noto" }), { align: "center", line: 240 })],
	});
}

function wordCell(entry: ExportWord | undefined, content: ExportContent, color: string, fill: string): string {
	if (!entry || content === "meaning") {
		return cell({ width: COLUMNS[1], fill, margins: CELL_MARGINS });
	}
	return cell({
		width: COLUMNS[1],
		fill,
		margins: CELL_MARGINS,
		paragraphs: [paragraph(run(entry.word, { size: 10, color, noProof: true, font: "noto" }), { line: 240 })],
	});
}

function meaningCell(entry: ExportWord | undefined, content: ExportContent, fill: string): string {
	const gloss = entry?.gloss?.trim() ?? "";
	if (!entry || content === "word" || gloss.length === 0) {
		return cell({ width: COLUMNS[2], fill, margins: CELL_MARGINS });
	}
	return cell({
		width: COLUMNS[2],
		fill,
		margins: CELL_MARGINS,
		paragraphs: [paragraph(run(gloss, { size: 7.5, color: "4A4A4A", font: "noto" }), { line: 220 })],
	});
}

function emptyCell(width: number, fill: string): string {
	return cell({ width, fill, margins: CELL_MARGINS });
}

function listPage(words: ExportWord[], startNumber: number, content: ExportContent, palette: ListPalette): string {
	const rows = [headerRow(palette.headerFill)];
	const half = Math.ceil(words.length / 2);
	const leftWords = words.slice(0, half);
	const rightWords = words.slice(half);
	const rowsNeeded = Math.max(leftWords.length, rightWords.length);
	for (let index = 0; index < rowsNeeded; index += 1) {
		const left = leftWords[index];
		const right = rightWords[index];
		const fill = index % 2 === 0 ? palette.zebra : "FFFFFF";
		rows.push(
			row(
				[
					numberCell(startNumber + index, palette.indexColor, fill),
					wordCell(left, content, palette.wordColor, fill),
					meaningCell(left, content, fill),
					gapCell(),
					right ? numberCell(startNumber + half + index, palette.indexColor, fill) : emptyCell(COLUMNS[4], fill),
					wordCell(right, content, palette.wordColor, fill),
					meaningCell(right, content, fill),
				],
				{ height: ROW_HEIGHT },
			),
		);
	}
	return table({ columns: COLUMNS, rows, borders: palette.borders });
}

function spellingTitle(count: number, today: string): string {
	return [
		paragraph(
			run("我的词表 - ", { size: 21, color: "1A1A1A", bold: true, font: "noto" }) +
				run("拼写测试", { size: 21, color: "F08A3C", bold: true, font: "noto" }),
			{ align: "center", after: 140 },
		),
		paragraph(
			run("■  ", { size: 6, color: "F5A76B", font: "noto" }) +
				run(`英语单词表 · ${count} 组`, { size: 7, color: "9AA0A6", font: "noto" }) +
				run(`\tDate : ${today}`, { size: 9, color: "666666", italic: true, font: "noto" }),
			{ tabs: [{ pos: 10484, val: "right" }], after: 160, line: 240 },
		),
	].join("");
}

function spellingHeaderCell(text: string, width: number, fill: string, color: string): string {
	return cell({
		width,
		fill,
		margins: CELL_MARGINS,
		paragraphs: [paragraph(run(text, { size: 9.5, color, italic: true, font: "noto" }), { line: 240 })],
	});
}

function spellingHeaderRow(): string {
	return row(
		[
			spellingHeaderCell("No.", COLUMNS[0], "F5A76B", "3A2B1F"),
			spellingHeaderCell("Word", COLUMNS[1], "F5A76B", "3A2B1F"),
			spellingHeaderCell("Meaning", COLUMNS[2], "7CC9DE", "FFFFFF"),
			gapCell(),
			spellingHeaderCell("No.", COLUMNS[4], "F5A76B", "3A2B1F"),
			spellingHeaderCell("Word", COLUMNS[5], "F5A76B", "3A2B1F"),
			spellingHeaderCell("Meaning", COLUMNS[6], "7CC9DE", "FFFFFF"),
		],
		{ height: HEADER_HEIGHT, header: true },
	);
}

const SPELLING_TINTS = { number: "FEF1E7", word: "FDF0E6", meaning: "EFF9FC" };
const SPELLING_BORDERS: BorderSet = {
	top: { val: "single", size: 4, color: "E7E2DE" },
	left: { val: "single", size: 4, color: "E7E2DE" },
	bottom: { val: "single", size: 4, color: "E7E2DE" },
	right: { val: "single", size: 4, color: "E7E2DE" },
	insideH: { val: "single", size: 4, color: "E7E2DE" },
	insideV: { val: "single", size: 4, color: "E7E2DE" },
};

function spellingPage(words: ExportWord[], startNumber: number): string {
	const rows = [spellingHeaderRow()];
	for (let index = 0; index < words.length; index += 1) {
		const entry = words[index]!;
		rows.push(
			row(
				[
					cell({
						width: COLUMNS[0],
						fill: SPELLING_TINTS.number,
						margins: CELL_MARGINS,
						paragraphs: [paragraph(run(String(startNumber + index), { size: 9, color: "B2541F", font: "noto" }), { align: "center", line: 240 })],
					}),
					cell({
						width: COLUMNS[1],
						fill: SPELLING_TINTS.word,
						margins: CELL_MARGINS,
						paragraphs: [paragraph(run(entry.word, { size: 10, color: "F06A3A", font: "noto" }), { line: 240 })],
					}),
					cell({ width: COLUMNS[2], fill: SPELLING_TINTS.meaning, margins: CELL_MARGINS }),
					gapCell(),
					cell({
						width: COLUMNS[4],
						fill: SPELLING_TINTS.number,
						margins: CELL_MARGINS,
						paragraphs: [paragraph(run(String(startNumber + index), { size: 9, color: "B2541F", font: "noto" }), { align: "center", line: 240 })],
					}),
					cell({ width: COLUMNS[5], fill: SPELLING_TINTS.word, margins: CELL_MARGINS }),
					cell({
						width: COLUMNS[6],
						fill: SPELLING_TINTS.meaning,
						margins: CELL_MARGINS,
						paragraphs: [paragraph(run(entry.gloss?.trim() ?? "", { size: 7.5, color: "4A4A4A", font: "noto" }), { line: 220 })],
					}),
				],
				{ height: ROW_HEIGHT },
			),
		);
	}
	return table({ columns: COLUMNS, rows, borders: SPELLING_BORDERS });
}

function pagesBody(input: ExportInput, capacity: number, renderPage: (words: ExportWord[], startNumber: number) => string): string {
	const pages = chunk(input.words, capacity);
	return pages
		.map((page, index) => `${index > 0 ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : ""}${renderPage(page, index * capacity + 1)}`)
		.join("");
}

function renderList(input: ExportInput, palette: ListPalette): RenderedTemplate {
	const pages = pageCount(input.words.length, 50);
	return {
		body: titleBlock(palette, input.words.length, input.today) + pagesBody(input, 50, (words, start) => listPage(words, start, input.content, palette)),
		margins: { top: 567, right: 680, bottom: 397, left: 680 },
		footer: footerPartFor({ align: "right", font: "noto", size: 7, color: "A6A6A6", total: false, pages }),
	};
}

export function renderClassicGreen(input: ExportInput): RenderedTemplate {
	return renderList(input, GREEN);
}

export function renderFreshBlue(input: ExportInput): RenderedTemplate {
	return renderList(input, BLUE);
}

export function renderSpellingTest(input: ExportInput): RenderedTemplate {
	const pages = pageCount(input.words.length, 25);
	return {
		body: spellingTitle(input.words.length, input.today) + pagesBody(input, 25, (words, start) => spellingPage(words, start)),
		margins: { top: 567, right: 680, bottom: 397, left: 680 },
		footer: footerPartFor({ align: "right", font: "noto", size: 7, color: "A6A6A6", total: false, pages }),
	};
}
