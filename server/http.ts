/**
 * Minimal fetch helpers for the free translation services.
 *
 * These are third-party endpoints with no contract we control: they rate-limit, hang, or
 * occasionally return an error page. Every call therefore gets a hard timeout and a small
 * retry budget, and callers are expected to chain to a fallback when this throws.
 */

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_ATTEMPTS = 2;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(label: string, attempts: number, run: () => Promise<T>): Promise<T> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			return await run();
		} catch (error) {
			lastError = error;
			if (attempt < attempts) await delay(attempt * 400);
		}
	}
	throw new Error(`${label} failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function request(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
	const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return response;
}

export async function getJson<T>(url: string, label: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
	return withRetry(label, DEFAULT_ATTEMPTS, async () => {
		const response = await request(url, { method: "GET" }, timeoutMs);
		return (await response.json()) as T;
	});
}

export async function postJson<T>(url: string, body: unknown, label: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
	return withRetry(label, DEFAULT_ATTEMPTS, async () => {
		const response = await request(
			url,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			},
			timeoutMs,
		);
		return (await response.json()) as T;
	});
}

/** True when a value looks like a usable translation rather than an error page or placeholder. */
export function usableText(value: string | undefined): value is string {
	if (!value) return false;
	const trimmed = value.trim();
	if (trimmed.length === 0) return false;
	if (/^<|^\{|^<\/?(html|body)/i.test(trimmed)) return false;
	return !/^(MYMEMORY WARNING|INVALID|LIMIT REACHED)/i.test(trimmed);
}