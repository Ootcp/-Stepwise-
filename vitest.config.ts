import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// browser-tests/ holds tests that import real browser modules, so they need DOM types.
		// It lives outside test/ on purpose: the Pi repo root tsconfig scans packages/*/test/**/*
		// with a lib that has no DOM, which would fail on every HTMLElement reference.
		include: ["test/**/*.test.ts", "browser-tests/**/*.test.ts"],
		environment: "node",
	},
});