using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class CompanionProgram {
    [STAThread]
    public static int Main(string[] args) {
        if (Array.IndexOf(args, "--self-test") >= 0) {
            string target = "KutzUI.Companion.Test/" + Guid.NewGuid().ToString("N");
            string testDirectory = Path.Combine(Path.GetTempPath(), "KutzUI-test-" + Guid.NewGuid().ToString("N"));
            try {
                KutzCredentialStore.Set(target, "test-user", "synthetic-test-key");
                if (KutzCredentialStore.Get(target) != "synthetic-test-key") return 1;
                KutzCredentialStore.Remove(target);
                if (KutzCredentialStore.Get(target) != null) return 1;
                Application.EnableVisualStyles();
                // A site saved as https://cr0m.com (any case, trailing slash) moves to the WoW site and is saved back; others stay.
                Directory.CreateDirectory(testDirectory);
                foreach (var saved in new[] { "HTTPS://CR0M.com/", "https://example.com" }) {
                    File.WriteAllText(Path.Combine(testDirectory, "settings.json"),
                        "{\"version\":1,\"game\":\"C:/Game\",\"base\":\"" + saved + "\",\"futureOption\":42}");
                    using (var moved = new CompanionForm(testDirectory)) { if (!moved.SiteMoveSelfTest(saved)) return 1; }
                }
                File.Delete(Path.Combine(testDirectory, "settings.json"));
                using (var form = new CompanionForm(testDirectory)) {
                    if (form.Handle == IntPtr.Zero || !form.TrayLifecycleSelfTest()) return 1;
                }
                return 0;
            } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
            finally { try { KutzCredentialStore.Remove(target); } catch {} try { if (Directory.Exists(testDirectory)) Directory.Delete(testDirectory, true); } catch {} }
        }
        bool created;
        using (var mutex = new Mutex(true, "Local\\KutzUICompanion", out created)) {
            if (!created) {
                try { using (var activation = EventWaitHandle.OpenExisting("Local\\KutzUICompanion.ShowSettings")) activation.Set(); }
                catch { MessageBox.Show("KutzUI Companion is already running. Open Settings from its icon beside the clock.", "KutzUI Companion"); }
                return 0;
            }
            try {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                using (var form = new CompanionForm(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "KutzUI", "Companion"))) {
                    using (var context = new ApplicationContext())
                    using (var activation = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\KutzUICompanion.ShowSettings")) {
                        form.FormClosed += delegate { context.ExitThread(); };
                        var handle = form.Handle;
                        var wait = ThreadPool.RegisterWaitForSingleObject(activation, delegate {
                            if (!form.IsDisposed) { try { form.BeginInvoke((Action)form.ShowSettings); } catch (InvalidOperationException) {} }
                        }, null, Timeout.Infinite, false);
                        try {
                            bool watch = Array.IndexOf(args, "--watch") >= 0;
                            bool settings = Array.IndexOf(args, "--settings") >= 0 || !form.CanStartHidden;
                            if (settings) form.ShowSettings(); else form.HideToTray();
                            if (!settings && form.ShouldResume(watch)) form.BeginInvoke((Action)delegate { form.Send("start"); });
                            Application.Run(context);
                        } finally { wait.Unregister(null); }
                    }
                }
                return 0;
            } catch { MessageBox.Show("Companion could not start. Extract the entire download to a writable folder and try again.", "KutzUI Companion"); return 1; }
            finally { mutex.ReleaseMutex(); }
        }
    }
}

