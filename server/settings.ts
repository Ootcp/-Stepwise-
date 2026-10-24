import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { dataRoot, ensureDataRoot } from "./paths.ts";
import {
	BUILTIN_MODEL_IDS,
	FALLBACK_MODEL_IDS,
	PROVIDER_ID,
	resolveApiKeyInfo,
	resolveBaseUrl,
	SENTENCE_MODEL_ID,
	WORD_MODEL_ID,
	type ApiKeySource,
} from "./config.ts";

/**
 * Local settings: user-configured OpenAI-compatible providers, the default provider,
 * cross-provider fallback, and the two model-selection groups.
 *
 * Keys are stored only here (mode 0600 where the platform supports it) and are never
 * returned by the HTTP layer. The built-in SenseNova provider is synthesized from
 * SENSENOVA_API_KEY / ~/.pi/agent/models.json and is never written into this file.
 */

export type ModelGroup = "structured" | "prose";
export type KeySource = ApiKeySource | "settings";
export type ModelSelection =
	| { mode: "auto" }
	| { mode: "pinned"; providerId: string; modelId: string };

export interface ProviderCompat {
	jsonMode?: boolean;
	maxTokensField?: "max_tokens" | "max_completion_tokens";
}

export interface StoredProvider {
	id: string;
	name: string;
	baseUrl: string;
	apiKey?: string;
	enabled: boolean;
	defaultModelId?: string;
	models: string[];
	modelsAt?: number;
	compat?: ProviderCompat;
	createdAt: number;
	updatedAt: number;
}

export interface StoredSettings {
	version: 1;
	providers: StoredProvider[];
	defaultProviderId: string;
	crossApiFallback: boolean;
	manualModelSelection: boolean;
	structured: ModelSelection;
	prose: ModelSelection;
}

export interface ResolvedProvider {
	id: string;
	name: string;
	baseUrl: string;
	apiKey?: string;
	kind: "builtin" | "custom";
	enabled: boolean;
	models: readonly string[];
	defaultModelId?: string;
	compat: ProviderCompat;
	keySource: KeySource;
}

export interface ProviderView {
	id: string;
	name: string;
	baseUrl: string;
	kind: "builtin" | "custom";
	enabled: boolean;
	keySource: KeySource;
	hasKey: boolean;
	keyMasked: string;
	defaultModelId?: string;
	models: string[];
	modelsAt?: number;
	compat: ProviderCompat;
	editable: boolean;
	deletable: boolean;
	createdAt?: number;
	updatedAt?: number;
}

export interface SettingsView {
	version: 1;
	providers: ProviderView[];
	defaultProviderId: string;
	crossApiFallback: boolean;
	manualModelSelection: boolean;
	structured: ModelSelection;
	prose: ModelSelection;
	warnings: string[];
}

export interface SettingsPatch {
	defaultProviderId?: string;
	crossApiFallback?: boolean;
	manualModelSelection?: boolean;
	structured?: ModelSelection;
	prose?: ModelSelection;
}

export class SettingsError extends Error {
	readonly status: number;

	constructor(message: string, status = 400) {
		super(message);
		this.name = "SettingsError";
		this.status = status;
	}
}

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const MAX_PROVIDERS = 20;
const MAX_MODELS = 500;
const MAX_KEY = 4096;
const MAX_URL = 500;

function settingsFile(): string {
	return join(dataRoot(), "settings.json");
}

/** Test seam: where settings.json lives. */
export function settingsPath(): string {
	return settingsFile();
}

export function defaultSettings(): StoredSettings {
	return {
		version: 1,
		providers: [],
		defaultProviderId: PROVIDER_ID,
		crossApiFallback: true,
		manualModelSelection: false,
		structured: { mode: "auto" },
		prose: { mode: "auto" },
	};
}

let cached: StoredSettings | undefined;
let revision = 0;

export function settingsRevision(): number {
	return revision;
}

/** Drops the in-memory copy; used by tests and after an external file edit. */
export function reloadSettings(): void {
	cached = undefined;
}

export function readSettings(): StoredSettings {
	if (!cached) cached = loadSettings();
	return cached;
}

function loadSettings(): StoredSettings {
	try {
		return normalizeSettings(JSON.parse(readFileSync(settingsFile(), "utf8")));
	} catch {
		return defaultSettings();
	}
}

