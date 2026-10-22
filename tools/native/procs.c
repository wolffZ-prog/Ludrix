#include <windows.h>
#include <tlhelp32.h>
#include <psapi.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

static unsigned long long ft2unix(FILETIME ft) {
    ULARGE_INTEGER u; u.LowPart = ft.dwLowDateTime; u.HighPart = ft.dwHighDateTime;
    if (!u.QuadPart) return 0;
    return (u.QuadPart - 116444736000000000ULL) / 10000000ULL;
}

static void print_utf8(const wchar_t *w) {
    char buf[4096];
    int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, buf, sizeof(buf), NULL, NULL);
    if (n > 0) fputs(buf, stdout);
}

static int kill_tree(DWORD root) {
    DWORD stack[4096]; int top = 0, killed = 0;
    stack[top++] = root;
    while (top > 0) {
        DWORD pid = stack[--top];
        HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (snap != INVALID_HANDLE_VALUE) {
            PROCESSENTRY32W pe; pe.dwSize = sizeof(pe);
            if (Process32FirstW(snap, &pe)) {
                do { if (pe.th32ParentProcessID == pid && pe.th32ProcessID != pid && top < 4096) stack[top++] = pe.th32ProcessID; } while (Process32NextW(snap, &pe));
            }
            CloseHandle(snap);
        }
        HANDLE h = OpenProcess(PROCESS_TERMINATE, FALSE, pid);
        if (h) { if (TerminateProcess(h, 1)) killed++; CloseHandle(h); }
    }
    return killed;
}

int main(int argc, char **argv) {
    if (argc >= 3 && strcmp(argv[1], "kill") == 0) {
        int total = 0;
        for (int i = 2; i < argc; i++) total += kill_tree((DWORD)strtoul(argv[i], NULL, 10));
        printf("%d\n", total);
        return 0;
    }
    int mem = argc >= 2 && strcmp(argv[1], "mem") == 0;
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) return 1;
    PROCESSENTRY32W pe; pe.dwSize = sizeof(pe);
    if (!Process32FirstW(snap, &pe)) { CloseHandle(snap); return 1; }
    do {
        wchar_t path[MAX_PATH * 2]; DWORD len = MAX_PATH * 2; path[0] = 0;
        unsigned long long created = 0, ws = 0;
        HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pe.th32ProcessID);
        if (h) {
            if (!QueryFullProcessImageNameW(h, 0, path, &len)) path[0] = 0;
            FILETIME c, e, k, u;
            if (GetProcessTimes(h, &c, &e, &k, &u)) created = ft2unix(c);
            if (mem) { PROCESS_MEMORY_COUNTERS pm; pm.cb = sizeof(pm); if (GetProcessMemoryInfo(h, &pm, sizeof(pm))) ws = pm.WorkingSetSize; }
            CloseHandle(h);
        }
        printf("%lu\t%lu\t%llu\t%llu\t", (unsigned long)pe.th32ProcessID, (unsigned long)pe.th32ParentProcessID, created, ws);
        print_utf8(path[0] ? path : pe.szExeFile);
        fputc('\n', stdout);
    } while (Process32NextW(snap, &pe));
    CloseHandle(snap);
    return 0;
}
