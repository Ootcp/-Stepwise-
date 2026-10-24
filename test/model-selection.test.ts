import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "shiji-selection-"));
const previousData = process.env.ENGLISH_APP_DATA_DIR;
const previousKey = process.env.SENSENOVA_API_KEY;
process.env.ENGLISH_APP_DATA_DIR = dataDir;
process.env.SENSENOVA_API_KEY = "sk-env-test-123456";

const settings = await import("../server/settings.ts");
const llm = await import("../server/llm.ts");

function reply(
	text: string,
	stopReason: AssistantMessage["stopReason"] = "stop",
	errorMessage?: string,
): AssistantMessage {
	return {
		role: "assistant",
		content: text ? [{ type: "text", text }] : [],
		stopReason,
		errorMessage,
	} as unknown as AssistantMessage;
}

function createCustom(overrides: Record<string, unknown> = {}) {
	return settings.createProvider({
		name: "Custom",
		baseUrl: "https://api.example.com/v1",
		apiKey: "sk-custom-test",
		models: ["m1", "m2"],
		defaultModelId: "m1",
		...overrides,
	});
}

beforeEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	mkdirSync(dataDir, { recursive: true });
	process.env.SENSENOVA_API_KEY = "sk-env-test-123456";
	settings.reloadSettings();
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	settings.reloadSettings();
});

afterAll(() => {
	if (previousData === undefined) delete process.env.ENGLISH_APP_DATA_DIR;
	else process.env.ENGLISH_APP_DATA_DIR = previousData;
	if (previousKey === undefined) delete process.env.SENSENOVA_API_KEY;
	else process.env.SENSENOVA_API_KEY = previousKey;
	rmSync(dataDir, { recursive: true, force: true });
});

describe("target helpers", () => {
	it("round-trips composite keys, including model ids containing ::", () => {
		expect(llm.targetKey({ providerId: "p-a", modelId: "m::x" })).toBe("p-a::m::x");
		expect(llm.parseTargetKey("p-a::m::x")).toEqual({ providerId: "p-a", modelId: "m::x" });
		expect(llm.parseTargetKey("broken")).toBeUndefined();
	});

	it("picks task-specific auto targets for the built-in provider", () => {
		const builtin = settings.builtinProvider();
		expect(llm.autoTargetFor("structured", builtin)).toEqual({
			providerId: "sensenova",
			modelId: "deepseek-v4-flash",
		});
		expect(llm.autoTargetFor("prose", builtin)).toEqual({
			providerId: "sensenova",
			modelId: "glm-5.2",
		});
	});

	it("orders same-provider fallbacks and appends other providers only when enabled", () => {
		const custom = createCustom();
		const empty = createCustom({ name: "Empty", models: [], defaultModelId: undefined });
		const providers = settings.resolveProviders();
		const primary = { providerId: "sensenova", modelId: "deepseek-v4-flash" };
		const same = llm.sameProviderFallback(primary, providers);
		expect(same[0]).toBe("sensenova::glm-5.2");
		expect(same).not.toContain("sensenova::deepseek-v4-flash");

		const across = llm.crossProviderFallback(primary, providers, true);
		expect(across).toContain(`${custom.id}::m1`);
		expect(across).not.toContain(`${empty.id}::m1`);
		expect(llm.crossProviderFallback(primary, providers, false)).toEqual(same);
	});
});

describe("resolvePrimaryTarget", () => {
	it("uses the built-in word/prose models in auto mode", () => {
		const providers = settings.resolveProviders();
		expect(llm.resolvePrimaryTarget("structured", providers)).toEqual({
			providerId: "sensenova",
			modelId: "deepseek-v4-flash",
		});
		expect(llm.resolvePrimaryTarget("prose", providers)).toEqual({
			providerId: "sensenova",
			modelId: "glm-5.2",
		});
	});

	it("uses a custom default model for both groups", () => {
		const custom = createCustom();
		settings.updateSettings({ defaultProviderId: custom.id });
		const providers = settings.resolveProviders();
		expect(llm.resolvePrimaryTarget("structured", providers)).toEqual({
			providerId: custom.id,
			modelId: "m1",
		});
		expect(llm.resolvePrimaryTarget("prose", providers)).toEqual({
			providerId: custom.id,
			modelId: "m1",
		});
	});

	it("falls back to the built-in target when a custom default has no models", () => {
		const empty = createCustom({ name: "Empty", models: [], defaultModelId: undefined });
		settings.updateSettings({ defaultProviderId: empty.id });
		const providers = settings.resolveProviders();
		expect(llm.resolvePrimaryTarget("structured", providers)).toEqual({
			providerId: "sensenova",
			modelId: "deepseek-v4-flash",
		});
	});

	it("uses pinned models only while the manual switch is on", () => {
		const custom = createCustom();
		settings.updateSettings({
			manualModelSelection: true,
			structured: { mode: "pinned", providerId: custom.id, modelId: "m2" },
			prose: { mode: "auto" },
		});
		let providers = settings.resolveProviders();
		expect(llm.resolvePrimaryTarget("structured", providers)).toEqual({
			providerId: custom.id,
			modelId: "m2",
		});
		expect(llm.resolvePrimaryTarget("prose", providers)).toEqual({
			providerId: "sensenova",
			modelId: "glm-5.2",
		});

		settings.updateSettings({ manualModelSelection: false });
		providers = settings.resolveProviders();
		expect(llm.resolvePrimaryTarget("structured", providers)).toEqual({
			providerId: "sensenova",
			modelId: "deepseek-v4-flash",
		});
	});
});

describe("classifyTestReply", () => {
	it("accepts any non-empty answer for the settings test", () => {
		expect(llm.classifyTestReply(reply("OK"))).toBe("healthy");
		expect(llm.classifyTestReply(reply('{"ok":true}', "length"))).toBe("healthy");
		expect(llm.classifyTestReply(reply(""))).toBe("unavailable");
		expect(llm.classifyTestReply(reply("", "stop", "403: forbidden"))).toBe("unavailable");
		expect(llm.classifyTestReply(reply("", "error", "429: slow down"))).toBe("unverified");
	});
});
