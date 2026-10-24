#!/usr/bin/env node
/**
 * Build the Windows installer for 拾级.
 *
 *   node packages/shiji/scripts/win/build.mjs [--out <dir>] [--node-from <exe>] [--skip-installer] [--verbose]
 *
 * The pipeline is deliberately strict: every stage that could silently produce an installer
 * that does not run on another machine fails the build instead.
 *
 *   1. build the front end and the single-file server bundle (no node_modules is shipped)
 *   2. fetch the pinned portable Node, verify its SHA-256, take node.exe out of the archive
 *   3. assemble a whitelisted staging tree — personal articles, the dictionary and test files
 *      must never end up inside it
 *   4. write manifest.json, then smoke-test the staged tree with its own runtime
 *   5. compile installer/shiji.iss with the Inno Setup compiler bundled in the innosetup package
 *   6. copy the setup program plus its SHA-256 to the output directory
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
	copyFileSync,
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDir = dirname(fileURLToPath(import.meta.url));
// This repository *is* the package: scripts/win/ sits two levels below the project root.
const packageDir = resolve(scriptDir, "..", "..");
const repoRoot = packageDir;
const cacheDir = join(packageDir, ".cache");
const stagingDir = join(packageDir, "staging");
const installerDir = join(packageDir, "installer");

const args = process.argv.slice(2);
const option = (name) => {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
};
const flags = new Set(args.filter((arg) => arg.startsWith("--") && !option(arg)));
const outputDir = resolve(option("--out") ?? join(packageDir, "release"));
const verbose = flags.has("--verbose");

const version = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")).version;
const nodeRuntime = JSON.parse(readFileSync(join(scriptDir, "node-runtime.json"), "utf8"));

/** Names that must never be shipped: personal writing, the 310MB dictionary and dev-only files. */
const FORBIDDEN = new Set(["data", ".review", "test", "browser-tests", "node_modules", ".cache", "staging", "temp-stub.txt", "1600", ".git"]);
const MIN_STAGING_BYTES = 60 * 1024 * 1024;
const MAX_STAGING_BYTES = 200 * 1024 * 1024;

function log(message) {
	process.stdout.write(`${message}\n`);
}

function step(message) {
	log(`\n=== ${message} ===`);
}

function fail(message) {
	process.stderr.write(`\n构建失败:${message}\n`);
	process.exit(1);
}

function sha256File(file) {
	const hash = createHash("sha256");
	hash.update(readFileSync(file));
	return hash.digest("hex");
}

/** Runs a Node entry point inside this repository, without involving an npm shell wrapper. */
function runNode(entry, entryArgs, cwd, options = {}) {
	const result = spawnSync(process.execPath, [entry, ...entryArgs], {
		cwd,
		stdio: options.inherit || verbose ? "inherit" : ["ignore", "pipe", "pipe"],
		encoding: "utf8",
		windowsHide: true,
	});
	if (result.status !== 0) {
		fail(`${relative(repoRoot, entry)} 退出码 ${result.status ?? result.signal}\n${result.stderr ?? ""}`);
	}
	return result.stdout ?? "";
}

function resolveDependency(name) {
	for (const base of [packageDir, repoRoot]) {
		const candidate = join(base, "node_modules", name);
		if (existsSync(candidate)) return candidate;
	}
	fail(`找不到 ${name},请先在仓库根目录运行 npm install。`);
}

async function download(url, destination, expectedSize) {
	if (existsSync(destination) && statSync(destination).size === expectedSize) {
		log(`使用已缓存的 ${relative(packageDir, destination)}`);
		return;
	}
	mkdirSync(dirname(destination), { recursive: true });
	log(`下载 ${url}`);
	let response;
	try {
		response = await fetch(url, { redirect: "follow" });
	} catch (error) {
		fail(`无法连接 ${url}:${String(error)}`);
	}
	if (!response.ok || !response.body) fail(`下载失败:${response.status} ${response.statusText} ${url}`);
	const stream = createWriteStream(destination);
	let received = 0;
	let lastReport = 0;
	for await (const chunk of response.body) {
		received += chunk.length;
		if (!stream.write(chunk)) await once(stream, "drain");
		if (received - lastReport > 8 * 1024 * 1024) {
			lastReport = received;
			log(`  ${(received / 1024 / 1024).toFixed(0)} MB…`);
		}
	}
	stream.end();
	await new Promise((accept, reject) => stream.on("close", accept).on("error", reject));
	if (received !== expectedSize) fail(`${url} 只下载到 ${received} 字节,期望 ${expectedSize}。`);
	log(`  共 ${(received / 1024 / 1024).toFixed(1)} MB`);
}

