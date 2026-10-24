import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeElement, FakeHtmlElement, createDocument, resetStorage, stubStorage, type FakeDocument } from "./dom-stub.ts";

/**
 * The spelling drill: entering it from the ledger, the prompt, the letter-by-letter reveal,
 * the keys that drive it, and the order switch that must not move the current word.
 */

const NOW = Date.now();
interface StubWord {
	word: string;
	ipa: string;
	pos: string;
	meanings: string[];
	clicks: number;
	lastSeenAt: number;
	misses?: number;
}

const LEDGER: StubWord[] = [
	{ word: "study", ipa: "/'stʌdi/", pos: "n.", meanings: ["学习", "研究"], clicks: 6, lastSeenAt: NOW - 60_000, misses: 1 },
	{ word: "law", ipa: "/lɔː/", pos: "n.", meanings: ["法律"], clicks: 3, lastSeenAt: NOW - 86_400_000 * 10, misses: 4 },
	{ word: "apply", ipa: "", pos: "", meanings: [], clicks: 1, lastSeenAt: NOW - 86_400_000 * 3, misses: 0 },
];

let ledger: StubWord[] = LEDGER;
let syllablePayload: Record<string, string[]> = { study: ["stud", "y"], law: ["l", "aw"], apply: ["ap", "ply"] };
let syllablesFail = false;
const spoken: string[] = [];
const reported: Array<{ word: string; correct: boolean }> = [];
let storage: ReturnType<typeof stubStorage>;

