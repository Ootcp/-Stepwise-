import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeElement, FakeHtmlElement, createDocument, resetStorage, stubStorage, type FakeDocument } from "./dom-stub.ts";
import { READING_CLASS, READING_SENTENCE_CLASS } from "../web/sentence-reader.ts";
import { speakSequence, type SpeechWindow } from "../web/speech.ts";

/**
 * Reading a sentence aloud.
 *
 * The engine is stubbed, so the tests drive the boundary events by hand: that is the only
 * way to check that a character offset turns into the right word, and it is also the only
 * honest way to check that a missing boundary does not break the reading.
 */

interface Utterance {
	text: string;
	lang: string;
	rate: number;
	voice: unknown;
	onboundary?: ((event: { charIndex: number }) => void) | null;
	onend?: (() => void) | null;
	onerror?: (() => void) | null;
}

interface Harness {
	view: SpeechWindow;
	spoken: Utterance[];
	cancelled: number;
}

function installSpeech(): Harness {
	const spoken: Utterance[] = [];
	let cancelled = 0;
	const view: SpeechWindow = {
		speechSynthesis: {
			cancel: () => {
				cancelled += 1;
			},
			getVoices: () => [{ lang: "en-US", name: "American" }],
			speak: (utterance: unknown) => spoken.push(utterance as Utterance),
		},
		SpeechSynthesisUtterance: function (this: unknown, text: string) {
			return {
				text,
				lang: "",
				rate: 1,
				voice: undefined,
				onboundary: null,
				onend: null,
				onerror: null,
			} as unknown as new (text: string) => {
				lang: string;
				rate: number;
				pitch: number;
				voice?: unknown;
				onboundary?: ((event: { charIndex: number }) => void) | null;
				onend?: (() => void) | null;
				onerror?: ((event: unknown) => void) | null;
			};
		} as unknown as new (text: string) => {
			lang: string;
			rate: number;
			pitch: number;
			voice?: unknown;
			onboundary?: ((event: { charIndex: number }) => void) | null;
			onend?: (() => void) | null;
			onerror?: ((event: unknown) => void) | null;
		},
	};
	return { view, spoken, get cancelled() { return cancelled; } } as never;
}

