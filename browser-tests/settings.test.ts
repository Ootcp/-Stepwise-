import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeElement, FakeHtmlElement, createDocument, resetStorage, stubStorage, type FakeDocument } from "./dom-stub.ts";

const calls: Array<{ method: string; url: string; body: unknown }> = [];

const builtin = {
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
};

let settings = {
	version: 1,
	providers: [builtin],
	defaultProviderId: "sensenova",
	crossApiFallback: true,
	manualModelSelection: false,
	structured: { mode: "auto" },
	prose: { mode: "auto" },
	warnings: [],
};

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "content-type": "application/json" },
	});
}

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
	for (let index = 0; index < 16; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function boot(): Promise<FakeDocument> {
	const doc = install();
	vi.resetModules();
	await import("../web/main.ts");
	await settle();
	byId(doc, "home-enter").fire("click");
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
	settings = {
		version: 1,
		providers: [builtin],
		defaultProviderId: "sensenova",
		crossApiFallback: true,
		manualModelSelection: false,
		structured: { mode: "auto" },
		prose: { mode: "auto" },
		warnings: [],
	};
	vi.stubGlobal("fetch", async (input: unknown, init?: { body?: string; method?: string }) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		const body = init?.body ? JSON.parse(init.body) : undefined;
		calls.push({ method, url, body });
		if (url === "/api/articles" && method === "GET") return jsonResponse({ articles: [] });
		if (url === "/api/health") return jsonResponse({ ok: true, dictionary: "ecdict", llmModel: "auto", ecdictPath: null });
		if (url === "/api/settings" && method === "GET") return jsonResponse({ settings });
		if (url === "/api/settings" && method === "PUT") {
			settings = { ...settings, ...body };
			return jsonResponse({ settings });
		}
		if (url === "/api/settings/models" && method === "POST") {
			return jsonResponse({ models: [{ id: "m1", chat: true }, { id: "m2", chat: true }], at: 1 });
		}
		if (url === "/api/settings/test-model" && method === "POST") {
			return jsonResponse({ model: body.model, status: "healthy", latencyMs: 12 });
		}
		if (url === "/api/settings/providers" && method === "POST") {
			const provider = {
				id: "p-new-0000",
				name: body.name,
				baseUrl: body.baseUrl,
				kind: "custom",
				enabled: true,
				keySource: "settings",
				hasKey: true,
				keyMasked: "sk-…9999",
				defaultModelId: body.models?.[0],
				models: body.models ?? [],
				compat: body.compat ?? { jsonMode: true, maxTokensField: "max_tokens" },
				editable: true,
				deletable: true,
			};
			settings = { ...settings, providers: [...settings.providers, provider] } as typeof settings;
			return jsonResponse({ provider, settings }, 201);
		}
		return jsonResponse({ ok: true });
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("settings dialog", () => {
	it("opens from the library settings button and masks the key", async () => {
		const doc = await boot();
		byId(doc, "settings-button").fire("click");
		await settle();

		expect(doc.body.querySelector(".dialog--settings")).not.toBeNull();
		expect(byId(doc, "settings-heading").textContent).toBe("设置");
		const dialog = doc.body.querySelector(".dialog--settings")!;
		expect(dialog.textValue).toContain("SenseNova");
		expect(dialog.textValue).toContain("sk-…1234");
		expect(dialog.textValue).not.toContain("sk-secret");
	});

	it("switches between the API and help tabs", async () => {
		const doc = await boot();
		byId(doc, "settings-button").fire("click");
		await settle();

		const helpTab = doc.body.querySelectorAll(".settings__tab").find((tab) => tab.dataset.panel === "help")!;
		helpTab.fire("click");
		const panels = doc.body.querySelectorAll(".settings__panel");
		const help = panels.find((panel) => panel.dataset.panel === "help")!;
		const api = panels.find((panel) => panel.dataset.panel === "api")!;
		expect(help.hidden).toBe(false);
		expect(api.hidden).toBe(true);
		expect(help.textValue).toContain("OpenAI 兼容");
	});

	it("adds a provider, queries models, tests one and saves it", async () => {
		const doc = await boot();
		byId(doc, "settings-button").fire("click");
		await settle();
		doc.body.querySelector(".settings__add")!.fire("click");

		const form = doc.body.querySelector(".settings__form")!;
		expect(form.hidden).toBe(false);
		const name = doc.body.querySelector(".settings__input--name")!;
		const baseUrl = doc.body.querySelector(".settings__input--base-url")!;
		const key = doc.body.querySelector(".settings__input--api-key")!;
		name.value = "My API";
		baseUrl.value = "https://api.example.com/v1";
		key.value = "sk-new-secret";

		doc.body.querySelector(".settings__form-query")!.fire("click");
		await settle();
		const formModels = doc.body.querySelector(".settings__form-models")!;
		expect(formModels.querySelectorAll(".settings__model")).toHaveLength(2);
		expect(formModels.textValue).toContain("m1");

		formModels.querySelectorAll(".settings__model-test")[0].fire("click");
		await settle();
		expect(formModels.textValue).toContain("可用");

		doc.body.querySelector(".settings__form-save")!.fire("click");
		await settle();
		const create = calls.find((call) => call.url === "/api/settings/providers" && call.method === "POST");
		expect(create).toBeDefined();
		expect((create?.body as Record<string, unknown>).apiKey).toBe("sk-new-secret");
		expect(doc.body.querySelectorAll(".settings__provider")).toHaveLength(2);
		expect(form.hidden).toBe(true);
	});

	it("saves the two strategy switches and a pinned model group", async () => {
		const doc = await boot();
		byId(doc, "settings-button").fire("click");
		await settle();

		const cross = doc.body.querySelector(".settings__switch--cross")!;
		expect(cross.getAttribute("aria-checked")).toBe("true");
		cross.fire("click");
		expect(cross.getAttribute("aria-checked")).toBe("false");

		const manual = doc.body.querySelector(".settings__switch--manual")!;
		manual.fire("click");
		const groups = doc.body.querySelector(".settings__groups")!;
		expect(groups.hidden).toBe(false);

		const structured = doc.body.querySelectorAll(".settings__group-select").find((select) => select.dataset.group === "structured")!;
		structured.value = "sensenova::glm-5.2";
		structured.fire("change");

		doc.body.querySelector(".settings__save")!.fire("click");
		await settle();
		const saved = calls.find((call) => call.url === "/api/settings" && call.method === "PUT");
		expect(saved).toBeDefined();
		const body = saved?.body as {
			crossApiFallback: boolean;
			manualModelSelection: boolean;
			structured: { mode: string; providerId?: string; modelId?: string };
		};
		expect(body.crossApiFallback).toBe(false);
		expect(body.manualModelSelection).toBe(true);
		expect(body.structured).toEqual({ mode: "pinned", providerId: "sensenova", modelId: "glm-5.2" });
	});

	it("closes with Escape and the backdrop", async () => {
		const doc = await boot();
		byId(doc, "settings-button").fire("click");
		await settle();
		doc.fire("keydown", { key: "Escape" });
		await settle();
		expect(doc.body.querySelector(".dialog--settings")).toBeNull();

		byId(doc, "settings-button").fire("click");
		await settle();
		doc.body.querySelector(".dialog-layer--settings")!.fire("click");
		await settle();
		expect(doc.body.querySelector(".dialog--settings")).toBeNull();
	});

	it("shows an error and keeps the dialog open when settings cannot load", async () => {
		vi.stubGlobal("fetch", async (input: unknown) => {
			const url = String(input);
			if (url === "/api/articles") return jsonResponse({ articles: [] });
			if (url === "/api/health") return jsonResponse({ ok: true, dictionary: "ecdict", llmModel: "auto", ecdictPath: null });
			if (url === "/api/settings") return jsonResponse({ error: "settings down" }, 500);
			return jsonResponse({ ok: true });
		});
		const doc = await boot();
		byId(doc, "settings-button").fire("click");
		await settle();
		const error = doc.body.querySelector(".settings__error")!;
		expect(error.hidden).toBe(false);
		expect(error.textValue).toContain("settings down");
		expect(doc.body.querySelector(".dialog--settings")).not.toBeNull();
	});
});