export function writeSettings(next: StoredSettings): void {
	const normalized = normalizeSettings(next);
	ensureDir();
	const path = settingsFile();
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(normalized, null, "\t")}\n`, { encoding: "utf8", mode: 0o600 });
	renameSync(tmp, path);
	// Windows ignores POSIX modes; this is best-effort there.
	try {
		chmodSync(path, 0o600);
	} catch {
		// Ignore platforms/filesystems that cannot chmod.
	}
	cached = normalized;
	revision += 1;
}

function ensureDir(): void {
	ensureDataRoot();
}

export function builtinProvider(): ResolvedProvider {
	const info = resolveApiKeyInfo();
	return {
		id: PROVIDER_ID,
		name: "SenseNova",
		baseUrl: resolveBaseUrl(),
		apiKey: info.key,
		kind: "builtin",
		enabled: true,
		models: BUILTIN_MODEL_IDS,
		defaultModelId: WORD_MODEL_ID,
		compat: { jsonMode: true, maxTokensField: "max_completion_tokens" },
		keySource: info.source,
	};
}

export function resolveProviders(): ResolvedProvider[] {
	const settings = readSettings();
	return [builtinProvider(), ...settings.providers.map(toResolvedProvider)];
}

export function resolveProvider(id: string): ResolvedProvider | undefined {
	if (id === PROVIDER_ID) return builtinProvider();
	return resolveProviders().find((provider) => provider.id === id);
}

function toResolvedProvider(provider: StoredProvider): ResolvedProvider {
	const models = [...new Set([...(provider.defaultModelId ? [provider.defaultModelId] : []), ...provider.models])];
	return {
		id: provider.id,
		name: provider.name,
		baseUrl: provider.baseUrl,
		apiKey: provider.apiKey,
		kind: "custom",
		enabled: provider.enabled,
		models,
		defaultModelId: provider.defaultModelId,
		compat: {
			jsonMode: provider.compat?.jsonMode ?? true,
			maxTokensField: provider.compat?.maxTokensField ?? "max_tokens",
		},
		keySource: provider.apiKey ? "settings" : "none",
	};
}

export function settingsView(): SettingsView {
	const settings = readSettings();
	const builtin = builtinProvider();
	const providers: ProviderView[] = [providerView(builtin)];
	for (const provider of settings.providers) providers.push(providerView(toResolvedProvider(provider)));
	return {
		version: 1,
		providers,
		defaultProviderId: settings.defaultProviderId,
		crossApiFallback: settings.crossApiFallback,
		manualModelSelection: settings.manualModelSelection,
		structured: settings.structured,
		prose: settings.prose,
		warnings: settingsWarnings(settings, providers),
	};
}

function providerView(provider: ResolvedProvider): ProviderView {
	return {
		id: provider.id,
		name: provider.name,
		baseUrl: provider.baseUrl,
		kind: provider.kind,
		enabled: provider.enabled,
		keySource: provider.keySource,
		hasKey: Boolean(provider.apiKey),
		keyMasked: maskKey(provider.apiKey),
		defaultModelId: provider.defaultModelId,
		models: [...provider.models],
		modelsAt: provider.kind === "builtin" ? undefined : readSettings().providers.find((row) => row.id === provider.id)?.modelsAt,
		compat: provider.compat,
		editable: provider.kind === "custom",
		deletable: provider.kind === "custom",
		createdAt: provider.kind === "custom" ? readSettings().providers.find((row) => row.id === provider.id)?.createdAt : undefined,
		updatedAt: provider.kind === "custom" ? readSettings().providers.find((row) => row.id === provider.id)?.updatedAt : undefined,
	};
}

function settingsWarnings(settings: StoredSettings, providers: ProviderView[]): string[] {
	const warnings: string[] = [];
	const builtin = providers.find((provider) => provider.id === PROVIDER_ID);
	if (!builtin?.hasKey) {
		warnings.push("内置 SenseNova 未配置 API Key；请设置 SENSENOVA_API_KEY 或 models.json，或添加自定义 API。");
	}
	const selected = providers.find((provider) => provider.id === settings.defaultProviderId);
	if (selected && !selected.enabled) warnings.push(`默认 API「${selected.name}」已停用。`);
	if (selected && !selected.hasKey) warnings.push(`默认 API「${selected.name}」还没有配置 API Key。`);
	return warnings;
}

export function maskKey(key: string | undefined): string {
	if (!key) return "";
	const value = key.trim();
	if (value.length <= 8) return "••••";
	return `${value.slice(0, 3)}…${value.slice(-4)}`;
}

export function normalizeBaseUrl(value: unknown): string {
	const raw = typeof value === "string" ? value.trim() : "";
	if (!raw) throw new SettingsError("Base URL 不能为空。");
	if (raw.length > MAX_URL) throw new SettingsError("Base URL 太长。");
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new SettingsError("Base URL 不是合法地址。");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new SettingsError("Base URL 只支持 http/https。");
	}
	if (url.username || url.password) throw new SettingsError("Base URL 不能包含账号或密码。");
	if (url.hash) throw new SettingsError("Base URL 不能包含 # 片段。");
	if (url.search) throw new SettingsError("Base URL 不能包含查询参数。");
	return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

function normalizeKey(value: unknown): string {
	const key = typeof value === "string" ? value.trim() : "";
	if (!key) throw new SettingsError("API Key 不能为空。");
	if (key.length > MAX_KEY) throw new SettingsError("API Key 太长。");
	if (/[\u0000-\u001f\u007f]/.test(key)) throw new SettingsError("API Key 不能包含换行或控制字符。");
	return key;
}

function optionalKey(value: unknown): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	return normalizeKey(value);
}

function normalizeModels(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const models: string[] = [];
	for (const item of value) {
		if (typeof item !== "string") continue;
		const id = item.trim();
		if (!id || id.length > 200 || /[\u0000-\u001f\u007f]/.test(id)) continue;
		if (!models.includes(id)) models.push(id);
		if (models.length >= MAX_MODELS) break;
	}
	return models;
}

function normalizeCompat(value: unknown): ProviderCompat | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const record = value as Record<string, unknown>;
	const compat: ProviderCompat = {};
	if (typeof record.jsonMode === "boolean") compat.jsonMode = record.jsonMode;
	if (record.maxTokensField === "max_tokens" || record.maxTokensField === "max_completion_tokens") {
		compat.maxTokensField = record.maxTokensField;
	}
	return Object.keys(compat).length > 0 ? compat : undefined;
}

function normalizeProvider(value: unknown): StoredProvider | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const record = value as Record<string, unknown>;
	const id = typeof record.id === "string" ? record.id.trim() : "";
	if (!PROVIDER_ID_PATTERN.test(id) || id === PROVIDER_ID) return undefined;
	const name = typeof record.name === "string" ? record.name.trim().slice(0, 60) : "";
	if (!name) return undefined;
	let baseUrl: string;
	try {
		baseUrl = normalizeBaseUrl(record.baseUrl);
	} catch {
		return undefined;
	}
	const now = Date.now();
	const defaultModelId = typeof record.defaultModelId === "string" ? record.defaultModelId.trim() : "";
	const models = normalizeModels(record.models);
	if (models.length === 0 && defaultModelId) models.push(defaultModelId);
	return {
		id,
		name,
		baseUrl,
		apiKey: typeof record.apiKey === "string" && record.apiKey.trim() ? record.apiKey.trim() : undefined,
		enabled: record.enabled !== false,
		defaultModelId: defaultModelId || undefined,
		models,
		modelsAt: typeof record.modelsAt === "number" ? record.modelsAt : undefined,
		compat: normalizeCompat(record.compat),
		createdAt: typeof record.createdAt === "number" ? record.createdAt : now,
		updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : now,
	};
}

function normalizeSelection(value: unknown, providers: StoredProvider[]): ModelSelection {
	if (typeof value !== "object" || value === null) return { mode: "auto" };
	const record = value as Record<string, unknown>;
	if (record.mode !== "pinned") return { mode: "auto" };
	const providerId = typeof record.providerId === "string" ? record.providerId.trim() : "";
	const modelId = typeof record.modelId === "string" ? record.modelId.trim() : "";
	const stored = providers.find((provider) => provider.id === providerId);
	const provider =
		providerId === PROVIDER_ID ? builtinProvider() : stored ? toResolvedProvider(stored) : undefined;
	if (!provider || !provider.enabled || !provider.apiKey || !provider.models.includes(modelId)) {
		return { mode: "auto" };
	}
	return { mode: "pinned", providerId, modelId };
}

function normalizeSettings(value: unknown): StoredSettings {
	if (typeof value !== "object" || value === null) return defaultSettings();
	const record = value as Record<string, unknown>;
	if (record.version !== undefined && record.version !== 1) return defaultSettings();
	const providers: StoredProvider[] = [];
	if (Array.isArray(record.providers)) {
		for (const row of record.providers) {
			const provider = normalizeProvider(row);
			if (!provider || providers.some((item) => item.id === provider.id)) continue;
			providers.push(provider);
			if (providers.length >= MAX_PROVIDERS) break;
		}
	}
	const defaultProviderId =
		typeof record.defaultProviderId === "string" && providerIdExists(record.defaultProviderId, providers)
			? record.defaultProviderId
			: PROVIDER_ID;
	return {
		version: 1,
		providers,
		defaultProviderId,
		crossApiFallback: record.crossApiFallback !== false,
		manualModelSelection: record.manualModelSelection === true,
		structured: normalizeSelection(record.structured, providers),
		prose: normalizeSelection(record.prose, providers),
	};
}

function providerIdExists(id: string, providers: StoredProvider[]): boolean {
	return id === PROVIDER_ID || providers.some((provider) => provider.id === id);
}

function validateSelection(value: unknown, settings: StoredSettings, field: string): ModelSelection {
	if (typeof value !== "object" || value === null) throw new SettingsError(`${field} 格式不对。`);
	const record = value as Record<string, unknown>;
	if (record.mode === "auto") return { mode: "auto" };
	if (record.mode !== "pinned") throw new SettingsError(`${field} 模式不对。`);
	const providerId = typeof record.providerId === "string" ? record.providerId.trim() : "";
	const modelId = typeof record.modelId === "string" ? record.modelId.trim() : "";
	if (!providerId || !modelId) throw new SettingsError(`${field} 需要选择服务和模型。`);
	const stored = settings.providers.find((provider) => provider.id === providerId);
	const provider =
		providerId === PROVIDER_ID ? builtinProvider() : stored ? toResolvedProvider(stored) : undefined;
	if (!provider || !provider.enabled) throw new SettingsError(`${field} 选择的服务不可用。`);
	if (!provider.apiKey) throw new SettingsError(`${field} 选择的服务还没有 API Key。`);
	if (!provider.models.includes(modelId)) throw new SettingsError(`${field} 选择的模型不在该服务列表里。`);
	return { mode: "pinned", providerId, modelId };
}

export function createProvider(input: unknown): ProviderView {
	const record = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
	const settings = readSettings();
	if (settings.providers.length >= MAX_PROVIDERS) throw new SettingsError(`最多只能添加 ${MAX_PROVIDERS} 个自定义服务。`, 409);
	const name = typeof record.name === "string" ? record.name.trim() : "";
	if (!name || name.length > 60) throw new SettingsError("服务名称需要 1-60 个字符。");
	const baseUrl = normalizeBaseUrl(record.baseUrl);
	const apiKey = normalizeKey(record.apiKey);
	const models = normalizeModels(record.models);
	const defaultModelId = typeof record.defaultModelId === "string" ? record.defaultModelId.trim() : "";
	if (defaultModelId && !models.includes(defaultModelId)) models.push(defaultModelId);
	const now = Date.now();
	const provider: StoredProvider = {
		id: `p-${randomBytes(4).toString("hex")}`,
		name,
		baseUrl,
		apiKey,
		enabled: record.enabled !== false,
		defaultModelId: defaultModelId || undefined,
		models,
		compat: normalizeCompat(record.compat),
		createdAt: now,
		updatedAt: now,
	};
	writeSettings({ ...settings, providers: [...settings.providers, provider] });
	return providerView(toResolvedProvider(provider));
}

export function updateProvider(id: string, input: unknown): ProviderView {
	if (id === PROVIDER_ID) throw new SettingsError("内置 SenseNova 由环境变量 / models.json 配置，不能在这里修改。");
	const settings = readSettings();
	const index = settings.providers.findIndex((provider) => provider.id === id);
	if (index === -1) throw new SettingsError("服务不存在。", 404);
	const record = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
	const existing = settings.providers[index];
	const name = record.name === undefined ? existing.name : typeof record.name === "string" ? record.name.trim() : "";
	if (!name || name.length > 60) throw new SettingsError("服务名称需要 1-60 个字符。");
	const baseUrl = record.baseUrl === undefined ? existing.baseUrl : normalizeBaseUrl(record.baseUrl);
	const clearKey = record.clearKey === true;
	const key = clearKey ? undefined : optionalKey(record.apiKey) ?? existing.apiKey;
	const enabled = record.enabled === undefined ? existing.enabled : record.enabled !== false;
	const models = record.models === undefined ? existing.models : normalizeModels(record.models);
	let defaultModelId =
		record.defaultModelId === undefined
			? existing.defaultModelId
			: typeof record.defaultModelId === "string" && record.defaultModelId.trim()
				? record.defaultModelId.trim()
				: undefined;
	if (defaultModelId && !models.includes(defaultModelId)) models.push(defaultModelId);
	const updated: StoredProvider = {
		...existing,
		name,
		baseUrl,
		apiKey: key,
		enabled,
		defaultModelId,
		models,
		compat: record.compat === undefined ? existing.compat : normalizeCompat(record.compat),
		updatedAt: Date.now(),
	};
	const providers = settings.providers.slice();
	providers[index] = updated;
	const next = { ...settings, providers };
	if (!enabled && next.defaultProviderId === id) next.defaultProviderId = PROVIDER_ID;
	if (!enabled) {
		next.structured = next.structured.mode === "pinned" && next.structured.providerId === id ? { mode: "auto" } : next.structured;
		next.prose = next.prose.mode === "pinned" && next.prose.providerId === id ? { mode: "auto" } : next.prose;
	}
	writeSettings(next);
	return providerView(toResolvedProvider(updated));
}

export function deleteProvider(id: string): SettingsView {
	if (id === PROVIDER_ID) throw new SettingsError("内置 SenseNova 不能删除。");
	const settings = readSettings();
	const exists = settings.providers.some((provider) => provider.id === id);
	if (!exists) throw new SettingsError("服务不存在。", 404);
	const next: StoredSettings = {
		...settings,
		providers: settings.providers.filter((provider) => provider.id !== id),
		defaultProviderId: settings.defaultProviderId === id ? PROVIDER_ID : settings.defaultProviderId,
		structured:
			settings.structured.mode === "pinned" && settings.structured.providerId === id
				? { mode: "auto" }
				: settings.structured,
		prose: settings.prose.mode === "pinned" && settings.prose.providerId === id ? { mode: "auto" } : settings.prose,
	};
	writeSettings(next);
	return settingsView();
}

export function updateProviderModels(id: string, models: string[]): ProviderView {
	if (id === PROVIDER_ID) {
		return providerView(builtinProvider());
	}
	const settings = readSettings();
	const index = settings.providers.findIndex((provider) => provider.id === id);
	if (index === -1) throw new SettingsError("服务不存在。", 404);
	const normalized = normalizeModels(models);
	const existing = settings.providers[index];
	const defaultModelId =
		existing.defaultModelId && normalized.includes(existing.defaultModelId)
			? existing.defaultModelId
			: normalized[0];
	const updated: StoredProvider = {
		...existing,
		models: normalized,
		defaultModelId,
		modelsAt: Date.now(),
		updatedAt: Date.now(),
	};
	const providers = settings.providers.slice();
	providers[index] = updated;
	writeSettings({ ...settings, providers });
	return providerView(toResolvedProvider(updated));
}

export function updateSettings(patch: unknown): SettingsView {
	const record = typeof patch === "object" && patch !== null ? (patch as Record<string, unknown>) : {};
	const settings = readSettings();
	const next: StoredSettings = { ...settings };
	if (record.defaultProviderId !== undefined) {
		const id = typeof record.defaultProviderId === "string" ? record.defaultProviderId.trim() : "";
		const provider = id === PROVIDER_ID ? builtinProvider() : settings.providers.find((item) => item.id === id);
		if (!provider || !provider.enabled) throw new SettingsError("默认服务不存在或已停用。");
		next.defaultProviderId = id;
	}
	if (record.crossApiFallback !== undefined) next.crossApiFallback = record.crossApiFallback === true;
	if (record.manualModelSelection !== undefined) next.manualModelSelection = record.manualModelSelection === true;
	if (record.structured !== undefined) next.structured = validateSelection(record.structured, settings, "结构化任务");
	if (record.prose !== undefined) next.prose = validateSelection(record.prose, settings, "翻译与问书");
	writeSettings(next);
	return settingsView();
}

/** Model ids available for a provider in the settings UI. */
export function providerModelIds(provider: ResolvedProvider): string[] {
	return [...provider.models];
}

/** Built-in preferred order for the first provider; custom providers use their own list. */
export function preferredModelIds(provider: ResolvedProvider): string[] {
	if (provider.kind === "builtin") return [...FALLBACK_MODEL_IDS];
	const preferred = provider.defaultModelId ? [provider.defaultModelId] : [];
	return [...new Set([...preferred, ...provider.models])];
}

export { SENTENCE_MODEL_ID, WORD_MODEL_ID };
