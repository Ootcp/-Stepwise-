import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeElement, FakeHtmlElement, createDocument, resetStorage, stubStorage, type FakeDocument } from "./dom-stub.ts";

/**
 * The vocabulary ledger: entering it from the library, the cards, search, the three orders,
 * empty/error states, and the route surviving a reload.
 */

type StoreMode = "words" | "empty" | "error";

const NOW = Date.now();
const words = {
	study: {
		word: "study",
		ipa: "/'stʌdi/",
		pos: "n.",
		meanings: ["学习", "研究"],
		clicks: 6,
		firstSeenAt: NOW - 86_400_000 * 20,
		lastSeenAt: NOW - 60_000,
	},
	apply: {
		word: "apply",
		ipa: "/əˈplaɪ/",
		pos: "v.",
		meanings: ["申请"],
		clicks: 1,
		firstSeenAt: NOW - 86_400_000 * 30,
		lastSeenAt: NOW - 86_400_000 * 3,
	},
	law: {
		word: "law",
		ipa: "/lɔː/",
		pos: "n.",
		meanings: ["法律"],
		clicks: 3,
		firstSeenAt: NOW - 86_400_000 * 40,
		lastSeenAt: NOW - 86_400_000 * 10,
	},
	thesethings: {
		word: "thesethings",
		ipa: "",
		pos: "",
		meanings: [],
		clicks: 2,
		firstSeenAt: NOW - 86_400_000 * 60,
		lastSeenAt: NOW - 86_400_000 * 50,
	},
};

let store: StoreMode = "words";
let failWordsOnce = false;
const spoken: string[] = [];

