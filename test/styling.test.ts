import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for the "both views render on one page" bug.
 *
 * The router sets `hidden` on the view it is leaving, but `.library { display: grid }` and
 * `.app { display: flex }` are author declarations, so they beat the browser's default
 * `[hidden] { display: none }` and the hidden view stayed on screen. The stub cannot compute
 * CSS, so this asserts the two conditions that produced it: both views do declare a display,
 * and there is a rule that makes the attribute win.
 */

const read = (name: string): string => readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), "utf8");

/**
 * The app's own rules and the cover's rules are two files, and a rule can live in either:
 * the cover brings its own display faces and its own palette, so its CSS stands apart from
 * the reader's. The tests below read both, so a rule can be asserted wherever it is.
 */
const css = [read("web/styles.css"), read("web/cover.css")].join("\n");
const wordsCss = read("web/words.css");
const html = read("web/index.html");
const mainSource = read("web/main.ts");

/**
 * The body of the rule for one selector.
 *
 * The selector has to start a rule of its own: it must be followed by a brace, and it must
 * not be the tail of a selector list (".a,\n.b {"). Otherwise ".home__foil" would match the
 * ".home__ink,\n.home__foil" rule instead of the rule that actually sets the mask.
 */
function ruleBody(selector: string): string {
	const needle = `\n${selector} {`;
	let from = 0;
	for (;;) {
		const index = css.indexOf(needle, from);
		expect(index, `selector ${selector} not found`).toBeGreaterThan(-1);
		// A selector list tail is preceded by a comma; that rule belongs to the whole list.
		if (css[index - 1] !== ",") {
			return css.slice(index + needle.length, css.indexOf("}", index));
		}
		from = index + 1;
	}
}

/** The value of one custom property, wherever it is declared. */
function tokenValue(name: string): string {
	const match = new RegExp(`${name}:\\s*([^;]+);`).exec(css);
	expect(match, `token ${name} not found`).not.toBeNull();
	return match?.[1] ?? "";
}

describe("hidden views actually hide", () => {
	it("makes the hidden attribute win over author display declarations", () => {
		const body = ruleBody("[hidden]");
		expect(body).toMatch(/display:\s*none/);
		expect(body).toMatch(/!important/);
	});

	it("still applies it to both views, which do set their own display", () => {
		expect(ruleBody(".library")).toMatch(/display:\s*grid/);
		expect(ruleBody(".app")).toMatch(/display:\s*flex/);
		// If either view stopped declaring a display this guard would be checking nothing,
		// so assert both facts together rather than either one alone.
		expect(ruleBody("[hidden]")).toMatch(/!important/);
	});
});

describe("library scroll containment", () => {
	it("locks the page while the library is showing", () => {
		const body = ruleBody('html[data-view="library"]');
		expect(body).toMatch(/overflow:\s*hidden/);
	});

	// The library is already 100dvh, so any body padding pushes its bottom edge off screen.
	it("removes body padding in the library so nothing overflows", () => {
		const body = ruleBody('html[data-view="library"] body');
		expect(body).toMatch(/padding:\s*0/);
		expect(body).toMatch(/margin:\s*0/);
		expect(body).toMatch(/overflow:\s*hidden/);
		expect(body).toMatch(/height:\s*100dvh/);
	});

	it("puts the scrollbar on the grid, not the page", () => {
		const body = ruleBody(".library__grid");
		expect(body).toMatch(/overflow-y:\s*auto/);
		expect(body).toMatch(/min-height:\s*0/);
	});

	it("keeps the body able to scroll in the reader", () => {
		const body = ruleBody('html[data-view="reader"]');
		expect(body).toMatch(/overflow:\s*auto/);
		expect(body).not.toContain("100dvh");
	});
});

describe("decorative borders are gone", () => {
	it("has no reserved sidebar left to frame", () => {
		// The old library had a "预留" panel that never held anything. It is gone, and with it
		// the green frame that once marked it as a placeholder.
		expect(css).not.toContain(".library__side");
		expect(css).not.toContain("--line-green");
	});

	it("draws no dashed red frame around the card grid", () => {
		expect(ruleBody(".library__grid")).not.toMatch(/border:/);
	});
});

