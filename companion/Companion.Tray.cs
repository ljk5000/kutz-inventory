using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Windows.Forms;

// Tray ownership, window lifetime, and menu actions are separate from credential/worker setup.
internal sealed partial class CompanionForm {
    private readonly NotifyIcon tray = new NotifyIcon();
    private readonly ContextMenuStrip trayMenu = new ContextMenuStrip();
    private readonly ToolStripMenuItem trayStatus = new ToolStripMenuItem(), trayAccount = new ToolStripMenuItem(), trayUpload = new ToolStripMenuItem();
    private readonly ToolStripMenuItem traySettings = new ToolStripMenuItem("Settings..."), trayStart = new ToolStripMenuItem(), trayStartup = new ToolStripMenuItem("Run at Windows sign-in"), trayExit = new ToolStripMenuItem("Exit Companion");
    private readonly Icon normalIcon = LoadCompanionIcon(SystemInformation.SmallIconSize), windowIcon = LoadCompanionIcon(SystemInformation.IconSize), warningIcon = (Icon)SystemIcons.Warning.Clone();
    private bool exitRequested, trayDisposed, hideAfterStart, attention, startupRegistered;
    private string lastUpload;

    private static Icon LoadCompanionIcon(Size size) {
        using (var stream = typeof(CompanionProgram).Assembly.GetManifestResourceStream("KutzUI.Companion.ico")) {
            using (var source = new Icon(stream, size)) return (Icon)source.Clone();
        }
    }

