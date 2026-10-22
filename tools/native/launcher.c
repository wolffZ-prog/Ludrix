#include <windows.h>
#include <shlwapi.h>
#include <wchar.h>

#ifndef CONSOLE_MODE
#define CONSOLE_MODE 0
#endif

static void fail(const wchar_t *msg) {
    MessageBoxW(NULL, msg, L"LudrixHub", MB_ICONERROR | MB_OK);
}

int WINAPI wWinMain(HINSTANCE hInst, HINSTANCE hPrev, LPWSTR lpCmdLine, int nShow) {
    wchar_t dir[MAX_PATH], exe[MAX_PATH], app[MAX_PATH];
    (void)hInst; (void)hPrev; (void)nShow;
    if (!GetModuleFileNameW(NULL, dir, MAX_PATH)) return 1;
    PathRemoveFileSpecW(dir);
    wcscpy_s(exe, MAX_PATH, dir); PathAppendW(exe, L"runtime\\Ludrix.exe");
    wcscpy_s(app, MAX_PATH, dir); PathAppendW(app, L"app");
    if (GetFileAttributesW(exe) == INVALID_FILE_ATTRIBUTES) {
        fail(L"A pasta runtime\\ não foi encontrada ao lado do Ludrix.exe.\n\nExtraia o pacote completo (Ludrix-<versão>.zip) de novo por cima desta pasta.");
        return 2;
    }
    if (GetFileAttributesW(app) == INVALID_FILE_ATTRIBUTES) {
        fail(L"A pasta app\\ não foi encontrada ao lado do Ludrix.exe.\n\nExtraia o pacote completo (Ludrix-<versão>.zip) de novo por cima desta pasta.");
        return 2;
    }
    SetEnvironmentVariableW(L"LUDRIX_HOME", dir);
    SetEnvironmentVariableW(L"LUDRIX_ROOT", dir);
    wchar_t cmd[32768];
    swprintf_s(cmd, 32768, L"\"%s\"%s%s%s", exe, CONSOLE_MODE ? L" --console" : L"", (lpCmdLine && *lpCmdLine) ? L" " : L"", (lpCmdLine && *lpCmdLine) ? lpCmdLine : L"");
    STARTUPINFOW si; PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si)); si.cb = sizeof(si);
    ZeroMemory(&pi, sizeof(pi));
    if (!CreateProcessW(exe, cmd, NULL, NULL, FALSE, 0, NULL, dir, &si, &pi)) {
        fail(L"Não foi possível iniciar runtime\\Ludrix.exe.");
        return 3;
    }
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    return 0;
}
