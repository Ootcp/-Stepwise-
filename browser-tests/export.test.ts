import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeElement, FakeHtmlElement, createDocument, resetStorage, stubStorage, type FakeDocument } from "./dom-stub.ts";

/**
 * The export sheet is the only path from the reader's weak-word list to a file, so this
 * drives the real entry point: open a word, choose a template and content, confirm, and
 * check the request body and the downloaded blob.
 */

const calls: Array<{ method: string; url: string; body: unknown }> = [];
let exportReply: () => Response = () => new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), { status: 200 });
const downloads: Blob[] = [];
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

function jsonResponse(payload: unknown): Response {
	return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
	resetStorage();
	calls.length = 0;
	downloads.length = 0;
	exportReply = () => new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), { status: 200 });
	const scope = globalThis as Record<string, unknown>;
	scope.speechSynthesis = {
		cancel: () => {},
		getVoices: () => [{ lang: "en-US", name: "American" }],
		speak: () => {},
	};
	scope.SpeechSynthesisUtterance = function (this: Record<string, unknown>, text: string) {
		this.text = text;
		this.lang = "";
		this.rate = 1;
		this.pitch = 1;
		this.voice = undefined;
	};
	URL.createObjectURL = (blob: Blob): string => {
		downloads.push(blob);
		return "blob:export";
	};
	URL.revokeObjectURL = () => {};
	vi.stubGlobal("fetch", async (input: unknown, init?: { body?: string; method?: string }) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		const body = init?.body ? JSON.parse(init.body) : undefined;
		calls.push({ method, url, body });
		if (url.includes("/api/export/word")) return exportReply();
		if (url.includes("/api/lookup")) {
			const words = (body as { words?: string[] }).words ?? [];
			return jsonResponse({
				entries: Object.fromEntries(
					words.map((word: string) => [word, { pos: "adj.", meaning: `释义-${word}`, ipa: `/${word}/` }]),
				),
			});
		}
		return jsonResponse({ ok: true });
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
	URL.createObjectURL = originalCreate;
	URL.revokeObjectURL = originalRevoke;
});

function install(): FakeDocument {
	const doc = createDocument();
	const scope = globalThis as Record<string, unknown>;
	scope.document = doc;
	scope.localStorage = stubStorage();
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

function dialog(doc: FakeDocument): FakeElement | null {
	return doc.body.querySelector(".dialog--export");
}

function templateButton(doc: FakeDocument, template: string): FakeElement {
	const found = doc.body
		.querySelectorAll(".export-template")
		.find((button) => button.getAttribute("data-template") === template);
	if (!found) throw new Error(`missing template ${template}`);
	return found;
}

function contentButton(doc: FakeDocument, content: string): FakeElement {
	const found = doc.body
		.querySelectorAll(".export-mode")
		.find((button) => button.getAttribute("data-content") === content);
	if (!found) throw new Error(`missing content ${content}`);
	return found;
}

describe("weak-word export", () => {
	it("disables the export button until this article has a clicked word", async () => {
		const doc = await openReaderWith("A serene library.");
		const button = byId(doc, "summary-export");
		expect(button.disabled).toBe(true);
		button.fire("click");
		expect(dialog(doc)).toBeFalsy();

		await clickWord(doc, 1);
		expect(byId(doc, "summary-export").disabled).toBe(false);
	});

	it("opens with the flash-card template and both sides selected", async () => {
		const doc = await openReaderWith("A serene library.");
		await clickWord(doc, 1);
		byId(doc, "summary-export").fire("click");

		expect(dialog(doc)).toBeDefined();
		expect(doc.body.querySelectorAll(".export-template")).toHaveLength(8);
		expect(templateButton(doc, "color-cards").getAttribute("aria-checked")).toBe("true");
		expect(templateButton(doc, "classic-green").getAttribute("aria-checked")).toBe("false");
		expect(templateButton(doc, "fresh-blue").getAttribute("aria-checked")).toBe("false");
		expect(contentButton(doc, "both").getAttribute("aria-checked")).toBe("true");
	});

	it("locks the content choice on the spelling test and explains why", async () => {
		const doc = await openReaderWith("A serene library.");
		await clickWord(doc, 1);
		byId(doc, "summary-export").fire("click");
		templateButton(doc, "spelling-test").fire("click");

		expect(templateButton(doc, "spelling-test").getAttribute("aria-checked")).toBe("true");
		const modes = doc.body.querySelectorAll(".export-mode");
		expect(modes.every((mode) => mode.disabled)).toBe(true);
		expect(modes.every((mode) => mode.getAttribute("aria-checked") === "false")).toBe(true);
		const note = doc.body.querySelector(".export-lock-note");
		expect(note?.hidden).toBe(false);
		expect(note?.textValue).toContain("固定双向自测");
	});

	it("sends the chosen template, content and snapshot, then downloads a .docx", async () => {
		const doc = await openReaderWith("A serene library.");
		await clickWord(doc, 1);
		byId(doc, "summary-export").fire("click");

		templateButton(doc, "classic-green").fire("click");
		contentButton(doc, "meaning").fire("click");
		byId(doc, "export-confirm").fire("click");
		await settle();
		await settle();

		const request = calls.find((call) => call.url.includes("/api/export/word"));
		expect(request?.method).toBe("POST");
		expect(request?.body).toMatchObject({
			template: "classic-green",
			content: "meaning",
			words: [{ word: "serene", ipa: "/serene/", pos: "adj.", gloss: "adj. 释义-serene" }],
		});
		expect(downloads).toHaveLength(1);
		const bytes = new Uint8Array(await downloads[0]!.arrayBuffer());
		expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
		expect(dialog(doc)).toBeFalsy();
	});

	it("keeps the sheet open and shows the server error when the export fails", async () => {
		exportReply = () =>
			new Response(JSON.stringify({ error: "没有可导出的单词。" }), {
				status: 400,
				headers: { "content-type": "application/json" },
			});
		const doc = await openReaderWith("A serene library.");
		await clickWord(doc, 1);
		byId(doc, "summary-export").fire("click");
		byId(doc, "export-confirm").fire("click");
		await settle();

		expect(dialog(doc)).toBeDefined();
		expect(doc.body.querySelector(".dialog__error--export")?.textValue).toContain("没有可导出的单词。");
		expect(downloads).toHaveLength(0);
	});
});
