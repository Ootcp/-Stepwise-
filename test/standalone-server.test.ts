import { request as httpRequest } from "node:http";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCli, serveStatic, startServer, type CliContext, type RunningServer, type RuntimeInfo } from "../server/main.ts";
import type { TraySpec } from "../server/tray.ts";

/**
 * The entry point an installed copy uses instead of Vite. Everything here is about the shape of
 * a real installation: a program directory holding the built front end, a per-user data
 * directory, and a loopback-only server that can be started, inspected and stopped again.
 */

let root: string;
let distDir: string;
let dataDir: string;
let runtimeDir: string;
let server: RunningServer;
let programFiles: string[];
const previousDataDir = process.env.ENGLISH_APP_DATA_DIR;

/** Recursive listing, so "nothing was written" covers nested files too. */
function tree(dir: string): string[] {
	const entries: string[] = [];
	for (const name of readdirSync(dir).sort()) {
		const path = join(dir, name);
		entries.push(name);
		if (statSync(path).isDirectory()) entries.push(...tree(path).map((child) => `${name}/${child}`));
	}
	return entries;
}

interface Reply {
	status: number;
	body: string;
	type: string;
	cache: string;
	disposition: string;
	bytes: Buffer;
}

function reply(status: number | undefined, headers: Record<string, string | string[] | undefined>, bytes: Buffer): Reply {
	return {
		status: status ?? 0,
		body: bytes.toString("utf8"),
		type: String(headers["content-type"] ?? ""),
		cache: String(headers["cache-control"] ?? ""),
		disposition: String(headers["content-disposition"] ?? ""),
		bytes,
	};
}

async function send(path: string, init?: RequestInit): Promise<Reply> {
	const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { redirect: "manual", ...init });
	return reply(response.status, Object.fromEntries(response.headers), Buffer.from(await response.arrayBuffer()));
}

/** fetch() normalises the URL and pins Host, so traversal and Host spoofing need a raw client. */
function rawSend(path: string, host?: string): Promise<Reply> {
	return new Promise((accept, reject) => {
		const req = httpRequest(
			{ host: "127.0.0.1", port: server.port, path, method: "GET", ...(host ? { headers: { host } } : {}) },
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => accept(reply(res.statusCode, res.headers, Buffer.concat(chunks))));
			},
		);
		req.on("error", reject);
		req.end();
	});
}

/** The commands talk to the user through stdout, which is what the installer reads. */
async function capture(run: () => Promise<number>): Promise<{ code: number; text: string }> {
	const lines: string[] = [];
	const log = console.log;
	const error = console.error;
	console.log = (...args: unknown[]) => lines.push(args.join(" "));
	console.error = (...args: unknown[]) => lines.push(args.join(" "));
	try {
		return { code: await run(), text: lines.join("\n") };
	} finally {
		console.log = log;
		console.error = error;
	}
}

async function waitForRuntime(dir: string): Promise<RuntimeInfo> {
	const file = join(dir, "runtime.json");
	const deadline = Date.now() + 8000;
	while (Date.now() < deadline) {
		if (statSync(file, { throwIfNoEntry: false })) return JSON.parse(readFileSync(file, "utf8")) as RuntimeInfo;
		await new Promise((accept) => setTimeout(accept, 25));
	}
	throw new Error(`${file} 一直没有出现`);
}

