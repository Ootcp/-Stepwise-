import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeElement, FakeHtmlElement, createDocument, resetStorage, stubStorage, type FakeDocument } from "./dom-stub.ts";
import type { ArticleSummary } from "../web/api.ts";
import { LibraryController } from "../web/library.ts";

/**
 * Library view behaviour: the first screen, the card grid, the two-stage delete flow, and
 * the routing between library and reader.
 */

const calls: Array<{ method: string; url: string; body: unknown }> = [];
const articles = [
	{ id: "art-one-0000", title: "The Early Bird", createdAt: 1, updatedAt: 200, preview: "The early bird catches the worm." },
	{ id: "art-two-0000", title: "A Quiet Library", createdAt: 2, updatedAt: 100, preview: "A serene library invites you to linger." },
];

const settings = {
	version: 1,
	providers: [
		{
			id: "sensenova",
			name: "SenseNova",
			baseUrl: "https://token.sensenova.cn/v1",
			kind: "builtin",
			enabled: true,
			keySource: "env",
			hasKey: true,
			keyMasked: "sk-…1234",
			defaultModelId: "deepseek-v4-flash",
			models: ["deepseek-v4-flash", "glm-5.2"],
			compat: { jsonMode: true, maxTokensField: "max_completion_tokens" },
			editable: false,
			deletable: false,
		},
	],
	defaultProviderId: "sensenova",
	crossApiFallback: true,
	manualModelSelection: false,
	structured: { mode: "auto" },
	prose: { mode: "auto" },
	warnings: [],
};

function jsonResponse(payload: unknown): Response {
	return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

/**
 * A mutable store behind the same DELETE route the app uses, so a confirmed delete actually
 * removes the card on the next list read. Ids in `failIds` answer 500 instead.
 */
function stubStore(failIds: string[] = []): ArticleSummary[] {
	const stored = articles.map((article) => ({ ...article }));
	vi.stubGlobal("fetch", async (input: unknown, init?: { body?: string; method?: string }) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		calls.push({ method, url, body: init?.body ? JSON.parse(init.body) : undefined });
		if (url === "/api/articles" && method === "GET") return jsonResponse({ articles: stored });
		const match = /^\/api\/articles\/([^/]+)$/.exec(url);
		if (match && method === "DELETE") {
			const id = decodeURIComponent(match[1]);
			if (failIds.includes(id)) {
				return new Response(JSON.stringify({ error: "disk full" }), {
					status: 500,
					headers: { "content-type": "application/json" },
				});
			}
			const index = stored.findIndex((article) => article.id === id);
			if (index !== -1) stored.splice(index, 1);
			return jsonResponse({ ok: true });
		}
		if (url.startsWith("/api/articles/") && method === "GET") {
			const id = decodeURIComponent(url.split("/").pop() ?? "");
			const found = stored.find((article) => article.id === id);
			if (found) {
				return jsonResponse({ article: { version: 1, ...found, text: found.preview, sentences: [] } });
			}
		}
		if (url === "/api/health") {
			return jsonResponse({ ok: true, dictionary: "ecdict", llmModel: "deepseek-v4-flash", ecdictPath: null });
		}
		return jsonResponse({ ok: true });
	});
	return stored;
}

