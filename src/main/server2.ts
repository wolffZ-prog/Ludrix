import { app, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import * as P from './paths';
import * as log from './log';
import * as server from './server';
import * as server_2 from './server';
import * as storeFront from './storeFront';
import * as emulation from './emulation';
import * as presets from './presets';
import * as dialogs from './dialogs';
import * as sourceGen from './sourceGen';
import * as util from './util';
Object.defineProperty(exports, "slug", { enumerable: true, get: function () { return util.slug; } });
let frontRef = null;
/** Uma unica fachada por backend. */
function frontFor(be) {
    if (!frontRef || frontRef.be !== be)
        frontRef = { be, front: new storeFront.StoreFront(be) };
    return frontRef.front;
}
/* =========================== varredura de pasta =========================== */
/* ================================== GET ================================== */
async function routeGet2(res, p, q, be, port) {
    const front = frontFor(be);
    // ---- Store por fontes ----
    if (p === '/api/repos')
        return (0, server.sendJson)(res, front.repoList()), true;
    // ---- emulacao / ROMs ----
    if (p === '/api/emulation')
        return (0, server.sendJson)(res, front.emulationStatus()), true;
    if (p === '/api/emulator/guide')
        return (0, server.sendJson)(res, front.emulatorGuide(String(q.get('system') || 'nes'))), true;
    // ---- downloads ----
    if (p === '/api/queue')
        return (0, server.sendJson)(res, front.queuePayload()), true;
    // ---- mods / saves / dependencias ----
    if (p === '/api/mods')
        return (0, server.sendJson)(res, { ...be.mods.status(), games: be.gmods.summary() }), true;
    if (p.startsWith('/api/mods/game/'))
        return (0, server.sendJson)(res, be.gmods.list(decodeURIComponent(p.slice(15)))), true;
    if (p.startsWith('/api/mods/inspect/'))
        return (0, server.sendJson)(res, be.modInspect(decodeURIComponent(p.slice(18)))), true;
    if (p.startsWith('/api/mods/for/')) {
        const g = be.store.lib(decodeURIComponent(p.slice(14))) || {};
        return (0, server.sendJson)(res, be.mods.forGame(String(g.title || ''), String(g.system || 'pc'))), true;
    }
    if (p === '/api/redists')
        return (0, server.sendJson)(res, await be.central.redistsStatus(q.get('refresh') === '1')), true;
    if (p.startsWith('/api/saves/'))
        return (0, server.sendJson)(res, await be.savesInfo(decodeURIComponent(p.slice(11)), Boolean(q.get('deep')))), true;
    if (p === '/api/minecraft')
        return (0, server.sendJson)(res, await be.central.minecraftStatus(q.get('refresh') === '1')), true;
    // ---- importacao ----
    if (p === '/api/import/launchers')
        return (0, server.sendJson)(res, be.imp.importLaunchers()), true;
    if (p === '/api/import/poll')
        return (0, server.sendJson)(res, be.imp.importPoll()), true;
    if (p === '/api/import/cover')
        return (0, server.sendFile)(res, be.imp.importCoverPath(String(q.get('p') || '')), true), true;
    if (p === '/api/site_search')
        return (0, server.sendJson)(res, await front.siteSearch(String(q.get('q') || ''))), true;
    // ---- sistema ----
    if (p === '/api/integrity')
        return (0, server.sendJson)(res, front.integrityStatus()), true;
    if (p === '/api/updates')
        return (0, server.sendJson)(res, front.updateStatus()), true;
    if (p === '/api/console')
        return (0, server.sendJson)(res, await be.consolePayload()), true;
    if (p === '/api/linux')
        return (0, server.sendJson)(res, be.linuxStatus()), true;
    if (p === '/api/terminal/commands')
        return (0, server.sendJson)(res, { commands: be.terminal.catalog(), history: be.terminal.history.slice(-50) }), true;
    if (p === '/api/detect')
        return (0, server.sendJson)(res, await front.detect(String(q.get('q') || ''))), true;
    if (p === '/api/disc/tool')
        return (0, server.sendJson)(res, be.repack.tool()), true;
    void port;
    return false;
}
/* ================================== POST ================================== */
async function routePost2(res, p, b, be, getWindow, port) {
    const front = frontFor(be);
    /* ------------------------- Store por fontes ------------------------- */
    if (p === '/api/repos/links')
        return (0, server.sendJson)(res, await front.repoLinks(String(b?.id || ''))), true;
    if (p === '/api/repos/add')
        return (0, server.sendJson)(res, front.repoAdd(b || {})), true;
    if (p === '/api/repos/update')
        return (0, server.sendJson)(res, front.repoUpdate(b?.id, b?.patch || {})), true;
    if (p === '/api/repos/remove')
        return (0, server.sendJson)(res, front.repoRemove(b?.id)), true;
    if (p === '/api/repos/toggle')
        return (0, server.sendJson)(res, front.repoToggle(b?.id, Boolean(b?.enabled))), true;
    /* ----------------------------- downloads ----------------------------- */
    if (p === '/api/link/preview')
        return (0, server.sendJson)(res, await front.linkPreview(String(b?.url || ''))), true;
    if (p === '/api/link/download') {
        return (0, server.sendJson)(res, await front.linkDownload(String(b?.url || ''), String(b?.title || ''), String(b?.kind || 'pc'), String(b?.system || 'pc'), b?.picks)), true;
    }
    if (p === '/api/patch/download')
        return (0, server.sendJson)(res, await front.patchDownload(String(b?.key || ''), Number(b?.i || 0))), true;
    if (p === '/api/install') {
        return (0, server.sendJson)(res, await front.install(String(b?.key || ''), b?.files, Boolean(b?.torrent), b?.dest, Boolean(b?.remember))), true;
    }
    if (p === '/api/install/preview')
        return (0, server.sendJson)(res, await front.installPreview(String(b?.key || ''), b?.files, Boolean(b?.torrent))), true;
    if (p === '/api/local/install_file') {
        return (0, server.sendJson)(res, await front.installLocalFile(String(b?.file || b?.path || ''), String(b?.title || ''), String(b?.system || ''))), true;
    }
    if (p === '/api/queue' || p === '/api/queue/action')
        return (0, server.sendJson)(res, await front.queueAction(String(b?.action || ''), b?.key)), true;
    if (p === '/api/cancel')
        return (0, server.sendJson)(res, be.jobs.cancel(String(b?.key || ''), Boolean(b?.pause))), true;
    /* ---------------------------- emuladores ---------------------------- */
    if (p === '/api/emulator/install')
        return (0, server.sendJson)(res, front.installEmulator(String(b?.id || ''))), true;
    if (p === '/api/emulator/update')
        return (0, server.sendJson)(res, front.updateEmulator(String(b?.id || ''))), true;
    if (p === '/api/emulator/remove')
        return (0, server.sendJson)(res, front.removeEmulator(String(b?.id || ''))), true;
    if (p === '/api/emulator/exe')
        return (0, server.sendJson)(res, front.setEmulatorExe(String(b?.id || ''), b?.exe || null)), true;
    if (p === '/api/emulator/select')
        return (0, server.sendJson)(res, front.setSystemEmulator(String(b?.system || ''), b?.id || null)), true;
    if (p === '/api/emulator/open')
        return (0, server.sendJson)(res, front.openEmulator(String(b?.id || ''))), true;
    if (p === '/api/emulator/custom/add')
        return (0, server.sendJson)(res, front.addCustomEmulator(b || {})), true;
    if (p === '/api/emulator/custom/remove')
        return (0, server.sendJson)(res, front.removeCustomEmulator(String(b?.id || ''))), true;
    if (p === '/api/emulator/add_system')
        return (0, server.sendJson)(res, front.addSystemEmulator(String(b?.system || ''), String(b?.id || ''))), true;
    if (p === '/api/emulator/remove_system')
        return (0, server.sendJson)(res, front.removeSystemEmulator(String(b?.system || ''), String(b?.id || ''))), true;
    if (p === '/api/emulator/guide/install')
        return (0, server.sendJson)(res, await front.emulatorGuideInstall(String(b?.system || ''), String(b?.what || ''), b?.path || null, b?.pick || 'file')), true;
    if (p === '/api/emulator/check_updates')
        return (0, server.sendJson)(res, await front.checkEmulatorUpdates()), true;
    if (p === '/api/game/emulator')
        return (0, server.sendJson)(res, be.setGameEmulator(String(b?.key || ''), b?.emulator || null)), true;
    /* -------------------------------- ROMs -------------------------------- */
    if (p === '/api/rom/add')
        return (0, server.sendJson)(res, await front.addRomFile(b?.path || null, b?.system || null, b?.title || null, b?.emulator || null, Boolean(b?.add_folder))), true;
    if (p === '/api/rom/preview')
        return (0, server.sendJson)(res, await front.romPreview(b?.path || null)), true;
    if (p === '/api/romroot/scan')
        return (0, server.sendJson)(res, front.scanRomRoot(String(b?.folder || ''))), true;
    if (p === '/api/romroot/apply')
        return (0, server.sendJson)(res, front.applyRomRoot(b?.items || [])), true;
    if (p === '/api/romdir/add')
        return (0, server.sendJson)(res, front.addRomDir(String(b?.system || ''), String(b?.folder || ''))), true;
    if (p === '/api/romdir/remove')
        return (0, server.sendJson)(res, front.removeRomDir(String(b?.system || ''), String(b?.folder || ''))), true;
    if (p === '/api/rom_dest')
        return (0, server.sendJson)(res, front.setRomDest(String(b?.system || ''), b?.folder || null)), true;
    /* ---------------------------- jogos rapidos ---------------------------- */
    if (p === '/api/flash/install')
        return (0, server.sendJson)(res, be.flashInstall(b?.id ?? null)), true;
    if (p === '/api/flash/remove') {
        be.flash.removeGame(String(b?.id || ''));
        return (0, server.sendJson)(res, { ok: true }), true;
    }
    if (p === '/api/flash/add')
        return (0, server.sendJson)(res, await be.flashAdd(b?.path || null, String(b?.title || ''), String(b?.kind || ''))), true;
    if (p === '/api/flash/play_web')
        return (0, server.sendJson)(res, be.flashPlayWeb(String(b?.id || ''))), true;
    if (p === '/api/flash/update') {
        const f: any = {};
        for (const k of ['title', 'genre', 'tip', 'controls', 'w', 'h', 'players', 'time', 'url'])
            f[k] = b?.[k];
        return (0, server.sendJson)(res, be.flash.updateCustom(String(b?.id || ''), f)), true;
    }
    if (p === '/api/flash/remove_custom')
        return (0, server.sendJson)(res, be.flash.removeCustom(String(b?.id || ''))), true;
    if (p === '/api/flash/fav')
        return (0, server.sendJson)(res, be.flash.toggleFav(String(b?.id || ''))), true;
    if (p === '/api/flash/cover')
        return (0, server.sendJson)(res, await be.flashCover(String(b?.id || ''), b?.path || null)), true;
    /* -------------------------------- mods -------------------------------- */
    if (p === '/api/mods/game/install')
        return (0, server.sendJson)(res, await be.modInstall(String(b?.key || ''), b?.path || null, String(b?.title || ''), String(b?.target || ''), String(b?.kind || ''))), true;
    if (p === '/api/mods/loader')
        return (0, server.sendJson)(res, be.modLoaderInstall(String(b?.key || ''))), true;
    if (p === '/api/mods/patch')
        return (0, server.sendJson)(res, await be.modPatch(String(b?.key || ''), b?.path || null, Boolean(b?.force))), true;
    if (p === '/api/mods/game/toggle')
        return (0, server.sendJson)(res, be.gmods.setEnabled(String(b?.key || ''), String(b?.id || ''), Boolean(b?.on))), true;
    if (p === '/api/mods/game/remove')
        return (0, server.sendJson)(res, be.gmods.remove(String(b?.key || ''), String(b?.id || ''))), true;
    if (p === '/api/tools/install')
        return (0, server.sendJson)(res, be.installTool(String(b?.id || ''))), true;
    if (p === '/api/tools/remove') {
        be.mods.remove(String(b?.id || ''));
        return (0, server.sendJson)(res, { ok: true }), true;
    }
    if (p === '/api/tools/launch')
        return (0, server.sendJson)(res, be.mods.launch(String(b?.id || ''))), true;
    /* ------------------------------- saves ------------------------------- */
    if (p === '/api/saves/import')
        return (0, server.sendJson)(res, await be.savesImport(String(b?.key || ''), b?.source || null, b?.dest || null)), true;
    if (p === '/api/saves/import_folder')
        return (0, server.sendJson)(res, await be.savesImportFolder(String(b?.key || ''), b?.dest || null)), true;
    if (p === '/api/saves/set_dir')
        return (0, server.sendJson)(res, await be.savesSetDir(String(b?.key || ''), b?.folder || null)), true;
    if (p === '/api/saves/export')
        return (0, server.sendJson)(res, await be.savesExport(String(b?.key || ''), String(b?.dir || ''))), true;
    if (p === '/api/saves/restore')
        return (0, server.sendJson)(res, await be.saves.restoreBackup(String(b?.key || ''), String(b?.backup || ''), String(b?.dir || ''))), true;
    /* --------------------------- dependencias --------------------------- */
    if (p === '/api/redist/install')
        return (0, server.sendJson)(res, await be.central.redistInstall(String(b?.id || ''))), true;
    if (p === '/api/redist/bundle')
        return (0, server.sendJson)(res, await be.central.redistBundle(String(b?.id || ''))), true;
    if (p === '/api/redist/open')
        return (0, server.sendJson)(res, be.openPath(P.REDISTS)), true;
    /* ----------------------------- importacao ----------------------------- */
    if (p === '/api/import/launchers')
        return (0, server.sendJson)(res, be.imp.importLaunchers()), true;
    if (p === '/api/import/scan')
        return (0, server.sendJson)(res, be.imp.importScan(String(b?.id || ''), String(b?.path || ''), b?.opts || {})), true;
    if (p === '/api/import/apply')
        return (0, server.sendJson)(res, be.imp.importApply(Array.isArray(b?.games) ? b.games : [])), true;
    if (p === '/api/import/pick')
        return (0, server.sendJson)(res, await be.imp.importPick(String(b?.id || ''), String(b?.mode || ''))), true;
    if (p === '/api/import/poll')
        return (0, server.sendJson)(res, be.imp.importPoll()), true;
    if (p === '/api/library/steam')
        return (0, server.sendJson)(res, await be.imp.exportSteam(b?.user || null, Array.isArray(b?.keys) ? b.keys : null)), true;
    if (p === '/api/shortcut/desktop')
        return (0, server.sendJson)(res, desktopShortcut(be, String(b?.key || ''))), true;
    /* ------------------------------- pastas ------------------------------- */
    if (p === '/api/folder/scan')
        return (0, server.sendJson)(res, await be.imp.folderScan(b?.path ?? null, String(b?.mode || 'windows'))), true;
    if (p === '/api/folder/apply')
        return (0, server.sendJson)(res, await be.imp.folderApply(Array.isArray(b?.games) ? b.games : [], String(b?.mode || 'windows'), b?.opts || {})), true;
    if (p === '/api/dirs/add') {
        const r = await be.imp.gameDirAdd(b?.path || null);
        be.watchDirs();
        return (0, server.sendJson)(res, r), true;
    }
    if (p === '/api/dirs/remove') {
        const r = be.imp.gameDirRemove(String(b?.path || ''));
        be.watchDirs();
        return (0, server.sendJson)(res, r), true;
    }
    if (p === '/api/dirs/watch') {
        be.watchDirs();
        return (0, server.sendJson)(res, { ok: true, dirs: [...be.watchers.keys()] }), true;
    }
    if (p === '/api/dirs/ignore')
        return (0, server.sendJson)(res, be.imp.scanIgnore(Array.isArray(b?.exes) ? b.exes : [])), true;
    /* ----------------------------- atualizacoes ----------------------------- */
    if (p === '/api/updates/check')
        return (0, server.sendJson)(res, await front.updateCheck()), true;
    if (p === '/api/updates/download')
        return (0, server.sendJson)(res, front.updateDownload()), true;
    if (p === '/api/updates/apply')
        return (0, server.sendJson)(res, front.updateApply(b?.relaunch !== false, b?.restore || null)), true;
    if (p === '/api/updates/file')
        return (0, server.sendJson)(res, await front.updateAddFile()), true;
    if (p === '/api/updates/restore_pick')
        return (0, server.sendJson)(res, await front.updatePickRestore(Boolean(b?.allow_same))), true;
    if (p === '/api/updates/ack')
        return (0, server.sendJson)(res, front.updateAck()), true;
    /* ---------------------------- autorreparo ---------------------------- */
    if (p === '/api/integrity')
        return (0, server.sendJson)(res, front.integrityStatus()), true;
    if (p === '/api/integrity/repair')
        return (0, server.sendJson)(res, front.integrityRepair()), true;
    /* ---------------------------- Modo Console ---------------------------- */
    if (p === '/api/console/swap')
        return (0, server.sendJson)(res, be.consoleSwap(String(b?.to || 'console'), Boolean(b?.force))), true;
    /* ------------------------- Proton / Linux ------------------------- */
    if (p === '/api/linux')
        return (0, server.sendJson)(res, be.linuxStatus()), true;
    if (p === '/api/linux/prepare')
        return (0, server.sendJson)(res, be.linuxPrepare()), true;
    if (p === '/api/linux/prefix/remove')
        return (0, server.sendJson)(res, be.linuxPrefixRemove(b?.key || null)), true;
    /* --------------------------- terminal embutido --------------------------- */
    if (p === '/api/terminal')
        return (0, server.sendJson)(res, await be.terminal.run(String(b?.line || ''), String(b?.source || 'terminal'))), true;
    /* ------------------------------ opcionais ------------------------------ */
    /* ------------------------------- repacks ------------------------------- */
    if (p === '/api/repack/run')
        return (0, server.sendJson)(res, be.repack.run(String(b?.key || ''), Boolean(b?.force))), true;
    if (p === '/api/finish_repack')
        return (0, server.sendJson)(res, be.repack.finish(String(b?.key || ''))), true;
    /* --------------------------- compatibilidade --------------------------- */
    if (p === '/api/compat/layer')
        return (0, server.sendJson)(res, be.compatLayer(String(b?.key || ''), String(b?.layer || ''))), true;
    /* ------------------------------- detectar ------------------------------- */
    if (p === '/api/repos/gen/scan') {
        const dir = String(b?.dir || '').trim() || (await dialogs.pickFolder(String(b?.initial || '') || P.ROOT)) || '';
        if (!dir)
            return (0, server.sendJson)(res, { cancel: true }), true;
        return (0, server.sendJson)(res, sourceGen.scanFolder(dir)), true;
    }
    if (p === '/api/repos/gen/make') {
        const name = String(b?.name || '').trim() || 'Minha fonte';
        const out = String(b?.out || '') || (await dialogs.pickSave(path.join(app.getPath('documents') || P.ROOT, name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + '.json'), 'json')) || '';
        if (!out)
            return (0, server.sendJson)(res, { cancel: true }), true;
        const key = 'gen:' + path.basename(out);
        const r = be.jobs.run(key, `Fonte ${name}`, 'source', async (cb: any, cancel: any) => {
            const g = await sourceGen.generate({ name, dir: String(b?.dir || ''), base_url: String(b?.base_url || ''), out, hash: b?.hash !== false, games: Array.isArray(b?.games) ? b.games : [] }, cb, cancel);
            be.notify('ok', `Fonte criada: ${name}`, `${g.count} jogo(s), ${g.files} arquivo(s) · ${g.out}`, key, 'source-made:' + g.out);
            return { dir: path.dirname(g.out), out: g.out, count: g.count };
        });
        return (0, server.sendJson)(res, { ...r, out, key }), true;
    }
    if (p === '/api/repos/validate')
        return (0, server.sendJson)(res, await front.repoValidate(String(b?.url || ''))), true;
    if (p === '/api/repos/seen') {
        be.repos.clearNews(b?.id ? String(b.id) : undefined);
        return (0, server.sendJson)(res, { ok: true }), true;
    }
    if (p === '/api/detect')
        return (0, server.sendJson)(res, await front.detect(String(b?.q || ''))), true;
    /* ------------------------------ minecraft ------------------------------ */
    if (p === '/api/minecraft/add')
        return (0, server.sendJson)(res, be.central.minecraftAdd(String(b?.id || ''), b?.path || null)), true;
    if (p === '/api/minecraft/locate')
        return (0, server.sendJson)(res, await be.central.minecraftLocate(String(b?.id || ''))), true;
    if (p === '/api/minecraft/launcher')
        return (0, server.sendJson)(res, be.central.minecraftSetLauncher(String(b?.id || ''), b?.path || null)), true;
    if (p === '/api/minecraft/open')
        return (0, server.sendJson)(res, be.central.minecraftOpen(String(b?.id || ''), String(b?.where || 'site'))), true;
    /* ---------------------------- limpeza / jobs ---------------------------- */
    if (p === '/api/downloads/clean')
        return (0, server.sendJson)(res, front.cleanDownloads()), true;
    return false;
}
/** Reinicia o processo, aplicando uma atualizacao pendente se houver. */
function relaunch(getWindow, port) {
    void port;
    try {
        const { app } = require('electron');
        const win = getWindow();
        if (win)
            win.close();
        setTimeout(() => {
            app.relaunch({ args: process.argv.slice(1).concat(['--ludrix-after-update']) });
            app.exit(0);
        }, 500);
    }
    catch (e) {
        log.warn('relaunch: %s', e);
    }
}

export { frontFor, routeGet2, routePost2, relaunch, emulation };

/* --------------------- atalho na area de trabalho --------------------- */
/**
 * Cria um .lnk na area de trabalho apontando para o jogo.
 * O Python abria um PowerShell para falar com o WScript.Shell; aqui o
 * proprio Electron grava o atalho -- mesmo resultado, sem processo externo.
 */
function desktopShortcut(be, key) {
    const info = be.store.lib(key) || {};
    const exe = String(info.exe || '');
    if (!exe || !fs.existsSync(exe))
        return { error: 'O jogo não tem executável definido' };
    if (process.platform !== 'win32')
        return { error: 'Atalhos .lnk só existem no Windows' };
    const stem = path.basename(exe, path.extname(exe));
    const title = String(info.title || stem).replace(/[<>:"\/\\|?*]+/g, '').trim() || stem;
    const lnk = path.join(app.getPath('desktop'), title + '.lnk');
    const args = String((be.store.config.game_args || {})[key] || '').trim();
    try {
        const ok = shell.writeShortcutLink(lnk, 'create', {
            target: exe,
            args,
            cwd: path.dirname(exe),
            description: 'Ludrix - ' + title,
            icon: exe,
            iconIndex: 0,
        });
        return ok ? { ok: true, path: lnk } : { error: 'O Windows não criou o atalho' };
    }
    catch (e) {
        return { error: String(e?.message || e) };
    }
}
