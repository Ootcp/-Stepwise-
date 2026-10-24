import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "shiji-settings-"));
const agentDir = mkdtempSync(join(tmpdir(), "shiji-agent-"));
const previousData = process.env.ENGLISH_APP_DATA_DIR;
const previousAgent = process.env.PI_CODING_AGENT_DIR;
const previousKey = process.env.SENSENOVA_API_KEY;
process.env.ENGLISH_APP_DATA_DIR = dataDir;
process.env.PI_CODING_AGENT_DIR = agentDir;
delete process.env.SENSENOVA_API_KEY;

const settings = await import("../server/settings.ts");
const { SettingsError } = settings;

function readFile(): Record<string, unknown> {
	return JSON.parse(readFileSync(settings.settingsPath(), "utf8")) as Record<string, unknown>;
}

beforeEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	mkdirSync(dataDir, { recursive: true });
	delete process.env.SENSENOVA_API_KEY;
	settings.reloadSettings();
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	settings.reloadSettings();
});

afterAll(() => {
	if (previousData === undefined) delete process.env.ENGLISH_APP_DATA_DIR;
	else process.env.ENGLISH_APP_DATA_DIR = previousData;
	if (previousAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgent;
	if (previousKey === undefined) delete process.env.SENSENOVA_API_KEY;
	else process.env.SENSENOVA_API_KEY = previousKey;
	rmSync(dataDir, { recursive: true, force: true });
	rmSync(agentDir, { recursive: true, force: true });
});

describe("settings defaults", () => {
	it("starts with only the built-in provider and automatic groups", () => {
		const view = settings.settingsView();
		expect(view.providers).toHaveLength(1);
		expect(view.providers[0].id).toBe("sensenova");
		expect(view.providers[0].kind).toBe("builtin");
		expect(view.providers[0].hasKey).toBe(false);
		expect(view.defaultProviderId).toBe("sensenova");
		expect(view.crossApiFallback).toBe(true);
		expect(view.manualModelSelection).toBe(false);
		expect(view.structured).toEqual({ mode: "auto" });
		expect(view.prose).toEqual({ mode: "auto" });
		expect(view.warnings.join(" ")).toContain("未配置 API Key");
	});

	it("reports an environment key as the built-in source without writing it", () => {
		process.env.SENSENOVA_API_KEY = "sk-env-secret-123456";
		settings.reloadSettings();
		const view = settings.settingsView();
		expect(view.providers[0].keySource).toBe("env");
		expect(view.providers[0].hasKey).toBe(true);
		expect(view.providers[0].keyMasked).toBe("sk-…3456");
		expect(JSON.stringify(view)).not.toContain("sk-env-secret-123456");
	});
});

describe("provider CRUD", () => {
	function create(overrides: Record<string, unknown> = {}) {
		return settings.createProvider({
			name: "DeepSeek",
			baseUrl: "https://api.deepseek.com/v1/",
			apiKey: "sk-custom-secret-123456",
			models: ["deepseek-chat"],
			defaultModelId: "deepseek-chat",
			...overrides,
		});
	}

	it("creates a provider, persists it, and masks the key", () => {
		const before = settings.settingsRevision();
		const provider = create();
		expect(provider.id).toMatch(/^p-[a-f0-9]{8}$/);
		expect(provider.baseUrl).toBe("https://api.deepseek.com/v1");
		expect(provider.hasKey).toBe(true);
		expect(provider.keyMasked).toBe("sk-…3456");
		expect(settings.settingsRevision()).toBe(before + 1);
		expect(JSON.stringify(settings.settingsView())).not.toContain("sk-custom-secret-123456");
		expect(readFile().providers).toHaveLength(1);
		expect(() => statSync(`${settings.settingsPath()}.tmp`)).toThrow();
		if (process.platform !== "win32") {
			expect(statSync(settings.settingsPath()).mode & 0o777).toBe(0o600);
		}
	});

	it("keeps a blank key on update and can explicitly clear it", () => {
		const provider = create();
		settings.updateProvider(provider.id, { name: "DeepSeek 2", apiKey: "" });
		expect(settings.settingsView().providers[1].hasKey).toBe(true);
		settings.updateProvider(provider.id, { clearKey: true });
		expect(settings.settingsView().providers[1].hasKey).toBe(false);
	});

	it("validates URL, name, key and reserved ids", () => {
		expect(() => create({ baseUrl: "file:///tmp/x" })).toThrow(SettingsError);
		expect(() => create({ baseUrl: "https://user:pass@example.com/v1" })).toThrow(SettingsError);
		expect(() => create({ name: "" })).toThrow(SettingsError);
		expect(() => create({ apiKey: "" })).toThrow(SettingsError);
		expect(() => settings.updateProvider("sensenova", { name: "x" })).toThrow("不能在这里修改");
		expect(() => settings.deleteProvider("sensenova")).toThrow("不能删除");
	});

	it("updates the cached model list and default model", () => {
		const provider = create();
		const updated = settings.updateProviderModels(provider.id, ["m1", "m2"]);
		expect(updated.models).toEqual(["m1", "m2"]);
		// The old default no longer exists, so the first model wins.
		expect(updated.defaultModelId).toBe("m1");
	});

	it("resets the default and pinned groups when a provider is deleted", () => {
		const provider = create();
		settings.updateSettings({
			defaultProviderId: provider.id,
			manualModelSelection: true,
			structured: { mode: "pinned", providerId: provider.id, modelId: "deepseek-chat" },
			prose: { mode: "auto" },
		});
		const view = settings.deleteProvider(provider.id);
		expect(view.defaultProviderId).toBe("sensenova");
		expect(view.structured).toEqual({ mode: "auto" });
	});
});

describe("settings patch", () => {
	it("saves switches, default provider and pinned groups", () => {
		process.env.SENSENOVA_API_KEY = "sk-env-12345678";
		settings.reloadSettings();
		const view = settings.updateSettings({
			defaultProviderId: "sensenova",
			crossApiFallback: false,
			manualModelSelection: true,
			structured: { mode: "pinned", providerId: "sensenova", modelId: "deepseek-v4-flash" },
			prose: { mode: "auto" },
		});
		expect(view.crossApiFallback).toBe(false);
		expect(view.manualModelSelection).toBe(true);
		expect(view.structured).toEqual({ mode: "pinned", providerId: "sensenova", modelId: "deepseek-v4-flash" });
	});

	it("rejects a default provider that does not exist", () => {
		expect(() => settings.updateSettings({ defaultProviderId: "p-missing" })).toThrow(SettingsError);
	});

	it("drops invalid pins when reading a corrupt-ish file", () => {
		writeFileSync(
			settings.settingsPath(),
			JSON.stringify({
				version: 1,
				providers: [],
				defaultProviderId: "sensenova",
				crossApiFallback: true,
				manualModelSelection: true,
				structured: { mode: "pinned", providerId: "p-missing", modelId: "x" },
				prose: { mode: "auto" },
			}),
			"utf8",
		);
		settings.reloadSettings();
		expect(settings.settingsView().structured).toEqual({ mode: "auto" });
	});

	it("falls back to defaults for a corrupt file", () => {
		writeFileSync(settings.settingsPath(), "{ not json", "utf8");
		settings.reloadSettings();
		expect(settings.settingsView().providers).toHaveLength(1);
		expect(settings.settingsView().defaultProviderId).toBe("sensenova");
	});
});
