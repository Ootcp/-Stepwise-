/**
 * Standalone server: the entry point for an installed copy of 拾级.
 *
 * `vite.config.ts` mounts the API into Vite's dev and preview servers, which is perfect for
 * development but unusable once the app is installed: it would drag the whole Vite package
 * along, needs the source tree, and has no way to be started, stopped or inspected. This file
 * serves the built `dist/` plus the same `/api/*` handlers from plain `node:http`.
 *
 * Commands:
 *   --serve   run in the foreground (default; the shortcut hides the window)
 *   --open    reuse a running instance or start one, then open the browser
 *   --stop    shut the running instance down
 *   --status  print {"running":…} as JSON, for the installer
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
	appendFileSync,
	createReadStream,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { launchTray, resolveTraySpec, trayDisabledByInstaller, type TrayHandle, type TrayLauncher, type TraySpec } from "./tray.ts";

const HOST = "127.0.0.1";
const PORT_START = 45173;
const PORT_END = 45183;
const LOG_LIMIT_BYTES = 1024 * 1024;
const SHUTDOWN_GRACE_MS = 3000;

export interface RuntimeInfo {
	port: number;
	pid: number;
	url: string;
	token: string;
	startedAt: string;
	version: string;
	node: string;
}

const MIME_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".webmanifest": "application/manifest+json",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".ttf": "font/ttf",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".ico": "image/x-icon",
	".txt": "text/plain; charset=utf-8",
	".map": "application/json; charset=utf-8",
};

export interface ServerOptions {
	distDir: string;
	runtimeDir: string;
	version: string;
	port?: number;
	log?(line: string): void;
	/** Override the "installed copy only" rule; tests use it to force the tray on or off. */
	tray?: boolean;
	trayLauncher?: TrayLauncher;
	/** Test seam: use these paths instead of looking for an installed layout. */
	traySpec?: TraySpec;
}

export interface RunningServer {
	server: Server;
	port: number;
	url: string;
	info: RuntimeInfo;
	close(): Promise<void>;
	/** Resolves when the server has stopped, whoever asked for it. */
	waitUntilStopped(): Promise<void>;
}

/** Per-user state: runtime.json and the log. Independent of where the app is installed. */
export function appDirectory(): string {
	const local = process.env.LOCALAPPDATA?.trim();
	return join(local && local.length > 0 ? local : join(homedir(), "AppData", "Local"), "english-app");
}

/** Where the built front end lives, for a source checkout or for an installed bundle. */
export function defaultDistDir(): string {
	const here = bundleDirectory();
	const candidates = [join(here, "..", "web", "dist"), join(here, "..", "dist"), join(here, "dist")];
	for (const candidate of candidates) {
		if (existsSync(join(candidate, "index.html"))) return candidate;
	}
	return candidates[0]!;
}

function bundleDirectory(): string {
	return dirname(fileURLToPath(import.meta.url));
}

/** The build manifest only exists in an installed copy, next to the bundle's parent directory. */
function installManifest(): string {
	const candidate = join(bundleDirectory(), "..", "manifest.json");
	return existsSync(candidate) ? candidate : "";
}

/**
 * An installed bundle must not write beside its own program files, so it takes over the
 * environment before the API modules — and therefore the stores — are loaded.
 */
function useInstallationLayout(): void {
	if (installManifest().length === 0) return;
	process.env.ENGLISH_APP_PACKAGED = "1";
}

function readVersion(): string {
	const fromEnv = process.env.ENGLISH_APP_VERSION?.trim();
	if (fromEnv) return fromEnv;
	for (const candidate of [join(bundleDirectory(), "..", "manifest.json"), join(bundleDirectory(), "..", "package.json")]) {
		try {
			const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { version?: string };
			if (typeof parsed.version === "string") return parsed.version;
		} catch {
			// Try the next candidate.
		}
	}
	return "0.0.0";
}

function mimeFor(path: string): string {
	return MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function logLine(file: string, message: string): void {
	const line = `${new Date().toISOString()} ${message}\n`;
	try {
		mkdirSync(dirname(file), { recursive: true });
		if (existsSync(file) && statSync(file).size > LOG_LIMIT_BYTES) writeFileSync(file, "", "utf8");
		appendFileSync(file, line, "utf8");
	} catch {
		// A log file that cannot be written must never take the app down.
	}
}

/**
 * Refuse anything that did not arrive through a loopback URL. Without this, any page the
 * reader has open could reach the local API — including the shutdown route — by DNS rebinding.
 */
function hostIsAllowed(header: string | undefined): boolean {
	if (!header) return false;
	const host = header.replace(/:\d+$/, "").toLowerCase();
	return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}

function textResponse(res: ServerResponse, status: number, body: string): void {
	const payload = Buffer.from(body, "utf8");
	res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "content-length": String(payload.length) });
	res.end(payload);
}

