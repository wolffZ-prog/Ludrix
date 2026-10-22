#include <windows.h>
#include <stdio.h>
#include <string.h>

typedef struct { WORD wButtons; BYTE bLeftTrigger; BYTE bRightTrigger; SHORT sThumbLX; SHORT sThumbLY; SHORT sThumbRX; SHORT sThumbRY; } XGAMEPAD;
typedef struct { DWORD dwPacketNumber; XGAMEPAD Gamepad; } XSTATE;
typedef DWORD (WINAPI *GETSTATE)(DWORD, XSTATE*);

static GETSTATE load_xinput(void) {
    const char *names[] = {"xinput1_4.dll", "xinput1_3.dll", "xinput9_1_0.dll"};
    for (int i = 0; i < 3; i++) {
        HMODULE h = LoadLibraryA(names[i]);
        if (!h) continue;
        GETSTATE f = (GETSTATE)GetProcAddress(h, (LPCSTR)100);
        if (!f) f = (GETSTATE)GetProcAddress(h, "XInputGetState");
        if (f) return f;
    }
    return NULL;
}

int main(int argc, char **argv) {
    int once = argc > 1 && strcmp(argv[1], "--once") == 0;
    GETSTATE get = load_xinput();
    setvbuf(stdout, NULL, _IONBF, 0);
    if (!get) { printf("unavailable\n"); return 0; }
    int was[4] = {0, 0, 0, 0};
    DWORD guide_since[4] = {0, 0, 0, 0};
    int guide_fired[4] = {0, 0, 0, 0};
    int first = 1, last = -1;
    XSTATE st;
    for (;;) {
        int n = 0;
        for (int i = 0; i < 4; i++) {
            int ok = get(i, &st) == ERROR_SUCCESS;
            if (ok) n++;
            if (ok && !was[i] && !first) printf("connected %d\n", i);
            was[i] = ok;
            if (ok) {
                if (st.Gamepad.wButtons & 0x0400) {
                    if (!guide_since[i]) guide_since[i] = GetTickCount();
                    if (!guide_fired[i] && GetTickCount() - guide_since[i] >= 900) { guide_fired[i] = 1; printf("guide %d\n", i); }
                } else { guide_since[i] = 0; guide_fired[i] = 0; }
            }
        }
        if (n != last) { printf("state %d\n", n); last = n; }
        if (once) return 0;
        first = 0;
        Sleep(n ? 250 : 1500);
    }
}
