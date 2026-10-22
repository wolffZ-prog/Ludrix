import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import * as images from './images';

export const PLAYNITE_SPEC: Record<string, string> = {'pc': 'pc_windows', 'ps1': 'sony_playstation', 'ps2': 'sony_playstation2', 'psp': 'sony_psp', 'n64': 'nintendo_64', 'gc': 'nintendo_gamecube', 'wii': 'nintendo_wii', 'dc': 'sega_dreamcast', 'xbox': 'xbox', 'x360': 'xbox360', 'gba': 'nintendo_gameboyadvance', 'snes': 'nintendo_super_nes', 'nds': 'nintendo_ds', 'genesis': 'sega_genesis', 'nes': 'nintendo_nes', 'ps3': 'sony_playstation3', 'wiiu': 'nintendo_wiiu', 'switch': 'nintendo_switch', '3ds': 'nintendo_3ds', 'saturn': 'sega_saturn', 'sms': 'sega_mastersystem', 'pce': 'nec_turbografx_16', 'atari2600': 'atari_2600', 'arcade': 'arcade', 'dos': 'pc_dos'};

const PLAYNITE_YAML = `Id: LudrixImport_Ludrix_Script
Name: Importar do Ludrix
Author: LudrixHub
Version: {version}
Module: LudrixImport.psm1
Type: Script
Icon: icon.png
`;

const PLAYNITE_PSM1 = `function Ensure-Item($collection, $name)
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
    if ($summary) { $game.Description = ([System.Net.WebUtility]::HtmlEncode($summary)).Replace("\`r\`n", "<br>").Replace("\`n", "<br>") }
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
    $res = $PlayniteApi.Dialogs.ShowMessage("Importar $($games.Count) jogos do Ludrix para o Playnite?\`n\`nJogos já importados antes (mesmo nome, origem Ludrix) são atualizados, não duplicados. Nada é apagado.", "Ludrix", [System.Windows.MessageBoxButton]::YesNo)
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
    $PlayniteApi.Dialogs.ShowMessage("Importação do Ludrix concluída.\`n\`nAdicionados: $added\`nAtualizados: $updated\`nCom erro: $failed\`n\`nOs jogos ficam com origem 'Ludrix'. ROMs entram com o arquivo preenchido; configure o emulador em Playnite > Biblioteca > Configurar emuladores.", "Ludrix")
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
`;

const PLAYNITE_README = `Importar no Playnite (versão 10)

1. Feche o Ludrix se quiser (não precisa).
2. Dê dois cliques em LudrixImport.pext. O Playnite pergunta se instala a extensão; aceite e deixe ele reabrir.
   (Alternativa: Playnite > menu principal > Complementos > Instalar complemento de arquivo… > escolha o .pext)
3. No Playnite: menu principal > Extensões > Ludrix > Importar biblioteca do Ludrix.
4. Confirme. Cada jogo entra com nome, capa, pasta, executável, tempo jogado, favoritos, gênero, ano e desenvolvedora.
   Jogos já importados antes (mesmo nome, origem "Ludrix") são atualizados, não duplicados.

Os jogos ficam com a origem "Ludrix" (filtro Origem). ROMs entram com o arquivo preenchido; o emulador é escolhido no próprio Playnite.
A extensão carrega a lista e as capas que estão dentro dela; para exportar de novo, gere outro .pext no Ludrix e instale por cima.
Playnite 11 em diante não aceita extensões em PowerShell: nesse caso use o ludrix-library.csv com uma extensão de importar CSV.
`;

function coverForPlaynite(src: string, destDir: string, base: string): string {
    if (!src || !fs.existsSync(src))
        return '';
    fs.mkdirSync(destDir, { recursive: true });
    const ext = path.extname(src).toLowerCase();
    if (['.jpg', '.jpeg', '.png'].includes(ext)) {
        const out = path.join(destDir, base + ext);
        fs.copyFileSync(src, out);
        return path.basename(out);
    }
    try {
        const out = path.join(destDir, base + '.jpg');
        const jpg = images.convert(fs.readFileSync(src), 100000, 88);
        if (!jpg)
            throw new Error('convert');
        fs.writeFileSync(out, jpg);
        return path.basename(out);
    }
    catch {
        const out = path.join(destDir, base + ext);
        fs.copyFileSync(src, out);
        return path.basename(out);
    }
}

function walk(d: string, out: string[] = []) {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
        const q = path.join(d, e.name);
        if (e.isDirectory()) walk(q, out);
        else if (e.isFile()) out.push(q);
    }
    return out;
}

export function buildPlaynite(out: string, rows: any[], coversDir: string, version: string, icon: string | null, systemNames: Record<string, string>) {
    const pdir = path.join(out, 'playnite');
    const work = path.join(pdir, '_pext');
    if (fs.existsSync(work))
        fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(path.join(work, 'covers'), { recursive: true });
    const prow: any[] = [];
    for (const r of rows) {
        const row = { ...r };
        let cov = '';
        if (r.cover) {
            const src = path.join(path.dirname(coversDir), r.cover);
            cov = coverForPlaynite(src, path.join(work, 'covers'), path.basename(r.cover, path.extname(r.cover)));
        }
        row.cover = cov ? 'covers/' + cov : '';
        const sysid = r.system || 'pc';
        row.playnite_platform = PLAYNITE_SPEC[sysid] || '';
        row.system_name = systemNames[sysid] || (sysid === 'pc' ? 'PC (Windows)' : sysid);
        prow.push(row);
    }
    fs.writeFileSync(path.join(work, 'ludrix-library.json'), JSON.stringify({ format: 'ludrix-export', version: 1, games: prow }, null, 1), 'utf8');
    fs.writeFileSync(path.join(work, 'extension.yaml'), PLAYNITE_YAML.replace('{version}', version ? version.split('.').slice(0, 3).join('.') : '1.0'), 'utf8');
    fs.writeFileSync(path.join(work, 'LudrixImport.psm1'), '\uFEFF' + PLAYNITE_PSM1, 'utf8');
    if (icon && fs.existsSync(icon))
        fs.copyFileSync(icon, path.join(work, 'icon.png'));
    const pext = path.join(pdir, 'LudrixImport.pext');
    const z = new AdmZip();
    for (const f of walk(work))
        z.addFile(path.relative(work, f).split(path.sep).join('/'), fs.readFileSync(f));
    z.writeZip(pext);
    fs.rmSync(work, { recursive: true, force: true });
    fs.writeFileSync(path.join(pdir, 'COMO-IMPORTAR.txt'), PLAYNITE_README, 'utf8');
    return { pext, count: prow.length };
}