    public bool CanStartHidden {
        get {
            try { return configurationLoaded && remember.Checked && !String.IsNullOrEmpty(KutzCredentialStore.Get(Target(Origin()))); }
            catch { return false; }
        }
    }
    public bool ShouldResume(bool legacyWatch) {
        return CanStartHidden && (hasPausePreference ? !pausedPreference : legacyWatch);
    }
    private void InitializeTray() {
        Icon = windowIcon;
        trayStatus.Enabled = trayAccount.Enabled = trayUpload.Enabled = false;
        trayMenu.Items.AddRange(new ToolStripItem[] { trayStatus, trayAccount, trayUpload, new ToolStripSeparator(), traySettings, trayStart, trayStartup });
        var exports = new ToolStripMenuItem("Open export folder");
        exports.Click += delegate {
            try { Directory.CreateDirectory(directory); Process.Start(new ProcessStartInfo(directory) { UseShellExecute = true }); }
            catch { SetStatus("Could not open the export folder.", true); ShowSettings(); }
        };
        trayMenu.Items.Add(exports);
        trayMenu.Items.Add(new ToolStripSeparator()); trayMenu.Items.Add(trayExit);
        traySettings.Click += delegate { ShowSettings(); };
        trayStart.Click += delegate {
            if (running || busy) Pause();
            else { Send("start"); if (!running && !busy) ShowSettings(); }
        };
        trayStartup.Click += delegate {
            try {
                bool enable = !startupRegistered;
                if (enable && (!remember.Checked || String.IsNullOrEmpty(KutzCredentialStore.Get(Target(Origin()))))) {
                    SetStatus("Connect and remember your key before enabling Windows sign-in startup.", true); ShowSettings(); return;
                }
                Startup(enable); startup.Checked = enable; UpdateTray();
            } catch { SetStatus("Could not change Windows sign-in startup.", true); ShowSettings(); }
        };
        trayExit.Click += delegate { exitRequested = true; Close(); };
        tray.DoubleClick += delegate { ShowSettings(); };
        tray.ContextMenuStrip = trayMenu;
        tray.Icon = normalIcon;
        tray.Visible = true;
        Resize += delegate { if (WindowState == FormWindowState.Minimized) HideToTray(); };
        UpdateTray();
    }
    public void ShowSettings() {
        if (closing || IsDisposed) return;
        hideAfterStart = false;
        ShowInTaskbar = true; WindowState = FormWindowState.Normal;
        Show(); BringToFront(); Activate();
    }
    public void HideToTray() {
        if (closing || IsDisposed) return;
        Hide(); ShowInTaskbar = false; WindowState = FormWindowState.Normal;
    }
    private void SetStatus(string text, bool needsAttention = false) {
        status.Text = text; attention = needsAttention; UpdateTray();
    }
    private void UpdateTray() {
        if (trayDisposed) return;
        string text = "KutzUI: " + status.Text;
        tray.Text = text.Substring(0, Math.Min(63, text.Length));
        trayStatus.Text = "Status: " + status.Text.Substring(0, Math.Min(160, status.Text.Length));
        trayAccount.Text = account.Text;
        trayUpload.Text = lastUpload == null ? "Last upload: none this session" : "Last upload: " + lastUpload;
        trayStart.Text = running || busy ? "Pause uploading" : "Start uploading";
        trayStartup.Checked = startupRegistered;
        tray.Icon = attention ? warningIcon : normalIcon;
    }
    private static string DisplayState(string state) {
        switch (state) {
            case "watching": return "Watching for game saves";
            case "uploading": return "Uploading inventory";
            case "retrying": return "Connection unavailable; retrying";
            case "attention": return "Needs attention";
            case "connected": return "Connected";
            case "paused": return "Paused";
            default: return state;
        }
    }
    private void DisposeTray() {
        tray.Visible = false; tray.Dispose(); trayMenu.Dispose(); normalIcon.Dispose(); windowIcon.Dispose(); warningIcon.Dispose(); trayDisposed = true;
    }
    internal bool SiteMoveSelfTest(string saved) {
        var stored = ReadSettings();
        string expected = saved == "https://example.com" ? saved : WowSite;
        if (site.Text != expected || Convert.ToString(stored["base"]) != expected || Convert.ToInt32(stored["futureOption"]) != 42)
            throw new InvalidOperationException("A saved cr0m.com site must move to " + WowSite + " and be saved back; other sites and settings must stay.");
        return true;
    }
    // Runs on Windows CI against the actual packaged worker. No real user credentials or startup entries are changed.
    internal bool TrayLifecycleSelfTest() {
        if (Icon != windowIcon || tray.Icon != normalIcon || normalIcon.Size != SystemInformation.SmallIconSize)
            throw new InvalidOperationException("Window and tray must use the packaged Companion icon at the correct size.");
        SetStatus("Test attention", true);
        if (tray.Icon != warningIcon) throw new InvalidOperationException("Attention must retain the warning icon.");
        SetStatus("Test ready");
        if (tray.Icon != normalIcon) throw new InvalidOperationException("Clearing attention must restore the Companion icon.");
        ShowSettings(); Application.DoEvents();
        EnsureWorker(); int pid = worker.Id;
        Close(); Application.DoEvents();
        if (IsDisposed || Visible || ShowInTaskbar || !tray.Visible || worker.HasExited) throw new InvalidOperationException("Closing settings must hide the window and retain the tray and worker.");
        traySettings.PerformClick(); Application.DoEvents();
        if (!Visible || !ShowInTaskbar) throw new InvalidOperationException("The tray Settings action must restore the window.");
        bool previousStartup = startup.Checked;
        WriteSettings(new Dictionary<string, object> { { "version", 1 }, { "paused", false }, { "futureOption", 42 } });
        // Exercise Pause directly: it must preserve the sign-in preference.
        Pause(); Application.DoEvents();
        var stored = ReadSettings();
        if (!Convert.ToBoolean(stored["paused"]) || Convert.ToInt32(stored["futureOption"]) != 42) throw new InvalidOperationException("Pause must persist without losing other settings.");
        if (startup.Checked != previousStartup || worker.HasExited) throw new InvalidOperationException("Pause must retain the worker and sign-in preference.");
        WindowState = FormWindowState.Minimized; Application.DoEvents();
        if (Visible || ShowInTaskbar || !tray.Visible) throw new InvalidOperationException("Minimize must hide the window into the tray.");
        traySettings.PerformClick(); Application.DoEvents();
        if (!Visible) throw new InvalidOperationException("Settings must reopen after minimize.");
        trayExit.PerformClick(); Application.DoEvents();
        if (!IsDisposed || !trayDisposed) throw new InvalidOperationException("Exit must dispose the window and tray icon.");
        try { using (var remaining = Process.GetProcessById(pid)) { if (!remaining.HasExited) throw new InvalidOperationException("Exit must stop the worker process."); } }
        catch (ArgumentException) {}
        return true;
    }
}