beforeEach(() => {
	resetStorage();
	calls.length = 0;
	vi.stubGlobal("fetch", async (input: unknown, init?: { body?: string; method?: string }) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		const body = init?.body ? JSON.parse(init.body) : undefined;
		calls.push({ method, url, body });
		if (url.startsWith("/api/articles") && method === "GET" && !url.includes("/art-")) {
			return jsonResponse({ articles });
		}
		if (url.includes("/api/articles/") && method === "GET" && !url.includes("art-new-0000")) {
			return jsonResponse({
				article: {
					version: 1,
					id: "art-one-0000",
					title: "The Early Bird",
					createdAt: 1,
					updatedAt: 200,
					text: "The early bird catches the worm.",
					sentences: [],
				},
			});
		}
		if (url === "/api/articles" && method === "POST") {
			return jsonResponse({
				article: {
					version: 1,
					id: "art-new-0000",
					title: body.title || "新建文章",
					createdAt: 3,
					updatedAt: 3,
					text: body.text,
					sentences: [],
					clicks: {},
					weakGrammar: [],
				},
			});
		}
		if (url.includes("/api/articles/art-new-0000") && method === "GET") {
			return jsonResponse({
				article: {
					version: 1,
					id: "art-new-0000",
					title: "新建文章",
					createdAt: 3,
					updatedAt: 3,
					text: "A new article.",
					sentences: [],
				},
			});
		}
		if (url.includes("/api/articles/art-one-0000") && method === "PUT") {
			const patch = body ?? {};
			return jsonResponse({
				article: {
					version: 1,
					id: "art-one-0000",
					title: patch.title || "The Early Bird",
					createdAt: 1,
					updatedAt: 300,
					text: patch.text ?? "The early bird catches the worm.",
					sentences: patch.sentences ?? [],
					clicks: patch.clicks ?? {},
					weakGrammar: patch.weakGrammar ?? [],
				},
			});
		}
		if (url === "/api/health") return jsonResponse({ ok: true, dictionary: "ecdict", llmModel: "deepseek-v4-flash", ecdictPath: null });
		if (url === "/api/settings" && method === "GET") return jsonResponse({ settings });
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
	for (let index = 0; index < 12; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Boots and stops on the landing page, which is where the app opens now. */
async function bootHome(): Promise<FakeDocument> {
	const doc = install();
	vi.resetModules();
	await import("../web/main.ts");
	await settle();
	return doc;
}

/** Boots and walks through the landing page, because every test below is about the library. */
async function boot(): Promise<FakeDocument> {
	const doc = await bootHome();
	byId(doc, "home-enter").fire("click");
	await settle();
	return doc;
}

function byId(doc: FakeDocument, id: string): FakeElement {
	const found = doc.body.querySelector(`#${id}`);
	if (!found) throw new Error(`missing #${id}`);
	return found;
}

function cards(doc: FakeDocument): FakeElement[] {
	return byId(doc, "article-grid").querySelectorAll(".article-card");
}

function cardById(doc: FakeDocument, id: string): FakeElement {
	const found = cards(doc).find((card) => card.getAttribute("data-id") === id);
	if (!found) throw new Error(`no card for ${id}`);
	return found;
}

/** Direct controller for state tests that do not need the whole app booted. */
function makeController(doc: FakeDocument): LibraryController {
	const controller = new LibraryController({
		doc: doc as unknown as Document,
		root: byId(doc, "library-view") as unknown as HTMLElement,
		grid: byId(doc, "article-grid") as unknown as HTMLElement,
		callbacks: { onOpen: () => {}, onNotice: () => {} },
	});
	controller.bindTrash(byId(doc, "delete-toggle") as unknown as HTMLElement);
	return controller;
}

describe("library is the first screen", () => {
	it("opens on the landing page with the library and the reader hidden", async () => {
		const doc = await bootHome();
		expect(doc.documentElement.dataset.view).toBe("home");
		expect(byId(doc, "home-view").hidden).toBe(false);
		expect(byId(doc, "library-view").hidden).toBe(true);
		expect(byId(doc, "reader-view").hidden).toBe(true);
	});

	it("shows the library from the landing page button and records it in the URL", async () => {
		const doc = await bootHome();
		byId(doc, "home-enter").fire("click");
		await settle();

		const view = doc.defaultView as unknown as { history: { location: { hash: string } } };
		expect(doc.documentElement.dataset.view).toBe("library");
		expect(byId(doc, "home-view").hidden).toBe(true);
		expect(byId(doc, "library-view").hidden).toBe(false);
		expect(view.history.location.hash).toBe("#/library");
	});

	it("goes back to the landing page from the library header", async () => {
		const doc = await boot();
		byId(doc, "library-home").fire("click");
		await settle();

		const view = doc.defaultView as unknown as { history: { location: { hash: string } } };
		expect(doc.documentElement.dataset.view).toBe("home");
		expect(byId(doc, "home-view").hidden).toBe(false);
		expect(view.history.location.hash).toBe("#/home");
	});

	it("renders one card per article plus the new-article card last", async () => {
		const doc = await boot();
		expect(cards(doc)).toHaveLength(3);
		expect(cards(doc)[2].className).toContain("article-card--new");
	});

	it("shows the title and preview on each card", async () => {
		const doc = await boot();
		const card = cardById(doc, "art-one-0000");
		expect(card.querySelectorAll(".article-card__title")[0].textContent).toBe("The Early Bird");
		expect(card.querySelectorAll(".article-card__preview")[0].textContent).toBe("The early bird catches the worm.");
	});

	it("keeps the full preview reachable through the title attribute", async () => {
		const doc = await boot();
		const preview = cardById(doc, "art-one-0000").querySelectorAll(".article-card__preview")[0];
		expect(preview.attributes.title).toBe("The early bird catches the worm.");
	});
});

describe("routing", () => {
	it("opens the new-article dialog from the + card", async () => {
		const doc = await boot();
		byId(doc, "article-grid").querySelectorAll(".article-card--new")[0].fire("click");
		await settle();
		expect(doc.body.querySelector(".dialog--article")).toBeDefined();
		expect(byId(doc, "article-dialog-heading").textContent).toBe("新建文章");
		expect(doc.documentElement.dataset.view).toBe("library");

		byId(doc, "article-dialog-body").value = "A new article.";
		byId(doc, "article-dialog-save").fire("click");
		await settle();
		await settle();
		expect(doc.documentElement.dataset.view).toBe("reader");
		expect(byId(doc, "reader-view").hidden).toBe(false);
		expect(byId(doc, "library-view").hidden).toBe(true);
		expect(byId(doc, "article-input").value).toBe("A new article.");
	});

	it("loads the article text when a card is opened", async () => {
		const doc = await boot();
		cardById(doc, "art-one-0000").fire("click");
		await settle();
		expect(byId(doc, "article-input").value).toBe("The early bird catches the worm.");
	});

	it("names the tab 拾级 · 阅读 while reading, not the article", async () => {
		const doc = await boot();
		expect((doc as unknown as { title: string }).title).toBe("拾级 · 文章库");

		cardById(doc, "art-one-0000").fire("click");
		await settle();
		expect(byId(doc, "article-title").textContent).toBe("The Early Bird");
		expect((doc as unknown as { title: string }).title).toBe("拾级 · 阅读");

		byId(doc, "back-button").fire("click");
		await settle();
		expect((doc as unknown as { title: string }).title).toBe("拾级 · 文章库");
	});

	it("edits the title and body from the reader", async () => {
		const doc = await boot();
		cardById(doc, "art-one-0000").fire("click");
		await settle();
		byId(doc, "edit-article").fire("click");
		await settle();

		byId(doc, "article-dialog-title").value = "A New Title";
		byId(doc, "article-dialog-body").value = "A new first sentence. A new second one.";
		byId(doc, "article-dialog-save").fire("click");
		await settle();
		await settle();

		const update = calls.find((call) => call.method === "PUT" && call.url.includes("art-one-0000"));
		expect(update).toBeDefined();
		expect((update?.body as { title?: string; text?: string })?.title).toBe("A New Title");
		expect((update?.body as { text?: string })?.text).toBe("A new first sentence. A new second one.");
		expect(byId(doc, "article-title").textContent).toBe("A New Title");
		expect(byId(doc, "article-meta").textContent).toContain("2 句");
		expect(byId(doc, "article").querySelectorAll(".sentence")).toHaveLength(2);
		expect(doc.body.querySelector(".dialog-layer--article")).toBeNull();
	});

	it("returns to the library from the back button", async () => {
		const doc = await boot();
		cardById(doc, "art-one-0000").fire("click");
		await settle();
		byId(doc, "back-button").fire("click");
		await settle();
		expect(doc.documentElement.dataset.view).toBe("library");
		expect(byId(doc, "reader-view").hidden).toBe(true);
	});

	it("keeps the URL hash in step with the view", async () => {
		const doc = await boot();
		const view = doc.defaultView as unknown as { history: { location: { hash: string } } };
		expect(view.history.location.hash).toContain("#/library");
		cardById(doc, "art-one-0000").fire("click");
		await settle();
		expect(view.history.location.hash).toContain("#/reader/art-one-0000");
	});
});

describe("a new article appears as a card", () => {
	// Regression: the grid used to keep the snapshot taken at startup, so an article saved
	// on the way out was written to disk but never showed up as a card.
	it("re-reads the library after leaving a brand new article", async () => {
		const stored: ArticleSummary[] = [];
		vi.stubGlobal("fetch", async (input: unknown, init?: { body?: string; method?: string }) => {
			const url = String(input);
			const method = init?.method ?? "GET";
			if (url === "/api/articles" && method === "GET") {
				return jsonResponse({ articles: stored });
			}
			if (url.startsWith("/api/articles") && method === "POST") {
				const body = JSON.parse(init?.body ?? "{}");
				const article = {
					id: "art-new-0000",
					title: "A serene library",
					createdAt: 1,
					updatedAt: 2,
					preview: "A serene library invites you to linger.",
				};
				stored.push(article);
				return jsonResponse({ article: { version: 1, ...article, text: body.text, sentences: [] } });
			}
			if (url.includes("/api/articles/art-new-0000") && method === "GET") {
				return jsonResponse({
					article: {
						version: 1,
						id: "art-new-0000",
						title: "A serene library",
						createdAt: 1,
						updatedAt: 2,
						text: "A serene library invites you to linger.",
						sentences: [],
					},
				});
			}
			return jsonResponse({ ok: true });
		});

		const doc = await boot();
		expect(cards(doc)).toHaveLength(1);

		byId(doc, "article-grid").querySelectorAll(".article-card--new")[0].fire("click");
		await settle();
		byId(doc, "article-dialog-body").value = "A serene library invites you to linger.";
		byId(doc, "article-dialog-save").fire("click");
		await settle();
		await settle();
		expect(doc.documentElement.dataset.view).toBe("reader");

		byId(doc, "back-button").fire("click");
		await settle();

		expect(doc.documentElement.dataset.view).toBe("library");
		expect(stored).toHaveLength(1);
		// One real card plus the new-article card.
		expect(cards(doc)).toHaveLength(2);
		expect(cardById(doc, "art-new-0000")).toBeDefined();
	});

	it("does not create a card when nothing was typed", async () => {
		const doc = await boot();
		byId(doc, "article-grid").querySelectorAll(".article-card--new")[0].fire("click");
		await settle();
		byId(doc, "article-dialog-save").fire("click");
		await settle();

		expect(calls.some((call) => call.method === "POST" && call.url === "/api/articles")).toBe(false);
		expect(byId(doc, "article-dialog-error").hidden).toBe(false);
		byId(doc, "article-dialog-cancel").fire("click");
		await settle();
		expect(cards(doc)).toHaveLength(3);
	});
});

describe("delete flow", () => {
	it("first trash click only arms the mode", async () => {
		const doc = await boot();
		byId(doc, "delete-toggle").fire("click");
		await settle();
		expect(byId(doc, "library-view").getAttribute("data-mode")).toBe("delete");
		expect(calls.some((call) => call.method === "DELETE")).toBe(false);
		const hint = byId(doc, "library-hint");
		expect(hint.hidden).toBe(false);
		expect(hint.textContent).toContain("可多选");
	});

	it("does not open the reader for a card click while armed", async () => {
		const doc = await boot();
		byId(doc, "delete-toggle").fire("click");
		await settle();
		cardById(doc, "art-one-0000").fire("click");
		await settle();
		expect(doc.documentElement.dataset.view).toBe("library");
		expect(cardById(doc, "art-one-0000").getAttribute("data-selected")).toBe("true");
		expect(byId(doc, "library-hint").textContent).toContain("已选 1 篇");
	});

	it("selects several cards and toggles them off", async () => {
		const doc = await boot();
		byId(doc, "delete-toggle").fire("click");
		await settle();
		const first = cardById(doc, "art-one-0000");
		const second = cardById(doc, "art-two-0000");

		first.fire("click");
		second.fire("click");
		await settle();
		expect(first.getAttribute("data-selected")).toBe("true");
		expect(second.getAttribute("data-selected")).toBe("true");
		expect(byId(doc, "library-hint").textContent).toContain("已选 2 篇");

		first.fire("click");
		await settle();
		expect(first.getAttribute("data-selected")).toBe("false");
		expect(second.getAttribute("data-selected")).toBe("true");
		expect(byId(doc, "library-hint").textContent).toContain("已选 1 篇");
	});

	it("deletes after confirming", async () => {
		const doc = await boot();
		byId(doc, "delete-toggle").fire("click");
		await settle();
		cardById(doc, "art-one-0000").fire("click");
		byId(doc, "delete-toggle").fire("click");
		await settle();

		const dialog = doc.body.querySelector(".dialog-layer");
		expect(dialog).toBeDefined();
		const box = dialog?.children[0];
		expect(box?.querySelectorAll(".dialog__title")[0].textContent).toBe("删除这篇文章?");
		expect(box?.querySelectorAll(".dialog__message")[0].textContent).toContain("《The Early Bird》");
		box?.querySelectorAll(".dialog__button")[1].fire("click");
		await settle();

		const deletes = calls.filter((call) => call.method === "DELETE");
		expect(deletes).toHaveLength(1);
		expect(deletes[0].url).toContain("art-one-0000");
		expect(byId(doc, "library-view").getAttribute("data-mode")).toBe("browse");
		expect(byId(doc, "library-hint").hidden).toBe(true);
	});

	it("keeps the selection when the confirmation is cancelled", async () => {
		const doc = await boot();
		byId(doc, "delete-toggle").fire("click");
		await settle();
		cardById(doc, "art-one-0000").fire("click");
		cardById(doc, "art-two-0000").fire("click");
		byId(doc, "delete-toggle").fire("click");
		await settle();
		doc.body.querySelector(".dialog-layer")?.children[0].querySelectorAll(".dialog__button")[0].fire("click");
		await settle();

		expect(calls.some((call) => call.method === "DELETE")).toBe(false);
		expect(byId(doc, "library-view").getAttribute("data-mode")).toBe("delete");
		expect(cardById(doc, "art-one-0000").getAttribute("data-selected")).toBe("true");
		expect(cardById(doc, "art-two-0000").getAttribute("data-selected")).toBe("true");
		expect(byId(doc, "library-hint").textContent).toContain("已选 2 篇");

		// The mode is still armed, so the trash opens the confirmation again.
		byId(doc, "delete-toggle").fire("click");
		await settle();
		expect(doc.body.querySelector(".dialog-layer")).toBeDefined();
	});

	it("exits delete mode when the trash is pressed with nothing selected", async () => {
		const doc = await boot();
		byId(doc, "delete-toggle").fire("click");
		await settle();
		byId(doc, "delete-toggle").fire("click");
		await settle();
		expect(calls.some((call) => call.method === "DELETE")).toBe(false);
		expect(byId(doc, "library-view").getAttribute("data-mode")).toBe("browse");
		expect(byId(doc, "library-hint").hidden).toBe(true);
		expect(byId(doc, "status").textContent).toContain("已退出删除模式");
	});

	it("does not select the new-article card", async () => {
		const doc = await boot();
		byId(doc, "delete-toggle").fire("click");
		await settle();
		const newCard = byId(doc, "article-grid").querySelectorAll(".article-card--new")[0];
		newCard.fire("click");
		await settle();
		expect(newCard.getAttribute("data-selected")).toBe("false");
		expect(doc.documentElement.dataset.view).toBe("library");
		expect(byId(doc, "library-hint").textContent).toContain("可多选");
	});

	it("deletes every selected article after one confirmation", async () => {
		const stored = stubStore();
		const doc = await boot();
		byId(doc, "delete-toggle").fire("click");
		await settle();
		cardById(doc, "art-one-0000").fire("click");
		cardById(doc, "art-two-0000").fire("click");
		byId(doc, "delete-toggle").fire("click");
		await settle();

		const dialog = doc.body.querySelector(".dialog-layer");
		expect(dialog?.children[0].querySelectorAll(".dialog__title")[0].textContent).toBe("删除这 2 篇文章?");
		dialog?.children[0].querySelectorAll(".dialog__button")[1].fire("click");
		await settle();
		await settle();

		const deletes = calls
			.filter((call) => call.method === "DELETE")
			.map((call) => call.url)
			.sort();
		expect(deletes).toEqual(["/api/articles/art-one-0000", "/api/articles/art-two-0000"]);
		expect(stored).toHaveLength(0);
		expect(cards(doc)).toHaveLength(1);
		expect(byId(doc, "library-view").getAttribute("data-mode")).toBe("browse");
		expect(byId(doc, "library-hint").hidden).toBe(true);
	});

	it("keeps a failed article selected and reports the count", async () => {
		const stored = stubStore(["art-two-0000"]);
		const doc = await boot();
		byId(doc, "delete-toggle").fire("click");
		await settle();
		cardById(doc, "art-one-0000").fire("click");
		cardById(doc, "art-two-0000").fire("click");
		byId(doc, "delete-toggle").fire("click");
		await settle();
		doc.body.querySelector(".dialog-layer")?.children[0].querySelectorAll(".dialog__button")[1].fire("click");
		await settle();
		await settle();

		expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(2);
		expect(stored.map((article) => article.id)).toEqual(["art-two-0000"]);
		expect(cards(doc)).toHaveLength(2);
		expect(cardById(doc, "art-two-0000").getAttribute("data-selected")).toBe("true");
		expect(byId(doc, "library-view").getAttribute("data-mode")).toBe("delete");
		expect(byId(doc, "status").textContent).toContain("1 篇删除失败");
		expect(byId(doc, "library-hint").textContent).toContain("1 篇删除失败");
	});
});

describe("delete selection across refresh", () => {
	it("keeps a selected card when the list reloads", async () => {
		const doc = createDocument();
		const controller = makeController(doc);
		await controller.refresh();
		byId(doc, "delete-toggle").fire("click");
		cardById(doc, "art-one-0000").fire("click");
		await controller.refresh();
		expect(controller.selected()).toEqual(["art-one-0000"]);
		expect(cardById(doc, "art-one-0000").getAttribute("data-selected")).toBe("true");
	});

	it("drops a selected id that disappeared from the list", async () => {
		const stored = stubStore();
		const doc = createDocument();
		const controller = makeController(doc);
		await controller.refresh();
		byId(doc, "delete-toggle").fire("click");
		cardById(doc, "art-one-0000").fire("click");
		cardById(doc, "art-two-0000").fire("click");
		stored.splice(
			stored.findIndex((article) => article.id === "art-two-0000"),
			1,
		);
		await controller.refresh();
		expect(controller.selected()).toEqual(["art-one-0000"]);
		expect(byId(doc, "library-hint").textContent).toContain("已选 1 篇");
	});
});

describe("theme and settings", () => {
	it("mirrors the theme across both views", async () => {
		const doc = await boot();
		byId(doc, "library-theme-toggle").fire("click");
		expect(doc.documentElement.dataset.theme).toBe("dark");
		expect(byId(doc, "theme-toggle").getAttribute("aria-label")).toBe("切换到亮色模式");
		byId(doc, "theme-toggle").fire("click");
		expect(doc.documentElement.dataset.theme).toBe("light");
		expect(byId(doc, "library-theme-toggle").getAttribute("aria-label")).toBe("切换到暗色模式");
	});

	it("opens the settings dialog", async () => {
		const doc = await boot();
		byId(doc, "settings-button").fire("click");
		await settle();
		expect(doc.body.querySelector(".dialog--settings")).not.toBeNull();
		expect(byId(doc, "settings-heading").textContent).toBe("设置");
	});
});