function jsonResponse(payload: unknown): Response {
	return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
	resetStorage();
	ledger = LEDGER;
	syllablePayload = { study: ["stud", "y"], law: ["l", "aw"], apply: ["ap", "ply"] };
	syllablesFail = false;
	spoken.length = 0;
	reported.length = 0;

	vi.stubGlobal("fetch", async (input: unknown, init?: { method?: string; body?: string }) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		if (url === "/api/words") {
			const words = Object.fromEntries(
				ledger.map((entry) => [
					entry.word,
					{
						word: entry.word,
						ipa: entry.ipa,
						pos: entry.pos,
						meanings: entry.meanings,
						clicks: entry.clicks,
						firstSeenAt: entry.lastSeenAt,
						lastSeenAt: entry.lastSeenAt,
					},
				]),
			);
			return jsonResponse({ version: 1, words });
		}
		if (url === "/api/practice") {
			const words = Object.fromEntries(
				ledger
					.filter((entry) => (entry.misses ?? 0) > 0)
					.map((entry) => [
						entry.word,
						{
							word: entry.word,
							attempts: (entry.misses ?? 0) + 1,
							misses: entry.misses ?? 0,
							lastWrongAt: entry.lastSeenAt,
							lastCorrectAt: 0,
							updatedAt: entry.lastSeenAt,
						},
					]),
			);
			return jsonResponse({ version: 1, words });
		}
		if (url === "/api/practice/record") {
			reported.push(JSON.parse(init?.body ?? "{}") as { word: string; correct: boolean });
			return jsonResponse({ record: { word: "study", attempts: 1, misses: 0, lastWrongAt: 0, lastCorrectAt: NOW, updatedAt: NOW } });
		}
		if (url === "/api/syllables") {
			if (syllablesFail) return new Response(JSON.stringify({ error: "未配置 API Key" }), { status: 503 });
			return jsonResponse({ words: syllablePayload });
		}
		if (url.startsWith("/api/articles") && method === "GET") return jsonResponse({ articles: [] });
		if (url === "/api/health") return jsonResponse({ ok: true, dictionary: "ecdict", llmModel: "x", ecdictPath: null });
		return jsonResponse({ ok: true });
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function install(hash?: string): FakeDocument {
	const doc = createDocument();
	const scope = globalThis as Record<string, unknown>;
	scope.document = doc;
	storage = stubStorage();
	scope.localStorage = storage;
	scope.Element = FakeElement;
	scope.HTMLElement = FakeHtmlElement;
	scope.speechSynthesis = {
		cancel: () => {},
		getVoices: () => [],
		speak: (utterance: { text: string }) => spoken.push(utterance.text),
	};
	scope.SpeechSynthesisUtterance = function (this: unknown, text: string) {
		return { text, lang: "", rate: 1, pitch: 1, voice: undefined };
	};
	if (hash) {
		(doc.defaultView as unknown as { history: { location: { hash: string } } }).history.location.hash = hash;
	}
	return doc;
}

async function settle(): Promise<void> {
	for (let index = 0; index < 12; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function boot(hash?: string): Promise<FakeDocument> {
	const doc = install(hash);
	vi.resetModules();
	await import("../web/main.ts");
	await settle();
	return doc;
}

/** Landing → library → ledger → drill, the way a reader gets there. */
async function enterDrill(): Promise<FakeDocument> {
	const doc = await boot();
	byId(doc, "home-enter").fire("click");
	await settle();
	byId(doc, "words-button").fire("click");
	await settle();
	byId(doc, "words-drill").fire("click");
	await settle();
	return doc;
}

function byId(doc: FakeDocument, id: string): FakeElement {
	const found = doc.body.querySelector(`#${id}`);
	if (!found) throw new Error(`missing #${id}`);
	return found;
}

/** The reveal is one grid: cells carry their row as a class so both rows share the columns. */
function cells(doc: FakeDocument, row: "target" | "answer"): FakeElement[] {
	return byId(doc, "spell-stage").querySelectorAll(`.spell__cell--${row}`);
}

function states(doc: FakeDocument, row: "target" | "answer" = "answer"): string[] {
	return cells(doc, row).map((cell) => cell.getAttribute("data-state") ?? "");
}

function type(doc: FakeDocument, text: string): void {
	const answer = byId(doc, "spell-answer");
	answer.value = text;
	// Real typing fires `input`; that is what dismisses a reveal.
	answer.fire("input", answer);
}

function press(doc: FakeDocument, key: string, init: Record<string, unknown> = {}): boolean {
	let prevented = false;
	const answer = byId(doc, "spell-answer");
	answer.fire("keydown", answer, { key, isComposing: false, preventDefault: () => (prevented = true), ...init });
	return prevented;
}

function submit(doc: FakeDocument): void {
	byId(doc, "spell-submit").fire("click");
}

describe("entering the drill", () => {
	it("opens from the ledger and records #/spell", async () => {
		const doc = await enterDrill();
		expect(doc.documentElement.dataset.view).toBe("spell");
		expect(byId(doc, "spell-view").hidden).toBe(false);
		expect(byId(doc, "words-view").hidden).toBe(true);
		expect((doc.defaultView as unknown as { history: { location: { hash: string } } }).history.location.hash).toBe("#/spell");
		expect((doc as unknown as { title: string }).title).toBe("拾级 · 拼写练习");
	});

	it("restores the page from a direct #/spell load", async () => {
		const doc = await boot("#/spell");
		expect(doc.documentElement.dataset.view).toBe("spell");
		expect(byId(doc, "spell-meaning").textContent).toBe("学习、研究");
		expect(byId(doc, "spell-progress").textContent).toContain("第 1 / 3 题");
	});

	it("goes back to the ledger", async () => {
		const doc = await enterDrill();
		byId(doc, "spell-back").fire("click");
		await settle();
		expect(doc.documentElement.dataset.view).toBe("words");
	});

	it("shows the prompt for the most recently looked-up word", async () => {
		const doc = await enterDrill();
		expect(byId(doc, "spell-meaning").textContent).toBe("学习、研究");
		expect(byId(doc, "spell-pos").textContent).toBe("n.");
		expect(byId(doc, "spell-ipa").textContent).toBe("/'stʌdi/");
	});

	it("says so when the dictionary has no gloss", async () => {
		const doc = await boot("#/spell");
		// 最近 puts study first and apply second; apply has neither gloss nor IPA here.
		press(doc, "2");
		await settle();
		expect(byId(doc, "spell-meaning").textContent).toBe("词典暂未收录释义");
		expect(byId(doc, "spell-meaning").getAttribute("data-missing")).toBe("true");
		expect(byId(doc, "spell-ipa").textContent).toBe("");
	});
});

describe("submitting an answer", () => {
	it("paints every letter green and hands the empty field back when the answer is right", async () => {
		const doc = await enterDrill();
		type(doc, "study");
		submit(doc);
		await settle();

		expect(byId(doc, "spell-stage").hidden).toBe(false);
		// A correct answer needs no correction row, so no target cells are written at all.
		expect(cells(doc, "target")).toHaveLength(0);
		expect(states(doc)).toEqual(["right", "right", "right", "right", "right"]);
		expect(byId(doc, "spell-result").textContent).toContain("拼对了");
		expect(byId(doc, "spell-result").getAttribute("data-tone")).toBe("right");
		// The scored word is out of the field and the keyboard is back on it.
		expect(byId(doc, "spell-answer").value).toBe("");
		expect(byId(doc, "spell-answer").focused).toBe(true);
		expect(reported).toEqual([{ word: "study", correct: true }]);
	});

	it("paints the wrong letter red and puts the divided word above it", async () => {
		const doc = await enterDrill();
		type(doc, "skudy");
		press(doc, "Enter");
		await settle();

		// One grid, two rows: the row classes carry the row, so both share the column widths.
		expect((byId(doc, "spell-stage") as unknown as { style: Record<string, string> }).style["--cols"]).toBe("6");
		expect(states(doc, "target")).toEqual(["plain", "plain", "plain", "plain", "sep", "plain"]);
		expect(states(doc, "answer")).toEqual(["right", "wrong", "right", "right", "blank", "right"]);
		expect(cells(doc, "target").map((cell) => cell.textContent)).toEqual(["s", "t", "u", "d", "·", "y"]);
		expect(byId(doc, "spell-result").textContent).toContain("错 1 / 5 个字母");
		expect(byId(doc, "spell-result").textContent).toContain("stud·y");
		expect(byId(doc, "spell-legend").hidden).toBe(false);
		expect(reported).toEqual([{ word: "study", correct: false }]);
	});

	it("marks letters the answer left out and letters it added", async () => {
		const doc = await enterDrill();
		type(doc, "studyy");
		submit(doc);
		await settle();

		// study is divided stud·y, so the separator column is blank on the answer row.
		expect(cells(doc, "answer").map((cell) => cell.textContent)).toEqual(["s", "t", "u", "d", "", "y", "y"]);
		expect(cells(doc, "target").map((cell) => cell.textContent)).toEqual(["s", "t", "u", "d", "·", "y", ""]);
		const extra = cells(doc, "answer")[6];
		expect(extra.getAttribute("data-state")).toBe("extra");
		expect(extra.getAttribute("data-mark")).toBe("多");

		type(doc, "stu");
		submit(doc);
		await settle();
		const answer = cells(doc, "answer");
		// The gap stays in the reader's own line: an empty dashed slot, marked 缺.
		expect(answer[3].getAttribute("data-state")).toBe("missing");
		expect(answer[3].textContent).toBe("");
		expect(answer[3].getAttribute("data-mark")).toBe("缺");
		expect(cells(doc, "target")[3].textContent).toBe("d");
		expect(cells(doc, "target")[3].getAttribute("data-state")).toBe("plain");
	});

	it("shows the word undivided when the syllable call fails", async () => {
		syllablesFail = true;
		const doc = await enterDrill();
		type(doc, "stud");
		submit(doc);
		await settle();

		expect(states(doc, "target")).toEqual(["plain", "plain", "plain", "plain", "plain"]);
		expect(states(doc, "answer")).toEqual(["right", "right", "right", "right", "missing"]);
		expect(byId(doc, "spell-result").textContent).toContain("正确拼写 study");
	});

	it("refuses to score an empty field", async () => {
		const doc = await enterDrill();
		submit(doc);
		await settle();
		expect(byId(doc, "spell-result").textContent).toContain("先拼一个字母");
		expect(byId(doc, "spell-stage").hidden).toBe(true);
		expect(reported).toEqual([]);
	});

	it("counts the round", async () => {
		const doc = await enterDrill();
		type(doc, "study");
		submit(doc);
		await settle();
		expect(byId(doc, "spell-session").textContent).toBe("本轮 已提交 1 · 对 1 · 错 0");

		press(doc, "a");
		type(doc, "law");
		byId(doc, "spell-next").fire("click");
		await settle();
		type(doc, "laww");
		byId(doc, "spell-submit").fire("click");
		await settle();
		expect(byId(doc, "spell-session").textContent).toContain("对 1 · 错 1");
	});
});

describe("typing after a reveal", () => {
	it("clears the previous attempt and hides the correct word on the next keystroke", async () => {
		const doc = await enterDrill();
		type(doc, "skudy");
		submit(doc);
		await settle();
		expect(byId(doc, "spell-stage").hidden).toBe(false);

		press(doc, "s");
		await settle();
		expect(byId(doc, "spell-stage").hidden).toBe(true);
		expect(byId(doc, "spell-answer").value).toBe("");
		expect(byId(doc, "spell-result").textContent).toBe("");
		expect(byId(doc, "spell-answer").getAttribute("data-state")).toBeUndefined();
	});

	it("moves on with the same Enter once the word is right", async () => {
		const doc = await enterDrill();
		type(doc, "study");
		submit(doc);
		await settle();
		expect(byId(doc, "spell-progress").textContent).toContain("第 1 / 3 题");

		press(doc, "Enter");
		await settle();
		// One scored attempt, then the key that confirmed it stepped to the next card.
		expect(reported).toEqual([{ word: "study", correct: true }]);
		expect(byId(doc, "spell-progress").textContent).toContain("第 2 / 3 题");
		expect(byId(doc, "spell-stage").hidden).toBe(true);
		expect(byId(doc, "spell-answer").value).toBe("");
	});

	it("keeps a wrong word on screen when Enter is pressed again", async () => {
		const doc = await enterDrill();
		type(doc, "skudy");
		press(doc, "Enter");
		await settle();

		press(doc, "Enter");
		await settle();
		expect(byId(doc, "spell-progress").textContent).toContain("第 1 / 3 题");
		expect(reported).toEqual([{ word: "study", correct: false }]);
		// The reveal is still there to be read, and the field is empty and focused.
		expect(byId(doc, "spell-stage").hidden).toBe(false);
		expect(cells(doc, "target").length).toBeGreaterThan(0);
		expect(byId(doc, "spell-answer").value).toBe("");
		expect(byId(doc, "spell-answer").focused).toBe(true);

		// 提交 behaves the same way as Enter on a solved card.
		type(doc, "study");
		submit(doc);
		await settle();
		submit(doc);
		await settle();
		expect(byId(doc, "spell-progress").textContent).toContain("第 2 / 3 题");
	});
});

describe("keys", () => {
	it("reads the word aloud on the backquote key and on a bare Ctrl", async () => {
		const doc = await enterDrill();
		// event.key for that physical key is the character, not the code name "Backquote".
		expect(press(doc, "`")).toBe(true);
		press(doc, "~");
		press(doc, "Control", { ctrlKey: true });
		expect(spoken).toEqual(["study", "study", "study"]);
	});

	it("does not hijack Ctrl combos or held-down Ctrl repeats", async () => {
		const doc = await enterDrill();
		expect(press(doc, "2", { ctrlKey: true })).toBe(false);
		expect(press(doc, "Control", { ctrlKey: true, repeat: true })).toBe(false);
		await settle();
		expect(spoken).toEqual([]);
		expect(byId(doc, "spell-progress").textContent).toContain("第 1 / 3 题");
	});

	it("rewrites the same word on 3 or the 重写 button", async () => {
		const doc = await enterDrill();
		type(doc, "skudy");
		press(doc, "Enter");
		await settle();

		press(doc, "3");
		await settle();
		expect(byId(doc, "spell-stage").hidden).toBe(true);
		expect(byId(doc, "spell-answer").value).toBe("");
		expect(byId(doc, "spell-meaning").textContent).toBe("学习、研究");
		expect(byId(doc, "spell-progress").textContent).toContain("第 1 / 3 题");
		expect(reported).toHaveLength(1);

		type(doc, "stud");
		byId(doc, "spell-rewrite").fire("click");
		await settle();
		expect(byId(doc, "spell-answer").value).toBe("");
		expect(byId(doc, "spell-result").textContent).toContain("已清空");
		expect(byId(doc, "spell-answer").focused).toBe(true);
		// Rewriting is not an attempt: the round counter stays where it was.
		expect(byId(doc, "spell-session").textContent).toBe("本轮 已提交 1 · 对 0 · 错 1");
	});

	it("keeps the keyboard on the field after every button on the page", async () => {
		const doc = await enterDrill();
		byId(doc, "spell-next").fire("click");
		await settle();
		expect(byId(doc, "spell-answer").focused).toBe(true);

		byId(doc, "spell-prev").fire("click");
		await settle();
		expect(byId(doc, "spell-answer").focused).toBe(true);

		type(doc, "study");
		byId(doc, "spell-submit").fire("click");
		await settle();
		expect(byId(doc, "spell-answer").focused).toBe(true);

		// Clicking the reveal rows themselves also hands the keyboard back.
		byId(doc, "spell-stage").fire("click");
		await settle();
		expect(byId(doc, "spell-answer").focused).toBe(true);
	});

	it("speaks when the IPA is clicked", async () => {
		const doc = await enterDrill();
		byId(doc, "spell-ipa").fire("click");
		expect(spoken).toEqual(["study"]);
	});

	it("walks the queue on 1 and 2", async () => {
		const doc = await enterDrill();
		press(doc, "2");
		await settle();
		expect(byId(doc, "spell-meaning").textContent).toBe("词典暂未收录释义");
		expect(byId(doc, "spell-progress").textContent).toContain("第 2 / 3 题");
		expect(byId(doc, "spell-prev").disabled).toBe(false);

		press(doc, "1");
		await settle();
		expect(byId(doc, "spell-meaning").textContent).toBe("学习、研究");
	});

	it("stops at the ends instead of wrapping", async () => {
		const doc = await enterDrill();
		expect(byId(doc, "spell-prev").disabled).toBe(true);
		press(doc, "1");
		await settle();
		expect(byId(doc, "spell-progress").textContent).toContain("第 1 / 3 题");

		byId(doc, "spell-next").fire("click");
		byId(doc, "spell-next").fire("click");
		await settle();
		expect(byId(doc, "spell-next").disabled).toBe(true);
		expect(byId(doc, "spell-progress").textContent).toContain("第 3 / 3 题");
		byId(doc, "spell-next").fire("click");
		await settle();
		expect(byId(doc, "spell-progress").textContent).toContain("第 3 / 3 题");
	});

	it("leaves the caret alone while the reader is editing a half-typed answer", async () => {
		const doc = await enterDrill();
		type(doc, "stu");
		expect(press(doc, "ArrowUp")).toBe(false);
		await settle();
		expect(byId(doc, "spell-meaning").textContent).toBe("学习、研究");

		// Once the field is empty the same key navigates again.
		type(doc, "");
		expect(press(doc, "ArrowUp")).toBe(true);
		await settle();
		expect(byId(doc, "spell-progress").textContent).toContain("第 1 / 3 题");
	});

	it("ignores Enter coming from a Chinese input method", async () => {
		const doc = await enterDrill();
		type(doc, "stu");
		press(doc, "Enter", { isComposing: true });
		await settle();
		expect(reported).toEqual([]);
		expect(byId(doc, "spell-stage").hidden).toBe(true);
	});

	it("leaves Enter on another control to that control", async () => {
		const doc = await enterDrill();
		const next = byId(doc, "spell-next");
		let prevented = false;
		next.fire("keydown", next, { key: "Enter", isComposing: false, preventDefault: () => (prevented = true) });
		await settle();
		// Enter is the field's key; a focused button keeps it, and the drill does not move.
		expect(prevented).toBe(false);
		expect(byId(doc, "spell-progress").textContent).toContain("第 1 / 3 题");
		expect(reported).toEqual([]);
	});

	it("ignores browser shortcuts like Ctrl+1", async () => {
		const doc = await enterDrill();
		expect(press(doc, "2", { ctrlKey: true })).toBe(false);
		await settle();
		expect(byId(doc, "spell-meaning").textContent).toBe("学习、研究");
	});
});

describe("the order slider", () => {
	it("starts on 最近 and marks it pressed", async () => {
		const doc = await enterDrill();
		const buttons = byId(doc, "spell-order").querySelectorAll("[data-order]");
		expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false"]);
		expect(byId(doc, "spell-progress").textContent).toContain("最近");
		expect(byId(doc, "spell-order-thumb").style.transform).toBe("translateX(0%)");
	});

	it("slides the order thumb to the chosen stop", async () => {
		const doc = await enterDrill();
		byId(doc, "spell-order").querySelectorAll("[data-order]")[3].fire("click");
		await settle();
		expect(byId(doc, "spell-order-thumb").style.transform).toBe("translateX(300%)");
		byId(doc, "spell-order").querySelectorAll("[data-order]")[1].fire("click");
		await settle();
		expect(byId(doc, "spell-order-thumb").style.transform).toBe("translateX(100%)");
	});

	it("keeps the current word and only re-orders the next one", async () => {
		const doc = await enterDrill();
		// 最近: study, apply, law. Step onto apply, then change the order under it.
		press(doc, "2");
		await settle();
		expect(byId(doc, "spell-meaning").textContent).toBe("词典暂未收录释义");

		// 易错: law (4 misses), study (1), apply (none). apply moves to the last slot…
		byId(doc, "spell-order").querySelectorAll("[data-order]")[3].fire("click");
		await settle();
		expect(byId(doc, "spell-meaning").textContent).toBe("词典暂未收录释义");
		expect(byId(doc, "spell-progress").textContent).toContain("易错 · 第 3 / 3 题");

		// …so the previous card is now study rather than the study→apply it came from.
		press(doc, "1");
		await settle();
		expect(byId(doc, "spell-meaning").textContent).toBe("学习、研究");
		press(doc, "1");
		await settle();
		expect(byId(doc, "spell-meaning").textContent).toBe("法律");
	});

	it("remembers the choice for the next visit", async () => {
		const doc = await enterDrill();
		byId(doc, "spell-order").querySelectorAll("[data-order]")[2].fire("click");
		await settle();
		expect(storage.getItem("english-app:spell-order")).toBe('"alpha"');

		byId(doc, "spell-back").fire("click");
		await settle();
		byId(doc, "words-drill").fire("click");
		await settle();
		const buttons = byId(doc, "spell-order").querySelectorAll("[data-order]");
		expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "false", "true", "false"]);
		// A–Z restarts the queue at apply, and the header names the order the reader chose.
		expect(byId(doc, "spell-meaning").textContent).toBe("词典暂未收录释义");
		expect(byId(doc, "spell-progress").textContent).toContain("A–Z · 第 1 / 3 题");
	});

	it("falls back to 最近 when storage holds nonsense", async () => {
		const doc = install();
		storage.setItem("english-app:spell-order", '"nonsense"');
		vi.resetModules();
		await import("../web/main.ts");
		await settle();
		byId(doc, "home-enter").fire("click");
		await settle();
		byId(doc, "words-button").fire("click");
		await settle();
		byId(doc, "words-drill").fire("click");
		await settle();

		const buttons = byId(doc, "spell-order").querySelectorAll("[data-order]");
		expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false"]);
		expect(byId(doc, "spell-meaning").textContent).toBe("学习、研究");
	});
});

describe("empty ledger", () => {
	it("invites the reader back to the ledger when there is nothing to drill", async () => {
		ledger = [];
		const doc = await enterDrill();
		expect(byId(doc, "spell-card").hidden).toBe(true);
		expect(byId(doc, "spell-empty").hidden).toBe(false);
		expect(byId(doc, "spell-empty-title").textContent).toBe("还没有可以拼的词");

		byId(doc, "spell-empty-action").fire("click");
		await settle();
		expect(doc.documentElement.dataset.view).toBe("words");
	});
});