function verify(file, expected, label) {
	if (!existsSync(file)) fail(`缺少 ${label}`);
	const actual = sha256File(file);
	if (actual !== expected) fail(`${label} 的 SHA-256 与 ${relative(scriptDir, "node-runtime.json")} 不一致\n  期望 ${expected}\n  实际 ${actual}`);
	log(`${label} 校验通过 ${actual.slice(0, 16)}…`);
}

/**
 * Extracts one member out of a ZIP. Windows ships bsdtar as System32\tar.exe, which is used in
 * preference to whatever tar a Git shell happens to have on PATH.
 */
function extractMember(archive, member, destination) {
	mkdirSync(dirname(destination), { recursive: true });
	const workDir = dirname(destination);
	rmSync(join(workDir, basename(member)), { force: true });
	const system = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
	const candidates = existsSync(system) ? [system, "tar.exe"] : ["tar.exe"];
	let last = "";
	for (const tool of candidates) {
		const result = spawnSync(tool, ["-xf", archive, member], { cwd: workDir, encoding: "utf8", windowsHide: true });
		if (result.status === 0) break;
		last = `${tool}:${String(result.stderr ?? "").trim()}`;
	}
	const extracted = join(workDir, member);
	if (!existsSync(extracted)) fail(`无法从 ${basename(archive)} 取出 ${member}${last ? `(${last})` : ""}`);
	if (resolve(extracted) !== resolve(destination)) {
		rmSync(destination, { force: true });
		copyFileSync(extracted, destination);
		rmSync(extracted, { force: true });
		rmSync(join(workDir, member.split("/")[0]), { recursive: true, force: true });
	}
}

function basename(path) {
	return path.split("/").pop();
}

/** Offset of the PE optional header's Subsystem field (2 = GUI, 3 = console). */
function subsystemOffset(image, label) {
	const headers = image.readUInt32LE(0x3c);
	if (image.readUInt32LE(headers) !== 0x00004550) fail(`${label} 不是有效的 PE 文件。`);
	const optional = headers + 4 + 20;
	return optional + (image.readUInt16LE(optional) === 0x20b ? 68 : 76);
}

function assertGuiSubsystem(file, label) {
	const image = readFileSync(file);
	const value = image.readUInt16LE(subsystemOffset(image, label));
	if (value !== 2) fail(`${label} 的子系统是 ${value},不是 GUI 程序,启动时会闪出控制台窗口。`);
}

/**
 * Copies node.exe into a launcher that Windows runs without a console window, by setting the
 * PE optional header's Subsystem field from IMAGE_SUBSYSTEM_WINDOWS_CUI (3) to
 * IMAGE_SUBSYSTEM_WINDOWS_GUI (2). Everything else is byte-identical, so the Node behaviour
 * — including node:sqlite — is exactly what was verified above. The copy's Authenticode
 * signature no longer matches, which is why node.exe itself is left untouched.
 */
function makeGuiSubsystem(source, target) {
	const image = readFileSync(source);
	const offset = subsystemOffset(image, basename(source));
	if (image.readUInt16LE(offset) !== 3) fail(`${basename(source)} 不是控制台程序,不认识的 PE 结构,停止构建。`);
	image.writeUInt16LE(2, offset);
	writeFileSync(target, image);
	assertGuiSubsystem(target, "拾级.exe");
	log(`拾级.exe 就绪(与 node.exe 仅子系统不同)`);
	return target;
}

/**
 * Builds the notification-area icon with the compiler that ships with .NET Framework 4, which is
 * part of Windows 10/11. A few kilobytes of managed code, no third-party dependency, and — unlike
 * a console node process or a PowerShell loop — a real NotifyIcon that owns no window.
 */
