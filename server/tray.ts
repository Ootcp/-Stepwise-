import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The notification-area icon for an installed 拾级.
 *
 * The helper itself is a few dozen lines of C# compiled by the .NET Framework compiler that
 * ships with Windows 10/11 (installer/tray/tray.cs, built by scripts/win/build.mjs). This module
 * only decides whether it should run, hands it what it needs, and makes sure it goes away with
 * the server — a tray icon left behind after the service stopped looks exactly like a broken
 * install.
 */

export interface TraySpec {
	exe: string;
	icon: string;
	url: string;
	pid: number;
	runtimePath: string;
	launcher: string;
	entry: string;
	logs: string;
	runValue: string;
}

export interface TrayHandle {
	pid?: number;
	/** Lets the helper notice the server is gone and remove its own icon; kills it if it lingers. */
	stop(): void;
}

export type TrayLauncher = (spec: TraySpec, log: (line: string) => void) => TrayHandle;

function bundleDirectory(): string {
	return dirname(fileURLToPath(import.meta.url));
}

/** The installer writes this marker next to the bundle when the user unchecked the tray task. */
export function trayDisabledByInstaller(): boolean {
	return existsSync(join(bundleDirectory(), "..", "tray.disabled"));
}

/** The command Windows runs at logon: the GUI launcher, so no console window flashes up. */
export function autoStartCommand(launcher: string, entry: string): string {
	return `"${launcher}" "${entry}" --serve`;
}

/** The installed program layout, or undefined for a source checkout. */
function installedLayout(): { trayExe: string; icon: string; launcher: string; entry: string } | undefined {
	const here = bundleDirectory();
	const runtimeDir = join(here, "..", "..", "runtime");
	const paths = {
		trayExe: join(runtimeDir, "拾级托盘.exe"),
		icon: join(here, "..", "icons", "shiji.ico"),
		launcher: join(runtimeDir, "拾级.exe"),
		entry: join(here, "index.mjs"),
	};
	return Object.values(paths).every((path) => existsSync(path)) ? paths : undefined;
}

/**
 * Everything the helper needs, but only for an installed copy: in a source checkout these paths
 * do not exist and the developer's taskbar is left alone.
 */
export function resolveTraySpec(given: { url: string; runtimePath: string }): TraySpec | undefined {
	const paths = installedLayout();
	if (!paths) return undefined;
	return {
		exe: paths.trayExe,
		icon: paths.icon,
		url: given.url,
		pid: process.pid,
		runtimePath: given.runtimePath,
		launcher: paths.launcher,
		entry: paths.entry,
		logs: join(dirname(given.runtimePath), "logs"),
		runValue: autoStartCommand(paths.launcher, paths.entry),
	};
}

export function trayArguments(spec: TraySpec): string[] {
	return [
		"--icon",
		spec.icon,
		"--url",
		spec.url,
		"--pid",
		String(spec.pid),
		"--runtime",
		spec.runtimePath,
		"--launcher",
		spec.launcher,
		"--entry",
		spec.entry,
		"--logs",
		spec.logs,
		"--run-value",
		spec.runValue,
	];
}

export function launchTray(spec: TraySpec, log: (line: string) => void): TrayHandle {
	let child: ChildProcess | undefined;
	try {
		child = spawn(spec.exe, trayArguments(spec), { detached: false, windowsHide: true, stdio: "ignore" });
	} catch (error) {
		log(`tray failed to start: ${String(error)}`);
		return { stop(): void {} };
	}
	child.on("error", (error) => log(`tray error: ${String(error)}`));
	child.once("exit", (code) => log(`tray exited code=${String(code)}`));
	// The helper is not allowed to keep anything alive on its own.
	child.unref();
	const pid = child.pid;
	if (pid !== undefined) log(`tray started pid=${pid}`);
	return {
		pid,
		stop(): void {
			if (!child || child.exitCode !== null || child.signalCode !== null) return;
			const killer = setTimeout(() => {
				try {
					child.kill();
				} catch {
					// Already gone.
				}
			}, 3000);
			killer.unref();
			child.once("exit", () => clearTimeout(killer));
		},
	};
}
