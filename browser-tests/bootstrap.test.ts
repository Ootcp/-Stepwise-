import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument, FakeElement, type FakeDocument, resetStorage, stubStorage } from "./dom-stub.ts";

/**
 * Executes the real browser entry point against the DOM stub.
 *
 * The stub is installed on globalThis before main.ts is imported, so this is the same code
 * path the browser runs. It exists because a thrown error during init() silently leaves
 * every button dead, which no pure-logic test would ever catch.
 */
const calls: string[] = [];

function install(): FakeDocument {
	const doc = createDocument();
	const globals = globalThis as Record<string, unknown>;
	globals.document = doc;
	globals.localStorage = stubStorage();
	// article.ts guards delegated clicks with `target instanceof HTMLElement`, so this must
	// be the stub elements' own constructor, not a subclass of it.
	globals.HTMLElement = FakeElement;
	globals.Element = FakeElement;
	return doc;
}

async function boot(): Promise<FakeDocument> {
	const doc = install();
	vi.resetModules();
	await import("../web/main.ts");
	return doc;
}

/**
 * The app now starts on the landing page, so reader tests have to walk in first. Going
 * through the landing button and then the + card keeps the path identical to what a user does.
 */
async function bootInReader(): Promise<FakeDocument> {
	const doc = await boot();
	await settle();
	byId(doc, "home-enter").fire("click");
	await settle();
	byId(doc, "article-grid").querySelectorAll(".article-card--new")[0].fire("click");
	await settle();
	return doc;
}

function byId(doc: FakeDocument, id: string): FakeElement {
	const found = doc.body.querySelector(`#${id}`);
	if (!found) throw new Error(`missing #${id}`);
	return found;
}

beforeEach(() => {
	resetStorage();
	calls.length = 0;
	vi.stubGlobal("fetch", async (input: unknown, init?: { body?: string }) => {
		const url = String(input);
		calls.push(url);
		if (url.includes("/api/analyze")) {
			const body = JSON.parse(init?.body ?? "{}");
			const sentence = String(body.sentence ?? "");
			const parts = sentence.includes("no breakdown")
				? []
				: sentence.includes("that I bought")
				? [
						{
							w: "The book that I bought yesterday",
							r: "主",
							sub: [
								{
									w: "that I bought yesterday",
									r: "定",
									clause: true,
									sub: [
										{ w: "I", r: "主" },
										{ w: "bought", r: "谓" },
										{ w: "yesterday", r: "状" },
									],
								},
							],
						},
						{ w: "is", r: "谓" },
						{ w: "interesting", r: "表" },
						{ w: ".", r: "" },
					]
				: [
						{ w: "A serene library", r: "主" },
						{ w: "invites", r: "谓" },
						{ w: "you", r: "宾" },
						{ w: "to linger", r: "补" },
						{ w: ".", r: "" },
					];
			return jsonResponse({
				official: "参考译文内容",
				// An empty box asks only for the reference translation and the breakdown.
				analysis: body.user
					? "### 整体评价\n**invites** 直译生硬。\n\n1）用词：可改为 invites you in；2）语序：保持原句。"
					: "",
				parts,
			});
		}
		if (url.includes("/api/translate")) return jsonResponse({ translation: "宁静的图书馆邀你驻足。" });
		if (url.includes("/api/lookup")) {
			// Echo the requested words so the popup has a definition for whatever was clicked.
			const words = JSON.parse(init?.body ?? "{}").words ?? [];
			const entries = Object.fromEntries(
				words.map((word: string) => [word, { pos: "n.", meaning: `释义-${word}`, ipa: `/${word}/` }]),
			);
			return jsonResponse({ entries });
		}
		return jsonResponse({ ok: true });
	});
});

