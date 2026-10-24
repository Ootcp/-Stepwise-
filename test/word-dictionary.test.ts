import { describe, expect, it } from "vitest";
import { WordDictionary } from "../web/word-dictionary.ts";

/**
 * The reporter batches and retries; these tests pin both behaviours, because a regression in
 * either is invisible in the UI: batching shows up only as load, and retry shows up only when
 * the network hiccups.
 */

function recorder(): {
	calls: Array<{ words: string[]; entries: Record<string, unknown> }>;
	transport: { record(words: string[], entries: Record<string, never>): Promise<unknown> };
	failNext: (times: number) => void;
} {
	const calls: Array<{ words: string[]; entries: Record<string, unknown> }> = [];
	let failures = 0;
	return {
		calls,
		transport: {
			record: async (words, entries) => {
				if (failures > 0) {
					failures -= 1;
					throw new Error("network down");
				}
				calls.push({ words, entries });
				return { ok: true };
			},
		},
		failNext: (times: number) => {
			failures = times;
		},
	};
}

const NO_ENTRY = {} as Record<string, never>;

describe("WordDictionary batching", () => {
	it("merges clicks inside the window into one request", async () => {
		const harness = recorder();
		const dictionary = new WordDictionary(harness.transport);
		dictionary.click("serene");
		dictionary.click("linger");
		dictionary.click("ephemeral");
		await dictionary.settle();

		expect(harness.calls).toHaveLength(1);
		expect(harness.calls[0].words).toEqual(["serene", "linger", "ephemeral"]);
	});

	it("sends only words on a click, with no definitions", async () => {
		const harness = recorder();
		const dictionary = new WordDictionary(harness.transport);
		dictionary.click("serene");
		await dictionary.settle();
		expect(harness.calls[0].entries).toEqual({});
	});

	it("sends the definition when one is known", async () => {
		const harness = recorder();
		const dictionary = new WordDictionary(harness.transport);
		dictionary.click("serene");
		dictionary.define("serene", { pos: "adj.", meaning: "宁静的", ipa: "/səˈriːn/" });
		await dictionary.settle();
		expect(harness.calls[0].entries).toEqual({ serene: { pos: "adj.", meaning: "宁静的", ipa: "/səˈriːn/" } });
	});

	it("does not report the same definition twice", async () => {
		const harness = recorder();
		const dictionary = new WordDictionary(harness.transport);
		dictionary.define("serene", { pos: "adj.", meaning: "宁静的", ipa: "" });
		dictionary.define("serene", { pos: "adj.", meaning: "宁静的", ipa: "" });
		await dictionary.settle();
		expect(harness.calls).toHaveLength(1);
	});

	it("normalizes case and ignores blanks", async () => {
		const harness = recorder();
		const dictionary = new WordDictionary(harness.transport);
		dictionary.click("Serene");
		dictionary.click("  ");
		await dictionary.settle();
		expect(harness.calls[0].words).toEqual(["serene"]);
	});
});

describe("WordDictionary retries", () => {
	it("retries once after a failure and then gives up", async () => {
		const harness = recorder();
		harness.failNext(1);
		const dictionary = new WordDictionary(harness.transport);
		dictionary.click("serene");
		await dictionary.settle();
		// The first attempt failed, the retry succeeded: one delivered request.
		expect(harness.calls).toHaveLength(1);
		expect(harness.calls[0].words).toEqual(["serene"]);
	});

	it("stops retrying after the second failure", async () => {
		const harness = recorder();
		harness.failNext(5);
		const dictionary = new WordDictionary(harness.transport);
		dictionary.click("serene");
		await dictionary.settle();
		await new Promise((resolve) => setTimeout(resolve, 600));
		expect(harness.calls).toHaveLength(0);
		expect(dictionary.pendingSize()).toBe(0);
	});

	it("never rejects at the call site", async () => {
		const harness = recorder();
		harness.failNext(5);
		const dictionary = new WordDictionary(harness.transport);
		expect(() => dictionary.click("serene")).not.toThrow();
		await dictionary.settle();
		expect(NO_ENTRY).toEqual({});
	});
});