beforeAll(async () => {
	root = join(tmpdir(), `shiji-standalone-${Math.random().toString(36).slice(2)}`);
	distDir = join(root, "app", "resources", "dist");
	dataDir = join(root, "user", "english-app", "data");
	runtimeDir = join(root, "user", "english-app");
	mkdirSync(join(distDir, "assets"), { recursive: true });
	mkdirSync(dataDir, { recursive: true });
	writeFileSync(
		join(distDir, "index.html"),
		`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>拾级</title>
<link rel="icon" href="/assets/favicon-9f8e7d.svg"><link rel="stylesheet" href="/assets/app-1a2b3c.css">
</head><body><div id="app"></div><script type="module" src="/assets/app-1a2b3c.js"></script></body></html>`,
		"utf8",
	);
	writeFileSync(join(distDir, "assets", "app-1a2b3c.js"), "console.log('shiji');\n", "utf8");
	writeFileSync(join(distDir, "assets", "app-1a2b3c.css"), "body{color:#333}\n", "utf8");
	writeFileSync(join(distDir, "assets", "favicon-9f8e7d.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>\n', "utf8");
	programFiles = tree(distDir);
	process.env.ENGLISH_APP_DATA_DIR = dataDir;
	server = await startServer({ distDir, runtimeDir, version: "0.0.0-test" });
});

afterAll(async () => {
	await server?.close();
	if (previousDataDir === undefined) delete process.env.ENGLISH_APP_DATA_DIR;
	else process.env.ENGLISH_APP_DATA_DIR = previousDataDir;
	rmSync(root, { recursive: true, force: true });
});

describe("static files", () => {
	it("serves the built index page without caching it", async () => {
		const page = await send("/");
		expect(page.status).toBe(200);
		expect(page.type).toContain("text/html");
		expect(page.cache).toBe("no-cache");
		expect(page.body).toContain("<title>拾级</title>");
	});

	it("serves every asset the entry page references, immutably", async () => {
		const html = readFileSync(join(distDir, "index.html"), "utf8");
		const references = [...html.matchAll(/(?:href|src)="(\/assets\/[^"]+)"/g)].map((match) => match[1] as string);
		expect(references.length).toBeGreaterThan(0);
		const mime: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
		for (const path of references) {
			const asset = await send(path);
			expect(asset.status, path).toBe(200);
			expect(asset.type, path).toContain(mime[path.slice(path.lastIndexOf("."))] ?? "application/octet-stream");
			expect(asset.cache, path).toContain("immutable");
		}
	});

	it("falls back to the entry page for an extensionless route and 404s a missing file", async () => {
		expect((await send("/library")).body).toContain("<title>拾级</title>");
		const missing = await send("/nope.png");
		expect(missing.status).toBe(404);
		expect(missing.type).toContain("text/plain");
	});

	it("refuses to leave the directory it was given", async () => {
		expect([403, 404]).toContain((await rawSend("/../../app/node_modules")).status);
		expect([403, 404]).toContain((await rawSend("/%2e%2e%2f%2e%2e%2fapp")).status);
	});

	it("rejects a page that reached the port through another hostname", async () => {
		// DNS rebinding: a remote page can point its own domain at 127.0.0.1. Host is the only
		// header that says which name the browser used, and the local API can delete articles.
		expect((await rawSend("/api/health", "evil.example")).status).toBe(403);
		expect((await rawSend("/", "evil.example")).status).toBe(403);
		expect((await send("/api/health")).status).toBe(200);
	});
});

describe("runtime information", () => {
	it("publishes the port, pid and shutdown token under the per-user directory", () => {
		const info = JSON.parse(readFileSync(join(runtimeDir, "runtime.json"), "utf8")) as RuntimeInfo;
		expect(info).toMatchObject({ port: server.port, pid: process.pid, url: server.url, version: "0.0.0-test" });
		expect(info.token).toMatch(/^[0-9a-f]{64}$/);
		expect(info.node).toBe(process.version);
	});

	it("writes a log line the user can find", () => {
		expect(readFileSync(join(runtimeDir, "logs", "server.log"), "utf8")).toContain(`listening ${server.url}`);
	});
});

describe("api through the standalone server", () => {
	it("reports health", async () => {
		const health = await send("/api/health");
		expect(health.status).toBe(200);
		expect(health.cache).toBe("no-store");
		expect(JSON.parse(health.body).ok).toBe(true);
	});

	it("saves an article into the per-user data directory", async () => {
		const created = await send("/api/articles", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ title: "打包测试", text: "The installed server writes outside its own directory." }),
		});
		expect(created.status).toBe(201);
		const article = JSON.parse(created.body).article as { id: string; title: string };
		expect(article.title).toBe("打包测试");
		expect(readdirSync(join(dataDir, "articles"))).toContain(`${article.id}.json`);
		expect((await send("/api/articles")).body).toContain(article.id);
		expect((await send(`/api/articles/${article.id}`)).status).toBe(200);
		expect((await send(`/api/articles/${article.id}`, { method: "DELETE" })).status).toBe(200);
		expect(readdirSync(join(dataDir, "articles"))).not.toContain(`${article.id}.json`);
	});

	it("returns a docx download for a word list", async () => {
		const exported = await send("/api/export/word", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				template: "color-cards",
				content: "both",
				title: "打包测试",
				words: [{ word: "serene", ipa: "/səˈriːn/", pos: "adj.", gloss: "平静的" }],
			}),
		});
		expect(exported.status).toBe(200);
		expect(exported.type).toContain("wordprocessingml");
		expect(exported.bytes.subarray(0, 4).toString("ascii")).toBe("PK\u0003\u0004");
		expect(exported.disposition).toContain("filename*=UTF-8''");
	});

	it("keeps the drill's practice log in the per-user data directory", async () => {
		expect(JSON.parse((await send("/api/practice")).body).words).toEqual({});

		const recorded = await send("/api/practice/record", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ word: "Serene", correct: false }),
		});
		expect(recorded.status).toBe(200);
		const record = JSON.parse(recorded.body).record as { word: string; attempts: number; misses: number };
		// The key is normalised and the timestamp is the server's, not the caller's.
		expect(record).toMatchObject({ word: "serene", attempts: 1, misses: 1 });
		expect(readdirSync(dataDir)).toContain("practice.json");
		expect((await send("/api/practice")).body).toContain("serene");

		expect(
			(
				await send("/api/practice/record", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ word: "serene" }),
				})
			).status,
		).toBe(400);
	});

	it("refuses a syllable request with no words instead of calling the model", async () => {
		const empty = await send("/api/syllables", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ words: [] }),
		});
		expect(empty.status).toBe(400);
		expect(JSON.parse(empty.body).error).toContain("non-empty");
	});

	it("answers an unknown endpoint with JSON, not the entry page", async () => {
		const unknown = await send("/api/nope");
		expect(unknown.status).toBe(404);
		expect(unknown.type).toContain("application/json");
	});
});

