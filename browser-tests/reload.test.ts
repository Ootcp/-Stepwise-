import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeElement, FakeHtmlElement, createDocument, resetStorage, stubStorage, type FakeDocument } from "./dom-stub.ts";

/**
 * Reload and history behaviour.
 *
 * Both bugs here came from the reader being restored from the URL. Reloading on a reader URL
 * ran the restore before the article session existed, and a history entry for a new article
 * (`#/reader/new`) was read back as an article whose id was the literal string "new".
 */

const calls: Array<{ method: string; url: string; body: unknown }> = [];
const articles = [
	{ id: "art-one-0000", title: "The Early Bird", createdAt: 1, updatedAt: 200, preview: "The early bird catches the worm." },
];

function jsonResponse(payload: unknown): Response {
	return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

function notFound(): Response {
	return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
	resetStorage();
	calls.length = 0;
	vi.stubGlobal("fetch", async (input: unknown, init?: { body?: string; method?: string }) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		const body = init?.body ? JSON.parse(init.body) : undefined;
		calls.push({ method, url, body });
		if (url.startsWith("/api/articles") && method === "GET" && !url.includes("/art-")) return jsonResponse({ articles });
		if (url.includes("/api/articles/") && method === "GET") {
			if (url.endsWith("/art-new-0000")) {
				return jsonResponse({
					article: {
						version: 1,
						id: "art-new-0000",
						title: "New article",
						createdAt: 3,
						updatedAt: 3,
						text: body?.text ?? "One sentence. Another sentence.",
						sentences: [],
					},
				});
			}
			if (!url.endsWith("/art-one-0000")) return notFound();
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
					title: "New article",
					createdAt: 3,
					updatedAt: 3,
					text: body?.text ?? "One sentence. Another sentence.",
					sentences: [],
					clicks: {},
					weakGrammar: [],
				},
			});
		}
		if (url === "/api/health") return jsonResponse({ ok: true, dictionary: "ecdict", llmModel: "x", ecdictPath: null });
		return jsonResponse({ ok: true });
	});
});

afterEach(() => vi.unstubAllGlobals());

function install(hash?: string): FakeDocument {
	const doc = createDocument();
	const scope = globalThis as Record<string, unknown>;
	scope.document = doc;
	scope.localStorage = stubStorage();
	// Element and HTMLElement are not the same thing: an SVG element is an Element and
	// not an HTMLElement, and the app's click guards have to tell them apart.
	scope.Element = FakeElement;
	scope.HTMLElement = FakeHtmlElement;
	if (hash) hashLocation(doc, hash);
	return doc;
}

function hashLocation(doc: FakeDocument, hash: string): void {
	(doc.defaultView as unknown as { history: { location: { hash: string } } }).history.location.hash = hash;
}

function hashOf(doc: FakeDocument): string {
	return (doc.defaultView as unknown as { history: { location: { hash: string } } }).history.location.hash;
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

function byId(doc: FakeDocument, id: string): FakeElement {
	const found = doc.body.querySelector(`#${id}`);
	if (!found) throw new Error(`missing #${id}`);
	return found;
}

function posts(): number {
	return calls.filter((call) => call.method === "POST" && call.url === "/api/articles").length;
}

/** Walks in from the landing page, which is where a hashless URL now lands. */
async function enterLibrary(doc: FakeDocument): Promise<void> {
	byId(doc, "home-enter").fire("click");
	await settle();
}

describe("reloading on a reader URL", () => {
	it("restores the article instead of leaving the reader empty", async () => {
		const doc = await boot("#/reader/art-one-0000");
		expect(doc.documentElement.dataset.view).toBe("reader");
		expect(byId(doc, "article-input").value).toBe("The early bird catches the worm.");
		expect(byId(doc, "article").querySelectorAll(".sentence").length).toBeGreaterThan(0);
	});

	it("opens a blank reader for the new-article URL", async () => {
		const doc = await boot("#/reader/new");
		expect(doc.documentElement.dataset.view).toBe("reader");
		expect(byId(doc, "article-input").value).toBe("");
		// It must not try to fetch an article called "new".
		expect(calls.filter((call) => call.url.endsWith("/new"))).toHaveLength(0);
	});

	it("falls back to the library when a stored article no longer loads", async () => {
		const doc = await boot("#/reader/unknown-id");
		expect(doc.documentElement.dataset.view).toBe("library");
		expect(byId(doc, "article-input").value).toBe("");
		expect(byId(doc, "status").textContent).toContain("载入失败");
		expect(posts()).toBe(0);
	});
});

describe("history entries", () => {
	it("writes the library hash when the reader is left", async () => {
		const doc = await boot();
		await enterLibrary(doc);
		byId(doc, "article-grid").querySelectorAll(".article-card")[0].fire("click");
		await settle();
		expect(hashOf(doc)).toContain("#/reader/art-one-0000");

		byId(doc, "back-button").fire("click");
		await settle();
		expect(hashOf(doc)).toContain("#/library");
	});

	it("saves a new article once when it is created through the dialog", async () => {
		const doc = await boot();
		await enterLibrary(doc);
		byId(doc, "article-grid").querySelectorAll(".article-card--new")[0].fire("click");
		await settle();
		byId(doc, "article-dialog-body").value = "One sentence. Another sentence.";
		byId(doc, "article-dialog-save").fire("click");
		await settle();
		await settle();
		expect(doc.documentElement.dataset.view).toBe("reader");
		expect(posts(), "created once").toBe(1);

		byId(doc, "back-button").fire("click");
		await settle();
		expect(doc.documentElement.dataset.view).toBe("library");
		expect(posts(), "still only one article").toBe(1);
	});
});
