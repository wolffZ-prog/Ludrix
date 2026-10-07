using System.Diagnostics;

namespace Ludrix.Host;

static class Program
{
    public static readonly string Root = AppContext.BaseDirectory.TrimEnd('\\', '/');
    public static readonly string App = Path.Combine(Root, "app");
    public static readonly string Data = Path.Combine(Root, "data");

    [STAThread]
    static void Main(string[] args)
    {
        using var mutex = new Mutex(true, @"Local\LudrixLauncher-SingleInstance", out bool first);
        if (!first)
        {
            Wake.Existing();
            return;
        }

        ApplicationConfiguration.Initialize();

        if (!File.Exists(Path.Combine(App, "main.py")) && !File.Exists(Path.Combine(App, "main.pyc")))
        {
            MessageBox.Show($"Pasta app\\ não encontrada ao lado de Ludrix.exe.\n\nEsperado: {App}", "LudrixHub",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        var core = new Core();
        try
        {
            core.Start();
        }
        catch (Exception e)
        {
            MessageBox.Show("O núcleo do Ludrix não abriu.\n\n" + e.Message, "LudrixHub", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        var hidden = args.Contains("--minimized");
        Application.Run(new MainForm(core, hidden));
        core.Stop();
    }
}
