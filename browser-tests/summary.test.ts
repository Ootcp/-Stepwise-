import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeElement, FakeHtmlElement, createDocument, resetStorage, stubStorage, type FakeDocument } from "./dom-stub.ts";

/**
 * The per-article summary is the only place the reader sees its own weak words and grammar,
 * so these tests drive the real entry point and check what actually lands on screen.
 */

const calls: Array<{ method: string; url: string; body: unknown }> = [];
const spoken: string[] = [];

function jsonResponse(payload: unknown): Response {
	return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
	resetStorage();
	calls.length = 0;
	spoken.length = 0;
	const scope = globalThis as Record<string, unknown>;
	scope.speechSynthesis = {
		cancel: () => {},
		getVoices: () => [{ lang: "en-US", name: "American" }],
		speak: (utterance: { text: string }) => spoken.push(utterance.text),
	};
	scope.SpeechSynthesisUtterance = function (this: Record<string, unknown>, text: string) {
		this.text = text;
		this.lang = "";
		this.rate = 1;
		this.pitch = 1;
		this.voice = undefined;
	};
	vi.stubGlobal("fetch", async (input: unknown, init?: { body?: string; method?: string }) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		const body = init?.body ? JSON.parse(init.body) : undefined;
		calls.push({ method, url, body });
		if (url.includes("/api/lookup")) {
			const words = (body as { words?: string[] }).words ?? [];
			return jsonResponse({
				entries: Object.fromEntries(
					words.map((word: string) => [word, { pos: "adj.", meaning: `释义-${word}`, ipa: `/${word}/` }]),
				),
			});
		}
		if (url.includes("/api/analyze")) {
			return jsonResponse({ official: "宁静的图书馆邀你驻足。", analysis: "时态用错:这里应该用一般现在时,而不是过去时。" });
		}
		if (url.includes("/api/grammar-review")) return jsonResponse({ points: [{ key: "tense", label: "时态", note: "过去时误用", count: 2 }] });
		return jsonResponse({ ok: true });
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
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

async function settle(): Promise<void> {
	for (let index = 0; index < 14; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function boot(): Promise<void> {
	vi.resetModules();
	await import("../web/main.ts");
	await settle();
}

function byId(doc: FakeDocument, id: string): FakeElement {
	const found = doc.body.querySelector(`#${id}`);
	if (!found) throw new Error(`missing #${id}`);
	return found;
}

function summary(doc: FakeDocument): FakeElement {
	return byId(doc, "summary");
}

async function openReaderWith(text: string): Promise<FakeDocument> {
	const doc = install();
	await boot();
	byId(doc, "article-grid").querySelectorAll(".article-card--new")[0].fire("click");
	await settle();
	byId(doc, "article-input").value = text;
	byId(doc, "confirm-button").fire("click");
	await settle();
	return doc;
}

async function clickWord(doc: FakeDocument, index: number): Promise<void> {
	byId(doc, "article").querySelectorAll(".word")[index].fire("click");
	await settle();
}

describe("weak words", () => {
	it("lists only the words clicked in this article, most clicked first", async () => {
		const doc = await openReaderWith("Serene books. Serene papers. Library shelves.");
		await clickWord(doc, 0); // Serene
		await clickWord(doc, 1); // books
		await clickWord(doc, 2); // Serene again

		const rows = summary(doc).querySelectorAll(".weak-row");
		expect(rows.map((row) => row.getAttribute("data-word"))).toEqual(["serene", "books"]);
	});

	it("shows the click count on every weak word", async () => {
		const doc = await openReaderWith("Serene library.");
		await clickWord(doc, 0);
		expect(summary(doc).querySelectorAll(".weak-row__count")[0].textContent).toBe("1");

		await clickWord(doc, 0);
		expect(summary(doc).querySelectorAll(".weak-row__count")[0].textContent).toBe("2");
	});

	it("speaks the word when its phonetic is clicked", async () => {
		const doc = await openReaderWith("A serene library.");
		await clickWord(doc, 1);
		spoken.length = 0;
		summary(doc).querySelectorAll(".weak-row__ipa")[0].fire("click");
		expect(spoken).toEqual(["serene"]);
	});

	it("jumps to the word in the article when the word itself is clicked", async () => {
		const doc = await openReaderWith("A serene library.");
		await clickWord(doc, 1);
		const word = summary(doc).querySelectorAll(".weak-row__word")[0];
		word.fire("click");
		await settle();
		// The flashed element carries the highlight class, which is how a jump is observable.
		const flashed = byId(doc, "article").querySelectorAll(".word--flash");
		expect(flashed.length).toBeGreaterThan(0);
	});

	it("shows the part of speech and the Chinese meaning under the word", async () => {
		const doc = await openReaderWith("A serene library.");
		await clickWord(doc, 1);

		const gloss = summary(doc).querySelectorAll(".weak-row__gloss")[0];
		expect(gloss.getAttribute("data-pending")).toBeUndefined();
		expect(gloss.textContent).toBe("adj. 释义-serene");
		// The full gloss stays reachable even once the display is clipped.
		expect(gloss.title).toBe("adj. 释义-serene");
	});

	it("says so when nothing was clicked yet", async () => {
		const doc = await openReaderWith("A serene library.");
		expect(summary(doc).textValue).toContain("这一篇还没有查过词");
	});
});

describe("grammar weaknesses", () => {
	it("explains how to produce the section when there is no grading yet", async () => {
		const doc = await openReaderWith("A serene library.");
		expect(summary(doc).textValue).toContain("还没有发现语法薄弱点");
	});

	it("renders the weakness list the server returns", async () => {
		const doc = await openReaderWith("A serene library.");
		const panel = byId(doc, "article").querySelectorAll(".sentence__number")[0];
		panel.fire("click");
		await settle();

		const panelEl = byId(doc, "article").querySelectorAll(".panel")[0];
		panelEl.querySelectorAll(".panel__input")[0].value = "一个平静的图书馆邀请你逗留。";
		panelEl.querySelectorAll(".panel__button--send")[0].fire("click");
		for (let index = 0; index < 6; index += 1) await settle();

		const points = summary(doc).querySelectorAll(".grammar-item");
		expect(points).toHaveLength(1);
		expect(points[0].textValue).toContain("时态");
		expect(points[0].textValue).toContain("×2");
	});

	it("labels the section as per-article", async () => {
		const doc = await openReaderWith("A serene library.");
		expect(summary(doc).textValue).toContain("只根据本篇批改归纳");
	});
});