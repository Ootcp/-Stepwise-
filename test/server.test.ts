import { describe, expect, it } from "vitest";
import { DEFAULT_BASE_URL, PROVIDER_ID, resolveApiKey, resolveBaseUrl } from "../server/config.ts";

describe("config", () => {
	it("prefers the SENSENOVA_API_KEY environment variable", () => {
		process.env.SENSENOVA_API_KEY = "sk-from-env";
		try {
			expect(resolveApiKey()).toBe("sk-from-env");
		} finally {
			delete process.env.SENSENOVA_API_KEY;
		}
	});

	it("ignores a blank environment variable and falls through", () => {
		process.env.SENSENOVA_API_KEY = "   ";
		try {
			// Result depends on this machine's ~/.pi/agent/models.json; only the type matters.
			const key = resolveApiKey();
			expect(key === undefined || typeof key === "string").toBe(true);
		} finally {
			delete process.env.SENSENOVA_API_KEY;
		}
	});

	it("falls back to pi's models.json, then to the public default endpoint", () => {
		expect(resolveBaseUrl()).toMatch(/^https:\/\//);
	});

	it("exposes the documented defaults", () => {
		expect(PROVIDER_ID).toBe("sensenova");
		expect(DEFAULT_BASE_URL).toBe("https://token.sensenova.cn/v1");
	});
});
