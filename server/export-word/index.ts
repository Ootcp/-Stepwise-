import {
	EXPORT_TEMPLATES,
	exportFilename,
	templateInfo,
	type ExportContent,
	type ExportTemplateId,
} from "../../shared/export-catalog.ts";
import { FOOTER_ID, HEADER_ID, buildPackage } from "./package.ts";
import { TEMPLATE_SPECS } from "./catalog.ts";
import type { ExportInput, ExportWord } from "./schema.ts";
import { documentXml, section } from "./xml.ts";

export { exportFilename };
export type { ExportContent, ExportTemplateId, ExportWord };

const MAX_WORDS = 200;

export class ExportError extends Error {
	readonly status = 400;

	constructor(message: string) {
		super(message);
		this.name = "ExportError";
	}
}

const TEMPLATE_IDS = new Set(EXPORT_TEMPLATES.map((template) => template.id));

function field(value: unknown, name: string): unknown {
	if (typeof value !== "object" || value === null) return undefined;
	return (value as Record<string, unknown>)[name];
}

function clip(value: unknown, max: number): string {
	if (typeof value !== "string") return "";
	return value.trim().slice(0, max);
}

function localToday(now: Date): string {
	const pad = (value: number): string => String(value).padStart(2, "0");
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function estimatedPages(template: ExportTemplateId, count: number): number {
	return Math.max(1, Math.ceil(count / templateInfo(template).capacity));
}

/** Validates the request and pins locked templates to their designed content mode. */
export function normalizeExportRequest(body: unknown, now = new Date()): ExportInput {
	const rawTemplate = field(body, "template");
	if (typeof rawTemplate !== "string" || !TEMPLATE_IDS.has(rawTemplate as ExportTemplateId)) {
		throw new ExportError("未知的导出模板。");
	}
	const template = rawTemplate as ExportTemplateId;
	const spec = TEMPLATE_SPECS[template];
	const rawContent = field(body, "content");
	let content: ExportContent;
	if (spec.contentLocked) {
		content = "both";
	} else {
		if (rawContent !== "word" && rawContent !== "meaning" && rawContent !== "both") {
			throw new ExportError("未知的导出内容。");
		}
		content = rawContent;
	}

	const rawWords = field(body, "words");
	if (!Array.isArray(rawWords) || rawWords.length === 0) throw new ExportError("没有可导出的单词。");
	if (rawWords.length > MAX_WORDS) throw new ExportError(`一次最多导出 ${MAX_WORDS} 个单词。`);

	const seen = new Set<string>();
	const words: ExportWord[] = [];
	for (const item of rawWords) {
		const word = clip(field(item, "word"), 48);
		if (!/^[A-Za-z][A-Za-z'’-]*$/.test(word)) continue;
		const key = word.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		const ipa = clip(field(item, "ipa"), 60);
		const pos = clip(field(item, "pos"), 24);
		const gloss = clip(field(item, "gloss"), 240);
		words.push({
			word,
			...(ipa ? { ipa } : {}),
			...(pos ? { pos } : {}),
			...(gloss ? { gloss } : {}),
		});
	}
	if (words.length === 0) throw new ExportError("没有可导出的单词。");

	return {
		template,
		content,
		title: clip(field(body, "title"), 120),
		today: localToday(now),
		words,
	};
}

/** RFC 6266 header with an ASCII fallback; raw Chinese in the header would throw. */
export function contentDisposition(filename: string): string {
	const encoded = encodeURIComponent(filename).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
	return `attachment; filename="shiji-words.docx"; filename*=UTF-8''${encoded}`;
}

export function buildWordDocx(input: ExportInput): Buffer {
	const spec = TEMPLATE_SPECS[input.template];
	const rendered = spec.render(input);
	const body = rendered.body + section({
		margins: rendered.margins,
		headerRel: rendered.header ? HEADER_ID : undefined,
		footerRel: FOOTER_ID,
	});
	return buildPackage({
		document: documentXml(body),
		header: rendered.header,
		footer: rendered.footer,
	});
}