internal sealed partial class CompanionForm : Form {
    private readonly string directory, config;
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();
    private readonly TextBox game = new TextBox(), site = new TextBox(), key = new TextBox();
    private readonly CheckBox remember = new CheckBox(), startup = new CheckBox(), sendInventory = new CheckBox(), sendAuctions = new CheckBox();
    private readonly Label account = new Label(), status = new Label();
    private readonly Button browse = new Button(), connect = new Button(), start = new Button();
    private Process worker;
    private bool running, busy, closing;
    private bool pausedPreference = true, hasPausePreference, configurationLoaded, pausePersistenceFailed;
    private int requestId;
    private string pendingKey = "", pendingSite = "", sessionKey = "", sessionSite = "";
    private const string RunPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string StartupName = "KutzUI Companion";
    private static string LegacyShortcut { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "KutzUI Companion.lnk"); } }
    private const string WowSite = "https://wow.cr0m.com";
    // WoW moved from cr0m.com to its own site. A saved https://cr0m.com follows it; a self-hosted origin is left alone.
    internal static string MovedOrigin(string origin) {
        return String.Equals((origin ?? "").Trim().TrimEnd('/'), "https://cr0m.com", StringComparison.OrdinalIgnoreCase) ? WowSite : origin;
    }
    private static string Target(string origin) { return "KutzUI.Companion/" + origin.TrimEnd('/').ToLowerInvariant(); }

    public CompanionForm(string dataDirectory) {
        directory = dataDirectory; config = Path.Combine(directory, "settings.json");
        Text = "KutzUI Companion " + typeof(CompanionProgram).Assembly.GetName().Version.ToString(3); ClientSize = new Size(590, 533); StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; AutoScaleMode = AutoScaleMode.Font;
        AddLabel("Inventory sync for cr0m", 20, 15, 550, 24);
        AddLabel("Game client folder (contains WTF and Interface)", 20, 49, 550, 22);
        game.SetBounds(20, 73, 425, 25); Controls.Add(game);
        ConfigureButton(browse, "Browse...", 455, 71, 115, delegate {
            using (var dialog = new FolderBrowserDialog { Description = "Select the WoW client folder containing WTF and Interface" }) {
                if (dialog.ShowDialog(this) == DialogResult.OK) game.Text = dialog.SelectedPath;
            }
        });
        game.Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "World of Warcraft", "_forever_");
        AddLabel("cr0m site", 20, 111, 550, 22);
        site.SetBounds(20, 135, 425, 25); site.Text = WowSite; Controls.Add(site);
        var getKey = new Button();
        ConfigureButton(getKey, "Get key", 455, 133, 115, delegate {
            try { Process.Start(new ProcessStartInfo(Origin() + "/private/settings#wow-upload-key") { UseShellExecute = true }); }
            catch { SetStatus("Could not open the browser. Open cr0m user Settings to generate a key."); }
        });
        AddLabel("API key (leave empty to use the key saved for this site)", 20, 173, 550, 22);
        key.SetBounds(20, 197, 550, 25); key.UseSystemPasswordChar = true; Controls.Add(key);
        remember.Text = "Remember securely in Windows Credential Manager"; remember.Checked = true;
        remember.SetBounds(20, 231, 550, 26); Controls.Add(remember);
        startup.Text = "Run Companion when I sign in to Windows (requires a saved key)";
        startup.SetBounds(20, 260, 550, 26); Controls.Add(startup);
        // What this PC shares. A price-gathering "service" character unticks the first.
        sendInventory.Text = "Upload my characters (inventory, gear, professions)"; sendInventory.Checked = true;
        sendInventory.SetBounds(20, 289, 550, 26); Controls.Add(sendInventory);
        sendAuctions.Text = "Upload auction house prices (shared per realm, no character names)"; sendAuctions.Checked = true;
        sendAuctions.SetBounds(20, 318, 550, 26); Controls.Add(sendAuctions);
        ConfigureButton(connect, "Connect / save", 20, 359, 130, delegate { Send("connect"); });
        ConfigureButton(start, "Start", 160, 359, 110, delegate { Send("start"); });
        ConfigureButton(new Button(), "Pause", 280, 359, 110, delegate { Pause(); });
        ConfigureButton(new Button(), "Forget key", 400, 359, 170, delegate {
            Pause(true);
            try {
                KutzCredentialStore.Remove(Target(Origin())); key.Clear(); sessionKey = ""; sessionSite = "";
                account.Text = "Account: not connected";
                SetStatus("Key removed from this PC. Revoke it on cr0m to invalidate other copies.");
            } catch { SetStatus("Could not remove the saved key. Check Windows Credential Manager."); }
        });
        account.Text = "Account: not connected"; account.SetBounds(20, 402, 550, 24); Controls.Add(account);
        SetStatus("Paused. Start uploads in the tray; closing this window keeps Companion running.");
        status.SetBounds(20, 433, 550, 48); Controls.Add(status);
        AddLabel("Private exports stay in LocalAppData\\KutzUI\\Companion.", 20, 498, 550, 22);
        try {
            using (var run = Registry.CurrentUser.OpenSubKey(RunPath)) startup.Checked = startupRegistered = (run != null && run.GetValue(StartupName) != null) || File.Exists(LegacyShortcut);
            if (File.Exists(config)) {
                var settings = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(config));
                if (settings.ContainsKey("game")) game.Text = Convert.ToString(settings["game"]);
                if (settings.ContainsKey("base")) {
                    string saved = Convert.ToString(settings["base"]);
                    site.Text = MovedOrigin(saved);
                    if (site.Text != saved) {
                        // Keys belong to an account on the new site, so the one saved for cr0m.com is not reused.
                        SetStatus("Uploads moved to wow.cr0m.com. Click Get key to make a key there, then Connect / save.", true);
                        try { settings["base"] = site.Text; WriteSettings(settings); } catch {} // not saved: moved again on the next start
                    }
                }
                if (settings.ContainsKey("remember")) remember.Checked = Convert.ToBoolean(settings["remember"]);
                if (settings.ContainsKey("sendInventory")) sendInventory.Checked = Convert.ToBoolean(settings["sendInventory"]);
                if (settings.ContainsKey("sendAuctions")) sendAuctions.Checked = Convert.ToBoolean(settings["sendAuctions"]);
                hasPausePreference = settings.ContainsKey("paused");
                if (hasPausePreference) pausedPreference = Convert.ToBoolean(settings["paused"]);
                configurationLoaded = settings.ContainsKey("game") && settings.ContainsKey("base");
            }
        } catch { SetStatus("Settings could not be read. Select your folder and reconnect."); }
        InitializeTray();
    }
    private void AddLabel(string text, int x, int y, int w, int h) {
        var label = new Label { Text = text }; label.SetBounds(x, y, w, h); Controls.Add(label);
    }
    private void ConfigureButton(Button button, string text, int x, int y, int width, EventHandler click) {
        button.Text = text; button.SetBounds(x, y, width, 30); button.Click += click; Controls.Add(button);
    }
    private string Origin() {
        Uri origin;
        if (!Uri.TryCreate(site.Text, UriKind.Absolute, out origin) || origin.Scheme != "https" || origin.UserInfo != "" || origin.Query != "" || origin.Fragment != "" || origin.AbsolutePath != "/")
            throw new ArgumentException("Enter an HTTPS site origin, for example https://wow.cr0m.com.");
        return origin.GetLeftPart(UriPartial.Authority);
    }
    private void Startup(bool enable) {
        using (var run = Registry.CurrentUser.CreateSubKey(RunPath)) {
            if (enable) run.SetValue(StartupName, "\"" + Application.ExecutablePath + "\" --watch", RegistryValueKind.String);
            else run.DeleteValue(StartupName, false);
        }
        if (File.Exists(LegacyShortcut)) File.Delete(LegacyShortcut);
        startupRegistered = enable;
    }
    private Dictionary<string, object> ReadSettings() {
        return File.Exists(config) ? json.Deserialize<Dictionary<string, object>>(File.ReadAllText(config)) : new Dictionary<string, object>();
    }
    private void WriteSettings(Dictionary<string, object> data) {
        Directory.CreateDirectory(directory);
        File.WriteAllText(config + ".tmp", json.Serialize(data), new UTF8Encoding(false));
        if (File.Exists(config)) File.Replace(config + ".tmp", config, null); else File.Move(config + ".tmp", config);
    }
    private void Save() {
        var data = ReadSettings();
        data["version"] = 1; data["game"] = game.Text; data["base"] = site.Text;
        data["remember"] = remember.Checked; data["paused"] = pausedPreference;
        data["sendInventory"] = sendInventory.Checked; data["sendAuctions"] = sendAuctions.Checked;
        WriteSettings(data); configurationLoaded = hasPausePreference = true;
        if (!remember.Checked) startup.Checked = false;
        Startup(startup.Checked);
    }
    private void RememberPause() {
        pausedPreference = true; hasPausePreference = true;
        if (File.Exists(config)) { var data = ReadSettings(); data["paused"] = true; WriteSettings(data); }
    }
    private void EnableSettings() {
        bool enabled = !busy && !running;
        game.Enabled = site.Enabled = key.Enabled = browse.Enabled = connect.Enabled = start.Enabled = enabled;
        remember.Enabled = startup.Enabled = sendInventory.Enabled = sendAuctions.Enabled = enabled;
        UpdateTray();
    }
    private void EnsureWorker() {
        if (worker != null && !worker.HasExited) return;
        string binary = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "KutzInventoryUploader.exe");
        if (!File.Exists(binary)) throw new FileNotFoundException("Extract the entire Companion download; KutzInventoryUploader.exe is missing.");
        var info = new ProcessStartInfo(binary) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        info.EnvironmentVariables.Remove("NODE_OPTIONS");
        info.EnvironmentVariables.Remove("NODE_PATH");
        worker = new Process { StartInfo = info, EnableRaisingEvents = true };
        worker.OutputDataReceived += delegate(object sender, DataReceivedEventArgs args) {
            if (args.Data != null && !closing) {
                try { BeginInvoke((Action)delegate { Receive(args.Data); }); } catch (InvalidOperationException) {}
            }
        };
        worker.ErrorDataReceived += delegate {}; // Unexpected worker output must not leak private data into the UI/logs.
        worker.Exited += delegate(object sender, EventArgs args) {
            if (!closing) { try { BeginInvoke((Action)delegate { if (worker != sender) return; running = busy = false; EnableSettings(); SetStatus("Uploader stopped. Reconnect to start again.", true); }); } catch (InvalidOperationException) {} }
        };
        worker.Start(); worker.BeginOutputReadLine(); worker.BeginErrorReadLine();
    }
    public void Send(string action) {
        try {
            string origin = Origin(); site.Text = origin;
            string secret = key.Text;
            if (secret == "" && sessionSite == origin) secret = sessionKey;
            if (secret == "") secret = KutzCredentialStore.Get(Target(origin));
            if (String.IsNullOrEmpty(secret)) throw new ArgumentException("Paste your cr0m upload key. Get key opens user Settings.");
            if (action == "start" && (!Directory.Exists(Path.Combine(game.Text, "WTF")) || !Directory.Exists(Path.Combine(game.Text, "Interface"))))
                throw new ArgumentException("Select the game client folder containing WTF and Interface.");
            if (action == "start" && !sendInventory.Checked && !sendAuctions.Checked)
                throw new ArgumentException("Tick at least one: upload my characters, or upload auction house prices.");
            EnsureWorker(); pendingKey = secret; pendingSite = origin;
            hideAfterStart = action == "start";
            if (hideAfterStart) pausePersistenceFailed = false;
            busy = true; EnableSettings(); SetStatus("Connecting...");
            worker.StandardInput.WriteLine(json.Serialize(new Dictionary<string, object> {
                { "requestId", ++requestId }, { "action", action }, { "game", game.Text }, { "base", origin }, { "key", secret }, { "dataDirectory", directory },
                { "sendInventory", sendInventory.Checked }, { "sendAuctions", sendAuctions.Checked }
            }));
        } catch (ArgumentException error) { busy = false; EnableSettings(); SetStatus(error.Message, true); }
        catch (FileNotFoundException error) { busy = false; EnableSettings(); SetStatus(error.Message, true); }
        catch { busy = false; pendingKey = ""; EnableSettings(); SetStatus("Could not connect. Check that the package is fully extracted and Credential Manager is available.", true); }
    }
    private void Pause(bool disableStartup = false) {
        try {
            hideAfterStart = false; pausePersistenceFailed = false;
            requestId++; pendingKey = "";
            if (worker != null && !worker.HasExited) {
                worker.StandardInput.WriteLine(json.Serialize(new Dictionary<string, object> { { "action", "pause" }, { "requestId", requestId } }));
                SetStatus("Pausing...");
            } else { running = busy = false; EnableSettings(); SetStatus("Paused"); }
            RememberPause();
            if (disableStartup) { startup.Checked = false; Startup(false); }
        } catch { pausePersistenceFailed = true; SetStatus("Could not complete pause. Use Exit Companion from the tray to stop the uploader.", true); }
    }
    private void Receive(string line) {
        if (closing) return;
        try {
            var message = json.Deserialize<Dictionary<string, object>>(line);
            if (!message.ContainsKey("requestId") || Convert.ToInt32(message["requestId"]) != requestId) return;
            string state = Convert.ToString(message["state"]);
            if (state == "connected") {
                string username = Convert.ToString(message["username"]);
                account.Text = "Account: " + username + (message.ContainsKey("legacy") && Convert.ToBoolean(message["legacy"]) ? " (legacy shared token)" : "");
                running = message.ContainsKey("starting") && Convert.ToBoolean(message["starting"]);
                if (running) { pausedPreference = false; hasPausePreference = true; }
                if (remember.Checked) KutzCredentialStore.Set(Target(pendingSite), username, pendingKey); else KutzCredentialStore.Remove(Target(pendingSite));
                sessionKey = pendingKey; sessionSite = pendingSite; pendingKey = ""; key.Clear(); Save(); busy = false;
            } else if (state == "watching") { running = true; busy = false; }
            else if (state == "paused") { running = busy = false; }
            else if (state == "attention") {
                if (message.ContainsKey("running")) running = Convert.ToBoolean(message["running"]);
                busy = false; pendingKey = "";
            }
            EnableSettings();
            string text = DisplayState(state);
            if (message.ContainsKey("message")) text += ": " + Convert.ToString(message["message"]);
            if (message.ContainsKey("acknowledgedAt")) {
                lastUpload = DateTimeOffset.Parse(Convert.ToString(message["acknowledgedAt"])).ToLocalTime().ToString("g");
                text = "Uploaded successfully at " + lastUpload;
            }
            if (state == "paused" && pausePersistenceFailed) text = "Paused for this run; the pause preference could not be saved.";
            SetStatus(text, state == "attention" || (state == "paused" && pausePersistenceFailed));
            if (state == "watching" && hideAfterStart) { hideAfterStart = false; HideToTray(); }
        } catch {
            Pause(); pendingKey = "";
            SetStatus("Could not save credentials or settings. Pausing uploads.", true);
        }
    }
    private void ShutdownWorker() {
        closing = true;
        if (worker != null) {
            try {
                if (!worker.HasExited) {
                    try { worker.StandardInput.Close(); } catch {}
                    if (!worker.WaitForExit(3000)) { worker.Kill(); worker.WaitForExit(1000); }
                }
            } catch {}
            worker.Dispose(); worker = null;
        }
        pendingKey = sessionKey = "";
    }
    protected override void OnFormClosing(FormClosingEventArgs args) {
        if (!exitRequested && args.CloseReason == CloseReason.UserClosing) {
            args.Cancel = true; HideToTray(); base.OnFormClosing(args); return;
        }
        ShutdownWorker();
        base.OnFormClosing(args);
    }
    protected override void Dispose(bool disposing) {
        if (disposing && !trayDisposed) { ShutdownWorker(); DisposeTray(); }
        base.Dispose(disposing);
    }
}