function serveFile(res: ServerResponse, file: string, method: string, cache: string): void {
	const stats = statSync(file);
	res.writeHead(200, { "content-type": mimeFor(file), "content-length": String(stats.size), "cache-control": cache });
	if (method === "HEAD") {
		res.end();
		return;
	}
	createReadStream(file).pipe(res);
}

/** Static files under `distDir`, with the fallback the hash router still needs on reload. */
export function serveStatic(distDir: string, req: IncomingMessage, res: ServerResponse): void {
	const method = req.method ?? "GET";
	if (method !== "GET" && method !== "HEAD") {
		textResponse(res, 405, "Method not allowed");
		return;
	}
	const raw = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
	const root = resolve(distDir);
	const target = resolve(root, `.${raw.startsWith("/") ? raw : `/${raw}`}`);
	if (target !== root && !target.startsWith(root + sep)) {
		textResponse(res, 403, "Forbidden");
		return;
	}
	if (existsSync(target) && statSync(target).isFile()) {
		const immutable = target.startsWith(join(root, "assets") + sep);
		serveFile(res, target, method, immutable ? "public, max-age=31536000, immutable" : "no-cache");
		return;
	}
	const index = join(root, "index.html");
	if (method === "GET" && extname(target).length === 0 && existsSync(index)) {
		serveFile(res, index, method, "no-cache");
		return;
	}
	textResponse(res, 404, "Not found");
}

function listenOn(server: Server, port: number): Promise<void> {
	return new Promise((accept, reject) => {
		const onError = (error: Error): void => reject(error);
		server.once("error", onError);
		server.listen(port, HOST, () => {
			server.off("error", onError);
			accept();
		});
	});
}

/**
 * The dictionary is a built-in SQLite database, so `node:sqlite` is not optional. Loading the
 * API through a dynamic import means a runtime without it reports this one line instead of a
 * stack trace from the module loader.
 */
async function checkSqlite(): Promise<void> {
	try {
		await import("node:sqlite");
	} catch {
		throw new Error(`当前 Node ${process.version} 不带 node:sqlite,无法使用内置词典。请重新安装拾级,或改用 Node 22.19 及以上版本。`);
	}
}

