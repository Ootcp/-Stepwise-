import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { EXPORT_TEMPLATES, exportFilename, type ExportTemplateId } from "../shared/export-catalog.ts";
import { TEMPLATE_SPECS } from "../server/export-word/catalog.ts";
import {
	buildWordDocx,
	contentDisposition,
	estimatedPages,
	ExportError,
	normalizeExportRequest,
	type ExportWord,
} from "../server/export-word/index.ts";
import { crc32, createZip } from "../server/zip.ts";

/** Reads a ZIP produced by createZip; also proves every entry's CRC matches its bytes. */
function unzip(buffer: Buffer): Map<string, Buffer> {
	let end = buffer.length - 22;
	while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
	expect(end).toBeGreaterThanOrEqual(0);
	const count = buffer.readUInt16LE(end + 10);
	const size = buffer.readUInt32LE(end + 12);
	const offset = buffer.readUInt32LE(end + 16);
	let cursor = offset;
	const files = new Map<string, Buffer>();
	for (let index = 0; index < count; index += 1) {
		expect(buffer.readUInt32LE(cursor)).toBe(0x02014b50);
		const method = buffer.readUInt16LE(cursor + 10);
		const crc = buffer.readUInt32LE(cursor + 16);
		const compressedSize = buffer.readUInt32LE(cursor + 20);
		const nameLength = buffer.readUInt16LE(cursor + 28);
		const extraLength = buffer.readUInt16LE(cursor + 30);
		const commentLength = buffer.readUInt16LE(cursor + 32);
		const localOffset = buffer.readUInt32LE(cursor + 42);
		const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("ascii");
		const localNameLength = buffer.readUInt16LE(localOffset + 26);
		const localExtraLength = buffer.readUInt16LE(localOffset + 28);
		const start = localOffset + 30 + localNameLength + localExtraLength;
		expect(method).toBe(8);
		const data = inflateRawSync(buffer.subarray(start, start + compressedSize));
		expect(crc32(data)).toBe(crc);
		files.set(name, data);
		cursor += 46 + nameLength + extraLength + commentLength;
	}
	expect(cursor - offset).toBe(size);
	return files;
}

function words(count: number): ExportWord[] {
	return Array.from({ length: count }, (_, index) => ({
		word: `word${String(index + 1).padStart(2, "0")}`,
		ipa: `/w${index}/`,
		pos: ["n.", "v.", "adj.", "adv."][index % 4],
		gloss: `第 ${index + 1} 个词的释义`,
	}));
}

function parts(template: ExportTemplateId, count = 3): Map<string, Buffer> {
	return unzip(
		buildWordDocx({
			template,
			content: "both",
			title: "The Quiet Art",
			today: "2026-10-24",
			words: words(count),
		}),
	);
}

function documentXml(template: ExportTemplateId, count = 3, content: "word" | "meaning" | "both" = "both"): string {
	const files = unzip(
		buildWordDocx({ template, content, title: "The Quiet Art", today: "2026-10-24", words: words(count) }),
	);
	return files.get("word/document.xml")?.toString("utf8") ?? "";
}

function pageBreaks(xml: string): number {
	return xml.match(/<w:br w:type="page"\/>/g)?.length ?? 0;
}

/** Balanced-tag check: Word rejects a document with a dropped closing tag. */
function assertBalanced(xml: string): void {
	const stack: string[] = [];
	for (const match of xml.matchAll(/<\/?([A-Za-z][\w:.-]*)(?:\s[^>]*?)?\/?>/g)) {
		const raw = match[0];
		const name = match[1]!;
		if (raw.startsWith("<?") || raw.startsWith("<!")) continue;
		if (raw.endsWith("/>")) continue;
		if (raw.startsWith("</")) {
			expect(stack.pop(), `closing ${name}`).toBe(name);
		} else {
			stack.push(name);
		}
	}
	expect(stack).toEqual([]);
}

describe("zip", () => {
	it("writes readable entries with a correct CRC and a fixed timestamp", () => {
		const buffer = createZip([
			{ name: "[Content_Types].xml", data: Buffer.from("<Types/>", "utf8") },
			{ name: "word/document.xml", data: Buffer.from("<w:document/>", "utf8") },
		]);
		const files = unzip(buffer);
		expect([...files.keys()]).toEqual(["[Content_Types].xml", "word/document.xml"]);
		expect(files.get("word/document.xml")?.toString("utf8")).toBe("<w:document/>");
		expect(buffer.readUInt16LE(10)).toBe(0);
		expect(buffer.readUInt16LE(12)).toBe(0x0021);
	});

	it("rejects non-ASCII entry names", () => {
		expect(() => createZip([{ name: "词.xml", data: Buffer.from("x") }])).toThrow(/ASCII/);
	});
});

