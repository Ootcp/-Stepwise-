/**
 * Small OOXML writers for the Word exports.
 *
 * Word tolerates sloppy ordering, but LibreOffice and strict consumers do not, so each
 * property bag follows the schema order. The builders only emit what a caller asks for:
 * missing cell margins, heights or borders stay absent instead of being defaulted, because
 * the reference templates differ in every one of those details.
 */

export type FontKind = "calibri" | "yahei" | "noto";

export interface RunStyle {
	/** Points; written as half-points. */
	size: number;
	color: string;
	bold?: boolean;
	italic?: boolean;
	font?: FontKind;
	/** Character spacing in twips. */
	spacing?: number;
	noProof?: boolean;
}

function fontAttributes(font: FontKind = "calibri"): string {
	if (font === "noto") {
		return 'w:ascii="Noto Sans SC" w:hAnsi="Noto Sans SC" w:eastAsia="Noto Sans SC" w:cs="Noto Sans SC"';
	}
	if (font === "yahei") {
		return 'w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:cs="Microsoft YaHei"';
	}
	return 'w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"';
}

function runProperties(style: RunStyle): string {
	const halfPoints = Math.round(style.size * 2);
	return `<w:rPr><w:rFonts ${fontAttributes(style.font)}/>${style.bold ? "<w:b/>" : ""}${style.italic ? "<w:i/>" : ""}${style.noProof ? "<w:noProof/>" : ""}<w:color w:val="${style.color}"/>${style.spacing ? `<w:spacing w:val="${style.spacing}"/>` : ""}<w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/></w:rPr>`;
}

/** Strips characters XML 1.0 forbids (and lone surrogates) before escaping. */
export function cleanText(value: string): string {
	let out = "";
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0;
		if (code === 0x09) {
			out += " ";
			continue;
		}
		if (code === 0x0a) {
			out += "\n";
			continue;
		}
		if (code === 0x0d) continue;
		if (code < 0x20 || code === 0xfffe || code === 0xffff) continue;
		if (code >= 0xd800 && code <= 0xdfff) continue;
		out += character;
	}
	return out;
}

export function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/** Runs with line breaks and tabs preserved as <w:br/> and <w:tab/>. */
export function run(text: string, style: RunStyle): string {
	const clean = cleanText(text);
	if (clean.length === 0) return "";
	const body = clean
		.split(/(\n|\t)/)
		.map((part) => {
			if (part === "\n") return "<w:br/>";
			if (part === "\t") return "<w:tab/>";
			if (part.length === 0) return "";
			return `<w:t xml:space="preserve">${escapeXml(part)}</w:t>`;
		})
		.join("");
	return `<w:r>${runProperties(style)}${body}</w:r>`;
}

/** A live Word field, with a cached result so the file looks right before Word updates it. */
export function field(instruction: "PAGE" | "NUMPAGES", cached: string, style: RunStyle): string {
	const properties = runProperties(style);
	return `<w:r>${properties}<w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r>${properties}<w:instrText xml:space="preserve"> ${instruction} </w:instrText></w:r><w:r>${properties}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${properties}<w:t>${escapeXml(cached)}</w:t></w:r><w:r>${properties}<w:fldChar w:fldCharType="end"/></w:r>`;
}

export interface TabStop {
	/** Twips from the left margin. */
	pos: number;
	val?: "left" | "right" | "center";
}

export interface ParagraphStyle {
	align?: "left" | "center" | "right";
	before?: number;
	after?: number;
	/** Line height in 240ths, e.g. 240 = single. */
	line?: number;
	keepNext?: boolean;
	borderBottom?: { color: string; size: number; space?: number };
	tabs?: TabStop[];
}

