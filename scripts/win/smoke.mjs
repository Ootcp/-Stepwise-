#!/usr/bin/env node
/**
 * Smoke-test a packaged 拾级, before it ships and again after it is installed.
 *
 *   node scripts/win/smoke.mjs [--root <staging or install dir>] [--keep] [--allow-tray]
 *
 * The staged tree and an installed program directory have the same layout, so one script covers
 * both. It runs the real bundled runtime, the real bundle and the real built front end, and it
 * insists on the two properties an installer can otherwise lose silently: the program directory
 * is never written to, and the server stops when asked.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { request } from "node:http";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..", "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : fallback;
};

const root = resolve(option("--root", join(packageDir, "staging")));
const nodeExe = join(root, "runtime", "node.exe");
const entry = join(root, "resources", "server", "index.mjs");
const distDir = join(root, "resources", "dist");
const iconFile = join(root, "resources", "icons", "shiji.ico");

/** How many sizes an .ico carries; the tray needs the small ones, Explorer the large ones. */
function iconEntries(file) {
	const image = statSync(file, { throwIfNoEntry: false }) ? readFileSync(file) : undefined;
	if (!image || image.readUInt16LE(2) !== 1) return 0;
	return image.readUInt16LE(4);
}

/** PE optional-header Subsystem: 2 = GUI (no console window), 3 = console. */
function peSubsystem(file) {
	if (!statSync(file, { throwIfNoEntry: false })) return 0;
	const image = readFileSync(file);
	const headers = image.readUInt32LE(0x3c);
	if (image.readUInt32LE(headers) !== 0x00004550) return 0;
	const optional = headers + 4 + 20;
	return image.readUInt16LE(optional + (image.readUInt16LE(optional) === 0x20b ? 68 : 76));
}

const sandbox = join(tmpdir(), `shiji-smoke-${Math.random().toString(36).slice(2)}`);
const dataDir = join(sandbox, "data");
const runtimeDir = join(sandbox, "runtime");