function compileTray(icon, target) {
	const windir = process.env.WINDIR ?? "C:\\Windows";
	const frameworks = ["Framework64", "Framework"];
	const compiler = frameworks
		.map((kind) => join(windir, "Microsoft.NET", kind, "v4.0.30319", "csc.exe"))
		.find((candidate) => existsSync(candidate));
	if (!compiler) fail("这台机器没有 .NET Framework 4 的 csc.exe,无法生成托盘程序。");
	const sources = [join(installerDir, "tray", "tray.cs")];
	const manifest = join(installerDir, "tray", "app.manifest");
	const result = spawnSync(
		compiler,
		[
			"/nologo",
			"/target:winexe",
			"/optimize+",
			"/platform:x64",
			`/win32icon:${icon}`,
			`/win32manifest:${manifest}`,
			`/out:${target}`,
			...sources,
		],
		{ encoding: "utf8", windowsHide: true },
	);
	if (result.status !== 0) {
		fail(`托盘程序编译失败(csc 退出码 ${result.status}):\n${result.stdout ?? ""}${result.stderr ?? ""}`);
	}
	const size = statSync(target).size;
	if (size < 4096) fail(`托盘程序只有 ${size} 字节,不像编译成功。`);
	assertGuiSubsystem(target, "拾级托盘.exe");
	log(`拾级托盘.exe 就绪(${(size / 1024).toFixed(0)} KB,已嵌入图标)`);
	return target;
}

function listFiles(root) {
	const files = [];
	const walk = (dir) => {
		for (const name of readdirSync(dir).sort()) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else files.push(relative(root, path).split(sep).join("/"));
		}
	};
	if (existsSync(root)) walk(root);
	return files;
}

function totalSize(root, files) {
	return files.reduce((sum, file) => sum + statSync(join(root, file)).size, 0);
}

/* ---------- 1. front end and server bundle ---------- */

step(`构建拾级 v${version}`);

// The model client comes from npm, and the bundle inlines whatever it ships.
const aiPackage = resolveDependency("@earendil-works/pi-ai");
if (!existsSync(join(aiPackage, "dist", "index.js"))) {
	fail(`${aiPackage} 里没有 dist/index.js,请重新运行 npm install。`);
}

log("构建前端(vite build)…");
runNode(join(resolveDependency("vite"), "bin", "vite.js"), ["build"], packageDir);
if (!existsSync(join(packageDir, "dist", "index.html"))) fail("vite build 没有产出 dist/index.html。");

step("打包服务端为单文件");
rmSync(stagingDir, { recursive: true, force: true });
const serverBundle = join(stagingDir, "resources", "server", "index.mjs");
mkdirSync(dirname(serverBundle), { recursive: true });
const bundle = await build({
	absWorkingDir: packageDir,
	banner: {
		js: 'import { createRequire as __shijiCreateRequire } from "node:module"; const require = __shijiCreateRequire(import.meta.url);',
	},
	bundle: true,
	entryPoints: ["server/main.ts"],
	format: "esm",
	legalComments: "none",
	logLevel: "silent",
	metafile: true,
	minifySyntax: true,
	minifyWhitespace: true,
	platform: "node",
	outfile: serverBundle,
	sourcemap: false,
	target: "node22.19",
	// The monorepo tsconfig has path aliases that an installed bundle must not inherit.
	tsconfigRaw: { compilerOptions: {} },
});
const external = new Set();
for (const input of Object.values(bundle.metafile.inputs)) {
	for (const item of input.imports) {
		if (item.external && !item.path.startsWith("node:")) external.add(item.path);
	}
}
if (external.size > 0) {
	fail(`服务端 bundle 仍引用外部包 ${[...external].join(", ")};目标机没有 node_modules,请把这些依赖内联或改为随包发布。`);
}
log(`server/index.mjs ${(statSync(serverBundle).size / 1024 / 1024).toFixed(2)} MB,外部依赖 0 个`);

/* ---------- 2. portable Node ---------- */