/** Binds the first free port in 45173-45183 and publishes runtime.json for the other commands. */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
	const distDir = resolve(options.distDir);
	if (!existsSync(join(distDir, "index.html"))) {
		throw new Error(`找不到前端文件 ${join(distDir, "index.html")},请先运行 npm run build。`);
	}
	await checkSqlite();
	useInstallationLayout();
	const { createApiHandler } = await import("./api.ts");
	const runtimeDir = resolve(options.runtimeDir);
	mkdirSync(runtimeDir, { recursive: true });
	const logFile = join(runtimeDir, "logs", "server.log");
	const log = options.log ?? ((line: string): void => logLine(logFile, line));
	const token = randomBytes(32).toString("hex");
	const api = createApiHandler();
	const runtimePath = join(runtimeDir, "runtime.json");
	// Assigned once the socket is bound; requests cannot be answered before that, but the
	// shutdown route must not read a variable still in its temporal dead zone.
	let stopListening: () => Promise<void> = async (): Promise<void> => {};

	const server = createServer((req, res) => {
		void dispatch(req, res).catch((error: unknown) => {
			log(`request failed ${req.url ?? ""}: ${String(error)}`);
			if (!res.headersSent) textResponse(res, 500, "Internal server error");
			res.end();
		});
	});
	server.on("error", (error) => log(`server error: ${String(error)}`));

	async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
		if (!hostIsAllowed(req.headers.host)) {
			textResponse(res, 403, "Forbidden");
			return;
		}
		const url = req.url ?? "/";
		if (url.startsWith("/api/server/shutdown")) {
			const given = new URL(url, `http://${HOST}`).searchParams.get("token");
			if (given !== token) {
				textResponse(res, 403, "Forbidden");
				return;
			}
			res.writeHead(202, { "content-type": "application/json; charset=utf-8", "content-length": "12" });
			res.end('{"ok":true}\n');
			void stopListening();
			return;
		}
		if (url.startsWith("/api/")) {
			// The API owns the whole namespace and answers unknown endpoints itself with JSON,
			// so nothing here may wait for it: routes finish asynchronously.
			api(req, res, () => textResponse(res, 404, "Not found"));
			return;
		}
		serveStatic(distDir, req, res);
	}

	let lastError: unknown;
	for (const port of options.port ? [options.port] : range(PORT_START, PORT_END)) {
		try {
			await listenOn(server, port);
			break;
		} catch (error) {
			lastError = error;
		}
	}
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error(`无法监听 ${PORT_START}-${PORT_END}:${String(lastError)}`);
	}
	const port = address.port;
	const url = `http://${HOST}:${port}/`;
	const info: RuntimeInfo = {
		port,
		pid: process.pid,
		url,
		token,
		startedAt: new Date().toISOString(),
		version: options.version,
		node: process.version,
	};
	writeFileSync(runtimePath, `${JSON.stringify(info, null, "\t")}\n`, { mode: 0o600 });
	log(`listening ${url} node=${process.version} dist=${distDir}`);

	// The tray helper belongs to this process's lifetime: it starts once the port is bound and is
	// told to leave as soon as runtime.json is gone. Only an installed copy gets one.
	let tray: TrayHandle | undefined;
	const trayWanted =
		options.tray ??
		(process.env.ENGLISH_APP_PACKAGED === "1" &&
			process.env.ENGLISH_APP_TRAY !== "0" &&
			!trayDisabledByInstaller());
	if (trayWanted) {
		const spec = options.traySpec ?? resolveTraySpec({ url, runtimePath });
		if (spec) tray = (options.trayLauncher ?? launchTray)(spec, log);
		else log("tray helper missing, running without the notification icon");
	}

	// One promise for every caller: the shutdown route, a second shortcut click and the signal
	// handlers all ask for the same thing, and a later call must not wait on a settled server.
	let settled = false;
	let announceStopped: () => void = () => {};
	const stopped = new Promise<void>((accept) => {
		announceStopped = accept;
	});
	const finish = (): void => {
		if (settled) return;
		settled = true;
		// Removing the file first is what lets the helper take its own icon away; a killed process
		// cannot do that and leaves a ghost icon painted in the notification area.
		rmSync(runtimePath, { force: true });
		log("stopped");
		tray?.stop();
		announceStopped();
	};
	let closing: Promise<void> | undefined;
	const shutdown = (): Promise<void> =>
		(closing ??= new Promise<void>((accept) => {
			const done = (): void => {
				finish();
				accept();
			};
			server.close(done);
			server.closeAllConnections?.();
			setTimeout(done, SHUTDOWN_GRACE_MS).unref?.();
		}));

	const running: RunningServer = { server, port, url, info, close: shutdown, waitUntilStopped: () => stopped };
	stopListening = shutdown;
	return running;
}

function range(from: number, to: number): number[] {
	const values: number[] = [];
	for (let port = from; port <= to; port += 1) values.push(port);
	return values;
}

/* ---------- commands ---------- */

export interface CliContext {
	distDir: string;
	runtimeDir: string;
	version: string;
	env: NodeJS.ProcessEnv;
	entry: string;
	exists(path: string): boolean;
	read(path: string): string;
	remove(path: string): void;
	sleep(ms: number): Promise<void>;
	probe(url: string): Promise<boolean>;
	openBrowser(url: string): void;
	spawnServer(): void;
	taskkill(pid: number): Promise<number>;
}

function runtimeFile(context: Pick<CliContext, "runtimeDir">): string {
	return join(context.runtimeDir, "runtime.json");
}

function readRuntime(context: CliContext): RuntimeInfo | undefined {
	if (!context.exists(runtimeFile(context))) return undefined;
	try {
		const parsed = JSON.parse(context.read(runtimeFile(context))) as RuntimeInfo;
		return typeof parsed.port === "number" && typeof parsed.token === "string" ? parsed : undefined;
	} catch {
		return undefined;
	}
}

async function probeHealth(url: string): Promise<boolean> {
	try {
		const response = await fetch(`${url}api/health`, { signal: AbortSignal.timeout(1500) });
		return response.ok;
	} catch {
		return false;
	}
}

async function shutdownWithToken(info: RuntimeInfo): Promise<boolean> {
	try {
		const response = await fetch(`${info.url}api/server/shutdown?token=${encodeURIComponent(info.token)}`, {
			method: "POST",
			signal: AbortSignal.timeout(3000),
		});
		return response.ok;
	} catch {
		return false;
	}
}

