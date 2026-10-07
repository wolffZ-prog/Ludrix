using System.Diagnostics;
using System.Net.Http;
using System.Net.Sockets;
using System.Text.Json;

namespace Ludrix.Host;

public sealed class Core
{
    public int Port { get; private set; }
    public string Token { get; private set; } = "";
    public string Url => $"http://127.0.0.1:{Port}/";

    Process? _proc;
    readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(5) };

    public void Start()
    {
        var instance = Path.Combine(Program.Data, "instance.json");
        var (exe, prefix) = FindPython();
        var psi = new ProcessStartInfo
        {
            FileName = exe,
            WorkingDirectory = Program.Root,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        foreach (var a in prefix) psi.ArgumentList.Add(a);
        psi.ArgumentList.Add(Path.Combine(Program.App, "main.py"));
        psi.ArgumentList.Add("--web");
        psi.ArgumentList.Add("0");
        psi.Environment["LUDRIX_HOST"] = "casca";
        psi.Environment["PYTHONDONTWRITEBYTECODE"] = "1";

        try { File.Delete(instance); } catch { }
        _proc = Process.Start(psi) ?? throw new InvalidOperationException("não foi possível iniciar o Python");
        _proc.OutputDataReceived += (_, e) => { if (e.Data != null) Debug.WriteLine("[core] " + e.Data); };
        _proc.ErrorDataReceived += (_, e) => { if (e.Data != null) Debug.WriteLine("[core!] " + e.Data); };
        _proc.BeginOutputReadLine();
        _proc.BeginErrorReadLine();

        var deadline = DateTime.UtcNow.AddSeconds(25);
        while (DateTime.UtcNow < deadline)
        {
            if (_proc.HasExited) throw new InvalidOperationException($"o núcleo fechou com código {_proc.ExitCode}");
            if (File.Exists(instance))
            {
                try
                {
                    using var doc = JsonDocument.Parse(File.ReadAllText(instance));
                    var r = doc.RootElement;
                    if (r.TryGetProperty("pid", out var pid) && pid.GetInt32() == _proc.Id && r.TryGetProperty("port", out var port))
                    {
                        Port = port.GetInt32();
                        Token = r.TryGetProperty("token", out var t) ? t.GetString() ?? "" : "";
                        if (Listening(Port)) return;
                    }
                }
                catch { }
            }
            Thread.Sleep(150);
        }
        throw new TimeoutException("o núcleo não respondeu em 25 s");
    }

    public bool Alive => _proc is { HasExited: false };

    public async Task<bool> Post(string path, object body)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, Url.TrimEnd('/') + path)
            {
                Content = new StringContent(JsonSerializer.Serialize(body), System.Text.Encoding.UTF8, "application/json")
            };
            req.Headers.Add("X-Ludrix-Token", Token);
            using var res = await _http.SendAsync(req);
            return res.IsSuccessStatusCode;
        }
        catch { return false; }
    }

    public void Stop()
    {
        if (_proc == null || _proc.HasExited) return;
        try
        {
            Post("/api/window", new { cmd = "host_quit" }).Wait(1500);
            if (_proc.WaitForExit(2500)) return;
        }
        catch { }
        try { _proc.Kill(entireProcessTree: true); } catch { }
    }

    static (string exe, string[] prefix) FindPython()
    {
        var embedded = Path.Combine(Program.Root, "runtime", "pythonw.exe");
        if (File.Exists(embedded)) return (embedded, Array.Empty<string>());
        var embedded2 = Path.Combine(Program.Root, "runtime", "python.exe");
        if (File.Exists(embedded2)) return (embedded2, Array.Empty<string>());
        var local = Environment.GetEnvironmentVariable("LOCALAPPDATA") ?? "";
        foreach (var v in new[] { "313", "312", "311" })
        {
            var p = Path.Combine(local, "Programs", "Python", "Python" + v, "pythonw.exe");
            if (File.Exists(p)) return (p, Array.Empty<string>());
        }
        return ("py", new[] { "-3" });
    }

    static bool Listening(int port)
    {
        try
        {
            using var c = new TcpClient();
            var t = c.ConnectAsync("127.0.0.1", port);
            return t.Wait(400) && c.Connected;
        }
        catch { return false; }
    }
}