describe("the reader has no clear button", () => {
	it("no longer ships the button, the handler or the danger button styling", () => {
		expect(html).not.toContain('id="clear-button"');
		expect(mainSource).not.toContain("clear-button");
		expect(mainSource).not.toContain("resetToInitial");
		expect(css).not.toContain(".button--danger");
		expect(css).not.toContain("button--danger");
	});

	it("keeps the library delete flow intact", () => {
		expect(html).toContain('id="delete-toggle"');
	});
});

describe("study summary section", () => {
	it("replaced the word list in both the markup and the styles", () => {
		expect(html).toContain('id="summary"');
		expect(html).toContain("本篇小结");
		expect(html).not.toContain('id="vocab"');
		expect(css).not.toContain(".vocab");
	});

	it("keeps the danger colour only for grammar weakness cards", () => {
		// --danger came back for the grammar card accent; the button variant must stay gone.
		expect(ruleBody(".summary__point")).toMatch(/border-left:\s*3px solid var\(--danger\)/);
	});

	it("lays weak-word chips out inline rather than one per line", () => {
		expect(ruleBody(".summary__chips")).toMatch(/display:\s*flex/);
		expect(ruleBody(".summary__chips")).toMatch(/flex-wrap:\s*wrap/);
	});

	it("sizes chips by word length through three tiers", () => {
		for (const tier of ["s", "m", "l"]) {
			expect(css).toContain(`.summary__chip[data-size="${tier}"]`);
		}
	});
});

describe("sentence panels push content down", () => {
	it("uses min-height rather than a fixed height", () => {
		const body = ruleBody(".sentence__slot");
		expect(body).toMatch(/min-height:/);
		expect(body).not.toMatch(/(^|\s)height:/);
	});
});

describe("sentence-part colours", () => {
	it("gives every role its own tint and edge in both themes", () => {
		for (const role of ["subject", "predicate", "object", "attributive", "adverbial", "complement", "predicative", "appositive"]) {
			expect(css).toContain(`--role-${role}:`);
			expect(css).toContain(`--role-${role}-edge:`);
			expect(css).toContain(`.syntax__part--${role}`);
		}
	});

	it("draws a clause as a dashed edge instead of a nested fill", () => {
		expect(ruleBody(".syntax__part--clause")).toMatch(/border-bottom:\s*1\.5px dashed/);
		expect(ruleBody(".syntax__line")).not.toMatch(/display:\s*flex/);
	});
});