step(`准备便携 Node ${nodeRuntime.version}`);
const nodeExe = join(stagingDir, "runtime", "node.exe");
mkdirSync(dirname(nodeExe), { recursive: true });
const nodeFrom = option("--node-from");
if (nodeFrom) {
	const source = resolve(nodeFrom);
	if (!existsSync(source)) fail(`--node-from 指向的文件不存在:${source}`);
	copyFileSync(source, nodeExe);
	log(`使用本机 Node ${relative(repoRoot, source)}`);
	const probe = spawnSync(nodeExe, ["--version"], { encoding: "utf8", windowsHide: true });
	const actual = (probe.stdout ?? "").trim();
	if (actual !== nodeRuntime.version) {
		fail(`便携 Node 版本是 ${actual},需要 ${nodeRuntime.version}(node:sqlite 与词典行为按该版本验证过)。`);
	}
} else {
	const archive = join(cacheDir, "node", nodeRuntime.file);
	await download(nodeRuntime.url, archive, nodeRuntime.size);
	verify(archive, nodeRuntime.sha256, nodeRuntime.file);
	extractMember(archive, nodeRuntime.member, nodeExe);
}
const nodeProbe = spawnSync(nodeExe, ["-e", "import('node:sqlite').then(()=>console.log('sqlite ok'))"], {
	encoding: "utf8",
	windowsHide: true,
});
if (!/sqlite ok/.test(nodeProbe.stdout ?? "")) fail(`便携 Node 不支持 node:sqlite:${nodeProbe.stderr || nodeProbe.stdout}`);
log(`便携 Node 就绪,内置词典模块可用`);

// A shortcut that points at console node.exe always opens a black window. The same binary with
// its PE subsystem set to GUI starts silently, and solid compression makes the copy almost free.
const launcher = makeGuiSubsystem(nodeExe, join(stagingDir, "runtime", "拾级.exe"));

// The product icon is installed with the program: shortcuts, the uninstall entry and the tray all
// read this one file. Its ASCII name is deliberate — IconFilename goes through icon-resource
// extraction and Explorer's cache, a different path from the Chinese file names already proven.
const stagedIcon = join(stagingDir, "resources", "icons", "shiji.ico");
mkdirSync(dirname(stagedIcon), { recursive: true });
copyFileSync(join(installerDir, "icons", "shiji.ico"), stagedIcon);
const icon = readFileSync(stagedIcon);
const iconEntries = icon.readUInt16LE(4);
if (icon.readUInt16LE(2) !== 1 || iconEntries < 6) {
	fail(`installer/icons/shiji.ico 不是含多尺寸的 ICO(类型 ${icon.readUInt16LE(2)},条目 ${iconEntries});托盘与快捷方式需要 16/24/32 这几档。`);
}
log(`图标 shiji.ico:${iconEntries} 个尺寸`);
compileTray(stagedIcon, join(stagingDir, "runtime", "拾级托盘.exe"));

/* ---------- 3. staging ---------- */

step("组装发布目录");
// Windows PowerShell 5.1 reads a script without a byte-order mark as ANSI, which mangles every
// Chinese message and breaks parsing, so both text formats shipped here must keep their BOM.
for (const [file, label] of [
	[join(scriptDir, "fetch-ecdict.ps1"), "词典下载脚本"],
	[join(installerDir, "shiji.iss"), "安装脚本"],
]) {
	if (readFileSync(file).subarray(0, 3).toString("hex") !== "efbbbf") fail(`${label} ${basename(file)} 缺少 UTF-8 BOM,请重新保存为「UTF-8 带签名」。`);
}
mkdirSync(join(stagingDir, "tools"), { recursive: true });
for (const tool of ["fetch-ecdict.ps1", "ecdict.json", "build-dictionary.mjs"]) {
	copyFileSync(join(scriptDir, tool), join(join(stagingDir, "tools"), tool));
}
for (const file of listFiles(join(packageDir, "dist"))) {
	const destination = join(stagingDir, "resources", "dist", file);
	mkdirSync(dirname(destination), { recursive: true });
	copyFileSync(join(packageDir, "dist", file), destination);
}