describe("notification-area icon", () => {
	/** Stand-in for the installed layout: the real paths are checked by scripts/win/smoke.mjs. */
	function fakeSpec(url: string): TraySpec {
		return {
			exe: "C:\\app\\runtime\\拾级托盘.exe",
			icon: "C:\\app\\resources\\icons\\shiji.ico",
			url,
			pid: process.pid,
			runtimePath: "C:\\app\\runtime.json",
			launcher: "C:\\app\\runtime\\拾级.exe",
			entry: "C:\\app\\resources\\server\\index.mjs",
			logs: "C:\\app\\logs",
			runValue: '"C:\\app\\runtime\\拾级.exe" "C:\\app\\resources\\server\\index.mjs" --serve',
		};
	}

	async function withTray(tray: boolean, port: number): Promise<{ specs: TraySpec[]; stopped: number; close(): Promise<void> }> {
		const specs: TraySpec[] = [];
		let stopped = 0;
		const live = await startServer({
			distDir,
			runtimeDir: join(root, `tray-${port}`),
			version: "0.0.0-test",
			port,
			tray,
			traySpec: fakeSpec(`http://127.0.0.1:${port}/`),
			trayLauncher: (spec) => {
				specs.push(spec);
				return { pid: 4242, stop: () => (stopped += 1) };
			},
		});
		return { specs, get stopped() { return stopped; }, close: () => live.close() };
	}

	it("is started for an installed copy and told to leave when the server stops", async () => {
		const run = await withTray(true, 45181);
		expect(run.specs).toHaveLength(1);
		expect(run.specs[0]).toMatchObject({ pid: process.pid, url: "http://127.0.0.1:45181/" });
		expect(run.specs[0].icon).toContain("shiji.ico");
		expect(run.stopped).toBe(0);
		await run.close();
		expect(run.stopped).toBe(1);
	});

	it("stays out of the way when the user unchecked it", async () => {
		const run = await withTray(false, 45182);
		expect(run.specs).toHaveLength(0);
		await run.close();
		expect(run.stopped).toBe(0);
	});

	it("is not started from a source checkout", async () => {
		// No tray option at all: the gate is "packaged copy", which a test run is not.
		let started = 0;
		const live = await startServer({
			distDir,
			runtimeDir: join(root, "tray-dev"),
			version: "0.0.0-test",
			port: 45183,
			trayLauncher: () => {
				started += 1;
				return { stop(): void {} };
			},
		});
		await live.close();
		expect(started).toBe(0);
	});
});

describe("an installation stays read-only", () => {
	it("never writes next to the program files", () => {
		expect(tree(distDir)).toEqual(programFiles);
		expect(tree(join(root, "app"))).toEqual(["resources", "resources/dist", ...programFiles.map((name) => `resources/dist/${name}`)]);
	});
});

