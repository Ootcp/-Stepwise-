import { footerPartFor, groupByPos, headerPartFor, pageCount } from "../layout.ts";
import type { ExportContent, ExportInput, ExportWord, RenderedTemplate } from "../schema.ts";
import { cell, paragraph, row, run, table, type BorderSet } from "../xml.ts";

/** 03-quick-table.docx: a grouped lookup sheet with a page header and POS bands. */

const COLUMNS = [1750, 1650, 620, 2180, 3855];
const CELL_MARGINS = { top: 60, left: 60, bottom: 60, right: 60 };
const BORDERS: BorderSet = {
	top: { val: "single", size: 4, color: "D5DBE0" },
	left: { val: "single", size: 4, color: "D5DBE0" },
	bottom: { val: "single", size: 4, color: "D5DBE0" },
	right: { val: "single", size: 4, color: "D5DBE0" },
	insideH: { val: "single", size: 4, color: "D5DBE0" },
	insideV: { val: "single", size: 4, color: "D5DBE0" },
};

function titleBlock(count: number, today: string): string {
	return [
		paragraph(run("英语词汇速查表", { size: 20, color: "1F2A33", bold: true }), { after: 40 }),
		paragraph(
			run(`QUICK LOOKUP　·　本篇生词 ${count} 条　·　按词性分组　·　A4 纵向　·　生成日期 ${today}`, {
				size: 8.5,
				color: "7A8894",
			}),
			{ after: 40 },
		),
		paragraph(
			run("读法：横向扫读一整行即可完成“词条 — 音标 — 词性 — 释义 — 例句”的完整回忆；词性之间用一条色带隔开，便于定位。", {
				size: 8.5,
				color: "7A8894",
			}),
			{ after: 80 },
		),
	].join("");
}

function headerRow(): string {
	return row(
		["词条", "音标", "词性", "释义", "例句"].map((label, index) =>
			cell({
				width: COLUMNS[index]!,
				fill: "2B3A4A",
				margins: CELL_MARGINS,
				paragraphs: [paragraph(run(label, { size: 9, color: "FFFFFF", bold: true }), {})],
			}),
		),
		{ height: 300, header: true },
	);
}

function bandRow(index: number, label: string): string {
	return row(
		[
			cell({
				width: COLUMNS.reduce((sum, width) => sum + width, 0),
				gridSpan: 5,
				fill: "E4E9ED",
				margins: CELL_MARGINS,
				paragraphs: [paragraph(run(`${String(index).padStart(2, "0")}　${label}`, { size: 9, color: "1F4E79", bold: true }), { keepNext: true })],
			}),
		],
		{ height: 270, cantSplit: true },
	);
}

function dataRow(entry: ExportWord, content: ExportContent, fill: string): string {
	const withWord = content !== "meaning";
	const withMeaning = content !== "word";
	return row(
		[
			cell({
				width: COLUMNS[0],
				fill,
				margins: CELL_MARGINS,
				paragraphs: [paragraph(withWord ? run(entry.word, { size: 9.5, color: "1F2A33", bold: true, noProof: true }) : "", {})],
			}),
			cell({
				width: COLUMNS[1],
				fill,
				margins: CELL_MARGINS,
				paragraphs: [paragraph(withWord && entry.ipa ? run(entry.ipa, { size: 8.5, color: "7A8894", italic: true, noProof: true }) : "", {})],
			}),
			cell({
				width: COLUMNS[2],
				fill,
				margins: CELL_MARGINS,
				paragraphs: [paragraph(withWord && entry.pos ? run(entry.pos, { size: 8.5, color: "7A8894" }) : "", {})],
			}),
			cell({
				width: COLUMNS[3],
				fill,
				margins: CELL_MARGINS,
				paragraphs: [paragraph(withMeaning ? run(entry.gloss ?? "", { size: 9, color: "26313B" }) : "", {})],
			}),
			cell({
				width: COLUMNS[4],
				fill,
				margins: CELL_MARGINS,
				paragraphs: [paragraph("", {})],
			}),
		],
		{ height: 230 },
	);
}

export function renderQuickTable(input: ExportInput): RenderedTemplate {
	const rows = [headerRow()];
	const groups = groupByPos(input.words);
	let dataIndex = 0;
	groups.forEach((group, groupIndex) => {
		rows.push(bandRow(groupIndex + 1, group.label));
		for (const entry of group.words) {
			rows.push(dataRow(entry, input.content, dataIndex % 2 === 0 ? "FFFFFF" : "EDF1F4"));
			dataIndex += 1;
		}
	});
	const pages = pageCount(input.words.length, 24);
	return {
		body: titleBlock(input.words.length, input.today) + table({ columns: COLUMNS, rows, borders: BORDERS }),
		margins: { top: 850, right: 850, bottom: 850, left: 850 },
		header: headerPartFor({ text: "英语词汇速查表 · Quick Lookup", font: "calibri", size: 8, color: "9AA3AD", borderColor: "DCE1E6" }),
		footer: footerPartFor({ align: "center", font: "calibri", size: 8, color: "9AA3AD", total: true, pages }),
	};
}
