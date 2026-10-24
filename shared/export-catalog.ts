/**
 * Template catalog shared by the browser and the Word exporter.
 *
 * Labels, capacities and content rules live here so the dialog and the generated file
 * cannot disagree about how many words a page holds or which template is a fixed
 * self-test. No Node or DOM imports: both runtimes load this module.
 */

export type ExportTemplateId =
	| "color-cards"
	| "classic-green"
	| "fresh-blue"
	| "spelling-test"
	| "ebbinghaus"
	| "high-density"
	| "classic-complete"
	| "quick-table";

export type ExportContent = "word" | "meaning" | "both";

export type ExportPreview =
	| "cards"
	| "green"
	| "blue"
	| "spelling"
	| "ebbinghaus"
	| "high-density"
	| "classic"
	| "quick-table";

export interface ExportTemplateInfo {
	id: ExportTemplateId;
	/** Name shown on the template tile. */
	label: string;
	/** Words per A4 page, used for the “约 P 页” estimate. */
	capacity: number;
	/** CSS class suffix for the tiny paper preview. */
	preview: ExportPreview;
	/** One-line description under the name. */
	blurb: string;
	/** True when the template ignores the content choice. */
	contentLocked?: boolean;
	contentNote?: string;
}

export const EXPORT_TEMPLATES: ExportTemplateInfo[] = [
	{
		id: "color-cards",
		label: "彩色卡片",
		capacity: 8,
		preview: "cards",
		blurb: "四色卡片 · 例句留空",
	},
	{
		id: "classic-green",
		label: "经典绿",
		capacity: 50,
		preview: "green",
		blurb: "双栏词表 · 50 词/页",
	},
	{
		id: "fresh-blue",
		label: "清新蓝",
		capacity: 50,
		preview: "blue",
		blurb: "双栏词表 · 蓝色",
	},
	{
		id: "spelling-test",
		label: "拼写测试",
		capacity: 25,
		preview: "spelling",
		blurb: "左右互测 · 固定内容",
		contentLocked: true,
		contentNote: "固定双向自测:左看词写义,右看义写词。",
	},
	{
		id: "ebbinghaus",
		label: "艾宾浩斯",
		capacity: 25,
		preview: "ebbinghaus",
		blurb: "8 个复习格 · 25 词/页",
	},
	{
		id: "high-density",
		label: "高密度",
		capacity: 34,
		preview: "high-density",
		blurb: "5 列密集表 · 34 词/页",
	},
	{
		id: "classic-complete",
		label: "经典完整",
		capacity: 30,
		preview: "classic",
		blurb: "6 列完整表 · 30 词/页",
	},
	{
		id: "quick-table",
		label: "速查表",
		capacity: 24,
		preview: "quick-table",
		blurb: "按词性分组 · 24 词/页",
	},
];

const BY_ID = new Map(EXPORT_TEMPLATES.map((template) => [template.id, template]));

export function templateInfo(id: ExportTemplateId): ExportTemplateInfo {
	const found = BY_ID.get(id);
	if (!found) throw new Error(`Unknown export template: ${id}`);
	return found;
}

/** The one filename rule shared by Content-Disposition and the download attribute. */
export function exportFilename(id: ExportTemplateId, title: string, date = new Date()): string {
	const info = templateInfo(id);
	const safeTitle = title
		.replace(/[\\/:*?"<>|]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 40)
		.replace(/[. ]+$/, "");
	const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
	const name = `拾级-卡住的词-${info.label}-${safeTitle || "未命名文章"}-${stamp}.docx`;
	return name.length > 90 ? `${name.slice(0, 87)}.docx` : name;
}
