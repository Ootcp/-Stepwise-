import { describe, expect, it } from "vitest";
import type { WordEntry } from "../web/glossary.ts";
import { Limiter, LookupBatcher, SingleFlight } from "../web/limiter.ts";

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Limiter", () => {
	it("never runs more than the configured number of tasks at once", async () => {
		const limiter = new Limiter(2);
		let active = 0;
		let peak = 0;
		const task = async (): Promise<number> => {
			active += 1;
			peak = Math.max(peak, active);
			await delay(5);
			active -= 1;
			return active;
		};

		await Promise.all(Array.from({ length: 8 }, () => limiter.run(task)));
		expect(peak).toBe(2);
		expect(limiter.activeCount()).toBe(0);
		expect(limiter.pending()).toBe(0);
	});

	it("treats a limit below one as a limit of one", async () => {
		const limiter = new Limiter(0);
		let active = 0;
		let peak = 0;
		const task = async (): Promise<void> => {
			active += 1;
			peak = Math.max(peak, active);
			await delay(2);
			active -= 1;
		};
		await Promise.all([limiter.run(task), limiter.run(task)]);
		expect(peak).toBe(1);
	});

	it("frees its slot when a task rejects", async () => {
		const limiter = new Limiter(1);
		await expect(
			limiter.run(async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		await expect(limiter.run(async () => "recovered")).resolves.toBe("recovered");
	});
});

describe("SingleFlight", () => {
	it("runs the task once for concurrent calls with the same key", async () => {
		const singleFlight = new SingleFlight();
		let started = 0;
		const task = async (): Promise<string> => {
			started += 1;
			await delay(5);
			return "value";
		};
		const results = await Promise.all([
			singleFlight.run("word", task),
			singleFlight.run("word", task),
			singleFlight.run("word", task),
		]);
		expect(started).toBe(1);
		expect(results).toEqual(["value", "value", "value"]);
	});

	it("runs the task again once the in-flight call settles", async () => {
		const singleFlight = new SingleFlight();
		let started = 0;
		const task = async (): Promise<number> => {
			started += 1;
			return started;
		};
		expect(await singleFlight.run("a", task)).toBe(1);
		expect(await singleFlight.run("a", task)).toBe(2);
	});

	it("keeps different keys independent", async () => {
		const singleFlight = new SingleFlight();
		let started = 0;
		const task = async (): Promise<void> => {
			started += 1;
			await delay(2);
		};
		await Promise.all([singleFlight.run("a", task), singleFlight.run("b", task)]);
		expect(started).toBe(2);
	});
});

describe("LookupBatcher", () => {
	function stub(): { calls: string[][]; fetchBatch: (words: string[]) => Promise<Record<string, WordEntry>> } {
		const calls: string[][] = [];
		return {
			calls,
			fetchBatch: async (words) => {
				calls.push([...words]);
				return Object.fromEntries(words.map((word) => [word, { pos: "n", meaning: `m-${word}`, ipa: "" }]));
			},
		};
	}

	it("merges words requested in the same window into one call", async () => {
		const backend = stub();
		const batcher = new LookupBatcher({
			fetchBatch: backend.fetchBatch,
			limiter: new Limiter(2),
			windowMs: 20,
		});
		const entries = await Promise.all([batcher.request("serene"), batcher.request("calm"), batcher.request("still")]);
		expect(backend.calls).toHaveLength(1);
		expect(backend.calls[0]).toEqual(["serene", "calm", "still"]);
		expect(entries).toEqual([
			{ pos: "n", meaning: "m-serene", ipa: "" },
			{ pos: "n", meaning: "m-calm", ipa: "" },
			{ pos: "n", meaning: "m-still", ipa: "" },
		]);
	});

	it("resolves undefined for a word the model did not answer", async () => {
		const batcher = new LookupBatcher({
			fetchBatch: async () => ({}),
			limiter: new Limiter(1),
			windowMs: 10,
		});
		expect(await batcher.request("missing")).toBeUndefined();
	});

	it("resolves undefined and records the error when the batch fails", async () => {
		const batcher = new LookupBatcher({
			fetchBatch: async () => {
				throw new Error("rate limited");
			},
			limiter: new Limiter(1),
			windowMs: 10,
		});
		expect(await batcher.request("serene")).toBeUndefined();
		expect(batcher.lastError).toBe("rate limited");
	});

	it("flushes words requested during an in-flight call separately", async () => {
		const backend = stub();
		const batcher = new LookupBatcher({
			fetchBatch: backend.fetchBatch,
			limiter: new Limiter(2),
			windowMs: 10,
		});
		const first = batcher.request("first");
		await delay(40);
		const second = batcher.request("second");
		expect(await first).toEqual({ pos: "n", meaning: "m-first", ipa: "" });
		expect(await second).toEqual({ pos: "n", meaning: "m-second", ipa: "" });
		expect(backend.calls).toHaveLength(2);
	});

	it("gives duplicate requests for one word the same answer", async () => {
		const backend = stub();
		const batcher = new LookupBatcher({
			fetchBatch: backend.fetchBatch,
			limiter: new Limiter(2),
			windowMs: 20,
		});
		const [first, second] = await Promise.all([batcher.request("same"), batcher.request("same")]);
		expect(backend.calls).toHaveLength(1);
		expect(first).toEqual(second);
	});
});
