import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeElement, FakeHtmlElement, createDocument, resetStorage, stubStorage, type FakeDocument } from "./dom-stub.ts";

/**
 * The cover page.
 *
 * Two loops run here. The English line under the title rises word by word and then swaps for
 * the next line. The demo sentence lights up one word at a time, the lookup card follows the
 * word, and the last step lights the sentence number and swaps the card for the marked
 * translation.
 *
 * The stub has no `matchMedia`, so the default path under test is the still one: the first
 * word is lit and the card names it. The motion path is exercised separately by giving the
 * stub a `matchMedia` that reports no preference and driving the clock by hand.
 */

function jsonResponse(payload: unknown): Response {
	return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
	resetStorage();
	vi.stubGlobal("fetch", async (input: unknown) => {
		const url = String(input);
		if (url.startsWith("/api/articles")) return jsonResponse({ articles: [] });
		if (url === "/api/health") return jsonResponse({ ok: true, dictionary: "ecdict", llmModel: "x", ecdictPath: null });
		return jsonResponse({ ok: true });
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

function install(): FakeDocument {
	const doc = createDocument();
	const scope = globalThis as Record<string, unknown>;
	scope.document = doc;
	scope.localStorage = stubStorage();
	// Element and HTMLElement are not the same thing: an SVG element is an Element and
	// not an HTMLElement, and the app's click guards have to tell them apart.
	scope.Element = FakeElement;
	scope.HTMLElement = FakeHtmlElement;
	return doc;
}

function allowMotion(doc: FakeDocument): void {
	const view = doc.defaultView as unknown as Record<string, unknown>;
	view.matchMedia = () => ({ matches: false });
}

async function settle(): Promise<void> {
	for (let index = 0; index < 12; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function boot(): Promise<FakeDocument> {
	const doc = install();
	vi.resetModules();
	await import("../web/main.ts");
	await settle();
	return doc;
}

function byId(doc: FakeDocument, id: string): FakeElement {
	const found = doc.body.querySelector(`#${id}`);
	if (!found) throw new Error(`missing #${id}`);
	return found;
}

function words(doc: FakeDocument): FakeElement[] {
	return byId(doc, "home-view").querySelectorAll(".home__tok");
}

function lit(doc: FakeDocument): string[] {
	return words(doc)
		.map((token, index) => (token.classList.contains("is-lit") ? String(index) : ""))
		.filter((index) => index !== "");
}

function cardWord(doc: FakeDocument): string {
	return byId(doc, "home-gloss-word").textContent;
}

describe("the cover is where the app opens", () => {
	it("shows the home view with the other two hidden and the URL saying so", async () => {
		const doc = await boot();
		const hash = (doc.defaultView as unknown as { history: { location: { hash: string } } }).history.location.hash;
		expect(doc.documentElement.dataset.view).toBe("home");
		expect(byId(doc, "home-view").hidden).toBe(false);
		expect(byId(doc, "library-view").hidden).toBe(true);
		expect(byId(doc, "reader-view").hidden).toBe(true);
		// An empty hash has to be written back as the home route, or a reload would be ambiguous.
		expect(hash).toBe("#/home");
	});

	it("carries the demo sentence with the data its card shows", async () => {
		const doc = await boot();
		const tokens = words(doc);
		expect(tokens).toHaveLength(9);
		expect(tokens.map((token) => token.dataset.word).join(" ")).toBe(
			"The morning light came slowly over the quiet river",
		);
		// Every word needs a part of speech, a pronunciation and a gloss, or the card has
		// nothing to show when the word lights up.
		for (const token of tokens) {
			expect(token.dataset.pos).toBeTruthy();
			expect(token.dataset.ipa).toBeTruthy();
			expect(token.dataset.gloss).toBeTruthy();
		}
	});

	it("keeps the cover's own theme button in step with the reader's", async () => {
		const doc = await boot();
		byId(doc, "home-theme-toggle").fire("click");
		expect(doc.documentElement.dataset.theme).toBe("dark");
		expect(byId(doc, "theme-toggle").getAttribute("aria-label")).toBe("切换到亮色模式");
		byId(doc, "home-theme-toggle").fire("click");
		expect(doc.documentElement.dataset.theme).toBe("light");
		expect(byId(doc, "library-theme-toggle").getAttribute("aria-label")).toBe("切换到暗色模式");
	});
});

describe("the demo", () => {
	it("stands still on the first word when the platform has no motion opinion", async () => {
		const doc = await boot();
		expect(lit(doc)).toEqual(["0"]);
		expect(cardWord(doc)).toBe("The");
		expect(byId(doc, "home-gloss-pos").textContent).toBe("art.");
		expect(byId(doc, "home-gloss-meaning").textContent).toBe("这；那");
	});

	it("lights one word per beat and the card follows it", async () => {
		vi.useFakeTimers();
		const doc = install();
		allowMotion(doc);
		vi.resetModules();
		await import("../web/main.ts");
		await vi.advanceTimersByTimeAsync(1);

		// The first word is lit from the start; each beat moves on to the next.
		expect(lit(doc)).toEqual(["0"]);
		expect(cardWord(doc)).toBe("The");

		await vi.advanceTimersByTimeAsync(1500);
		expect(lit(doc)).toEqual(["1"]);
		expect(cardWord(doc)).toBe("morning");
		expect(byId(doc, "home-gloss-ipa").textContent).toBe("/ˈmɔːnɪŋ/");

		await vi.advanceTimersByTimeAsync(1500);
		expect(lit(doc)).toEqual(["2"]);
		expect(cardWord(doc)).toBe("light");
	});

	it("swaps the card for the marked translation when the sentence number lights up", async () => {
		vi.useFakeTimers();
		const doc = install();
		allowMotion(doc);
		vi.resetModules();
		await import("../web/main.ts");
		await vi.advanceTimersByTimeAsync(1);

		// Nine words, then the sentence itself. The first word is lit before the first
		// beat, so the sentence number lights on the ninth.
		await vi.advanceTimersByTimeAsync(1500 * 9);
		expect(lit(doc)).toEqual([]);
		expect(byId(doc, "home-view").querySelector(".home__num")?.classList.contains("is-lit")).toBe(true);
		expect(byId(doc, "home-card-gloss").classList.contains("is-on")).toBe(false);
		expect(byId(doc, "home-card-mark").classList.contains("is-on")).toBe(true);

		// And back to the first word, so the loop never ends on the sentence.
		await vi.advanceTimersByTimeAsync(1500);
		expect(lit(doc)).toEqual(["0"]);
		expect(byId(doc, "home-card-gloss").classList.contains("is-on")).toBe(true);
	});

	it("waits while the home view is hidden instead of ticking off screen", async () => {
		vi.useFakeTimers();
		const doc = install();
		allowMotion(doc);
		vi.resetModules();
		await import("../web/main.ts");
		await vi.advanceTimersByTimeAsync(1);

		byId(doc, "home-enter").fire("click");
		await vi.advanceTimersByTimeAsync(1);
		expect(byId(doc, "home-view").hidden).toBe(true);

		const before = lit(doc);
		await vi.advanceTimersByTimeAsync(1500 * 3);
		expect(lit(doc)).toEqual(before);
	});

	it("holds the loop on the word under the pointer", async () => {
		// A demo that runs away from under the pointer is a video, not something you can read.
		vi.useFakeTimers();
		const doc = install();
		allowMotion(doc);
		vi.resetModules();
		await import("../web/main.ts");
		await vi.advanceTimersByTimeAsync(1);

		words(doc)[3].fire("mouseenter");
		expect(lit(doc)).toEqual(["3"]);
		expect(cardWord(doc)).toBe("came");

		// The beat passes and the word stays put.
		await vi.advanceTimersByTimeAsync(1500 * 3);
		expect(lit(doc)).toEqual(["3"]);

		words(doc)[3].fire("mouseleave");
		await vi.advanceTimersByTimeAsync(1500);
		expect(lit(doc)).not.toEqual(["3"]);
	});

	it("holds the loop on the sentence number, so the marked card can be read", async () => {
		vi.useFakeTimers();
		const doc = install();
		allowMotion(doc);
		vi.resetModules();
		await import("../web/main.ts");
		await vi.advanceTimersByTimeAsync(1);

		byId(doc, "home-view").querySelector(".home__num")?.fire("mouseenter");
		expect(byId(doc, "home-card-mark").classList.contains("is-on")).toBe(true);
		expect(byId(doc, "home-card-gloss").classList.contains("is-on")).toBe(false);

		await vi.advanceTimersByTimeAsync(1500 * 3);
		expect(byId(doc, "home-card-mark").classList.contains("is-on")).toBe(true);
	});
});

describe("the English line under the title", () => {
	it("shows a whole line when nothing can animate it", async () => {
		const doc = await boot();
		const inner = byId(doc, "home-sentence-inner");
		expect(inner.children.length).toBeGreaterThan(0);
		// textValue aggregates the subtree; textContent is a plain field in the stub.
		expect(inner.textValue).toContain("A patient reader");
	});

	it("replaces the line with the next one when the clock runs", async () => {
		vi.useFakeTimers();
		const doc = install();
		allowMotion(doc);
		vi.resetModules();
		await import("../web/main.ts");
		await vi.advanceTimersByTimeAsync(1);

		const inner = byId(doc, "home-sentence-inner");
		// textValue aggregates the subtree; textContent is a plain field in the stub.
		expect(inner.textValue).toContain("A patient reader");
		await vi.advanceTimersByTimeAsync(6200);
		expect(inner.textContent).not.toContain("A patient reader");
	});
});

describe("entering the app", () => {
	it("both landing buttons open the library and write the library hash", async () => {
		for (const id of ["home-enter", "home-enter-foot"]) {
			const doc = await boot();
			byId(doc, id).fire("click");
			await settle();
			const hash = (doc.defaultView as unknown as { history: { location: { hash: string } } }).history.location.hash;
			expect(doc.documentElement.dataset.view).toBe("library");
			expect(byId(doc, "home-view").hidden).toBe(true);
			expect(hash).toBe("#/library");
		}
	});

	it("returns from the library to the cover without disturbing the reader", async () => {
		const doc = await boot();
		byId(doc, "home-enter").fire("click");
		await settle();
		byId(doc, "library-home").fire("click");
		await settle();
		expect(doc.documentElement.dataset.view).toBe("home");
		expect(byId(doc, "reader-view").hidden).toBe(true);
	});
});

describe("reveal is opt-in", () => {
	it("leaves the sections visible when nothing can observe them", async () => {
		const doc = await boot();
		// Node has no IntersectionObserver, so home.ts must not switch the page into the
		// hidden-until-scrolled state; the sections have to stay visible on their own.
		expect(byId(doc, "home-view").dataset.reveal).toBeUndefined();
	});

	/** Records what the page observed so the test can report an intersection by hand. */
	const observers: Array<{
		observed: FakeElement[];
		disconnected: boolean;
		report(entry: { isIntersecting: boolean; target: FakeElement }): void;
	}> = [];

	class FakeObserver {
		readonly observed: FakeElement[] = [];
		disconnected = false;
		private readonly callback: (entries: Array<{ isIntersecting: boolean; target: FakeElement }>) => void;

		constructor(callback: (entries: Array<{ isIntersecting: boolean; target: FakeElement }>) => void) {
			this.callback = callback;
			observers.push(this);
		}

		observe(target: FakeElement): void {
			this.observed.push(target);
		}

		unobserve(): void {
			// No bookkeeping needed: the page only reports an element once.
		}

		disconnect(): void {
			this.disconnected = true;
		}

		report(entry: { isIntersecting: boolean; target: FakeElement }): void {
			this.callback([entry]);
		}
	}

	async function bootWithObserver(): Promise<FakeDocument> {
		vi.useFakeTimers();
		observers.length = 0;
		vi.stubGlobal("IntersectionObserver", FakeObserver);
		const doc = install();
		vi.resetModules();
		await import("../web/main.ts");
		await vi.advanceTimersByTimeAsync(1);
		return doc;
	}

	it("hides the sections until they are reported, then shows only the one that arrived", async () => {
		const doc = await bootWithObserver();
		const home = byId(doc, "home-view");
		const rungs = home.querySelectorAll(".rung");
		expect(home.dataset.reveal).toBe("ready");
		expect(observers).toHaveLength(1);
		expect(observers[0].observed).toHaveLength(rungs.length);

		observers[0].report({ isIntersecting: true, target: rungs[1] });
		expect(rungs[1].dataset.reveal).toBe("in");
		expect(rungs[0].dataset.reveal).not.toBe("in");
	});

	it("shows every section anyway if the observer never reports", async () => {
		const doc = await bootWithObserver();
		const rungs = byId(doc, "home-view").querySelectorAll(".rung");
		await vi.advanceTimersByTimeAsync(2600);

		for (const rung of rungs) expect(rung.dataset.reveal).toBe("in");
		expect(observers[0].disconnected).toBe(true);
	});
});