function openInBrowser(url: string): void {
	// Test and packaging runs do not want a browser window popping up; the shortcut path is
	// still exercised because the caller only reaches here after the server answered.
	if (process.env.ENGLISH_APP_OPEN_BROWSER === "0") return;
	// rundll32 needs no console window and no Windows Script Host, both common policy
	// casualties; `start` is a shell builtin and cannot be spawned directly.
	const child = spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore" });
	child.unref();
}

export async function runCli(args: string[], context: CliContext): Promise<number> {
	const command = args.find((arg) => arg.startsWith("--")) ?? "--serve";
	const portOverride = Number(args.find((arg) => /^\d{4,5}$/.test(arg)) ?? context.env.ENGLISH_APP_PORT ?? 0);

	if (command === "--status") {
		const info = readRuntime(context);
		const alive = info !== undefined && (await context.probe(info.url));
		console.log(
			JSON.stringify(info && alive ? { running: true, port: info.port, pid: info.pid, url: info.url, version: info.version } : { running: false }),
		);
		return 0;
	}

	if (command === "--stop") {
		const info = readRuntime(context);
		if (!info) {
			console.log("拾级未在运行。");
			return 0;
		}
		if (await shutdownWithToken(info)) {
			console.log(`已停止拾级(端口 ${info.port})`);
			return 0;
		}
		const code = await context.taskkill(info.pid);
		console.log(code === 0 ? `已结束拾级进程 ${info.pid}` : "停止失败,请在任务管理器中结束 node.exe");
		return code === 0 ? 0 : 1;
	}

	if (command === "--open") {
		const info = readRuntime(context);
		if (info && (await context.probe(info.url))) {
			context.openBrowser(info.url);
			return 0;
		}
		context.remove(runtimeFile(context));
		context.spawnServer();
		for (let attempt = 0; attempt < 24; attempt += 1) {
			await context.sleep(250);
			const started = readRuntime(context);
			if (started && (await context.probe(started.url))) {
				context.openBrowser(started.url);
				return 0;
			}
		}
		console.error("拾级启动超时,请查看 english-app\\logs\\server.log。");
		return 1;
	}

	const existing = readRuntime(context);
	if (existing && (await context.probe(existing.url))) {
		console.log(`拾级已在运行:${existing.url}`);
		return 0;
	}
	let running: RunningServer;
	try {
		running = await startServer({
			distDir: context.distDir,
			runtimeDir: context.runtimeDir,
			version: context.version,
			...(portOverride > 0 ? { port: portOverride } : {}),
		});
	} catch (error) {
		// The shortcut starts this process hidden, so a stack trace on stdout would be lost.
		const message = error instanceof Error ? error.message : String(error);
		console.error(message);
		logLine(join(context.runtimeDir, "logs", "server.log"), `start failed: ${message}`);
		return 1;
	}
	const stop = (): void => {
		void running.close();
	};
	console.log(`拾级已启动:${running.url}`);
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	// Resolves when the shutdown route, a signal or --stop has finished closing the socket.
	return running.waitUntilStopped().then(() => 0);
}

function spawnDetachedServer(entry: string): void {
	const child = spawn(process.execPath, [entry, "--serve"], { detached: true, stdio: "ignore" });
	child.unref();
}

function taskkill(pid: number): Promise<number> {
	return new Promise((accept) => {
		const child = spawn("taskkill.exe", ["/PID", String(pid), "/F"], { stdio: "ignore" });
		child.on("close", (code) => accept(code ?? 1));
	});
}

export function defaultContext(): CliContext {
	const runtimeDir = process.env.ENGLISH_APP_RUNTIME_DIR?.trim() || appDirectory();
	mkdirSync(runtimeDir, { recursive: true });
	const entry = process.argv[1] !== undefined ? resolve(process.argv[1]) : fileURLToPath(import.meta.url);
	return {
		distDir: process.env.ENGLISH_APP_DIST_DIR?.trim() || defaultDistDir(),
		runtimeDir,
		version: readVersion(),
		env: process.env,
		entry,
		exists: existsSync,
		read: (path) => readFileSync(path, "utf8"),
		remove: (path) => rmSync(path, { force: true }),
		sleep: (ms) => new Promise((accept) => setTimeout(accept, ms)),
		probe: probeHealth,
		openBrowser: openInBrowser,
		spawnServer: () => spawnDetachedServer(entry),
		taskkill,
	};
}

/** Only a real launch runs the CLI; tests import the functions above. */
const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
	void runCli(process.argv.slice(2), defaultContext()).then((code) => {
		if (code !== 0) process.exitCode = code;
	});
}