describe("commands", () => {
	const opened: string[] = [];
	const spawned: number[] = [];

	function context(overrides: Partial<CliContext>): CliContext {
		return {
			distDir,
			runtimeDir,
			version: "0.0.0-test",
			env: {},
			entry: "index.mjs",
			exists: (path) => statSync(path, { throwIfNoEntry: false }) !== undefined,
			read: (path) => readFileSync(path, "utf8"),
			remove: (path) => rmSync(path, { force: true }),
			sleep: (ms) => new Promise((accept) => setTimeout(accept, ms)),
			probe: async (url) => {
				try {
					return (await fetch(`${url}api/health`, { signal: AbortSignal.timeout(1000) })).ok;
				} catch {
					return false;
				}
			},
			openBrowser: (url) => opened.push(url),
			spawnServer: () => spawned.push(1),
			taskkill: async () => 0,
			...overrides,
		};
	}

	it("reports the running instance instead of starting a second one", async () => {
		const output = await capture(() => runCli(["--status"], context({})));
		expect(output.code).toBe(0);
		expect(JSON.parse(output.text)).toMatchObject({ running: true, port: server.port, version: "0.0.0-test" });
	});

	it("says it is not running when the runtime file is gone", async () => {
		const empty = join(root, "empty-runtime");
		mkdirSync(empty, { recursive: true });
		const output = await capture(() => runCli(["--status"], context({ runtimeDir: empty })));
		expect(output.code).toBe(0);
		expect(JSON.parse(output.text).running).toBe(false);
	});

	it("opens the browser on the existing instance without spawning", async () => {
		opened.length = 0;
		spawned.length = 0;
		expect(await runCli(["--open"], context({}))).toBe(0);
		expect(opened).toEqual([server.url]);
		expect(spawned).toEqual([]);
	});

	it("starts a detached server and waits for it to answer", async () => {
		const dir = join(root, "cold");
		mkdirSync(dir, { recursive: true });
		opened.length = 0;
		let announced = false;
		const code = await runCli(
			["--open"],
			context({
				runtimeDir: dir,
				spawnServer: () => {
					announced = true;
					writeFileSync(join(dir, "runtime.json"), JSON.stringify({ port: server.port, pid: 1, url: server.url, token: "t" }), "utf8");
				},
				probe: async () => announced,
			}),
		);
		expect(code).toBe(0);
		expect(announced).toBe(true);
		expect(opened).toEqual([server.url]);
	});

	it("gives up with a readable error when a spawned server never answers", async () => {
		const dir = join(root, "dead");
		mkdirSync(dir, { recursive: true });
		const output = await capture(() =>
			runCli(["--open"], context({ runtimeDir: dir, spawnServer: () => {}, probe: async () => false, sleep: async () => {} })),
		);
		expect(output.code).toBe(1);
		expect(output.text).toContain("拾级启动超时");
	});

	it("stops the live instance through the same token route", async () => {
		const output = await capture(() => runCli(["--stop"], context({})));
		expect(output.code).toBe(0);
		expect(output.text).toContain("已停止");
		await new Promise((accept) => setTimeout(accept, 200));
		expect(statSync(join(runtimeDir, "runtime.json"), { throwIfNoEntry: false })).toBeUndefined();
		expect(server.server.listening).toBe(false);
	});

	it("keeps serving until something asks it to stop", async () => {
		// The shortcut runs exactly this command, so returning the shutdown promise must not be
		// the same as starting the shutdown.
		const dir = join(root, "serve-command");
		mkdirSync(dir, { recursive: true });
		let stopped = false;
		const log = console.log;
		console.log = () => {};
		const serve = runCli(["--serve"], context({ runtimeDir: dir, env: { ENGLISH_APP_PORT: "45177" } })).then((code) => {
			stopped = true;
			return code;
		});
		let info: RuntimeInfo;
		try {
			info = await waitForRuntime(dir);
		} finally {
			console.log = log;
		}
		const page = await fetch(`http://127.0.0.1:${info.port}/`);
		expect(page.status).toBe(200);
		expect(stopped).toBe(false);
		const output = await capture(() => runCli(["--stop"], context({ runtimeDir: dir })));
		expect(output.code).toBe(0);
		expect(await serve).toBe(0);
		expect(stopped).toBe(true);
	});
});

describe("shutdown", () => {
	it("refuses a token it did not issue", async () => {
		const live = await startServer({ distDir, runtimeDir: join(root, "second"), version: "0.0.0-test", port: 45178 });
		const refused = await fetch(`${live.url}api/server/shutdown?token=0000000000000000000000000000000000000000000000000000000000000000`, {
			method: "POST",
		});
		expect(refused.status).toBe(403);
		expect((await fetch(`${live.url}api/health`)).status).toBe(200);
		const info = JSON.parse(readFileSync(join(root, "second", "runtime.json"), "utf8")) as RuntimeInfo;
		expect((await fetch(`${live.url}api/server/shutdown?token=${info.token}`, { method: "POST" })).status).toBe(202);
		await live.close();
		expect(statSync(join(root, "second", "runtime.json"), { throwIfNoEntry: false })).toBeUndefined();
		expect(readFileSync(join(root, "second", "logs", "server.log"), "utf8")).toContain("stopped");
	});
});

describe("serveStatic", () => {
	it("answers a path above the root with 403", () => {
		const statuses: number[] = [];
		const res = {
			writeHead(status: number): unknown {
				statuses.push(status);
				return res;
			},
			end(): unknown {
				return res;
			},
			headersSent: false,
			writableEnded: false,
		};
		serveStatic(distDir, { method: "GET", url: "/../../secrets.txt", headers: {} } as never, res as never);
		expect(statuses).toEqual([403]);
	});
});
