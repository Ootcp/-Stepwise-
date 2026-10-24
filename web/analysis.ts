/**
 * Turns a model's grading reply into display points.
 *
 * Models answer the same prompt in different shapes: some reply with Markdown headings,
 * bullets and line breaks, others with one long paragraph that numbers its points inline.
 * Both must read the same in the panel, so decoration is removed and every point becomes one
 * block with identical spacing. The stored text is left untouched; this is display only.
 */
export function splitAnalysis(text: string): string[] {
	const stripped = text
		.replace(/\r\n?/g, "\n")
		// Headings at the start of a line only; a "#" inside a sentence is text.
		.replace(/^\s{0,3}#{1,6}\s*/gm, "")
		.replace(/\*\*(.+?)\*\*/g, "$1")
		.replace(/__(.+?)__/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		// Bullets carry no meaning once every point is a paragraph of its own.
		.replace(/^\s*[-*•·]\s+/gm, "")
		// "…；1）…；2）…" in one paragraph: break before each numbered point, keep the
		// punctuation that ended the previous one. Only after a sentence/semicolon/colon
		// marker, so decimals and ordinary "3.14" cannot be mistaken for a list number.
		.replace(/([；;。：:])\s*[（(]?\d{1,2}[)）.、]\s*/g, "$1\n")
		// A number that starts its own line is already a break; drop the marker itself.
		.replace(/^\s*(?:[（(]?\d{1,2}[)）.、]|[①-⑳])\s*/gm, "");

	return stripped
		.split(/\n+/)
		.map((point) => point.trim())
		.filter((point) => point.length > 0);
}
