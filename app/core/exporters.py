from __future__ import annotations

import json
import shutil
import zipfile
from pathlib import Path

PLAYNITE_SPEC = {"pc": "pc_windows", "ps1": "sony_playstation", "ps2": "sony_playstation2", "psp": "sony_psp", "n64": "nintendo_64", "gc": "nintendo_gamecube",
                 "wii": "nintendo_wii", "dc": "sega_dreamcast", "xbox": "xbox", "x360": "xbox360", "gba": "nintendo_gameboyadvance", "snes": "nintendo_super_nes",
                 "nds": "nintendo_ds", "genesis": "sega_genesis", "nes": "nintendo_nes", "ps3": "sony_playstation3", "wiiu": "nintendo_wiiu", "switch": "nintendo_switch",
                 "3ds": "nintendo_3ds", "saturn": "sega_saturn", "sms": "sega_mastersystem", "pce": "nec_turbografx_16", "atari2600": "atari_2600", "arcade": "arcade", "dos": "pc_dos"}

PLAYNITE_YAML = """Id: LudrixImport_Ludrix_Script
Name: Importar do Ludrix
Author: LudrixHub
Version: {version}
Module: LudrixImport.psm1
Type: Script
Icon: icon.png
"""

PLAYNITE_PSM1 = r'''function Ensure-Item($collection, $name)
{
    if ([string]::IsNullOrWhiteSpace($name)) { return $null }
    $n = ([string]$name).Trim()
    foreach ($it in $collection) { if ($it.Name -and ($it.Name -ieq $n)) { return $it } }
    return $collection.Add($n)
}

function Ensure-Platform($row)
{
    $db = $PlayniteApi.Database.Platforms
    $spec = [string]$row.playnite_platform
    if ($spec) { foreach ($p in $db) { if ($p.SpecificationId -eq $spec) { return $p } } }
    $name = [string]$row.system_name
    if (-not $name) { $name = "PC (Windows)" }
    return (Ensure-Item $db $name)
}

function Id-List($items)
{
    $l = New-Object "System.Collections.Generic.List[Guid]"
    foreach ($it in $items) { if ($it) { $l.Add($it.Id) } }
    return $l
}

function Fill-Game($game, $row, $root)
{
    $game.Name = [string]$row.title
    $dir = [string]$row.dir
    $exe = [string]$row.exe
    if ($dir) { $game.InstallDirectory = $dir }
    $isRom = ([string]$row.kind -eq "rom") -or (([string]$row.system) -and ([string]$row.system -ne "pc"))
    $game.IsInstalled = $false
    if ($exe) {
        if ($exe -like "*://*") { $game.IsInstalled = $true }
        elseif (Test-Path -LiteralPath $exe) { $game.IsInstalled = $true }
    }
    if ($isRom -and $exe) {
        $game.Roms = New-Object "System.Collections.ObjectModel.ObservableCollection[Playnite.SDK.Models.GameRom]"
        $game.Roms.Add((New-Object "Playnite.SDK.Models.GameRom" -ArgumentList ([string]$row.title), $exe))
    }
    elseif ($exe) {
        $a = New-Object "Playnite.SDK.Models.GameAction"
        $a.Name = "Jogar"
        $a.IsPlayAction = $true
        if ($exe -like "*://*") {
            $a.Type = [Playnite.SDK.Models.GameActionType]::URL
            $a.Path = $exe
        }
        else {
            $a.Type = [Playnite.SDK.Models.GameActionType]::File
            $a.Path = $exe
            $a.Arguments = [string]$row.args
            $wd = [string]$row.workdir
            if (-not $wd) { $wd = $dir }
            if ($wd) { $a.WorkingDir = $wd }
        }
        $game.GameActions = New-Object "System.Collections.ObjectModel.ObservableCollection[Playnite.SDK.Models.GameAction]"
        $game.GameActions.Add($a)
    }
    $game.Playtime = [uint64]([long]$row.playtime_seconds)
    $game.PlayCount = [uint64]([long]$row.play_count)
    $game.Favorite = [bool]$row.favorite
    $lp = [long]$row.last_played
    if ($lp -gt 0) { $game.LastActivity = ([datetime]"1970-01-01T00:00:00Z").AddSeconds($lp).ToLocalTime() }
    $year = 0
    if ([int]::TryParse([string]$row.year, [ref]$year) -and $year -gt 1950) { $game.ReleaseDate = New-Object "Playnite.SDK.Models.ReleaseDate" -ArgumentList $year }
    $summary = [string]$row.summary
    if ($summary) { $game.Description = ([System.Net.WebUtility]::HtmlEncode($summary)).Replace("`r`n", "<br>").Replace("`n", "<br>") }
    $notes = [string]$row.notes
    if ($notes) { $game.Notes = $notes }
    $game.PlatformIds = Id-List @((Ensure-Platform $row))
    if ($row.genres) { $game.GenreIds = Id-List @($row.genres | ForEach-Object { Ensure-Item $PlayniteApi.Database.Genres $_ }) }
    if ($row.developer) { $game.DeveloperIds = Id-List @((Ensure-Item $PlayniteApi.Database.Companies $row.developer)) }
    if ($row.publisher) { $game.PublisherIds = Id-List @((Ensure-Item $PlayniteApi.Database.Companies $row.publisher)) }
    if ($row.series) { $game.SeriesIds = Id-List @((Ensure-Item $PlayniteApi.Database.Series $row.series)) }
    $links = New-Object "System.Collections.ObjectModel.ObservableCollection[Playnite.SDK.Models.Link]"
    foreach ($l in @($row.links)) {
        if (-not $l) { continue }
        if ($l -is [string]) { $links.Add((New-Object "Playnite.SDK.Models.Link" -ArgumentList "Link", $l)) }
        elseif ($l.url) { $n = [string]$l.name; if (-not $n) { $n = "Link" }; $links.Add((New-Object "Playnite.SDK.Models.Link" -ArgumentList $n, ([string]$l.url))) }
    }
    if ($row.wiki_url) { $links.Add((New-Object "Playnite.SDK.Models.Link" -ArgumentList "Wikipedia", ([string]$row.wiki_url))) }
    if ($row.steam_appid) { $links.Add((New-Object "Playnite.SDK.Models.Link" -ArgumentList "Steam", ("https://store.steampowered.com/app/" + [string]$row.steam_appid))) }
    if ($links.Count -gt 0) { $game.Links = $links }
}

function LudrixImport()
{
    param($scriptMainMenuItemActionArgs)
    $root = $CurrentExtensionInstallPath
    $jsonPath = Join-Path $root "ludrix-library.json"
    if (-not (Test-Path -LiteralPath $jsonPath)) {
        $sel = $PlayniteApi.Dialogs.SelectFile("Exportação do Ludrix|ludrix-library.json")
        if (-not $sel) { return }
        $jsonPath = $sel
        $root = Split-Path -Parent $sel
    }
    $data = Get-Content -LiteralPath $jsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $games = @($data.games)
    if ($games.Count -eq 0) { $PlayniteApi.Dialogs.ShowMessage("A exportação não tem jogos.", "Ludrix"); return }
    $res = $PlayniteApi.Dialogs.ShowMessage("Importar $($games.Count) jogos do Ludrix para o Playnite?`n`nJogos já importados antes (mesmo nome, origem Ludrix) são atualizados, não duplicados. Nada é apagado.", "Ludrix", [System.Windows.MessageBoxButton]::YesNo)
    if ($res -ne [System.Windows.MessageBoxResult]::Yes) { return }
    $source = Ensure-Item $PlayniteApi.Database.Sources "Ludrix"
    $existing = @{}
    foreach ($g in $PlayniteApi.Database.Games) { if ($g.SourceId -eq $source.Id -and $g.Name) { $existing[$g.Name.ToLowerInvariant()] = $g } }
    $added = 0; $updated = 0; $failed = 0
    $PlayniteApi.Database.Games.BeginBufferUpdate()
    try {
        foreach ($row in $games) {
            try {
                $title = [string]$row.title
                if (-not $title) { continue }
                $game = $existing[$title.ToLowerInvariant()]
                $isNew = $false
                if (-not $game) { $game = New-Object "Playnite.SDK.Models.Game"; $isNew = $true; $game.Added = Get-Date }
                Fill-Game $game $row $root
                $game.SourceId = $source.Id
                if ($isNew) { $PlayniteApi.Database.Games.Add($game); $added++ } else { $PlayniteApi.Database.Games.Update($game); $updated++ }
                $cover = [string]$row.cover
                if ($cover) {
                    $cp = Join-Path $root $cover
                    if (Test-Path -LiteralPath $cp) {
                        $game.CoverImage = $PlayniteApi.Database.AddFile($cp, $game.Id)
                        $PlayniteApi.Database.Games.Update($game)
                    }
                }
            }
            catch {
                $failed++
                $__logger.Error("Ludrix: falha em '$($row.title)': $_")
            }
        }
    }
    finally {
        $PlayniteApi.Database.Games.EndBufferUpdate()
    }
    $PlayniteApi.Dialogs.ShowMessage("Importação do Ludrix concluída.`n`nAdicionados: $added`nAtualizados: $updated`nCom erro: $failed`n`nOs jogos ficam com origem 'Ludrix'. ROMs entram com o arquivo preenchido; configure o emulador em Playnite > Biblioteca > Configurar emuladores.", "Ludrix")
}

function GetMainMenuItems()
{
    param($getMainMenuItemsArgs)
    $item = New-Object Playnite.SDK.Plugins.ScriptMainMenuItem
    $item.Description = "Importar biblioteca do Ludrix"
    $item.FunctionName = "LudrixImport"
    $item.MenuSection = "@Ludrix"
    return $item
}
'''

