import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (name: string): string => readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), "utf8");

const html = read("web/index.html");
const mainSource = read("web/main.ts");

function idsIn(source: string): Set<string> {
	return new Set([...source.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
}

/** Every id main.ts looks up with requireElement, including those inside compound calls. */
function requiredIds(source: string): string[] {
	return [...source.matchAll(/requireElement(?:<[^>]*>)?\(\s*"([^"]+)"/g)].map((match) => match[1]);
}

describe("index.html and main.ts agree on element ids", () => {
	// Regression guard: #status was once dropped from index.html while main.ts still
	// required it, the throw killed init(), and every button on the page stopped working
	// with no visible error. These tests make that failure impossible to ship again.
	it("defines every id that main.ts requires", () => {
		const defined = idsIn(html);
		const required = requiredIds(mainSource);
		// Guard against a regex change silently matching nothing and passing vacuously.
		expect(required).toContain("status");
		expect(required).toContain("confirm-button");
		expect(required).toContain("article-grid");
		const missing = required.filter((id) => !defined.has(id));
		expect(missing).toEqual([]);
	});

	it("defines every id the library view needs", () => {
		const defined = idsIn(html);
		for (const id of [
			"library-view",
			"article-grid",
			"library-hint",
			"library-theme-toggle",
			"settings-button",
			"delete-toggle",
			"back-button",
			"reader-view",
		]) {
			expect(defined.has(id)).toBe(true);
		}
	});

	it("defines every id the vocabulary view needs", () => {
		const defined = idsIn(html);
		for (const id of [
			"words-view",
			"words-button",
			"words-back",
			"words-theme-toggle",
			"words-search",
			"words-clear",
			"words-sort",
			"words-count",
			"words-total",
			"words-stats",
			"words-loading",
			"words-grid",
			"words-empty",
			"words-empty-title",
			"words-empty-text",
			"words-empty-action",
		]) {
			expect(defined.has(id), `missing #${id}`).toBe(true);
		}
	});

	it("defines every id the spelling drill needs", () => {
		const defined = idsIn(html);
		for (const id of [
			"spell-view",
			"spell-back",
			"spell-theme-toggle",
			"spell-order",
			"spell-order-thumb",
			"spell-card",
			"spell-progress",
			"spell-meaning",
			"spell-pos",
			"spell-ipa",
			"spell-stage",
			"spell-legend",
			"spell-answer",
			"spell-result",
			"spell-prev",
			"spell-rewrite",
			"spell-submit",
			"spell-next",
			"spell-session",
			"spell-loading",
			"spell-empty",
			"spell-empty-title",
			"spell-empty-text",
			"spell-empty-action",
			// The entry lives on the ledger page, not in the drill.
			"words-drill",
		]) {
			expect(defined.has(id), `missing #${id}`).toBe(true);
		}
	});

	it("does not declare the same id twice", () => {
		const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
		const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
		expect(duplicates).toEqual([]);
	});

	it("keeps the status element outside the collapsible block so failures stay visible", () => {
		const inputSection = html.slice(html.indexOf('id="input-section"'), html.indexOf('id="article"'));
		expect(inputSection).toContain('id="status"');
	});

	it("starts on the home view", () => {
		expect(html).toMatch(/<html[^>]*data-view="home"/);
	});

	it("gives the home view every id the landing page needs", () => {
		const defined = idsIn(html);
		for (const id of [
			"home-view",
			"home-theme-toggle",
			"home-enter",
			"home-enter-foot",
			"home-rungs",
			"home-sentence",
			"home-sentence-inner",
			"home-demo-sentence",
			"home-card-gloss",
			"home-card-mark",
			"home-gloss-word",
			"home-gloss-pos",
			"home-gloss-ipa",
			"home-gloss-meaning",
			"library-home",
		]) {
			expect(defined.has(id)).toBe(true);
		}
	});

	// The home view is the only thing that loads the display faces; if the files it points at
	// are missing the page silently falls back to the system serif, which is the one thing the
	// direction contract forbids.
	it("points the display faces at files that ship", () => {
		const css = read("web/cover.css");
		for (const file of ["mashanzheng-subset.woff2", "instrument-serif-latin-400-normal.woff2"]) {
			expect(css).toContain(`./fonts/${file}`);
			const bytes = readFileSync(fileURLToPath(new URL(`../web/fonts/${file}`, import.meta.url)));
			expect(bytes.byteLength).toBeGreaterThan(1000);
			expect(bytes.subarray(0, 4).toString("latin1")).toBe("wOF2");
		}
	});

	// The demo section is the page proving the product works, so every word it lights up has
	// to carry the data the card shows. A word without a gloss would flash with nothing.
	it("gives every demo word the data its card shows", () => {
		const html = read("web/index.html");
		const words = [...html.matchAll(/<button class="home__tok"([^>]*)>/g)].map((match) => match[1]);
		expect(words.length).toBeGreaterThan(3);
		for (const attributes of words) {
			expect(attributes).toMatch(/data-word="/);
			expect(attributes).toMatch(/data-pos="/);
			expect(attributes).toMatch(/data-ipa="/);
			expect(attributes).toMatch(/data-gloss="/);
		}
	});

	// The words are the demo's only controls, so they have to be reachable by keyboard.
	it("makes the demo words real buttons rather than spans", () => {
		const html = read("web/index.html");
		expect(html).not.toMatch(/<span class="home__tok"/);
		expect(html).toMatch(/<button class="home__tok" type="button"/);
	});
});

describe("browser tab", () => {
	// The tab is the only part of the app that shows before any CSS or JS; it carries the same
	// staircase mark as the installer icon, and must name the view rather than fall back to the
	// browser's default icon.
	it("ships the 拾级 staircase favicon used by the installer too", () => {
		expect(html).toContain('<link rel="icon" href="data:image/svg+xml,');
		expect(html).toContain("viewBox='0 0 512 512'");
		expect(html).toContain("fill='%231c1a15'");
		expect(html).toContain("fill='%238a6410'");
	});

	it("titles every view 拾级 first, then the view", () => {
		expect(html).toContain("<title>拾级</title>");
		expect(mainSource).toContain('document.title = "拾级"');
		expect(mainSource).toContain('document.title = "拾级 · 文章库"');
		expect(mainSource).toContain('document.title = "拾级 · 单词库"');
		expect(mainSource).toContain('document.title = "拾级 · 拼写练习"');
	});

	it("names the reader 拾级 · 阅读 instead of the article", () => {
		expect(mainSource).toContain('const READER_TITLE = "拾级 · 阅读"');
		expect(mainSource).toContain("document.title = READER_TITLE");
		expect(mainSource).not.toContain("document.title = `${title} · 拾级`");
	});
});