beforeEach(() => {
	resetStorage();
	vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
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

/**
 * Lets everything that is already queued run.
 *
 * Under fake timers a plain await would never resolve — the clock does not move on its own
 * — so the clock is advanced instead. Under real timers it is a short wait.
 */
async function settle(): Promise<void> {
	if (vi.isFakeTimers()) {
		await vi.advanceTimersByTimeAsync(0);
		return;
	}
	for (let index = 0; index < 12; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function byId(doc: FakeDocument, id: string): FakeElement {
	const found = doc.body.querySelector(`#${id}`);
	if (!found) throw new Error(`missing #${id}`);
	return found;
}

async function boot(doc: FakeDocument, text: string): Promise<void> {
	vi.resetModules();
	await import("../web/main.ts");
	await settle();
	byId(doc, "article-grid").querySelectorAll(".article-card--new")[0].fire("click");
	await settle();
	byId(doc, "article-input").value = text;
	byId(doc, "confirm-button").fire("click");
	await settle();
}

function sentences(doc: FakeDocument): FakeElement[] {
	return byId(doc, "article").querySelectorAll(".sentence");
}

function speaker(doc: FakeDocument, index: number): FakeElement {
	const sentence = sentences(doc)[index];
	const found = sentence.querySelectorAll(".sentence__speak")[0];
	if (!found) throw new Error(`no speaker on sentence ${index}`);
	return found;
}

describe("speaking a stretch of text", () => {
	it("reports the words the engine reaches", () => {
		const harness = installSpeech();
		const seen: number[] = [];
		speakSequence("one two three", { onWord: (charIndex) => seen.push(charIndex) }, harness.view);
		expect(harness.spoken).toHaveLength(1);
		harness.spoken[0].onboundary?.({ charIndex: 0 });
		harness.spoken[0].onboundary?.({ charIndex: 4 });
		expect(seen).toEqual([0, 4]);
	});

	it("reads a whole sentence at a slower rate than a single word", () => {
		const harness = installSpeech();
		speakSequence("A whole sentence.", {}, harness.view);
		expect(harness.spoken[0].rate).toBeLessThan(0.95);
		expect(harness.spoken[0].text).toBe("A whole sentence.");
	});

	it("does not cancel the previous utterance when the caller says not to", () => {
		// Chrome drops an utterance queued right after a cancel(), so a chain of sentences
		// has to let each one end on its own.
		const harness = installSpeech();
		speakSequence("first", {}, harness.view);
		speakSequence("second", { interrupt: false }, harness.view);
		expect(harness.cancelled).toBe(1);
	});
});

describe("reading a sentence in the article", () => {
	// The reader waits a moment for a possible second click before it reads, so these tests
	// run on a clock they can move.
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("says the sentence when its speaker is clicked", async () => {
		const harness = installSpeech();
		const scope = globalThis as Record<string, unknown>;
		scope.speechSynthesis = harness.view.speechSynthesis;
		scope.SpeechSynthesisUtterance = harness.view.SpeechSynthesisUtterance;

		const doc = install();
		await boot(doc, "The morning light came slowly. The river was quiet.");

		speaker(doc, 0).fire("click");
		await vi.advanceTimersByTimeAsync(400);

		expect(harness.spoken).toHaveLength(1);
		expect(harness.spoken[0].text).toBe("The morning light came slowly.");
	});

	it("lights the word the engine reaches", async () => {
		const harness = installSpeech();
		const scope = globalThis as Record<string, unknown>;
		scope.speechSynthesis = harness.view.speechSynthesis;
		scope.SpeechSynthesisUtterance = harness.view.SpeechSynthesisUtterance;

		const doc = install();
		await boot(doc, "The morning light came slowly.");

		speaker(doc, 0).fire("click");
		await vi.advanceTimersByTimeAsync(400);

		const words = sentences(doc)[0].querySelectorAll(".word");
		// "morning" starts at character 4 of the sentence.
		harness.spoken[0].onboundary?.({ charIndex: 4 });
		expect(words[1].classList.contains(READING_CLASS)).toBe(true);
		expect(words[0].classList.contains(READING_CLASS)).toBe(false);
		expect(sentences(doc)[0].classList.contains(READING_SENTENCE_CLASS)).toBe(true);

		// The next word takes the light from the one before.
		harness.spoken[0].onboundary?.({ charIndex: 12 });
		expect(words[1].classList.contains(READING_CLASS)).toBe(false);
		expect(words[2].classList.contains(READING_CLASS)).toBe(true);
	});

	it("still reads the sentence when the engine reports no words", async () => {
		// Safari never sends a boundary event. The sentence has to be read all the same, and
		// the number has to say it is being read.
		const harness = installSpeech();
		const scope = globalThis as Record<string, unknown>;
		scope.speechSynthesis = harness.view.speechSynthesis;
		scope.SpeechSynthesisUtterance = harness.view.SpeechSynthesisUtterance;

		const doc = install();
		await boot(doc, "The morning light came slowly.");

		speaker(doc, 0).fire("click");
		await vi.advanceTimersByTimeAsync(400);

		expect(harness.spoken).toHaveLength(1);
		expect(sentences(doc)[0].classList.contains(READING_SENTENCE_CLASS)).toBe(true);
		for (const word of sentences(doc)[0].querySelectorAll(".word")) {
			expect(word.classList.contains(READING_CLASS)).toBe(false);
		}
	});

	it("keeps reading the sentences below on a double click", async () => {
		const harness = installSpeech();
		const scope = globalThis as Record<string, unknown>;
		scope.speechSynthesis = harness.view.speechSynthesis;
		scope.SpeechSynthesisUtterance = harness.view.SpeechSynthesisUtterance;

		const doc = install();
		await boot(doc, "First sentence here. Second sentence here.");

		const button = speaker(doc, 0);
		button.fire("click");
		button.fire("dblclick");
		await vi.advanceTimersByTimeAsync(400);

		expect(harness.spoken).toHaveLength(1);
		expect(harness.spoken[0].text).toBe("First sentence here.");

		// The first sentence ends, and the second one starts on its own.
		harness.spoken[0].onend?.();
		await settle();
		expect(harness.spoken).toHaveLength(2);
		expect(harness.spoken[1].text).toBe("Second sentence here.");
	});

	it("keeps reading on Shift and click, which a keyboard can reach", async () => {
		// A double click cannot be done from a keyboard, so Shift and click does the same thing.
		const harness = installSpeech();
		const scope = globalThis as Record<string, unknown>;
		scope.speechSynthesis = harness.view.speechSynthesis;
		scope.SpeechSynthesisUtterance = harness.view.SpeechSynthesisUtterance;

		const doc = install();
		await boot(doc, "First sentence here. Second sentence here.");

		speaker(doc, 0).fire("click", undefined, { shiftKey: true });
		await vi.advanceTimersByTimeAsync(400);

		expect(harness.spoken).toHaveLength(1);
		harness.spoken[0].onend?.();
		await settle();
		expect(harness.spoken).toHaveLength(2);
		expect(harness.spoken[1].text).toBe("Second sentence here.");
	});

	it("does not start the sentence over when a second click arrives", async () => {
		// The first click of a double click has already begun the sentence by the time the
		// second one lands. Restarting it would cut the sentence off in the middle.
		const harness = installSpeech();
		const scope = globalThis as Record<string, unknown>;
		scope.speechSynthesis = harness.view.speechSynthesis;
		scope.SpeechSynthesisUtterance = harness.view.SpeechSynthesisUtterance;

		const doc = install();
		await boot(doc, "First sentence here. Second sentence here.");

		const button = speaker(doc, 0);
		button.fire("click");
		await settle();
		expect(harness.spoken).toHaveLength(1);

		// The second click of the pair, and then the double click itself.
		button.fire("click");
		button.fire("dblclick");
		await settle();

		// The sentence was not read a second time; it just carries on to the next one.
		expect(harness.spoken).toHaveLength(1);
		harness.spoken[0].onend?.();
		await settle();
		expect(harness.spoken).toHaveLength(2);
		expect(harness.spoken[1].text).toBe("Second sentence here.");
	});

	it("reads the sentence inside the click, not after a wait", async () => {
		// Chrome only lets a page speak while it still holds the user's gesture. A reader
		// that waited even a moment before calling the engine would be refused, and the
		// refusal is silent.
		const harness = installSpeech();
		const scope = globalThis as Record<string, unknown>;
		scope.speechSynthesis = harness.view.speechSynthesis;
		scope.SpeechSynthesisUtterance = harness.view.SpeechSynthesisUtterance;

		const doc = install();
		await boot(doc, "First sentence here.");

		speaker(doc, 0).fire("click");
		// No clock movement at all: the engine has to be called by the click itself.
		expect(harness.spoken).toHaveLength(1);
	});

	it("reads the other sentence when one is already being read", async () => {
		// Cancelling an utterance makes the engine report its end, and that report arrives
		// after the next reading has started. If the old report were allowed to finish the
		// new reading, the reader would go silent and the highlight would vanish.
		const harness = installSpeech();
		const scope = globalThis as Record<string, unknown>;
		scope.speechSynthesis = harness.view.speechSynthesis;
		scope.SpeechSynthesisUtterance = harness.view.SpeechSynthesisUtterance;

		const doc = install();
		await boot(doc, "First sentence here. Second sentence here.");

		speaker(doc, 0).fire("click");
		await settle();
		expect(harness.spoken).toHaveLength(1);
		expect(sentences(doc)[0].classList.contains(READING_SENTENCE_CLASS)).toBe(true);

		// The other sentence is asked for while the first one is still going.
		speaker(doc, 1).fire("click");
		await settle();
		expect(harness.spoken).toHaveLength(2);
		expect(harness.spoken[1].text).toBe("Second sentence here.");

		// The first utterance now reports its end. It belongs to a reading that is over, so
		// it must not take the new reading down with it.
		harness.spoken[0].onend?.();
		await settle();
		expect(sentences(doc)[1].classList.contains(READING_SENTENCE_CLASS)).toBe(true);

		// And the second one still carries on to the sentence below it.
		harness.spoken[1].onend?.();
		await settle();
		expect(harness.spoken).toHaveLength(2);
	});

	it("reads only the one sentence on a single click", async () => {
		const harness = installSpeech();
		const scope = globalThis as Record<string, unknown>;
		scope.speechSynthesis = harness.view.speechSynthesis;
		scope.SpeechSynthesisUtterance = harness.view.SpeechSynthesisUtterance;

		const doc = install();
		await boot(doc, "First sentence here. Second sentence here.");

		speaker(doc, 0).fire("click");
		await vi.advanceTimersByTimeAsync(400);
		expect(harness.spoken).toHaveLength(1);

		harness.spoken[0].onend?.();
		await settle();
		expect(harness.spoken).toHaveLength(1);
	});

	it("stops on the space bar", async () => {
		const harness = installSpeech();
		const scope = globalThis as Record<string, unknown>;
		scope.speechSynthesis = harness.view.speechSynthesis;
		scope.SpeechSynthesisUtterance = harness.view.SpeechSynthesisUtterance;

		const doc = install();
		await boot(doc, "First sentence here. Second sentence here.");

		speaker(doc, 0).fire("click", undefined, { shiftKey: true });
		await vi.advanceTimersByTimeAsync(400);
		expect(harness.spoken).toHaveLength(1);

		doc.fire("keydown", { key: " " });
		await settle();

		expect(harness.cancelled).toBeGreaterThan(0);
		// Nothing is read after the space bar.
		const count = harness.spoken.length;
		harness.spoken[0].onend?.();
		await settle();
		expect(harness.spoken).toHaveLength(count);
	});

	it("leaves the space bar alone inside the translation box", async () => {
		// The practice panel has a textarea. A space there is a space, not a stop.
		const harness = installSpeech();
		const scope = globalThis as Record<string, unknown>;
		scope.speechSynthesis = harness.view.speechSynthesis;
		scope.SpeechSynthesisUtterance = harness.view.SpeechSynthesisUtterance;

		const doc = install();
		await boot(doc, "First sentence here. Second sentence here.");

		speaker(doc, 0).fire("click", undefined, { shiftKey: true });
		await vi.advanceTimersByTimeAsync(400);

		const textarea = doc.createElement("textarea");
		textarea.attributes.class = "panel__input";
		doc.body.append(textarea);

		doc.fire("keydown", { key: " ", target: textarea });
		await settle();

		const count = harness.spoken.length;
		harness.spoken[0].onend?.();
		await settle();
		expect(harness.spoken).toHaveLength(count + 1);
	});
});