PLAYNITE_README = """Importar no Playnite (versão 10)

1. Feche o Ludrix se quiser (não precisa).
2. Dê dois cliques em LudrixImport.pext. O Playnite pergunta se instala a extensão; aceite e deixe ele reabrir.
   (Alternativa: Playnite > menu principal > Complementos > Instalar complemento de arquivo… > escolha o .pext)
3. No Playnite: menu principal > Extensões > Ludrix > Importar biblioteca do Ludrix.
4. Confirme. Cada jogo entra com nome, capa, pasta, executável, tempo jogado, favoritos, gênero, ano e desenvolvedora.
   Jogos já importados antes (mesmo nome, origem "Ludrix") são atualizados, não duplicados.

Os jogos ficam com a origem "Ludrix" (filtro Origem). ROMs entram com o arquivo preenchido; o emulador é escolhido no próprio Playnite.
A extensão carrega a lista e as capas que estão dentro dela; para exportar de novo, gere outro .pext no Ludrix e instale por cima.
Playnite 11 em diante não aceita extensões em PowerShell: nesse caso use o ludrix-library.csv com uma extensão de importar CSV.
"""


def _cover_for_playnite(src: Path, dest_dir: Path, base: str) -> str:
    if not src or not src.exists():
        return ""
    dest_dir.mkdir(parents=True, exist_ok=True)
    if src.suffix.lower() in (".jpg", ".jpeg", ".png"):
        out = dest_dir / (base + src.suffix.lower())
        shutil.copy2(src, out)
        return out.name
    try:
        from PIL import Image
        out = dest_dir / (base + ".jpg")
        with Image.open(src) as im:
            im.convert("RGB").save(out, "JPEG", quality=88)
        return out.name
    except Exception:
        out = dest_dir / (base + src.suffix.lower())
        shutil.copy2(src, out)
        return out.name


