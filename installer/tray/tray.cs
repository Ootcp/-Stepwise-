// 拾级 系统托盘图标。
//
// 用系统自带的 .NET Framework 编译器在打包时生成(见 scripts/win/build.mjs),不引入任何第三方
// 依赖。语言版本上限是 C# 5:没有字符串插值、没有 ?. 、没有 nameof。
//
// 它只做一件事:服务在跑的时候,在通知区域留一个入口。左键单击用默认浏览器打开拾级;右键菜单
// 可以打开、停止、切换开机自启、打开日志目录。
//
// 退出条件有三重,任何一条成立就收工,避免服务已经没了而图标还挂着:
//   1) runtime.json 被服务删掉(正常停止)
//   2) 启动它的 node 进程不在了(被 taskkill 等硬杀)
//   3) /api/health 连续三次问不通(端口挂了但进程还在)

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace ShijiTray
{
    internal static class Program
    {
        private const int SM_CXSMICON = 49;
        private const string RunKeyPath = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
        private const string RunValueName = "拾级";

        [DllImport("user32.dll")]
        private static extern int GetSystemMetrics(int nIndex);

        private static NotifyIcon tray;
        private static MenuItem autostartItem;
        private static string url = "http://127.0.0.1/";
        private static string iconPath = "";
        private static string runtimePath = "";
        private static string launcherPath = "";
        private static string entryPath = "";
        private static string logsPath = "";
        private static string runValue = "";
        private static int serverPid = -1;
        private static volatile bool exiting;

        [STAThread]
        private static int Main(string[] args)
        {
            ReadArguments(args);
            if (!File.Exists(iconPath))
            {
                return 3;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            tray = new NotifyIcon();
            tray.Icon = LoadIcon();
            tray.Text = "拾级";
            tray.Visible = true;

            MenuItem open = new MenuItem("打开拾级", delegate { OpenBrowser(); });
            MenuItem stop = new MenuItem("停止拾级", delegate { StopServer(); });
            autostartItem = new MenuItem("随 Windows 启动", delegate { ToggleAutostart(); });
            autostartItem.Checked = AutostartEnabled();
            MenuItem logs = new MenuItem("打开日志文件夹", delegate { OpenLogs(); });

            ContextMenu menu = new ContextMenu(new MenuItem[] { open, stop, new MenuItem("-"), autostartItem, logs });
            tray.ContextMenu = menu;
            tray.Click += delegate { OpenBrowser(); };

            Thread watcher = new Thread(WatchServer);
            watcher.IsBackground = true;
            watcher.Start();

            Application.ApplicationExit += delegate { DisposeTray(); };
            AppDomain.CurrentDomain.ProcessExit += delegate { DisposeTray(); };

            Application.Run();
            DisposeTray();
            return 0;
        }

        private static void ReadArguments(string[] args)
        {
            for (int index = 0; index + 1 < args.Length; index += 2)
            {
                string key = args[index];
                string value = args[index + 1];
                if (key == "--icon") { iconPath = value; }
                else if (key == "--url") { url = value; }
                else if (key == "--runtime") { runtimePath = value; }
                else if (key == "--launcher") { launcherPath = value; }
                else if (key == "--entry") { entryPath = value; }
                else if (key == "--logs") { logsPath = value; }
                else if (key == "--run-value") { runValue = value; }
                else if (key == "--pid") { int.TryParse(value, out serverPid); }
            }
        }

        private static Icon LoadIcon()
        {
            try
            {
                int size = GetSystemMetrics(SM_CXSMICON);
                if (size > 0)
                {
                    return new Icon(iconPath, new Size(size, size));
                }
                return new Icon(iconPath);
            }
            catch
            {
                try
                {
                    return Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                }
                catch
                {
                    return SystemIcons.Application;
                }
            }
        }

        private static void OpenBrowser()
        {
            TryStart(url, null);
        }

        private static void OpenLogs()
        {
            if (logsPath.Length == 0 || !Directory.Exists(logsPath))
            {
                return;
            }
            TryStart("explorer.exe", "\"" + logsPath + "\"");
        }

        private static void StopServer()
        {
            if (launcherPath.Length > 0 && entryPath.Length > 0)
            {
                TryStart(launcherPath, "\"" + entryPath + "\" --stop");
            }
            // The server removes runtime.json on the way out; do not wait around for it.
            ExitTray();
        }

        private static bool AutostartEnabled()
        {
            RegistryKey key = null;
            try
            {
                key = Registry.CurrentUser.OpenSubKey(RunKeyPath, false);
                if (key == null) { return false; }
                return key.GetValue(RunValueName) != null;
            }
            catch
            {
                return false;
            }
            finally
            {
                if (key != null) { key.Close(); }
            }
        }

        private static void ToggleAutostart()
        {
            if (runValue.Length == 0)
            {
                return;
            }
            RegistryKey key = null;
            try
            {
                key = Registry.CurrentUser.OpenSubKey(RunKeyPath, true);
                if (key == null)
                {
                    key = Registry.CurrentUser.CreateSubKey(RunKeyPath);
                }
                if (AutostartEnabled())
                {
                    key.DeleteValue(RunValueName, false);
                }
                else
                {
                    key.SetValue(RunValueName, runValue, RegistryValueKind.String);
                }
            }
            catch
            {
                // A locked-down profile can refuse the Run key; the check mark just stays as it was.
            }
            finally
            {
                if (key != null) { key.Close(); }
            }
            autostartItem.Checked = AutostartEnabled();
        }

        private static void TryStart(string file, string arguments)
        {
            try
            {
                ProcessStartInfo info = new ProcessStartInfo(file);
                info.UseShellExecute = true;
                if (arguments != null)
                {
                    info.Arguments = arguments;
                }
                Process.Start(info);
            }
            catch
            {
                // Nothing to report to: the tray has no window of its own.
            }
        }

        private static void WatchServer()
        {
            int healthFailures = 0;
            int ticks = 0;
            while (!exiting)
            {
                // Half a second, so the icon disappears before the server's three-second
                // backstop has to terminate this process — terminated processes cannot clean
                // up their own icon.
                Thread.Sleep(500);
                if (exiting) { return; }
                ticks = ticks + 1;

                if (runtimePath.Length > 0 && !File.Exists(runtimePath))
                {
                    ExitTray();
                    return;
                }

                if (serverPid > 0 && ticks % 4 == 0)
                {
                    try
                    {
                        Process.GetProcessById(serverPid);
                    }
                    catch
                    {
                        ExitTray();
                        return;
                    }
                }

                if (ticks % 60 != 0)
                {
                    continue;
                }

                if (!PingHealth())
                {
                    healthFailures = healthFailures + 1;
                    if (healthFailures == 1)
                    {
                        TrySetText("拾级 – 无响应");
                    }
                    if (healthFailures >= 3)
                    {
                        ExitTray();
                        return;
                    }
                }
                else if (healthFailures > 0)
                {
                    healthFailures = 0;
                    TrySetText("拾级");
                }
            }
        }

        private static bool PingHealth()
        {
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url + "api/health");
                request.Timeout = 3000;
                request.AllowAutoRedirect = false;
                using (WebResponse response = request.GetResponse())
                {
                    return ((HttpWebResponse)response).StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        private static void TrySetText(string text)
        {
            try
            {
                tray.Text = text;
            }
            catch
            {
                // The handle may already be gone during logoff.
            }
        }

        private static void ExitTray()
        {
            if (exiting) { return; }
            exiting = true;
            DisposeTray();
            try
            {
                Application.Exit();
            }
            catch
            {
            }
        }

        private static void DisposeTray()
        {
            if (tray == null) { return; }
            try
            {
                // Without this the icon stays painted in the notification area until something
                // else repaints it, which looks exactly like a broken install.
                tray.Visible = false;
                tray.Dispose();
            }
            catch
            {
            }
            tray = null;
        }
    }
}