function jsonResponse(payload: unknown): Response {
	return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
	resetStorage();
	store = "words";
	failWordsOnce = false;
	spoken.length = 0;

	vi.stubGlobal("fetch", async (input: unknown, init?: { method?: string }) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		if (url === "/api/words") {
			if (store === "error" && failWordsOnce) {
				failWordsOnce = false;
				return new Response(JSON.stringify({ error: "词库文件损坏" }), {
					status: 500,
					headers: { "content-type": "application/json" },
				});
			}
			return jsonResponse({ version: 1, words: store === "empty" ? {} : words });
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
	scope.localStorage = stubStorage();
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

/** Home → library → vocabulary, the way a reader reaches it. */
async function enterWords(): Promise<FakeDocument> {
	const doc = await boot();
	byId(doc, "home-enter").fire("click");
	await settle();
	byId(doc, "words-button").fire("click");
	await settle();
	return doc;
}

function byId(doc: FakeDocument, id: string): FakeElement {
	const found = doc.body.querySelector(`#${id}`);
	if (!found) throw new Error(`missing #${id}`);
	return found;
}

function cards(doc: FakeDocument): FakeElement[] {
	return byId(doc, "words-grid").querySelectorAll(".word-card");
}

function order(doc: FakeDocument): string[] {
	return cards(doc).map((card) => card.getAttribute("data-word") ?? "");
}

function hashOf(doc: FakeDocument): string {
	return (doc.defaultView as unknown as { history: { location: { hash: string } } }).history.location.hash;
}

describe("entering the ledger", () => {
	it("opens from the library button and records #/words", async () => {
		const doc = await enterWords();
		expect(doc.documentElement.dataset.view).toBe("words");
		expect(byId(doc, "library-view").hidden).toBe(true);
		expect(byId(doc, "words-view").hidden).toBe(false);
		expect(hashOf(doc)).toBe("#/words");
		expect((doc as unknown as { title: string }).title).toBe("拾级 · 单词库");
	});

	it("comes back to the library from the back button", async () => {
		const doc = await enterWords();
		byId(doc, "words-back").fire("click");
		await settle();
		expect(doc.documentElement.dataset.view).toBe("library");
		expect(hashOf(doc)).toBe("#/library");
	});

	it("restores the page from a direct #/words load", async () => {
		const doc = await boot("#/words");
		expect(doc.documentElement.dataset.view).toBe("words");
		expect(hashOf(doc)).toBe("#/words");
		expect(cards(doc)).toHaveLength(4);
	});
});

describe("the cards", () => {
	it("shows word, IPA, part of speech, meaning, count and recency", async () => {
		const doc = await enterWords();
		const card = cards(doc).find((entry) => entry.getAttribute("data-word") === "study");
		expect(card).toBeDefined();
		expect(card!.querySelectorAll(".word-card__word")[0].textContent).toBe("study");
		expect(card!.querySelectorAll(".word-card__ipa")[0].textContent).toBe("/'stʌdi/");
		expect(card!.querySelectorAll(".word-card__pos")[0].textContent).toBe("n.");
		expect(card!.querySelectorAll(".word-card__gloss")[0].textContent).toBe("学习、研究");
		expect(card!.querySelectorAll(".word-card__count")[0].textContent).toBe("6 次");
		expect(card!.querySelectorAll(".word-card__seen")[0].textContent).toContain("最近 ·");
	});

	it("says so when the dictionary has no meaning for a word", async () => {
		const doc = await enterWords();
		const card = cards(doc).find((entry) => entry.getAttribute("data-word") === "thesethings")!;
		expect(card.querySelectorAll(".word-card__gloss--missing")).toHaveLength(1);
		expect(card.querySelectorAll(".word-card__gloss")[0].textContent).toBe("词典暂未收录释义");
		expect(card.querySelectorAll(".word-card__ipa")).toHaveLength(0);
	});

	it("speaks the word when the card is clicked", async () => {
		const doc = await enterWords();
		cards(doc)[0].fire("click");
		expect(spoken).toEqual(["study"]);
	});
});

describe("search and order", () => {
	it("defaults to the most recently seen word", async () => {
		const doc = await enterWords();
		expect(order(doc)).toEqual(["study", "apply", "law", "thesethings"]);
	});

	it("orders by click count", async () => {
		const doc = await enterWords();
		byId(doc, "words-sort").querySelectorAll("[data-sort]")[1].fire("click");
		await settle();
		expect(order(doc)).toEqual(["study", "law", "thesethings", "apply"]);
	});

	it("orders alphabetically", async () => {
		const doc = await enterWords();
		byId(doc, "words-sort").querySelectorAll("[data-sort]")[2].fire("click");
		await settle();
		expect(order(doc)).toEqual(["apply", "law", "study", "thesethings"]);
		expect(byId(doc, "words-sort").querySelectorAll("[data-sort]")[2].getAttribute("aria-pressed")).toBe("true");
	});

	it("filters by English word, Chinese meaning and IPA", async () => {
		const doc = await enterWords();
		const search = byId(doc, "words-search");
		search.value = "法律";
		search.fire("input");
		expect(order(doc)).toEqual(["law"]);
		expect(byId(doc, "words-count").textContent).toBe("1 / 4 个词");
		expect(byId(doc, "words-clear").hidden).toBe(false);

		search.value = "plaɪ";
		search.fire("input");
		expect(order(doc)).toEqual(["apply"]);

		search.value = "study";
		search.fire("input");
		expect(order(doc)).toEqual(["study"]);
	});

	it("shows a no-match state and clears it from the empty action", async () => {
		const doc = await enterWords();
		const search = byId(doc, "words-search");
		search.value = "zzz";
		search.fire("input");
		await settle();

		expect(byId(doc, "words-empty").hidden).toBe(false);
		expect(byId(doc, "words-empty-title").textContent).toBe("没有找到这个词");
		expect(byId(doc, "words-empty-action").textContent).toBe("清空搜索");
		byId(doc, "words-empty-action").fire("click");
		await settle();

		expect(byId(doc, "words-empty").hidden).toBe(true);
		expect(order(doc)).toEqual(["study", "apply", "law", "thesethings"]);
		expect(search.value).toBe("");
	});
});

describe("empty and errors", () => {
	it("invites the reader to the library when no word has been looked up", async () => {
		store = "empty";
		const doc = await enterWords();
		expect(cards(doc)).toHaveLength(0);
		expect(byId(doc, "words-empty").hidden).toBe(false);
		expect(byId(doc, "words-empty-title").textContent).toBe("生词簿还是空的");
		expect(byId(doc, "words-total").textContent).toBe("0");

		byId(doc, "words-empty-action").fire("click");
		await settle();
		expect(doc.documentElement.dataset.view).toBe("library");
	});

	it("offers a retry when the word file cannot be read", async () => {
		store = "error";
		failWordsOnce = true;
		const doc = await enterWords();

		expect(byId(doc, "words-empty").hidden).toBe(false);
		expect(byId(doc, "words-empty-title").textContent).toBe("词库没读出来");
		expect(byId(doc, "words-empty-action").textContent).toBe("重试");

		byId(doc, "words-empty-action").fire("click");
		await settle();
		expect(cards(doc)).toHaveLength(4);
	});
});

describe("theme", () => {
	it("mirrors the theme from the ledger", async () => {
		const doc = await enterWords();
		byId(doc, "words-theme-toggle").fire("click");
		expect(doc.documentElement.dataset.theme).toBe("dark");
		expect(byId(doc, "words-theme-toggle").getAttribute("aria-label")).toBe("切换到亮色模式");
	});
});
