import type { ExportContent, ExportTemplateId } from "../../shared/export-catalog.ts";
import type { Margins } from "./xml.ts";

export type { ExportContent, ExportTemplateId };

export interface ExportWord {
	word: string;
	ipa?: string;
	pos?: string;
	gloss?: string;
}

export interface ExportInput {
	template: ExportTemplateId;
	content: ExportContent;
	title: string;
	/** Local calendar date, `YYYY-MM-DD`. */
	today: string;
	words: ExportWord[];
}

/** One rendered template: body XML plus the page chrome and margins it needs. */
export interface RenderedTemplate {
	body: string;
	margins: Margins;
	header?: string;
	footer: string;
}

export interface TemplateSpec {
	id: ExportTemplateId;
	capacity: number;
	contentLocked?: boolean;
	render(input: ExportInput): RenderedTemplate;
}