describe("catalog and package", () => {
	it("has a renderer and matching capacity for every shared template", () => {
		expect(Object.keys(TEMPLATE_SPECS).sort()).toEqual(EXPORT_TEMPLATES.map((template) => template.id).sort());
		for (const info of EXPORT_TEMPLATES) expect(TEMPLATE_SPECS[info.id].capacity).toBe(info.capacity);
	});

	it("ships a footer for every template and a header only where the reference has one", () => {
		for (const info of EXPORT_TEMPLATES) {
			const files = parts(info.id);
			expect(files.has("word/footer1.xml")).toBe(true);
			expect(files.get("word/footer1.xml")?.toString("utf8")).toContain("PAGE");
			const expectsHeader = info.id === "color-cards" || info.id === "quick-table";
			expect(files.has("word/header1.xml")).toBe(expectsHeader);
			expect(files.has("word/_rels/document.xml.rels")).toBe(true);
		}
	});

	it("references header and footer parts from sectPr and Content_Types", () => {
		const files = parts("color-cards");
		const document = files.get("word/document.xml")?.toString("utf8") ?? "";
		const types = files.get("[Content_Types].xml")?.toString("utf8") ?? "";
		expect(document).toContain('<w:headerReference w:type="default" r:id="rId1"/>');
		expect(document).toContain('<w:footerReference w:type="default" r:id="rId2"/>');
		expect(document).toContain('w:header="720"');
		expect(types).toContain("/word/header1.xml");
		expect(types).toContain("/word/footer1.xml");
		const footer = files.get("word/footer1.xml")?.toString("utf8") ?? "";
		expect(footer.indexOf("PAGE")).toBeGreaterThan(0);
		expect(footer.indexOf("NUMPAGES")).toBeGreaterThan(footer.indexOf("PAGE"));
	});

	it("keeps every generated part tag-balanced", () => {
		for (const info of EXPORT_TEMPLATES) {
			const files = parts(info.id, 12);
			for (const [name, data] of files) {
				if (name.endsWith(".xml") || name.endsWith(".rels")) assertBalanced(data.toString("utf8"));
			}
		}
	});
});

describe("color cards", () => {
	it("rebuilds the reference title, legend, instruction and card grid", () => {
		const xml = documentXml("color-cards", 9);
		expect(xml).toContain("F\u2009L\u2009A\u2009S\u2009H\u2009C\u2009A\u2009R\u2009D\u2009S");
		expect(xml).toContain("英语词汇记忆卡");
		expect(xml).toContain("彩色卡片版式 · A4 · 9 张");
		for (const fill of ["FFF1E4", "E6F5EC", "E8F1FB", "FDEDF4", "F5F5F7"]) expect(xml).toContain(`w:fill="${fill}"`);
		for (const label of ["橙 · 学习", "绿 · 协作", "蓝 · 判断", "粉 · 变化"]) expect(xml).toContain(label);
		expect(xml).toContain("使用方法");
		expect(xml).toContain('<w:gridCol w:w="2400"/>');
		expect(xml).toContain('<w:gridCol w:w="2432"/>');
		expect(xml).toContain('<w:gridCol w:w="102"/>');
		expect(xml).toContain('<w:trHeight w:val="180"/>');
		expect(xml).not.toContain("4D4D4D");
	});

	it("starts a new page every eight cards", () => {
		expect(pageBreaks(documentXml("color-cards", 7))).toBe(0);
		expect(pageBreaks(documentXml("color-cards", 8))).toBe(0);
		expect(pageBreaks(documentXml("color-cards", 9))).toBe(1);
		expect(pageBreaks(documentXml("color-cards", 17))).toBe(2);
	});

	it("leaves the unchosen side blank", () => {
		const wordOnly = documentXml("color-cards", 1, "word");
		expect(wordOnly).toContain("word01");
		expect(wordOnly).not.toContain("第 1 个词的释义");
		const meaningOnly = documentXml("color-cards", 1, "meaning");
		expect(meaningOnly).not.toContain("word01");
		expect(meaningOnly).toContain("第 1 个词的释义");
		expect(meaningOnly).toContain(">01<");
	});
});

describe("two-block lists", () => {
	it("paginates classic green at fifty words and repeats its header", () => {
		const xml = documentXml("classic-green", 51);
		expect(xml).toContain("我的词表");
		expect(xml.match(/w:fill="28A387"/g)).toHaveLength(12);
		expect(pageBreaks(xml)).toBe(1);
		expect(xml).toContain("word51");
	});

	it("uses the blue palette for the same layout", () => {
		const xml = documentXml("fresh-blue", 3);
		expect(xml).toContain('w:fill="1C78F4"');
		expect(xml).toContain('w:color w:val="1F4FA8"');
		expect(xml).toContain("CFE2FB");
	});

	it("keeps the spelling test a fixed two-way sheet and ignores the content choice", () => {
		const input = normalizeExportRequest(
			{ template: "spelling-test", content: "word", words: [{ word: "serene", gloss: "平静的" }] },
			new Date(2026, 9, 24),
		);
		expect(input.content).toBe("both");
		const files = unzip(
			buildWordDocx({
				template: "spelling-test",
				content: "word",
				title: "T",
				today: "2026-10-24",
				words: [{ word: "serene", gloss: "平静的" }],
			}),
		);
		const xml = files.get("word/document.xml")?.toString("utf8") ?? "";
		expect(xml).toContain("拼写测试");
		expect((xml.match(/serene/g) ?? []).length).toBe(1);
		expect((xml.match(/平静的/g) ?? []).length).toBe(1);
		expect(xml).toContain("F5A76B");
		expect(xml).toContain("7CC9DE");
	});
});