const results = [];
function check(name, ok, detail) {
	results.push({ name, ok, detail });
	process.stdout.write(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}\n`);
}

/** Recursive fingerprint of the program directory; any write inside it changes this. */
function fingerprint(dir) {
	const hash = createHash("sha256");
	const walk = (current) => {
		for (const name of readdirSync(current).sort()) {
			const path = join(current, name);
			if (statSync(path).isDirectory()) walk(path);
			else hash.update(`${name}:${statSync(path).size}:${statSync(path).mtimeMs}\n`);
		}
	};
	walk(dir);
	return hash.digest("hex");
}

function wait(ms) {
	return new Promise((accept) => setTimeout(accept, ms));
}

// The tray helper would pop an icon onto whoever's desktop runs this script, so it is switched
// off by default and only exercised through the explicit --allow-tray check.
const childEnv = { ...process.env, ENGLISH_APP_DATA_DIR: dataDir, ENGLISH_APP_RUNTIME_DIR: runtimeDir, ENGLISH_APP_TRAY: "0" };

/** Is a process id still alive? Windows reports EPERM for a live process we may not open. */
function pidAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error?.code === "EPERM";
	}
}

/** A short-lived launcher command (--status, --stop), through node.exe or the GUI launcher. */
function runCommand(cliArgs, executable, extraEnv) {
	const env = { ...childEnv, ...(extraEnv ?? {}) };
	for (const key of Object.keys(env)) {
		if (env[key] === null) delete env[key];
	}
	return new Promise((accept, reject) => {
		const child = spawn(executable ?? nodeExe, [entry, ...cliArgs], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", reject);
		child.on("close", (code) => accept({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
	});
}

/** Plain node:http keeps no pooled sockets, so the script can exit as soon as it is done. */
function send(port, path, options = {}) {
	return new Promise((accept, reject) => {
		const req = request(
			{
				host: "127.0.0.1",
				port,
				path,
				method: options.method ?? "GET",
				agent: false,
				headers: { ...(options.host ? { host: options.host } : {}), ...(options.headers ?? {}) },
			},
			(res) => {
				const chunks = [];
				res.on("data", (chunk) => chunks.push(chunk));
				res.on("end", () => accept({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
			},
		);
		req.on("error", reject);
		if (options.body !== undefined) req.write(options.body);
		req.end();
	});
}

function json(port, path, payload) {
	return send(port, path, {
		method: "POST",
		headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) },
		body: payload,
	});
}

function startServer(extraEnv) {
	const env = { ...childEnv, ...extraEnv };
	for (const key of Object.keys(env)) {
		if (env[key] === null) delete env[key];
	}
	return new Promise((accept, reject) => {
		const child = spawn(nodeExe, [entry, "--serve"], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
		let stderr = "";
		let settled = false;
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.stderrText = () => stderr;
		// Recorded immediately: a process that has already exited will not emit "close" again.
		child.stopped = new Promise((accept) => child.once("close", (code) => accept(code)));
		child.stdout.on("data", () => {
			if (settled) return;
			settled = true;
			accept(child);
		});
		child.on("error", reject);
		child.once("close", (code) => {
			if (settled) return;
			reject(new Error(`服务进程提前退出(码 ${code}):${stderr}`));
		});
		setTimeout(() => {
			if (!settled) reject(new Error(`15 秒内没有启动:${stderr}`));
		}, 15_000).unref?.();
	});
}

function readRuntimeFile(dir) {
	const stats = statSync(join(dir, "runtime.json"), { throwIfNoEntry: false });
	if (!stats) return undefined;
	try {
		return JSON.parse(readFileSync(join(dir, "runtime.json"), "utf8"));
	} catch {
		return undefined;
	}
}

async function readRuntime(dir = runtimeDir) {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		const info = readRuntimeFile(dir);
		if (info) return info;
		await wait(100);
	}
	throw new Error("runtime.json 没有出现,服务可能没有启动");
}

/** Waits for a launched server to publish its runtime file, then reports its port. */
async function waitForPort(child, dir) {
	const deadline = Date.now() + 15_000;
	while (child.exitCode === null && Date.now() < deadline) {
		const info = readRuntimeFile(dir);
		if (info) return info.port;
		await wait(150);
	}
	throw new Error(`服务进程没有写出 ${join(dir, "runtime.json")}:${child.stderrText?.() ?? ""}`);
}

async function main() {
	process.stdout.write(`冒烟测试 ${relative(packageDir, root) || "."}\n`);
	for (const [label, file, minimum] of [
		["随包 Node", nodeExe, 40 * 1024 * 1024],
		["服务端入口", entry, 100_000],
		["前端首页", join(distDir, "index.html"), 100],
		["托盘程序", join(root, "runtime", "拾级托盘.exe"), 4096],
		["产品图标", iconFile, 1024],
	]) {
		const stats = statSync(file, { throwIfNoEntry: false });
		check(`${label}就位`, stats !== undefined && stats.size > minimum, stats ? `${(stats.size / 1024).toFixed(0)} KB` : `缺少 ${file}`);
	}
	const entries = iconEntries(iconFile);
	check("图标含 16/24/32 等小尺寸", entries >= 6, `${entries} 个尺寸`);
	const consoles = [join(root, "runtime", "拾级.exe"), join(root, "runtime", "拾级托盘.exe")]
		.map((file) => `${file.split(/[\\/]/).pop()}=${peSubsystem(file)}`)
		.join(" ");
	check("启动器与托盘都是无窗口 GUI 程序", [join(root, "runtime", "拾级.exe"), join(root, "runtime", "拾级托盘.exe")].every((file) => peSubsystem(file) === 2), `${consoles}(2=GUI)`);
	if (results.some((result) => !result.ok)) {
		process.stdout.write("\n发布目录不完整,后续检查没有意义。\n");
		process.exit(1);
	}
	mkdirSync(dataDir, { recursive: true });
	mkdirSync(runtimeDir, { recursive: true });

	const before = fingerprint(root);
	const child = await startServer();
	let port = 0;
	try {
		const info = await readRuntime();
		port = info.port;
		const base = `http://127.0.0.1:${port}`;
		check("端口在预留区间", port >= 45173 && port <= 45183, String(port));
		check("runtime.json 带关闭令牌", /^[0-9a-f]{64}$/.test(info.token), info.version);

		const page = await send(port, "/");
		const html = page.body.toString("utf8");
		check("首页返回 HTML", page.status === 200 && html.includes("<title>拾级</title>"), String(page.headers["content-type"]));

		const references = [...html.matchAll(/(?:href|src)="(\/[^"]*assets[^"]*)"/g)].map((match) => match[1]);
		const assets = [];
		let assetsOk = references.length > 0;
		for (const path of references) {
			const asset = await send(port, path);
			const cache = String(asset.headers["cache-control"]);
			assetsOk &&= asset.status === 200 && cache.includes("immutable");
			assets.push(`${path} ${asset.status} ${String(asset.headers["content-type"])} ${cache}`);
		}
		check(`${references.length} 个入口资源全部可用且可缓存`, assetsOk, assets.join(" | "));

		const health = await send(port, "/api/health");
		const healthBody = JSON.parse(health.body.toString("utf8"));
		check("接口健康检查通过", health.status === 200 && healthBody.ok === true, healthBody.dictionary);

		const spa = await send(port, "/library");
		check("无扩展名路径回退到入口页", spa.status === 200 && String(spa.headers["content-type"]).includes("text/html"));
		const missing = await send(port, "/missing-file.png");
		check("缺失文件返回 404", missing.status === 404, String(missing.status));

		const rebinding = await send(port, "/api/health", { host: "evil.example" }).catch((error) => ({ status: String(error) }));
		check("拒绝非本机 Host", rebinding.status === 403, String(rebinding.status));
		const escaped = await send(port, "/../../windows/win.ini").catch(() => ({ status: 0 }));
		check("拒绝越出发布目录", escaped.status === 403 || escaped.status === 404, String(escaped.status));

		const created = await json(port, "/api/articles", JSON.stringify({ title: "冒烟测试", text: "A packaged build must write outside its program directory." }));
		const article = JSON.parse(created.body.toString("utf8")).article;
		check("新建文章返回 201", created.status === 201 && Boolean(article?.id), article?.id);
		const written = statSync(join(dataDir, "articles", `${article?.id}.json`), { throwIfNoEntry: false });
		check("文章写入用户数据目录", written !== undefined, join("data", "articles", `${article?.id}.json`));
		const removed = await send(port, `/api/articles/${article?.id}`, { method: "DELETE" });
		check("删除文章成功", removed.status === 200, String(removed.status));

		const exported = await json(
			port,
			"/api/export/word",
			JSON.stringify({ template: "classic-green", content: "both", title: "冒烟", words: [{ word: "serene", gloss: "平静的" }] }),
		);
		check(
			"导出 Word 文档",
			exported.status === 200 && exported.body.subarray(0, 2).toString("ascii") === "PK",
			`${exported.body.length} 字节,${String(exported.headers["content-disposition"]).slice(0, 40)}`,
		);

		const status = await runCommand(["--status"]);
		check("--status 报告运行中", status.code === 0 && /"running":true/.test(status.stdout.replace(/\s+/g, "")), status.stdout);

		const launched = await runCommand(["--status"], join(root, "runtime", "拾级.exe"));
		check("无窗口启动器 拾级.exe 可用", launched.code === 0 && /"running":true/.test(launched.stdout.replace(/\s+/g, "")), launched.stdout || launched.stderr);

		// Exactly what the Start Menu shortcut does: start a detached server if needed, reuse it
		// if it is already up. The browser itself is switched off for the test.
		const runtime3 = join(sandbox, "runtime3");
		mkdirSync(runtime3, { recursive: true });
		const openEnv = { ENGLISH_APP_RUNTIME_DIR: runtime3, ENGLISH_APP_OPEN_BROWSER: "0" };
		const cold = await runCommand(["--open"], undefined, openEnv);
		const coldInfo = readRuntimeFile(runtime3);
		check("--open 冷启动会拉起后台服务", cold.code === 0 && Boolean(coldInfo?.port), cold.stdout || cold.stderr);
		const coldHealth = coldInfo ? await send(coldInfo.port, "/api/health").catch(() => ({ status: 0 })) : { status: 0 };
		check("新起的实例可以访问", coldHealth.status === 200, String(coldHealth.status));
		const second = await runCommand(["--open"], undefined, openEnv);
		const sameInfo = readRuntimeFile(runtime3);
		check("再次点击快捷方式复用同一实例", second.code === 0 && sameInfo?.pid === coldInfo?.pid, `${coldInfo?.pid} → ${sameInfo?.pid}`);
		await runCommand(["--stop"], undefined, openEnv);
		await wait(400);
		check("临时实例已停止", statSync(join(runtime3, "runtime.json"), { throwIfNoEntry: false }) === undefined);
		rmSync(runtime3, { recursive: true, force: true });

		// The tray really paints into this machine's notification area, so it is only run when
		// asked for; the check proves it comes up with the server and leaves with it.
		if (args.includes("--allow-tray")) {
			const runtime4 = join(sandbox, "runtime4");
			mkdirSync(runtime4, { recursive: true });
			const trayEnv = { ENGLISH_APP_RUNTIME_DIR: runtime4, ENGLISH_APP_TRAY: null };
			const trayChild = await startServer(trayEnv);
			let trayPid = 0;
			try {
				const livePort = await waitForPort(trayChild, runtime4);
				for (let attempt = 0; attempt < 40 && !trayPid; attempt += 1) {
					const log = readFileSync(join(runtime4, "logs", "server.log"), "utf8");
					trayPid = Number(log.match(/tray started pid=(\d+)/)?.[1] ?? 0);
					if (!trayPid) await wait(250);
				}
				check("托盘随服务启动", trayPid > 0 && pidAlive(trayPid), `端口 ${livePort},pid ${trayPid}`);
				await runCommand(["--stop"], undefined, trayEnv);
				const deadline = Date.now() + 6000;
				while (pidAlive(trayPid) && Date.now() < deadline) await wait(200);
				check("停止服务后托盘自己退出", !pidAlive(trayPid), `pid ${trayPid}`);
			} finally {
				if (trayChild.exitCode === null) trayChild.kill();
				await Promise.race([trayChild.stopped, wait(3000)]);
				rmSync(runtime4, { recursive: true, force: true });
			}
		}

		const stop = await runCommand(["--stop"]);
		check("--stop 返回成功", stop.code === 0 && stop.stdout.includes("已停止"), stop.stdout || stop.stderr);

		const exited = await Promise.race([child.stopped, wait(10_000).then(() => "timeout")]);
		check("服务进程自行退出", exited !== "timeout", `退出码 ${exited}`);
		check("runtime.json 已清除", statSync(join(runtimeDir, "runtime.json"), { throwIfNoEntry: false }) === undefined);
		check("日志记录了启动与停止", readFileSync(join(runtimeDir, "logs", "server.log"), "utf8").includes("stopped"), base);
	} finally {
		if (child.exitCode === null) child.kill();
		await Promise.race([child.stopped, wait(3000)]);
	}

	// The installed copy has to find its own data directory without being told: the manifest
	// beside the bundle is what says "this is an installation, write to the user's profile".
	const localAppData = join(sandbox, "localappdata");
	const runtime2 = join(sandbox, "runtime2");
	mkdirSync(localAppData, { recursive: true });
	mkdirSync(runtime2, { recursive: true });
	const second = await startServer({ ENGLISH_APP_DATA_DIR: null, ENGLISH_APP_RUNTIME_DIR: runtime2, LOCALAPPDATA: localAppData });
	let secondPort = 0;
	try {
		secondPort = await waitForPort(second, runtime2);
		const created = await json(secondPort, "/api/articles", JSON.stringify({ title: "安装形态", text: "Data belongs to the user, not to the program directory." }));
		const installed = JSON.parse(created.body.toString("utf8")).article;
		const expected = join(localAppData, "english-app", "data", "articles", `${installed?.id}.json`);
		check("未指定数据目录时写入 %LOCALAPPDATA%\\english-app\\data", statSync(expected, { throwIfNoEntry: false }) !== undefined, relative(sandbox, expected));
		await send(secondPort, `/api/articles/${installed?.id}`, { method: "DELETE" });
	} finally {
		if (second.exitCode === null) second.kill();
		await Promise.race([second.stopped, wait(3000)]);
		rmSync(runtime2, { recursive: true, force: true });
	}

	check("程序目录零写入", fingerprint(root) === before, `启动前 ${before.slice(0, 12)} / 结束后 ${fingerprint(root).slice(0, 12)}`);

	const failed = results.filter((result) => !result.ok);
	process.stdout.write(`\n${results.length - failed.length}/${results.length} 项通过\n`);
	if (args.includes("--keep")) process.stdout.write(`临时数据保留在 ${sandbox}\n`);
	else rmSync(sandbox, { recursive: true, force: true });
	if (failed.length > 0) {
		process.stdout.write(`失败项:${failed.map((result) => result.name).join("、")}\n`);
		process.exitCode = 1;
		return;
	}
	process.stdout.write("发布目录可以打包。\n");
}

main().catch((error) => {
	process.stderr.write(`冒烟测试异常:${String(error?.stack ?? error)}\n`);
	process.exitCode = 1;
});
