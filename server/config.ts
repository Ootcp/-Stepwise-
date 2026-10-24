import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Default SenseNova OpenAI-compatible endpoint. */
export const DEFAULT_BASE_URL = "https://token.sensenova.cn/v1";

/** Provider id used in pi's models.json under `<agent-dir>/models.json`. */
export const PROVIDER_ID = "sensenova";

/** Fast model for single-word lookups. */
export const WORD_MODEL_ID = "deepseek-v4-flash";

/** Stronger model for whole-sentence translation. */
export const SENTENCE_MODEL_ID = "glm-5.2";

/**
 * Preferred order for fallbacks. This is not the complete model list: after the primary
 * fails, the provider's `/models` reply is filtered to chat models and probed, and newly
 * discovered healthy models are appended after these. A listed-but-unavailable model is
 * detected by the probe and skipped for the cached health window.
 */
export const FALLBACK_MODEL_IDS = [
	"deepseek-v4-flash",
	"glm-5.2",
	"deepseek-flash",
	"deepseek-v4.1-flash",
	"sensenova-6.8-flash-lite",
	"kimi-k3",
	"sensenova-u1.5-lite",
] as const;

/** Built-in provider model list, deduped. Custom providers keep their own lists. */
export const BUILTIN_MODEL_IDS: readonly string[] = [
	...new Set([WORD_MODEL_ID, SENTENCE_MODEL_ID, ...FALLBACK_MODEL_IDS]),
];

/** Pi's agent directory: `PI_CODING_AGENT_DIR`, else `~/.pi/agent`. */
export function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

interface ModelsFileShape {
	providers?: Record<string, { baseUrl?: string; apiKey?: string } | undefined>;
}

/**
 * Reads the SenseNova entry from pi's models.json so a key already configured for the
 * `pi` CLI is reused instead of being duplicated here. Never throws: a missing or
 * malformed file just means "no key from this source".
 */
function readProviderFromModelsJson(): { baseUrl?: string; apiKey?: string } | undefined {
	const file = join(agentDir(), "models.json");
	let parsed: ModelsFileShape;
	try {
		parsed = JSON.parse(readFileSync(file, "utf8")) as ModelsFileShape;
	} catch {
		return undefined;
	}
	return parsed.providers?.[PROVIDER_ID];
}

/** Where the built-in provider's key came from. */
export type ApiKeySource = "env" | "models-json" | "none";

/** API key plus its source, so the settings UI can explain where it came from. */
export function resolveApiKeyInfo(): { key?: string; source: ApiKeySource } {
	const fromEnv = process.env.SENSENOVA_API_KEY?.trim();
	if (fromEnv) return { key: fromEnv, source: "env" };
	const fromModelsJson = readProviderFromModelsJson()?.apiKey?.trim();
	if (fromModelsJson) return { key: fromModelsJson, source: "models-json" };
	return { source: "none" };
}

/** API key from `SENSENOVA_API_KEY`, falling back to pi's models.json. */
export function resolveApiKey(): string | undefined {
	return resolveApiKeyInfo().key;
}

/** Endpoint from pi's models.json when configured, else the public default. */
export function resolveBaseUrl(): string {
	const fromModelsJson = readProviderFromModelsJson()?.baseUrl?.trim();
	return fromModelsJson ? fromModelsJson : DEFAULT_BASE_URL;
}

/** Message shown by `/api/health` when no API key can be found. */
export const MISSING_KEY_HINT = `No SenseNova API key found. Set SENSENOVA_API_KEY, or add a "${PROVIDER_ID}" provider to ${join(
	agentDir(),
	"models.json",
)} (apiKey + baseUrl).`;