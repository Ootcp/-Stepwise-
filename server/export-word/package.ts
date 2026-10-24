import { createZip, type ZipEntry } from "../zip.ts";

/**
 * Assembles the .docx package. Only the parts a document actually uses are written:
 * header/footer parts add their content-type overrides and a document relationship file,
 * which Word requires before it will read them.
 */

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const HEADER_REL_ID = "rId1";
const FOOTER_REL_ID = "rId2";

export const HEADER_ID = HEADER_REL_ID;
export const FOOTER_ID = FOOTER_REL_ID;

function contentTypes(header: boolean, footer: boolean): string {
	const overrides = [
		'<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
		header ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : "",
		footer ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : "",
	].join("");
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides}</Types>`;
}

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/officeDocument" Target="word/document.xml"/></Relationships>`;

function documentRels(header: boolean, footer: boolean): string {
	const relationships = [
		header ? `<Relationship Id="${HEADER_REL_ID}" Type="${OFFICE_REL}/header" Target="header1.xml"/>` : "",
		footer ? `<Relationship Id="${FOOTER_REL_ID}" Type="${OFFICE_REL}/footer" Target="footer1.xml"/>` : "",
	].join("");
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">${relationships}</Relationships>`;
}

export interface PackageParts {
	document: string;
	header?: string;
	footer?: string;
}

export function buildPackage(parts: PackageParts): Buffer {
	const hasHeader = parts.header !== undefined;
	const hasFooter = parts.footer !== undefined;
	const entries: ZipEntry[] = [
		{ name: "[Content_Types].xml", data: Buffer.from(contentTypes(hasHeader, hasFooter), "utf8") },
		{ name: "_rels/.rels", data: Buffer.from(ROOT_RELS, "utf8") },
		{ name: "word/document.xml", data: Buffer.from(parts.document, "utf8") },
	];
	if (hasHeader || hasFooter) {
		entries.push({ name: "word/_rels/document.xml.rels", data: Buffer.from(documentRels(hasHeader, hasFooter), "utf8") });
	}
	if (parts.header !== undefined) entries.push({ name: "word/header1.xml", data: Buffer.from(parts.header, "utf8") });
	if (parts.footer !== undefined) entries.push({ name: "word/footer1.xml", data: Buffer.from(parts.footer, "utf8") });
	return createZip(entries);
}

export { W_NS };