function jsonResponse(payload: unknown): Response {
	return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

/** Lets the panel's async open()/send() chain finish before assertions. The stubbed fetch is
 *  deterministic, so draining the microtask queue plus a few macrotasks is enough. */
async function settle(): Promise<void> {
	for (let index = 0; index < 10; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Waits until the panel finishes its in-flight request, so buttons are never clicked early. */
async function waitIdle(panel: FakeElement): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		if (panel.dataset.busy !== "true") return;
	}
}

function callsTo(fragment: string): number {
	return calls.filter((url) => url.includes(fragment)).length;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("app bootstrap", () => {
	it("wires the input section without throwing", async () => {
		const doc = await bootInReader();
		expect(byId(doc, "input-section").dataset.expanded).toBe("true");
	});

	it("folds the input away after a successful render and offers 展开", async () => {
		const doc = await bootInReader();
		const input = byId(doc, "article-input");
		input.value = "A serene library invites you to linger.";

		byId(doc, "confirm-button").fire("click");

		expect(byId(doc, "input-section").dataset.expanded).toBe("false");
	});

	it("keeps the input open when the textarea is empty", async () => {
		const doc = await bootInReader();
		byId(doc, "confirm-button").fire("click");
		expect(byId(doc, "input-section").dataset.expanded).toBe("true");
	});

	it("reopens the input section from the header button", async () => {
		const doc = await bootInReader();
		byId(doc, "article-input").value = "Hello world. This is a test.";
		byId(doc, "confirm-button").fire("click");
		expect(byId(doc, "input-section").dataset.expanded).toBe("false");

		byId(doc, "input-expand").fire("click");
		expect(byId(doc, "input-section").dataset.expanded).toBe("true");
	});

	it("collapses again from the action-row button", async () => {
		const doc = await bootInReader();
		byId(doc, "article-input").value = "Hello world. This is a test.";
		byId(doc, "confirm-button").fire("click");
		byId(doc, "input-expand").fire("click");
		expect(byId(doc, "input-section").dataset.expanded).toBe("true");

		byId(doc, "input-collapse").fire("click");
		expect(byId(doc, "input-section").dataset.expanded).toBe("false");
	});

	it("renders numbered sentences for a pasted article", async () => {
		const doc = await bootInReader();
		byId(doc, "article-input").value = "One sentence. Another sentence.";
		byId(doc, "confirm-button").fire("click");

		const article = byId(doc, "article");
		const paragraphs = article.querySelectorAll(".paragraph");
		expect(paragraphs).toHaveLength(1);
		const sentences = paragraphs[0].querySelectorAll(".sentence");
		expect(sentences).toHaveLength(2);
		expect(sentences[0].querySelectorAll(".sentence__number")[0].textContent).toBe("01");
		expect(sentences[0].querySelectorAll(".sentence__slot")).toHaveLength(1);
	});

	it("toggles the theme on the header button", async () => {
		const doc = await bootInReader();
		const toggle = byId(doc, "theme-toggle");
		expect(doc.documentElement.dataset.theme).toBe("light");
		toggle.fire("click");
		expect(doc.documentElement.dataset.theme).toBe("dark");
		toggle.fire("click");
		expect(doc.documentElement.dataset.theme).toBe("light");
	});

	it("keeps a space between sentences so paragraph layout does not run them together", async () => {
		const doc = await bootInReader();
		byId(doc, "article-input").value = "One sentence. Another sentence.";
		byId(doc, "confirm-button").fire("click");

		const paragraph = byId(doc, "article").querySelectorAll(".paragraph")[0];
		// Sentences are trimmed; without the separator the inline layout would show
		// "sentence.Another".
		expect(paragraph.textValue).toContain("01One sentence. 02Another sentence.");
	});
});

describe("sentence and paragraph layouts", () => {
	function pressedLayout(doc: FakeDocument): FakeElement | undefined {
		return byId(doc, "layout-toggle")
			.querySelectorAll("[data-layout]")
			.find((button) => button.getAttribute("aria-pressed") === "true");
	}

	it("starts in sentence layout and names the current mode on the button", async () => {
		const doc = await bootInReader();
		expect(doc.documentElement.dataset.layout).toBe("sentence");
		const buttons = byId(doc, "layout-toggle").querySelectorAll("[data-layout]");
		expect(buttons).toHaveLength(2);
		expect(pressedLayout(doc)?.textContent).toBe("按句");
	});

	it("switches to paragraph layout and back on repeated clicks", async () => {
		const doc = await bootInReader();
		const toggle = byId(doc, "layout-toggle");

		toggle.fire("click");
		expect(doc.documentElement.dataset.layout).toBe("paragraph");
		expect(pressedLayout(doc)?.textContent).toBe("按段");

		toggle.fire("click");
		expect(doc.documentElement.dataset.layout).toBe("sentence");
		expect(pressedLayout(doc)?.textContent).toBe("按句");
	});

	it("keeps the chosen layout across a reload", async () => {
		const first = await bootInReader();
		byId(first, "layout-toggle").fire("click");
		expect(first.documentElement.dataset.layout).toBe("paragraph");

		// A fresh document over the same localStorage is what a reload looks like.
		const second = await bootInReader();
		expect(second.documentElement.dataset.layout).toBe("paragraph");
		expect(pressedLayout(second)?.textContent).toBe("按段");
	});

	it("keeps sentences numbered and words clickable in paragraph layout", async () => {
		const doc = await bootInReader();
		byId(doc, "layout-toggle").fire("click");
		byId(doc, "article-input").value = "One sentence. Another sentence.";
		byId(doc, "confirm-button").fire("click");

		const article = byId(doc, "article");
		expect(article.querySelectorAll(".sentence")).toHaveLength(2);
		expect(article.querySelectorAll(".sentence__number")).toHaveLength(2);
		expect(article.querySelectorAll(".word").length).toBeGreaterThan(0);
	});
});

describe("part-of-speech display", () => {
	it("shows only the abbreviation, without a Chinese part-of-speech label", async () => {
		const doc = await bootInReader();
		byId(doc, "article-input").value = "A serene library invites you to linger.";
		byId(doc, "confirm-button").fire("click");
		await settle();

		const word = byId(doc, "article").querySelectorAll(".word")[0];
		word.fire("click");
		await settle();

		// The stubbed lookup answers with pos "n.", so the body must be the abbreviation plus
		// the meaning, with no Chinese label anywhere.
		const popup = doc.body.querySelector(".popup");
		expect(popup?.querySelectorAll(".popup__title")[0].textContent).toBe("a");
		const body = popup?.querySelectorAll(".popup__body")[0].textContent ?? "";
		expect(body).toBe("/a/ n. 释义-a");
		for (const chinese of ["名词", "动词", "形容词", "副词", "介词"]) {
			expect(body).not.toContain(chinese);
		}
	});
});
	describe("sentence practice panel", () => {
	async function renderTwoSentences(): Promise<FakeDocument> {
		const doc = await bootInReader();
		byId(doc, "article-input").value = "A serene library invites you to linger. Persistent readers notice details.";
		byId(doc, "confirm-button").fire("click");
		await settle();
		return doc;
	}

	function firstNumber(doc: FakeDocument): FakeElement {
		return byId(doc, "article").querySelectorAll(".sentence__number")[0];
	}

	it("opens and closes from the sentence number", async () => {
		const doc = await renderTwoSentences();
		firstNumber(doc).fire("click");
		await settle();
		const panel = byId(doc, "article").querySelectorAll(".panel")[0];
		expect(panel.hidden).toBe(false);

		firstNumber(doc).fire("click");
		expect(panel.hidden).toBe(true);
	});

	it("lays the editor out as head, input, actions and reply", async () => {
		const doc = await renderTwoSentences();
		firstNumber(doc).fire("click");
		await settle();

		const panel = byId(doc, "article").querySelectorAll(".panel")[0];
		const head = panel.querySelectorAll(".panel__head")[0];
		expect(head.textValue).toContain("第 01 句");
		expect(panel.querySelectorAll(".panel__input")[0]).toBeTruthy();
		const actions = panel.querySelectorAll(".panel__actions")[0];
		expect(actions).toBeTruthy();
		const buttons = panel.querySelectorAll(".panel__buttons")[0];
		expect(buttons.children).toHaveLength(3);
		expect(buttons.textValue).toContain("重写");
		expect(buttons.textValue).toContain("参考译文");
		expect(buttons.textValue).toContain("发送");
	});

	it("keeps the reader's translation and grading when reopened", async () => {
		const doc = await renderTwoSentences();
		firstNumber(doc).fire("click");
		await settle();

		const panel = byId(doc, "article").querySelectorAll(".panel")[0];
		const input = panel.querySelectorAll(".panel__input")[0];
		input.value = "一个平静的图书馆邀请你逗留。";
		panel.querySelectorAll(".panel__button--send")[0].fire("click");
		await settle();

		const translateCallsBefore = callsTo("/api/translate");
		const analyzeCallsBefore = callsTo("/api/analyze");
		expect(analyzeCallsBefore).toBe(1);
		const replyText = panel.querySelectorAll(".panel__reply")[0].textValue;
		expect(replyText).toContain("分析");

		// Collapse and reopen: nothing may be discarded and no new request may go out.
		firstNumber(doc).fire("click");
		firstNumber(doc).fire("click");
		await settle();

		expect(panel.hidden).toBe(false);
		expect(panel.querySelectorAll(".panel__input")[0].value).toBe("一个平静的图书馆邀请你逗留。");
		expect(panel.querySelectorAll(".panel__reply")[0].textValue).toBe(replyText);
		expect(callsTo("/api/translate")).toBe(translateCallsBefore);
		expect(callsTo("/api/analyze")).toBe(analyzeCallsBefore);
	});

	it("only clears the work when 重写 is pressed, without refetching", async () => {
		const doc = await renderTwoSentences();
		firstNumber(doc).fire("click");
		await settle();

		const panel = byId(doc, "article").querySelectorAll(".panel")[0];
		panel.querySelectorAll(".panel__input")[0].value = "我的翻译";
		panel.querySelectorAll(".panel__button--send")[0].fire("click");
		await waitIdle(panel);
		expect(panel.dataset.busy).toBe("false");
		expect(callsTo("/api/analyze")).toBe(1);
		expect(panel.querySelectorAll(".panel__reply")[0].textValue).toContain("分析");

		const translateCallsBefore = callsTo("/api/translate");
		// The 重写 button clears the draft without fetching.
		panel.querySelectorAll(".panel__button--rewrite")[0].fire("click");
		await waitIdle(panel);

		expect(panel.querySelectorAll(".panel__input")[0].value).toBe("");
		expect(panel.querySelectorAll(".panel__reply")[0].textValue).toBe("");
		expect(callsTo("/api/translate")).toBe(translateCallsBefore);
	});

	it("shows nothing until 发送 is pressed", async () => {
		const doc = await renderTwoSentences();
		firstNumber(doc).fire("click");
		await settle();

		const panel = byId(doc, "article").querySelectorAll(".panel")[0];
		expect(panel.hidden).toBe(false);
		expect(panel.querySelectorAll(".panel__reply")[0].textValue).toBe("");
		expect(callsTo("/api/translate")).toBe(0);
	});

	it("shows only the reference translation when 发送 is used with an empty box", async () => {
		const doc = await renderTwoSentences();
		firstNumber(doc).fire("click");
		await settle();

		const panel = byId(doc, "article").querySelectorAll(".panel")[0];
		panel.querySelectorAll(".panel__button--send")[0].fire("click");
		await settle();

		const reply = panel.querySelectorAll(".panel__reply")[0].textValue;
		expect(reply).toContain("参考译文");
		expect(reply).toContain("句子成分");
		expect(reply).not.toContain("分析");
		expect(reply).not.toContain("你的译文");
		// An empty box still asks the model for the sentence breakdown, so analyze is used.
		expect(callsTo("/api/analyze")).toBe(1);
	});

	it("renders the whole sentence as grouped parts with a legend", async () => {
		const doc = await renderTwoSentences();
		firstNumber(doc).fire("click");
		await settle();

		const panel = byId(doc, "article").querySelectorAll(".panel")[0];
		panel.querySelectorAll(".panel__button--send")[0].fire("click");
		await settle();

		const syntax = panel.querySelectorAll(".panel__block--syntax")[0];
		expect(syntax).toBeTruthy();
		const line = syntax.querySelectorAll(".syntax__line")[0];
		// The line is built from the original sentence, not from the model's word list.
		expect(line.dataset.sentence).toBe("A serene library invites you to linger.");
		expect(line.textValue).toContain("A serene library主");
		expect(line.textValue).toContain("invites谓");
		expect(line.textValue).toContain("to linger补");
		const subject = line.querySelectorAll(".syntax__part--subject")[0];
		expect(subject.textValue).toBe("A serene library主");
		const legend = syntax.querySelectorAll(".syntax__legend")[0];
		expect(legend.querySelectorAll(".syntax__key")).toHaveLength(9);
	});

	it("marks a clause inside the sentence and expands it on the line below", async () => {
		const doc = await bootInReader();
		byId(doc, "article-input").value = "The book that I bought yesterday is interesting.";
		byId(doc, "confirm-button").fire("click");
		await settle();

		const article = byId(doc, "article");
		article.querySelectorAll(".sentence__number")[0].fire("click");
		await settle();
		const panel = article.querySelectorAll(".panel")[0];
		panel.querySelectorAll(".panel__button--send")[0].fire("click");
		await settle();

		const syntax = panel.querySelectorAll(".panel__block--syntax")[0];
		expect(syntax).toBeTruthy();
		const line = syntax.querySelectorAll(".syntax__line")[0];
		expect(line.dataset.sentence).toBe("The book that I bought yesterday is interesting.");
		const clause = line.querySelectorAll(".syntax__part--clause")[0];
		expect(clause).toBeTruthy();
		expect(clause.textValue).toBe("that I bought yesterday定从");

		const rows = syntax.querySelectorAll(".syntax__clause-row");
		expect(rows).toHaveLength(1);
		expect(rows[0].dataset.depth).toBe("1");
		expect(rows[0].querySelectorAll(".syntax__clause-label")[0].textContent).toBe("定从");
		expect(rows[0].textValue).toContain("I主");
		expect(rows[0].textValue).toContain("bought谓");
		expect(rows[0].textValue).toContain("yesterday状");
	});

	it("shows a note instead of an empty block when no breakdown comes back", async () => {
		const doc = await bootInReader();
		byId(doc, "article-input").value = "This sentence has no breakdown.";
		byId(doc, "confirm-button").fire("click");
		await settle();

		const article = byId(doc, "article");
		article.querySelectorAll(".sentence__number")[0].fire("click");
		await settle();
		const panel = article.querySelectorAll(".panel")[0];
		panel.querySelectorAll(".panel__button--send")[0].fire("click");
		await settle();

		const note = panel.querySelectorAll(".syntax__note")[0];
		expect(note).toBeTruthy();
		expect(note.textValue).toContain("成分解析暂不可用");
		expect(panel.querySelectorAll(".syntax__line")).toHaveLength(0);
	});

	it("shows the reference translation and the grading when 发送 is used with text", async () => {
		const doc = await renderTwoSentences();
		firstNumber(doc).fire("click");
		await settle();

		const panel = byId(doc, "article").querySelectorAll(".panel")[0];
		panel.querySelectorAll(".panel__input")[0].value = "一个平静的图书馆邀请你逗留。";
		panel.querySelectorAll(".panel__button--send")[0].fire("click");
		await settle();

		const reply = panel.querySelectorAll(".panel__reply")[0].textValue;
		expect(reply).toContain("参考译文");
		expect(reply).toContain("分析");
		// Markdown headings and emphasis are display decoration, never shown to the reader.
		expect(reply).toContain("整体评价");
		expect(reply).not.toContain("###");
		expect(reply).not.toContain("**");
		expect(panel.querySelectorAll(".panel__point").length).toBeGreaterThan(1);
		expect(callsTo("/api/analyze")).toBe(1);
	});
});

describe("reading size", () => {
	it("changes the paper size from the topbar menu", async () => {
		const doc = await bootInReader();
		const button = byId(doc, "size-button");
		const menu = byId(doc, "size-menu");
		expect(menu.hidden).toBe(true);

		button.fire("click");
		await settle();
		expect(menu.hidden).toBe(false);

		const large = menu.querySelectorAll("[data-size]").find((item) => item.dataset.size === "l");
		expect(large).toBeTruthy();
		large!.fire("click");
		await settle();

		expect(doc.documentElement.dataset.size).toBe("l");
		expect(menu.hidden).toBe(true);
		expect(large!.getAttribute("aria-pressed")).toBe("true");
	});
});