function paragraphProperties(style: ParagraphStyle): string {
	const border = style.borderBottom
		? `<w:pBdr><w:bottom w:val="single" w:color="${style.borderBottom.color}" w:sz="${style.borderBottom.size}" w:space="${style.borderBottom.space ?? 4}"/></w:pBdr>`
		: "";
	const tabs = style.tabs
		? `<w:tabs>${style.tabs.map((tab) => `<w:tab w:val="${tab.val ?? "right"}" w:pos="${tab.pos}"/>`).join("")}</w:tabs>`
		: "";
	return `${style.keepNext ? "<w:keepNext/>" : ""}${border}${tabs}<w:spacing w:before="${style.before ?? 0}" w:after="${style.after ?? 0}"${style.line ? ` w:line="${style.line}" w:lineRule="auto"` : ""}/>${style.align ? `<w:jc w:val="${style.align}"/>` : ""}`;
}

export function paragraph(runs: string, style: ParagraphStyle = {}): string {
	return `<w:p><w:pPr>${paragraphProperties(style)}</w:pPr>${runs}</w:p>`;
}

export function emptyParagraph(style: ParagraphStyle = {}): string {
	return paragraph("", style);
}

export function pageBreak(): string {
	return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

export interface CellMargin {
	top?: number;
	left?: number;
	bottom?: number;
	right?: number;
}

export interface BorderEdge {
	val: "single" | "dashed" | "nil";
	/** Eighths of a point. */
	size?: number;
	color?: string;
}

export type BorderSet = Partial<Record<"top" | "left" | "bottom" | "right" | "insideH" | "insideV", BorderEdge>>;

export const NIL_BORDERS: BorderSet = {
	top: { val: "nil" },
	left: { val: "nil" },
	bottom: { val: "nil" },
	right: { val: "nil" },
	insideH: { val: "nil" },
	insideV: { val: "nil" },
};

function borderXml(tag: "tcBorders" | "tblBorders", borders: BorderSet): string {
	const edges = tag === "tcBorders" ? (["top", "left", "bottom", "right"] as const) : (["top", "left", "bottom", "right", "insideH", "insideV"] as const);
	const body = edges
		.map((edge) => {
			const spec = borders[edge];
			if (!spec) return "";
			return `<w:${edge} w:val="${spec.val}"${spec.size ? ` w:sz="${spec.size}"` : ""}${spec.color ? ` w:color="${spec.color}"` : ""}/>`;
		})
		.join("");
	return body.length > 0 ? `<w:${tag}>${body}</w:${tag}>` : "";
}

function marginXml(margins: CellMargin): string {
	const parts = [
		margins.top !== undefined ? `<w:top w:w="${margins.top}" w:type="dxa"/>` : "",
		margins.left !== undefined ? `<w:left w:w="${margins.left}" w:type="dxa"/>` : "",
		margins.bottom !== undefined ? `<w:bottom w:w="${margins.bottom}" w:type="dxa"/>` : "",
		margins.right !== undefined ? `<w:right w:w="${margins.right}" w:type="dxa"/>` : "",
	].join("");
	return parts.length > 0 ? `<w:tcMar>${parts}</w:tcMar>` : "";
}

export interface CellOptions {
	width?: number;
	fill?: string;
	paragraphs?: string[];
	valign?: "top" | "center" | "bottom";
	margins?: CellMargin;
	gridSpan?: number;
	/** Restart or continue a vertically merged cell. */
	vMerge?: "restart" | "continue";
	borders?: BorderSet;
}

export function cell(options: CellOptions): string {
	const properties = [
		options.width !== undefined ? `<w:tcW w:w="${options.width}" w:type="dxa"/>` : "",
		options.gridSpan ? `<w:gridSpan w:val="${options.gridSpan}"/>` : "",
		options.vMerge ? `<w:vMerge w:val="${options.vMerge}"/>` : "",
		options.borders ? borderXml("tcBorders", options.borders) : "",
		options.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${options.fill}"/>` : "",
		options.margins ? marginXml(options.margins) : "",
		options.valign ? `<w:vAlign w:val="${options.valign}"/>` : "",
	].join("");
	const body = options.paragraphs && options.paragraphs.length > 0 ? options.paragraphs.join("") : "<w:p/>";
	return `<w:tc>${properties.length > 0 ? `<w:tcPr>${properties}</w:tcPr>` : ""}${body}</w:tc>`;
}

export interface RowOptions {
	height?: number;
	hRule?: "atLeast" | "exact";
	/** Defaults to true; pass false for dense tables that may split. */
	cantSplit?: boolean;
	header?: boolean;
}

export function row(cells: string[], options: RowOptions = {}): string {
	const properties = [
		options.cantSplit !== false ? "<w:cantSplit/>" : "",
		options.height ? `<w:trHeight w:val="${options.height}"${options.hRule ? ` w:hRule="${options.hRule}"` : ""}/>` : "",
		options.header ? "<w:tblHeader/>" : "",
	].join("");
	return `<w:tr>${properties.length > 0 ? `<w:trPr>${properties}</w:trPr>` : ""}${cells.join("")}</w:tr>`;
}

export interface TableOptions {
	columns: number[];
	rows: string[];
	/** Defaults to the sum of column widths in twips. */
	width?: { value: number; type: "dxa" | "pct" };
	borders?: BorderSet;
	margins?: CellMargin;
	fixed?: boolean;
}

export function table(options: TableOptions): string {
	const total = options.columns.reduce((sum, width) => sum + width, 0);
	const width = options.width ?? { value: total, type: "dxa" };
	const properties = [
		`<w:tblW w:w="${width.value}" w:type="${width.type}"/>`,
		options.borders ? borderXml("tblBorders", options.borders) : "",
		options.fixed !== false ? '<w:tblLayout w:type="fixed"/>' : "",
		options.margins ? `<w:tblCellMar>${[options.margins.top !== undefined ? `<w:top w:w="${options.margins.top}" w:type="dxa"/>` : "", options.margins.left !== undefined ? `<w:left w:w="${options.margins.left}" w:type="dxa"/>` : "", options.margins.bottom !== undefined ? `<w:bottom w:w="${options.margins.bottom}" w:type="dxa"/>` : "", options.margins.right !== undefined ? `<w:right w:w="${options.margins.right}" w:type="dxa"/>` : ""].join("")}</w:tblCellMar>` : "",
	].join("");
	return `<w:tbl><w:tblPr>${properties}</w:tblPr><w:tblGrid>${options.columns.map((column) => `<w:gridCol w:w="${column}"/>`).join("")}</w:tblGrid>${options.rows.join("")}</w:tbl>`;
}

export interface Margins {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export interface SectionOptions {
	margins: Margins;
	headerRel?: string;
	footerRel?: string;
	/** Defaults to 720 when the corresponding part exists. */
	headerDistance?: number;
	footerDistance?: number;
}

export function section(options: SectionOptions): string {
	const header = options.headerRel ? `<w:headerReference w:type="default" r:id="${options.headerRel}"/>` : "";
	const footer = options.footerRel ? `<w:footerReference w:type="default" r:id="${options.footerRel}"/>` : "";
	const headerDistance = options.headerDistance ?? (options.headerRel ? 720 : 0);
	const footerDistance = options.footerDistance ?? (options.footerRel ? 720 : 0);
	const margins = `<w:pgMar w:top="${options.margins.top}" w:right="${options.margins.right}" w:bottom="${options.margins.bottom}" w:left="${options.margins.left}" w:header="${headerDistance}" w:footer="${footerDistance}" w:gutter="0"/>`;
	return `<w:sectPr>${header}${footer}<w:pgSz w:w="11906" w:h="16838"/>${margins}</w:sectPr>`;
}

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export function documentXml(body: string): string {
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${body}</w:body></w:document>`;
}

export function headerPart(body: string): string {
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="${W_NS}" xmlns:r="${R_NS}">${body}</w:hdr>`;
}

export function footerPart(body: string): string {
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="${W_NS}" xmlns:r="${R_NS}">${body}</w:ftr>`;
}