const staged = listFiles(stagingDir);
const leaks = staged.filter((file) => file.split("/").some((segment) => FORBIDDEN.has(segment)));
if (leaks.length > 0) fail(`发布目录混入了不该发布的内容:${leaks.join(", ")}`);
const required = [
	"resources/dist/index.html",
	"resources/server/index.mjs",
	"resources/icons/shiji.ico",
	"runtime/node.exe",
	"runtime/拾级.exe",
	"runtime/拾级托盘.exe",
	"tools/fetch-ecdict.ps1",
];
for (const file of required) {
	if (!staged.includes(file)) fail(`发布目录缺少 ${file}。`);
}
const bytes = totalSize(stagingDir, staged);
if (bytes < MIN_STAGING_BYTES || bytes > MAX_STAGING_BYTES) {
	fail(`发布目录体积 ${(bytes / 1024 / 1024).toFixed(1)} MB 不在 ${(MIN_STAGING_BYTES / 1024 / 1024).toFixed(0)}-${(MAX_STAGING_BYTES / 1024 / 1024).toFixed(0)} MB 之间,构建内容可能不完整。`);
}

const manifest = {
	version,
	productName: "拾级",
	builtAt: new Date().toISOString(),
	node: { version: nodeRuntime.version, sha256: nodeRuntime.sha256 },
	dictionary: JSON.parse(readFileSync(join(scriptDir, "ecdict.json"), "utf8")),
	bundleBytes: statSync(serverBundle).size,
	files: staged.map((file) => ({ path: file, sha256: sha256File(join(stagingDir, file)), size: statSync(join(stagingDir, file)).size })),
};
writeFileSync(join(stagingDir, "resources", "manifest.json"), `${JSON.stringify(manifest, null, "\t")}\n`, "utf8");
log(`${staged.length + 1} 个文件,${(bytes / 1024 / 1024).toFixed(1)} MB`);

/* ---------- 4. smoke ---------- */

step("冒烟测试发布目录");
runNode(join(scriptDir, "smoke.mjs"), [], packageDir, { inherit: true });

/* ---------- 5. installer ---------- */

if (flags.has("--skip-installer")) {
	log("\n--skip-installer:发布目录已就绪,跳过安装包编译。");
	log(`  ${stagingDir}`);
	process.exit(0);
}

step("编译安装程序");
const compiler = findInstallerCompiler();
if (!compiler) {
	fail("找不到 Inno Setup 编译器。请先运行 npm install -D innosetup,或安装 https://jrsoftware.org/isdl.php 后重试。");
}
const outputBase = join(packageDir, "installer-output");
rmSync(outputBase, { recursive: true, force: true });
mkdirSync(outputBase, { recursive: true });
const compile = spawnSync(
	compiler,
	[
		join(installerDir, "shiji.iss"),
		`/DShijiVersion=${version}`,
		`/DShijiStaging=${stagingDir}`,
		`/DShijiOutput=${outputBase}`,
		`/DShijiLanguage=${join(installerDir, "languages", "ChineseSimplified.isl")}`,
	],
	{ stdio: "inherit", windowsHide: true },
);
if (compile.status !== 0) fail(`ISCC 退出码 ${compile.status}`);

/* ---------- 6. publish ---------- */

const setupName = `拾级-Setup-${version}.exe`;
const built = join(outputBase, setupName);
if (!existsSync(built)) fail(`ISCC 没有产出 ${setupName}。`);
mkdirSync(outputDir, { recursive: true });
const target = join(outputDir, setupName);
copyFileSync(built, target);
const hash = sha256File(target);
writeFileSync(`${target}.sha256.txt`, `${hash}  ${setupName}\n`, "utf8");
log(`\n安装包:${target}`);
log(`  ${(statSync(target).size / 1024 / 1024).toFixed(1)} MB`);
log(`  SHA-256 ${hash}`);

function findInstallerCompiler() {
	// The innosetup npm package carries its own ISCC.exe, so nothing has to be installed system-wide.
	for (const candidate of [
		join(packageDir, "node_modules", "innosetup", "bin", "ISCC.exe"),
		join(repoRoot, "node_modules", "innosetup", "bin", "ISCC.exe"),
	]) {
		if (existsSync(candidate)) return candidate;
	}
	for (const candidate of ["C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe", "C:\\Program Files\\Inno Setup 6\\ISCC.exe"]) {
		if (existsSync(candidate)) return candidate;
	}
	const which = spawnSync("where.exe", ["ISCC.exe"], { encoding: "utf8", windowsHide: true });
	const first = (which.stdout ?? "").split(/\r?\n/).find((line) => line.trim().length > 0);
	return first ? first.trim() : undefined;
}
