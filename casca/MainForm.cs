using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Ludrix.Host;

public sealed class MainForm : Form
{
    readonly Core _core;
    readonly WebView2 _web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(0x16, 0x18, 0x1d) };
    readonly NotifyIcon _tray = new();
    readonly Icon _icon;
    bool _quitting;
    bool _fullscreen;
    FormWindowState _preFs;
    FormBorderStyle _preFsBorder;

    const string Bridge = """
        (() => {
          const HOST = new Set(['hide','show','quit','minimize','maximize','close','fullscreen','frameless','host_quit']);
          const post = (cmd, body) => { try { chrome.webview.postMessage(JSON.stringify({ cmd, ...(body || {}) })); } catch (e) {} };
          const orig = window.fetch.bind(window);
          window.fetch = async (url, opt) => {
            if (typeof url === 'string' && url.endsWith('/api/window') && opt && opt.body) {
              try {
                const b = JSON.parse(opt.body); const cmd = b.cmd || b.action || '';
                if (HOST.has(cmd) && !b.target) { post(cmd, b); return new Response(JSON.stringify({ ok: true, host: 'casca' }), { headers: { 'Content-Type': 'application/json' } }); }
              } catch (e) {}
            }
            return orig(url, opt);
          };
          window.ludrixHost = { name: 'casca', post };
          document.addEventListener('DOMContentLoaded', () => { document.documentElement.dataset.host = 'casca'; });
        })();
        """;

    public MainForm(Core core, bool startHidden)
    {
        _core = core;
        _icon = LoadIcon();
        Text = "LudrixHub";
        Icon = _icon;
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(1000, 660);
        BackColor = Color.FromArgb(0x16, 0x18, 0x1d);
        LoadBounds();
        Controls.Add(_web);

        _tray.Icon = _icon;
        _tray.Text = "LudrixHub";
        _tray.Visible = true;
        var menu = new ContextMenuStrip { RenderMode = ToolStripRenderMode.System };
        menu.Items.Add("Mostrar", null, (_, _) => ShowFromTray());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Sair", null, (_, _) => Quit());
        _tray.ContextMenuStrip = menu;
        _tray.DoubleClick += (_, _) => ShowFromTray();
        _tray.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) ShowFromTray(); };

        Load += async (_, _) => await InitWeb();
        FormClosing += OnClosing;
        Shown += (_, _) => { if (startHidden) HideToTray(); };
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        Dwm.Dark(Handle, true);
        Dwm.Corners(Handle, Dwm.Corner.Round);
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == Wake.Msg && Wake.Msg != 0) { ShowFromTray(); return; }
        base.WndProc(ref m);
    }

    async Task InitWeb()
    {
        var userData = Path.Combine(Program.Data, "webview2");
        Directory.CreateDirectory(userData);
        var opts = new CoreWebView2EnvironmentOptions("--disable-features=msSmartScreenProtection");
        var embedded = Path.Combine(Program.Root, "runtime", "webview2");
        string? browser = File.Exists(Path.Combine(embedded, "msedgewebview2.exe")) ? embedded : null;
        var env = await CoreWebView2Environment.CreateAsync(browser, userData, opts);
        await _web.EnsureCoreWebView2Async(env);
        var s = _web.CoreWebView2.Settings;
        s.AreDefaultContextMenusEnabled = false;
        s.AreBrowserAcceleratorKeysEnabled = false;
        s.IsStatusBarEnabled = false;
        s.IsZoomControlEnabled = false;
        s.IsSwipeNavigationEnabled = false;
        s.IsGeneralAutofillEnabled = false;
        s.IsPasswordAutosaveEnabled = false;
#if !DEBUG
        s.AreDevToolsEnabled = false;
#endif
        await _web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(Bridge);
        _web.CoreWebView2.WebMessageReceived += OnMessage;
        _web.CoreWebView2.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(e.Uri) { UseShellExecute = true }); } catch { }
        };
        _web.CoreWebView2.ProcessFailed += (_, _) => BeginInvoke(() => _web.CoreWebView2.Navigate(_core.Url));
        _web.CoreWebView2.Navigate(_core.Url);
    }

    void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        string cmd;
        JsonElement body;
        try
        {
            using var doc = JsonDocument.Parse(e.TryGetWebMessageAsString());
            body = doc.RootElement.Clone();
            cmd = body.GetProperty("cmd").GetString() ?? "";
        }
        catch { return; }
        switch (cmd)
        {
            case "hide": HideToTray(); break;
            case "show": ShowFromTray(); break;
            case "minimize": WindowState = FormWindowState.Minimized; break;
            case "maximize": WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized; break;
            case "close": Close(); break;
            case "quit":
            case "host_quit": Quit(); break;
            case "fullscreen":
                var on = body.TryGetProperty("on", out var v) && v.ValueKind == JsonValueKind.True;
                SetFullscreen(on);
                break;
        }
    }

    void SetFullscreen(bool on)
    {
        if (on == _fullscreen) return;
        _fullscreen = on;
        if (on)
        {
            _preFs = WindowState; _preFsBorder = FormBorderStyle;
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Normal;
            WindowState = FormWindowState.Maximized;
        }
        else
        {
            FormBorderStyle = _preFsBorder;
            WindowState = _preFs;
        }
    }

    void HideToTray()
    {
        Hide();
        ShowInTaskbar = false;
    }

    void ShowFromTray()
    {
        ShowInTaskbar = true;
        Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
    }

    void Quit()
    {
        _quitting = true;
        Close();
    }

    void OnClosing(object? sender, FormClosingEventArgs e)
    {
        SaveBounds();
        if (_quitting || e.CloseReason != CloseReason.UserClosing) { _tray.Visible = false; return; }
        e.Cancel = true;
        HideToTray();
    }

    Icon LoadIcon()
    {
        var p = Path.Combine(Program.App, "assets", "icon.ico");
        try { if (File.Exists(p)) return new Icon(p); } catch { }
        return Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;
    }

    string BoundsFile => Path.Combine(Program.Data, "host.json");

    void LoadBounds()
    {
        Size = new Size(1380, 880);
        try
        {
            if (!File.Exists(BoundsFile)) return;
            using var doc = JsonDocument.Parse(File.ReadAllText(BoundsFile));
            var r = doc.RootElement;
            var rect = new Rectangle(r.GetProperty("x").GetInt32(), r.GetProperty("y").GetInt32(), r.GetProperty("w").GetInt32(), r.GetProperty("h").GetInt32());
            if (Screen.AllScreens.Any(sc => sc.WorkingArea.IntersectsWith(rect)))
            {
                StartPosition = FormStartPosition.Manual;
                Bounds = rect;
            }
            if (r.TryGetProperty("max", out var m) && m.ValueKind == JsonValueKind.True) WindowState = FormWindowState.Maximized;
        }
        catch { }
    }

    void SaveBounds()
    {
        try
        {
            var b = WindowState == FormWindowState.Normal ? Bounds : base.RestoreBounds;
            Directory.CreateDirectory(Program.Data);
            File.WriteAllText(BoundsFile, JsonSerializer.Serialize(new { x = b.X, y = b.Y, w = b.Width, h = b.Height, max = WindowState == FormWindowState.Maximized }));
        }
        catch { }
    }
}

static class Dwm
{
    public enum Corner { Default = 0, DoNotRound = 1, Round = 2, RoundSmall = 3 }

    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    public static void Dark(IntPtr hwnd, bool on)
    {
        int v = on ? 1 : 0;
        DwmSetWindowAttribute(hwnd, 20, ref v, sizeof(int));
    }

    public static void Corners(IntPtr hwnd, Corner c)
    {
        int v = (int)c;
        DwmSetWindowAttribute(hwnd, 33, ref v, sizeof(int));
    }
}

static class Wake
{
    const int HWND_BROADCAST = 0xffff;
    public static readonly int Msg = RegisterWindowMessage("LudrixHub.Wake");

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int RegisterWindowMessage(string s);

    [DllImport("user32.dll")]
    static extern bool PostMessage(IntPtr hWnd, int msg, IntPtr w, IntPtr l);

    public static void Existing() => PostMessage((IntPtr)HWND_BROADCAST, Msg, IntPtr.Zero, IntPtr.Zero);
}
