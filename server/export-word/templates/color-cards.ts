import { chunk, footerPartFor, headerPartFor, pageCount } from "../layout.ts";
import type { ExportContent, ExportInput, ExportWord, RenderedTemplate } from "../schema.ts";
import { cell, NIL_BORDERS, emptyParagraph, pageBreak, paragraph, row, run, table } from "../xml.ts";

/**
 * 02-color-cards.docx, rebuilt from the reference. The sheet is the template's title,
 * four-colour legend, instruction band and four-cell cards; only the example sentence is
 * left blank. Cards flow with the page instead of being chunked by the exporter, because
 * the reference has no manual page breaks either.
 */

interface CardColor {
	fill: string;
	accent: string;
}

const COLORS: CardColor[] = [
	{ fill: "FFF1E4", accent: "C2620F" },
	{ fill: "E6F5EC", accent: "1E7A45" },
	{ fill: "E8F1FB", accent: "1F4E79" },
	{ fill: "FDEDF4", accent: "A6266E" },
];

const CARD_COLUMNS = [2400, 2432, 102, 2400, 2432, 102];
const CARD_MARGINS = { top: 120, left: 160, bottom: 120, right: 160 };

function titleBlock(count: number): string {
	return [
		paragraph(run("F\u2009L\u2009A\u2009S\u2009H\u2009C\u2009A\u2009R\u2009D\u2009S", { size: 9, color: "A6266E" }), {
			align: "center",
			after: 160,
		}),
		paragraph(run("英语词汇记忆卡", { size: 30, color: "5B2C8D", bold: true }), { align: "center", after: 120 }),
		paragraph(run(`彩色卡片版式 · A4 · ${count} 张`, { size: 12, color: "7A7A7A", italic: true }), {
			align: "center",
			after: 280,
		}),
	].join("");
}

function legendTable(): string {
	const legend = row(
		["橙 · 学习", "绿 · 协作", "蓝 · 判断", "粉 · 变化"].map((label, index) =>
			cell({
				width: 2466,
				fill: COLORS[index]!.fill,
				margins: { top: 90, left: 80, bottom: 90, right: 80 },
				paragraphs: [paragraph(run(label, { size: 9.5, color: COLORS[index]!.accent, bold: true }), { align: "center", line: 240 })],
			}),
		),
	);
	const instruction = row([
		cell({
			width: 9864,
			gridSpan: 4,
			fill: "F5F5F7",
			margins: { top: 130, left: 160, bottom: 130, right: 160 },
			paragraphs: [
				paragraph(
					run("使用方法　先读左栏词条与音标，再看右栏释义，最后用右栏例句改写一句自己的话。", {
						size: 10,
						color: "55555C",
					}),
					{ align: "center", line: 240 },
				),
			],
		}),
	]);
	const spacer = row(
		Array.from({ length: 4 }, () => cell({ width: 2466, margins: { top: 0, left: 0, bottom: 0, right: 0 } })),
		{ height: 200, cantSplit: false },
	);
	return table({
		columns: [2466, 2466, 2466, 2466],
		rows: [legend, instruction, spacer],
		width: { value: 5000, type: "pct" },
	});
}

function wordCell(entry: ExportWord, number: number, content: ExportContent, color: CardColor): string {
	const index = run(String(number).padStart(2, "0"), { size: 9, color: color.accent, bold: true });
	const paragraphs = [
		paragraph(
			content === "meaning" ? index : index + run(`  ${entry.word}`, { size: 16, color: "1A1A1A", bold: true }),
			{ line: 240 },
		),
		emptyParagraph({ after: 40 }),
	];
	const details = [entry.ipa ?? "", entry.pos ?? ""].map((part) => part.trim()).filter((part) => part.length > 0);
	paragraphs.push(
		details.length > 0 && content !== "meaning"
			? paragraph(run(details.join("\u3000"), { size: 10, color: color.accent, italic: true, noProof: true }), { line: 240 })
			: emptyParagraph({ line: 240 }),
	);
	return cell({ width: 2400, fill: color.fill, margins: CARD_MARGINS, paragraphs });
}

function meaningCell(entry: ExportWord, content: ExportContent, color: CardColor): string {
	const gloss = (entry.gloss ?? "").trim();
	const filled = content !== "word" && gloss.length > 0;
	return cell({
		width: 2432,
		fill: color.fill,
		margins: CARD_MARGINS,
		paragraphs: [
			emptyParagraph(),
			filled
				? paragraph(run(gloss, { size: 11, color: "1A1A1A" }), { line: 240, after: 80 })
				: emptyParagraph({ after: 80 }),
			// The example line is intentionally empty; the paragraph keeps the card's height
			// and the gloss aligned with the reference.
			emptyParagraph({ line: 240 }),
		],
	});
}

function blankCard(width: number): string {
	return cell({ width });
}

function cardTable(words: ExportWord[], content: ExportContent, startNumber: number): string {
	const rows: string[] = [];
	for (let index = 0; index < words.length; index += 2) {
		const first = words[index];
		const second = words[index + 1];
		if (!first) continue;
		const number = startNumber + index;
		const firstColor = COLORS[number % COLORS.length]!;
		const secondColor = COLORS[(number + 1) % COLORS.length]!;
		const cells = [
			wordCell(first, number + 1, content, firstColor),
			meaningCell(first, content, firstColor),
			cell({ width: 102, borders: NIL_BORDERS }),
		];
		if (second) {
			cells.push(wordCell(second, number + 2, content, secondColor), meaningCell(second, content, secondColor));
		} else {
			cells.push(blankCard(2400), blankCard(2432));
		}
		cells.push(cell({ width: 102, borders: NIL_BORDERS }));
		rows.push(row(cells, { cantSplit: true }));
		if (index + 2 < words.length) {
			rows.push(
				row(
					CARD_COLUMNS.map((width) => cell({ width, fill: "FFFFFF", margins: { top: 0, left: 0, bottom: 0, right: 0 } })),
					{ height: 180, cantSplit: false },
				),
			);
		}
	}
	return table({ columns: CARD_COLUMNS, rows });
}

export function renderColorCards(input: ExportInput): RenderedTemplate {
	const pages = pageCount(input.words.length, 8);
	const tables = chunk(input.words, 8)
		.map((page, index) => `${index > 0 ? pageBreak() : ""}${cardTable(page, input.content, index * 8)}`)
		.join("");
	return {
		body: titleBlock(input.words.length) + legendTable() + tables,
		margins: { top: 1020, right: 1020, bottom: 1020, left: 1020 },
		header: headerPartFor({ text: "英语词汇记忆卡 · Color Cards", font: "calibri", size: 8.5, color: "8A8A8A", borderColor: "E4E4E8" }),
		footer: footerPartFor({ align: "center", font: "calibri", size: 8.5, color: "8A8A8A", total: true, pages }),
	};
}