def build_playnite(out: Path, rows: list[dict], covers_dir: Path, version: str, icon: Path | None, system_names: dict) -> dict:
    pdir = out / "playnite"
    work = pdir / "_pext"
    if work.exists():
        shutil.rmtree(work, ignore_errors=True)
    (work / "covers").mkdir(parents=True, exist_ok=True)
    prow = []
    for r in rows:
        row = dict(r)
        cov = ""
        if r.get("cover"):
            src = covers_dir.parent / r["cover"]
            cov = _cover_for_playnite(src, work / "covers", Path(r["cover"]).stem)
        row["cover"] = ("covers/" + cov) if cov else ""
        sysid = r.get("system") or "pc"
        row["playnite_platform"] = PLAYNITE_SPEC.get(sysid, "")
        row["system_name"] = system_names.get(sysid) or ("PC (Windows)" if sysid == "pc" else sysid)
        prow.append(row)
    (work / "ludrix-library.json").write_text(json.dumps({"format": "ludrix-export", "version": 1, "games": prow}, ensure_ascii=False, indent=1), encoding="utf-8")
    (work / "extension.yaml").write_text(PLAYNITE_YAML.format(version=".".join(version.split(".")[:3]) if version else "1.0"), encoding="utf-8")
    (work / "LudrixImport.psm1").write_text(PLAYNITE_PSM1, encoding="utf-8-sig")
    if icon and icon.exists():
        shutil.copy2(icon, work / "icon.png")
    pext = pdir / "LudrixImport.pext"
    with zipfile.ZipFile(pext, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(work.rglob("*")):
            if f.is_file():
                z.write(f, f.relative_to(work).as_posix())
    shutil.rmtree(work, ignore_errors=True)
    (pdir / "COMO-IMPORTAR.txt").write_text(PLAYNITE_README, encoding="utf-8")
    return {"pext": str(pext), "count": len(prow)}