describe("paragraph layout", () => {
	it("runs sentences inline and drops the reserved slot line", () => {
		expect(css).toContain('html[data-layout="paragraph"] .sentence');
		expect(css).toMatch(/html\[data-layout="paragraph"\]\s*\.sentence\s*\{[^}]*display:\s*inline/);
		// An empty slot must not reserve a line, or every sentence still breaks the paragraph.
		expect(css).toMatch(/html\[data-layout="paragraph"\]\s*\.sentence__slot:not\(:has\(/);
		expect(css).toMatch(/html\[data-layout="paragraph"\]\s*\.sentence__slot[^}]*display:\s*none/);
	});

	it("ships the toggle button in the reader header", () => {
		expect(html).toContain('id="layout-toggle"');
		expect(mainSource).toContain("layout-toggle");
	});
});

describe("the reader can read a sentence aloud", () => {
	it("puts the speaker right after the number, where the sentence's actions live", () => {
		// The speaker and the number are the two things that act on a sentence, so they
		// belong together rather than the speaker floating at the end of the line.
		const source = read("web/article.ts");
		const order = source.slice(source.indexOf("marker,"), source.indexOf("slot,"));
		expect(order).toContain("speak");
		expect(order.indexOf("speak")).toBeGreaterThan(order.indexOf("marker"));
		expect(order.indexOf("speak")).toBeLessThan(order.indexOf("body"));
	});

	it("keeps the speaker out of the way until the sentence is hovered or focused", () => {
		// An article is a wall of sentences. A wall of speaker icons is a wall of noise.
		expect(ruleBody(".sentence__speak")).toMatch(/opacity:\s*0/);
		expect(css).toContain(".sentence:hover .sentence__speak");
		expect(css).toContain(".sentence__speak:focus-visible");
	});

	it("always shows the speaker on a touch screen", () => {
		// A finger cannot hover, and a button nobody can see is a button nobody finds.
		expect(css).toMatch(/@media \(hover: none\)/);
	});

	it("marks the sentence being read and the word being said", () => {
		// The sentence mark works whether or not the engine reports word boundaries, so
		// there is always some sign that the reading is going on.
		expect(css).toContain(".sentence--reading .sentence__number");
		expect(css).toContain(".word--reading");
	});

	it("draws the speaker rather than typing a glyph", () => {
		// A glyph renders differently everywhere and is announced before the button's own
		// label. The icon is drawn, and the button carries the words.
		//
		// The SVG is built through createElementNS, not pasted in as markup. That is the
		// correct way to make an SVG element, and it is also why a click on the icon reports
		// a different kind of target than a click on the button.
		const source = read("web/article.ts");
		expect(source).toContain('speak.className = "sentence__speak"');
		expect(source).toContain('doc.createElementNS(SVG_NS, "svg")');
		expect(source).toContain('aria-label", `朗读:');
		expect(source).not.toContain("SPEAKER_ICON");
	});
});

describe("landing page", () => {
	it("scrolls like a page and loses the reader's body padding", () => {
		const view = ruleBody('html[data-view="home"]');
		expect(view).toMatch(/overflow:\s*auto/);
		expect(ruleBody('html[data-view="home"] body')).toMatch(/padding:\s*0/);
	});

	it("draws the staircase as an SVG the light climbs", () => {
		// The staircase is a path, not a set of boxes: one line, stepped. The gold run is a
		// second path over it, so the light travelling up is the same shape as the stair.
		expect(css).toContain(".home__stair-base");
		expect(css).toContain(".home__stair-run");
		expect(ruleBody(".home__stair-run")).toMatch(/stroke-dasharray:/);
		expect(ruleBody(".home__stair-run")).toMatch(/animation:/);
		// The gold is a line, never a fill: the run is a stroke and carries no background.
		expect(ruleBody(".home__stair-run")).not.toMatch(/background:/);
	});

	it("sweeps the gold foil across the title instead of tinting the text", () => {
		// The foil is a mask over a solid colour, so the glyphs never become a gradient.
		expect(ruleBody(".home__foil")).toMatch(/mask-image:/);
		expect(ruleBody(".home__foil")).toMatch(/animation:/);
		expect(css).not.toContain("background-clip: text");
		expect(css).not.toContain("-webkit-background-clip: text");
	});

	it("shows the lookup card and the marked-translation card in the same place", () => {
		// Two cards, one position: the panel has a single cell, so swapping between them
		// never pushes the layout around.
		expect(ruleBody(".home__card")).toMatch(/grid-area:\s*1\s*\/\s*1/);
		expect(css).toContain(".home__card--gloss");
		expect(css).toContain(".home__card--mark");
	});

	it("keeps the reveal opt-in so the page is readable before any script runs", () => {
		expect(css).toMatch(/\.home\[data-reveal="ready"\]\s*\.rung:not\(\[data-reveal="in"\]\)/);
		// The base rule must not hide anything; only the ready state may.
		expect(ruleBody(".rung")).not.toMatch(/opacity:\s*0/);
	});

	it("loads both display faces from files that ship, and never a system face", () => {
		expect(css).toContain('font-family: "Shiji Brush"');
		expect(css).toContain('font-family: "Shiji Serif"');
		expect(css).toContain("./fonts/mashanzheng-subset.woff2");
		expect(css).toContain("./fonts/instrument-serif-latin-400-normal.woff2");
		// A system face is allowed only as a fallback behind a shipped one.
		const brush = tokenValue("--font-brush");
		expect(brush.indexOf('"Shiji Brush"')).toBeLessThan(brush.indexOf("Songti SC"));
		const serif = tokenValue("--font-serif");
		expect(serif.indexOf('"Shiji Serif"')).toBeLessThan(serif.indexOf("Georgia"));
	});

	it("turns the animation off when the platform asks for reduced motion", () => {
		const reduce = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
		expect(reduce).toContain(".home__word");
		expect(reduce).toContain(".home__foil");
		expect(reduce).toMatch(/animation:\s*none/);
	});
});

describe("settings sheet", () => {
	it("sits above the other dialogs with a stable two-column paper layout", () => {
		expect(ruleBody(".dialog-layer--settings")).toMatch(/z-index:\s*130/);
		const dialog = ruleBody(".dialog--settings");
		expect(dialog).toMatch(/width:\s*min\(900px,\s*100%\)/);
		expect(dialog).toMatch(/max-height:/);
		expect(ruleBody(".settings")).toMatch(/grid-template-columns:\s*168px/);
	});

	it("keeps one height while tabs change and uses paper, not white, for the menu", () => {
		const dialog = ruleBody(".dialog--settings");
		expect(dialog).toMatch(/height:\s*min\(720px,\s*calc\(100dvh - 32px\)\)/);
		expect(ruleBody(".settings__menu")).toMatch(/background:\s*transparent/);
	});

	it("turns the left rail into a tab strip on narrow screens", () => {
		const media = css.slice(css.indexOf("@media (max-width: 720px)"));
		expect(media).toContain(".settings__menu");
		expect(media).toContain("grid-template-columns: 1fr");
	});
});

describe("article library", () => {
	it("keeps the page locked to the viewport and the scrollbar on the grid", () => {
		// The library is a tool page, not a cover: the nav must stay put while the cards
		// scroll underneath it. The old layout put a reserved panel next to the grid, and
		// that panel is gone — one column now.
		expect(ruleBody('html[data-view="library"]')).toMatch(/overflow:\s*hidden/);
		expect(ruleBody(".library__grid")).toMatch(/overflow-y:\s*auto/);
		expect(ruleBody(".library__grid")).toMatch(/min-height:\s*0/);
		expect(css).not.toContain(".library__side");
	});

	it("marks the selected card in delete mode with a frame of its own", () => {
		expect(ruleBody('.library[data-mode="delete"] .article-card[data-selected="true"]')).toMatch(
			/border:\s*2px solid var\(--danger\)/,
		);
	});

	it("gives the first card's hover lift room inside the scroller", () => {
		const grid = ruleBody(".library__grid");
		const hover = ruleBody(".article-card:hover");
		const lift = Math.abs(Number(/translateY\((-?[\d.]+)px\)/.exec(hover)?.[1] ?? 0));
		const padding = Number(/padding-top:\s*([\d.]+)px/.exec(grid)?.[1] ?? 0);
		expect(lift).toBeGreaterThan(0);
		// The 1px top border sits above the card's box, so the padding must clear lift + 1.
		expect(padding).toBeGreaterThanOrEqual(lift + 1);
	});
});

describe("vocabulary ledger", () => {
	const wordsRuleBody = (selector: string): string => {
		const needle = `\n${selector} {`;
		const index = wordsCss.indexOf(needle);
		expect(index, `selector ${selector} not found in words.css`).toBeGreaterThan(-1);
		return wordsCss.slice(index + needle.length, wordsCss.indexOf("}", index));
	};

	it("locks the page and keeps the scrollbar on the card grid", () => {
		expect(ruleBody('html[data-view="words"]')).toMatch(/overflow:\s*hidden/);
		expect(ruleBody('html[data-view="words"] body')).toMatch(/padding:\s*0/);
		expect(wordsRuleBody(".words")).toMatch(/height:\s*100dvh/);
		expect(wordsRuleBody(".words__grid")).toMatch(/overflow-y:\s*auto/);
		expect(wordsRuleBody(".words__grid")).toMatch(/min-height:\s*0/);
		// A button's UA intrinsic height must not become the row height, or the card clips.
		expect(wordsRuleBody(".words__grid")).toMatch(/grid-auto-rows:\s*max-content/);
	});

	it("gives the first card's hover lift room inside the scroller", () => {
		const grid = wordsRuleBody(".words__grid");
		const hover = wordsRuleBody(".word-card:hover");
		const lift = Math.abs(Number(/translateY\((-?[\d.]+)px\)/.exec(hover)?.[1] ?? 0));
		const padding = Number(/padding:\s*([\d.]+)px/.exec(grid)?.[1] ?? 0);
		expect(lift).toBeGreaterThan(0);
		expect(padding).toBeGreaterThanOrEqual(lift + 1);
	});

	it("draws word cards as the same paper as article cards", () => {
		const card = wordsRuleBody(".word-card");
		expect(card).toMatch(/border:\s*1px solid var\(--hairline\)/);
		expect(card).toMatch(/border-radius:\s*4px/);
	});

	it("uses the cover's warm paper in both themes", () => {
		expect(css).toContain('html[data-view="home"],\nhtml[data-view="library"],\nhtml[data-view="words"],\nhtml[data-view="spell"] {');
		expect(css).toContain('html[data-theme="dark"][data-view="words"]');
	});

	it("collapses the library entry to an icon on a phone", () => {
		expect(css).toMatch(/\.library__words-label\s*\{\s*display:\s*none/);
	});
});

describe("spelling drill", () => {
	const spellCss = read("web/spell.css");
	const spellRule = (selector: string): string => {
		const needle = `\n${selector} {`;
		const index = spellCss.indexOf(needle);
		expect(index, `selector ${selector} not found in spell.css`).toBeGreaterThan(-1);
		return spellCss.slice(index + needle.length, spellCss.indexOf("}", index));
	};

	it("locks the page like the other tool views", () => {
		expect(ruleBody('html[data-view="spell"]')).toMatch(/overflow:\s*hidden/);
		expect(ruleBody('html[data-view="spell"] body')).toMatch(/padding:\s*0/);
		expect(spellRule(".spell")).toMatch(/height:\s*100dvh/);
	});

	it("gives the drill its own warm-paper tokens in both themes", () => {
		expect(css).toContain('html[data-view="spell"] {');
		expect(css).toContain('html[data-theme="dark"][data-view="spell"]');
		// A second red would fight --danger; the wrong letter borrows from it, the right one
		// is the only new hue.
		expect(css).toMatch(/--right:/);
		expect(css).toMatch(/--wrong:/);
	});

	it("keeps both rows in the same letter columns", () => {
		// One grid on the stage: `--cell` is resolved against the stage's own font size, so the
		// correction row can be a different size without drifting out of register.
		const stage = spellRule(".spell__stage");
		expect(stage).toMatch(/--cell:/);
		expect(stage).toMatch(/grid-template-columns:\s*repeat\(var\(--cols/);
		expect(spellRule(".spell__cell--target")).toMatch(/grid-row:\s*1/);
		expect(spellRule(".spell__cell--answer")).toMatch(/grid-row:\s*2/);
		// The separator is a column of its own, so the other row needs a placeholder there.
		expect(spellRule('.spell__cell[data-state="blank"]')).toMatch(/visibility:\s*hidden/);
	});

	it("marks a wrong letter with more than colour", () => {
		expect(spellRule('.spell__cell[data-state="wrong"]')).toMatch(/text-decoration-style:\s*dotted/);
		expect(spellRule('.spell__cell[data-state="extra"]')).toMatch(/line-through/);
		expect(spellRule('.spell__cell[data-state="missing"]')).toMatch(/dashed/);
		expect(spellRule(".spell__cell[data-mark]::after")).toMatch(/attr\(data-mark\)/);
	});

	it("keeps the field visible and empty while the reveal is showing", () => {
		// The old design faded the field out; the reader could not see a caret and could not
		// click back into it. The reveal now sits above a live, empty field.
		expect(spellCss).not.toMatch(/\.spell__answer\[data-state="revealed"\]/);
		// Clicking the reveal hands the keyboard back, so it has to look clickable.
		expect(spellRule(".spell__stage")).toMatch(/cursor:\s*text/);
	});

	it("centers the actions and gives them room", () => {
		expect(spellRule(".spell__foot")).toMatch(/flex-direction:\s*column/);
		expect(spellRule(".spell__foot")).toMatch(/align-items:\s*center/);
		expect(spellRule(".spell__actions")).toMatch(/justify-content:\s*center/);
		expect(spellRule(".spell__actions")).toMatch(/gap:\s*14px/);
	});

	it("moves the order slider from one place", () => {
		// JS writes the travel; CSS keeps the resting position and the transition, so a missing
		// script never leaves the thumb sitting in the middle of the control.
		expect(spellRule(".spell__order-thumb")).toMatch(/transform:\s*translateX\(0\)/);
		expect(spellRule(".spell__order-thumb")).toMatch(/transition:\s*transform/);
		expect(spellCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
	});

	it("collapses the ledger's drill entry to an icon on a phone", () => {
		expect(spellCss).toMatch(/\.words__drill-label\s*\{\s*display:\s*none/);
	});
});
