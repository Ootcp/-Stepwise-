import type { AssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { MISSING_KEY_HINT } from "../server/config.ts";
import {
	HEALTH_TTL_MS,
	chatCandidateIds,
	classifyProbe,
	createModelHealthCache,
	isChatModelId,
	probeModelHealth,
} from "../server/llm.ts";

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

describe("chat model filtering", () => {
	it("rejects non-chat ids and accepts chat ids", () => {
		for (const id of [
			"text-embedding-3",
			"bge-reranker-v2-m3",
			"senseaudio-tts",
			"image-gen",
			"whisper-asr",
			"omni-moderation-latest",
			"video-captioner",
		]) {
			expect(isChatModelId(id), id).toBe(false);
		}
		for (const id of ["deepseek-v4-flash", "glm-5.2", "kimi-k3", "qwen3-coder"]) {
			expect(isChatModelId(id), id).toBe(true);
		}
	});

	it("puts preferred static models first and appends newly discovered chat models", () => {
		const available = [
			"sensenova-6.8-flash-lite",
			"glm-5.2",
			"brand-new",
			"text-embedding-3",
			"deepseek-v4-flash",
			"glm-5.2",
		];
		expect(chatCandidateIds("deepseek-v4-flash", available)).toEqual([
			"glm-5.2",
			"sensenova-6.8-flash-lite",
			"brand-new",
		]);
	});
});

describe("probe classification", () => {
	it("accepts a JSON probe, including fences and prose", () => {
		expect(classifyProbe(reply('{"ok":true}'))).toBe("healthy");
		expect(classifyProbe(reply('```json\n{"ok":true}\n```'))).toBe("healthy");
		expect(classifyProbe(reply('Here is the result: {"ok":true}'))).toBe("healthy");
		expect(classifyProbe(reply('{"ok":true}', "length"))).toBe("healthy");
	});

	it("marks an answering model that cannot produce the JSON as unavailable", () => {
		expect(classifyProbe(reply(""))).toBe("unavailable");
		expect(classifyProbe(reply('{"ok":false}'))).toBe("unavailable");
		expect(classifyProbe(reply("plain text"))).toBe("unavailable");
		expect(classifyProbe(reply("", "stop", "403: model is not available"))).toBe("unavailable");
		expect(classifyProbe(reply("", "error", "404 status code (no body)"))).toBe("unavailable");
	});

	it("treats rate limits, server errors and timeouts as unverified", () => {
		expect(classifyProbe(reply("", "error", "429: inference exceeds tpm/rpm limit"))).toBe("unverified");
		expect(classifyProbe(reply("", "error", "500: boom"))).toBe("unverified");
		expect(classifyProbe(reply("", "error", "Request timed out."))).toBe("unverified");
		expect(classifyProbe(reply("", "aborted"))).toBe("unverified");
		expect(classifyProbe(reply("not json", "length"))).toBe("unverified");
	});
});

describe("probeModelHealth", () => {
	it("probes sequentially and records each status", async () => {
		const seen: string[] = [];
		const snapshot = await probeModelHealth(["good", "bad"], async (id) => {
			seen.push(id);
			return id === "good" ? reply('{"ok":true}') : reply("", "error", "403: unavailable");
		});
		expect(seen).toEqual(["good", "bad"]);
		expect(snapshot?.status.get("good")).toBe("healthy");
		expect(snapshot?.status.get("bad")).toBe("unavailable");
	});

	it("returns undefined when nothing is healthy", async () => {
		const snapshot = await probeModelHealth(["a", "b"], async () =>
			reply("", "error", "403: unavailable"),
		);
		expect(snapshot).toBeUndefined();
	});

	it("keeps a healthy model alongside an unverified one", async () => {
		const snapshot = await probeModelHealth(["good", "busy"], async (id) =>
			id === "good" ? reply('{"ok":true}') : reply("", "error", "429: slow down"),
		);
		expect(snapshot?.status.get("good")).toBe("healthy");
		expect(snapshot?.status.get("busy")).toBe("unverified");
	});

	it("stops probing when the budget is exhausted and marks the rest unverified", async () => {
		let clock = 0;
		const calls: Array<{ id: string; timeout: number }> = [];
		const snapshot = await probeModelHealth(
			["a", "b", "c"],
			async (id, timeout) => {
				calls.push({ id, timeout });
				clock += 6_000;
				return reply('{"ok":true}');
			},
			{ now: () => clock, budgetMs: 10_000, perModelMs: 5_000, minModelMs: 1_500 },
		);
		expect(calls.map((call) => call.id)).toEqual(["a", "b"]);
		expect(calls.map((call) => call.timeout)).toEqual([5_000, 4_000]);
		expect(snapshot?.status.get("c")).toBe("unverified");
	});

	it("aborts on a fatal error", async () => {
		const snapshot = await probeModelHealth(["a"], async () => {
			throw new Error(MISSING_KEY_HINT);
		});
		expect(snapshot).toBeUndefined();
	});

	it("continues after a non-fatal probe error", async () => {
		const snapshot = await probeModelHealth(["a", "b"], async (id) => {
			if (id === "a") throw new Error("network down");
			return reply('{"ok":true}');
		});
		expect(snapshot?.status.get("a")).toBe("unverified");
		expect(snapshot?.status.get("b")).toBe("healthy");
	});
});

describe("createModelHealthCache", () => {
	const available = new Set(["glm-5.2", "brand-new"]);

	it("caches a healthy snapshot for ten minutes and re-probes afterwards", async () => {
		let clock = 0;
		let probes = 0;
		const modelHealth = createModelHealthCache({
			probe: async () => {
				probes += 1;
				return reply('{"ok":true}');
			},
			now: () => clock,
		});
		const first = await modelHealth("deepseek-v4-flash", available);
		expect(first).toBeDefined();
		expect(probes).toBe(2);
		await modelHealth("deepseek-v4-flash", available);
		expect(probes).toBe(2);
		clock += HEALTH_TTL_MS + 1;
		await modelHealth("deepseek-v4-flash", available);
		expect(probes).toBe(4);
	});

	it("shares one probe between concurrent calls", async () => {
		let probes = 0;
		const modelHealth = createModelHealthCache({
			probe: async () => {
				probes += 1;
				return reply('{"ok":true}');
			},
		});
		const first = modelHealth("deepseek-v4-flash", available);
		const second = modelHealth("deepseek-v4-flash", available);
		expect(first).toBe(second);
		await Promise.all([first, second]);
		expect(probes).toBe(2);
	});

	it("remembers a failed round for a minute, then probes again", async () => {
		let clock = 0;
		let probes = 0;
		const modelHealth = createModelHealthCache({
			probe: async () => {
				probes += 1;
				return reply("", "error", "403: unavailable");
			},
			now: () => clock,
			failureTtlMs: 60_000,
		});
		expect(await modelHealth("deepseek-v4-flash", available)).toBeUndefined();
		expect(probes).toBe(2);
		expect(await modelHealth("deepseek-v4-flash", available)).toBeUndefined();
		expect(probes).toBe(2);
		clock += 60_001;
		expect(await modelHealth("deepseek-v4-flash", available)).toBeUndefined();
		expect(probes).toBe(4);
	});

	it("keeps separate snapshots for different primaries", async () => {
		const seen = new Set<string>();
		const modelHealth = createModelHealthCache({
			probe: async (id) => {
				seen.add(id);
				return reply('{"ok":true}');
			},
		});
		const both = new Set(["deepseek-v4-flash", "glm-5.2"]);
		await modelHealth("deepseek-v4-flash", both);
		await modelHealth("glm-5.2", both);
		expect(seen.has("glm-5.2")).toBe(true);
		expect(seen.has("deepseek-v4-flash")).toBe(true);
	});
});
