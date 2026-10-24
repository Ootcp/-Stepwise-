import { describe, expect, it } from "vitest";
import {
	HEALTH_TTL_MS,
	STRUCTURED_MODE,
	fallbackModelIds,
	type ModelHealth,
	type ModelProbeStatus,
} from "../server/llm.ts";

function health(
	candidates: string[],
	statuses: Record<string, ModelProbeStatus>,
): ModelHealth {
	return { at: 0, candidates, status: new Map(Object.entries(statuses)) };
}

/**
 * Regression guard for a failure that only appeared on long sentences: the fast model is a
 * reasoning model, and without an explicit disable it could spend the entire output budget on
 * thinking and return no text at all, which reached the reader as "模型未返回内容".
 */
describe("structured model calls", () => {
	it("disables thinking so a long reply cannot spend the whole budget before answering", () => {
		expect(STRUCTURED_MODE).toMatchObject({
			response_format: { type: "json_object" },
			thinking: { type: "disabled" },
		});
	});
});

describe("model fallback order", () => {
	it("tries the other models after the structured primary", () => {
		expect(fallbackModelIds("deepseek-v4-flash")).toEqual([
			"glm-5.2",
			"deepseek-flash",
			"deepseek-v4.1-flash",
			"sensenova-6.8-flash-lite",
			"kimi-k3",
			"sensenova-u1.5-lite",
		]);
	});

	it("filters out models the account no longer lists", () => {
		expect(fallbackModelIds("deepseek-v4-flash", new Set(["deepseek-v4-flash", "glm-5.2", "kimi-k3"]))).toEqual([
			"glm-5.2",
			"kimi-k3",
		]);
	});

	it("uses the fast model as the first translation fallback", () => {
		expect(fallbackModelIds("glm-5.2")[0]).toBe("deepseek-v4-flash");
	});

	it("puts healthy preferred models before discovered healthy models and unverified ones", () => {
		const snapshot = health(
			["glm-5.2", "kimi-k3", "brand-new", "deepseek-flash"],
			{
				"glm-5.2": "unverified",
				"kimi-k3": "healthy",
				"brand-new": "healthy",
				"deepseek-flash": "unavailable",
			},
		);
		expect(
			fallbackModelIds(
				"deepseek-v4-flash",
				new Set(["deepseek-v4-flash", "glm-5.2", "kimi-k3", "brand-new", "deepseek-flash"]),
				snapshot,
			),
		).toEqual(["kimi-k3", "brand-new", "glm-5.2"]);
	});

	it("never includes the primary, even if the snapshot calls it healthy", () => {
		const snapshot = health(
			["deepseek-v4-flash", "glm-5.2"],
			{ "deepseek-v4-flash": "healthy", "glm-5.2": "healthy" },
		);
		expect(
			fallbackModelIds(
				"deepseek-v4-flash",
				new Set(["deepseek-v4-flash", "glm-5.2"]),
				snapshot,
			),
		).toEqual(["glm-5.2"]);
	});

	it("drops a listed model that the probe never reached", () => {
		const snapshot = health(["glm-5.2"], { "glm-5.2": "healthy" });
		expect(
			fallbackModelIds("deepseek-v4-flash", new Set(["glm-5.2", "unprobed"]), snapshot),
		).toEqual(["glm-5.2"]);
	});

	it("orders from the snapshot even when the availability set is unavailable", () => {
		const snapshot = health(
			["glm-5.2", "brand-new"],
			{ "glm-5.2": "unverified", "brand-new": "healthy" },
		);
		expect(fallbackModelIds("deepseek-v4-flash", undefined, snapshot)).toEqual([
			"brand-new",
			"glm-5.2",
		]);
	});

	it("keeps a ten-minute health window", () => {
		expect(HEALTH_TTL_MS).toBe(10 * 60_000);
	});
});
