import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { speak, type SpeechWindow } from "../web/speech.ts";
import { FakeElement, FakeHtmlElement, createDocument, resetStorage, stubStorage, type FakeDocument } from "./dom-stub.ts";

/**
 * Pronunciation is exercised through the real entry point: clicking a word must speak it,
 * cancel whatever was playing, and stay silent instead of throwing when the browser has no
 * speech engine.
 */

interface Spoken {
	text: string;
	lang: string;
	rate: number;
	voice: string | undefined;
}

function installSpeech(voices: Array<{ lang: string; name: string }>): {
	view: SpeechWindow;
	spoken: Spoken[];
	cancelled: number;
} {
	const spoken: Spoken[] = [];
	let cancelled = 0;
	const view: SpeechWindow = {
		speechSynthesis: {
			cancel: () => {
				cancelled += 1;
			},
			getVoices: () => voices,
			speak: (utterance: unknown) => spoken.push(utterance as Spoken),
		},
		SpeechSynthesisUtterance: function (this: unknown, text: string) {
			return {
				text,
				lang: "",
				rate: 1,
				pitch: 1,
				voice: undefined,
			} as unknown;
		} as unknown as new (text: string) => { lang: string; rate: number; pitch: number; voice?: unknown },
	};
	return { view, spoken, get cancelled() { return cancelled; } } as never;
}

beforeEach(() => {
	resetStorage();
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
	for (let index = 0; index < 12; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function boot(doc: FakeDocument): Promise<void> {
	vi.resetModules();
	await import("../web/main.ts");
	await settle();
	byId(doc, "article-grid").querySelectorAll(".article-card--new")[0].fire("click");
	await settle();
}

function byId(doc: FakeDocument, id: string): FakeElement {
	const found = doc.body.querySelector(`#${id}`);
	if (!found) throw new Error(`missing #${id}`);
	return found;
}

async function renderArticle(doc: FakeDocument, text: string): Promise<void> {
	byId(doc, "article-input").value = text;
	byId(doc, "confirm-button").fire("click");
	await settle();
}

describe("speak", () => {
	it("speaks the text with a sensible rate", () => {
		const harness = installSpeech([{ lang: "en-GB", name: "British" }]);
		speak("serene", harness.view);
		expect(harness.spoken).toHaveLength(1);
		expect(harness.spoken[0].text).toBe("serene");
		expect(harness.spoken[0].rate).toBeCloseTo(0.95);
	});

	it("prefers en-US, then en-GB, then any English voice", () => {
		const all = installSpeech([
			{ lang: "de-DE", name: "German" },
			{ lang: "en-AU", name: "Australian" },
			{ lang: "en-GB", name: "British" },
			{ lang: "en-US", name: "American" },
		]);
		speak("serene", all.view);
		expect(all.spoken[0].lang).toBe("en-US");

		const withoutUs = installSpeech([
			{ lang: "de-DE", name: "German" },
			{ lang: "en-GB", name: "British" },
		]);
		speak("serene", withoutUs.view);
		expect(withoutUs.spoken[0].lang).toBe("en-GB");

		const anyEnglish = installSpeech([
			{ lang: "de-DE", name: "German" },
			{ lang: "en-AU", name: "Australian" },
		]);
		speak("serene", anyEnglish.view);
		expect(anyEnglish.spoken[0].lang).toBe("en-AU");
	});

	it("falls back to en-US when no English voice is installed", () => {
		const onlyGerman = installSpeech([{ lang: "de-DE", name: "German" }]);
		speak("serene", onlyGerman.view);
		expect(onlyGerman.spoken[0].lang).toBe("en-US");
	});

	it("cancels the previous utterance before speaking again", () => {
		const harness = installSpeech([{ lang: "en-US", name: "American" }]);
		speak("first", harness.view);
		speak("second", harness.view);
		expect(harness.cancelled).toBe(2);
		expect(harness.spoken.map((item) => item.text)).toEqual(["first", "second"]);
	});

	it("ignores blank input", () => {
		const harness = installSpeech([{ lang: "en-US", name: "American" }]);
		speak("   ", harness.view);
		expect(harness.spoken).toHaveLength(0);
	});

	it("does nothing when the engine is missing", () => {
		expect(() => speak("serene", {})).not.toThrow();
		expect(() => speak("serene", { speechSynthesis: { speak: () => {}, cancel: () => {}, getVoices: () => [] } })).not.toThrow();
	});
});

describe("clicking a word speaks it", () => {
	it("speaks the clicked word and shows the phonetics in the card", async () => {
		const harness = installSpeech([{ lang: "en-US", name: "American" }]);
		vi.stubGlobal("fetch", async (input: unknown, init?: { body?: string }) => {
			const url = String(input);
			if (url.includes("/api/lookup")) {
				const words = JSON.parse(init?.body ?? "{}").words ?? [];
				return new Response(
					JSON.stringify({
						entries: Object.fromEntries(words.map((word: string) => [word, { pos: "adj.", meaning: "宁静的", ipa: "/səˈriːn/" }])),
					}),
					{ status: 200 },
				);
			}
			return new Response("{}", { status: 200 });
		});

		const doc = install();
		// speak() reads the engine off globalThis, so the stub has to live there.
		const scope = globalThis as Record<string, unknown>;
		scope.speechSynthesis = harness.view.speechSynthesis;
		scope.SpeechSynthesisUtterance = harness.view.SpeechSynthesisUtterance;
		await boot(doc);
		await renderArticle(doc, "A serene library.");

		byId(doc, "article").querySelectorAll(".word")[1].fire("click");
		await settle();

		expect(harness.spoken.map((item) => item.text)).toContain("serene");
		const card = doc.body.querySelector(".popup");
		expect(card?.querySelectorAll(".popup__body")[0].textContent).toBe("/səˈriːn/ adj. 宁静的");
	});
});