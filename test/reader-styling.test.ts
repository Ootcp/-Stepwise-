import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Reader-sheet assertions for the regressions that only the app's DOM can trigger:
 * the back control is a <button> (prototype uses an <a>), and clause labels are inline
 * marks that must never break between their two characters.
 */
const css = readFileSync(fileURLToPath(new URL("../web/reader.css", import.meta.url)), "utf8");

function ruleBody(selector: string): string {
	const needle = `\n${selector} {`;
	const index = css.indexOf(needle);
	expect(index, `selector ${selector} not found`).toBeGreaterThan(-1);
	return css.slice(index + needle.length, css.indexOf("}", index));
}

describe("reader back button", () => {
	it("drops the browser's button chrome so it matches the prototype link", () => {
		const body = ruleBody(".back");
		expect(body).toMatch(/border:\s*0;/);
		expect(body).toMatch(/background:\s*none;/);
		expect(body).toMatch(/appearance:\s*none;/);
		expect(body).toMatch(/cursor:\s*pointer;/);
	});
});

describe("sentence-part wrapping", () => {
	it("keeps a two-character clause mark on one line", () => {
		expect(ruleBody(".syntax__mark")).toMatch(/white-space:\s*nowrap;/);
	});

	it("keeps the clause label and its text on the same row", () => {
		const row = ruleBody(".syntax__clause-row");
		expect(row).toMatch(/flex-wrap:\s*nowrap;/);
		const line = ruleBody(".syntax__clause-line");
		expect(line).toMatch(/flex:\s*1 1 0;/);
		expect(line).toMatch(/min-width:\s*0;/);
	});
});

describe("reader dark palette", () => {
	// styles.css still carries the old cool app-shell palette under :root[data-theme="dark"],
	// which outranks a plain html[data-theme="dark"] block. The reader-scoped block has to
	// re-assert the warm paper, or the reading page turns grey-blue while the cover stays warm.
	it("keeps the reader on the same warm paper as the cover", () => {
		const body = ruleBody('html[data-view="reader"][data-theme="dark"]');
		expect(body).toMatch(/--paper:\s*#14140f;/);
		expect(body).toMatch(/--card:\s*#21201a;/);
		expect(body).toMatch(/--paper-alt:\s*var\(--paper-deep\);/);
		expect(body).toMatch(/--paper-edge:\s*var\(--hairline\);/);
	});
});