describe("other templates", () => {
	it("paginates Ebbinghaus at 25 rows with the eight review columns", () => {
		const xml = documentXml("ebbinghaus", 26);
		expect(xml).toContain("艾宾浩斯抗遗忘");
		for (const day of ["D1", "D2", "D4", "D7", "D15", "D30", "D60", "D90"]) expect(xml).toContain(`>${day}<`);
		expect(pageBreaks(xml)).toBe(1);
	});

	it("paginates high-density at 34 and classic-complete at 30 words", () => {
		expect(pageBreaks(documentXml("high-density", 34))).toBe(0);
		expect(pageBreaks(documentXml("high-density", 35))).toBe(1);
		expect(pageBreaks(documentXml("classic-complete", 30))).toBe(0);
		expect(pageBreaks(documentXml("classic-complete", 31))).toBe(1);
		const classic = documentXml("classic-complete", 1);
		expect(classic).toContain("经典完整版");
		expect(classic).toContain("例句");
	});

	it("groups the quick table by part of speech in a fixed order", () => {
		const files = unzip(
			buildWordDocx({
				template: "quick-table",
				content: "both",
				title: "T",
				today: "2026-10-24",
				words: [
					{ word: "take", pos: "v.", gloss: "拿" },
					{ word: "calm", pos: "adj.", gloss: "平静的" },
					{ word: "river", pos: "n.", gloss: "河" },
					{ word: "fast", pos: "adv.", gloss: "快速地" },
					{ word: "under", pos: "prep.", gloss: "在下面" },
				],
			}),
		);
		const xml = files.get("word/document.xml")?.toString("utf8") ?? "";
		const labels = ["01　名词　Nouns", "02　动词　Verbs", "03　形容词　Adjectives", "04　副词　Adverbs", "05　其他　Others"];
		const positions = labels.map((label) => xml.indexOf(label));
		expect(positions.every((position) => position > 0)).toBe(true);
		expect([...positions].sort((a, b) => a - b)).toEqual(positions);
	});
});

describe("content and safety", () => {
	it("escapes markup and drops characters XML cannot carry", () => {
		const files = unzip(
			buildWordDocx({
				template: "classic-complete",
				content: "meaning",
				title: "T",
				today: "2026-10-24",
				words: [{ word: "safe", gloss: "A & B < C \u0001" }],
			}),
		);
		const xml = files.get("word/document.xml")?.toString("utf8") ?? "";
		expect(xml).toContain("A &amp; B &lt; C");
		expect(xml).not.toContain("\u0001");
	});

	it("rejects unknown templates, unknown content and empty lists", () => {
		const now = new Date(2026, 9, 24);
		expect(() => normalizeExportRequest({ template: "pdf", content: "both", words: [{ word: "a" }] }, now)).toThrow(ExportError);
		expect(() => normalizeExportRequest({ template: "classic-green", content: "ipa", words: [{ word: "a" }] }, now)).toThrow(ExportError);
		expect(() => normalizeExportRequest({ template: "classic-green", content: "both", words: [] }, now)).toThrow(ExportError);
		expect(() => normalizeExportRequest({ template: "classic-green", content: "both", words: [{ word: "!!!" }] }, now)).toThrow(ExportError);
	});

	it("deduplicates words and caps the list at 200", () => {
		const now = new Date(2026, 9, 24);
		const input = normalizeExportRequest(
			{ template: "classic-green", content: "both", words: [{ word: "Serene" }, { word: "serene" }] },
			now,
		);
		expect(input.words).toHaveLength(1);
		expect(() =>
			normalizeExportRequest(
				{ template: "classic-green", content: "both", words: Array.from({ length: 201 }, (_, i) => ({ word: `w${i}` })) },
				now,
			),
		).toThrow(/200/);
	});
});

describe("filenames and estimates", () => {
	it("names the file after the template and replaces forbidden characters", () => {
		expect(exportFilename("color-cards", "A/B:C*D", new Date(2026, 9, 24))).toBe("拾级-卡住的词-彩色卡片-A B C D-20261024.docx");
		expect(exportFilename("fresh-blue", "T", new Date(2026, 9, 24))).toContain("清新蓝");
	});

	it("writes an ASCII fallback plus an RFC 5987 UTF-8 name", () => {
		const header = contentDisposition("拾级.docx");
		expect(header).toContain('filename="shiji-words.docx"');
		expect(header).toContain("filename*=UTF-8''");
		expect(header).not.toContain("拾级");
		expect(header).toContain("%E6%8B%BE%E7%BA%A7.docx");
	});

	it("estimates pages from the shared capacities", () => {
		for (const info of EXPORT_TEMPLATES) {
			expect(estimatedPages(info.id, info.capacity)).toBe(1);
			expect(estimatedPages(info.id, info.capacity + 1)).toBe(2);
		}
	});
});
