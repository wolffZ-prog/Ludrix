# Atualizações

## Automático
O Ludrix consulta `https://github.com/wolffZ-prog/Ludrix/releases/latest/download/ludrix-updates.json` 20 s depois de abrir e a cada 6 h. Quando há versão nova compatível, avisa. Você aceita → ele baixa o `.lxup`, confere tamanho, SHA-256 e assinatura Ed25519, fecha, aplica, reabre.

- Só `https`. Limite de 600 MB.
- Um `.lxup` sem assinatura válida não é aplicado.
- Cada pasta listada no pacote (`app/`, `runtime/`) é apagada e gravada de novo: nada da versão anterior sobra. `data/`, `games/`, `emulation/` e `downloads/` nunca são tocadas.
- Depois de atualizar, se o Ludrix não conseguir abrir duas vezes seguidas, ele volta sozinho pra versão anterior.
- O changelog completo aparece na caixa de atualização.

Em **Ajustes → Sistema** dá pra checar na hora, apontar um endereço `https` próprio (feed no mesmo formato) ou aplicar um `.lxup` baixado manualmente (também arrastando pra janela).

## Tipos de pacote
| Pacote | Troca |
|---|---|
| `ludrix-<v>-patch.lxup` | só `app/` (código, interface, catálogos). Pequeno. Exige `min_version` 4.0.0. |
| `ludrix-<v>-full.lxup` | `app/` + `runtime/` + executáveis. Quando o Electron muda — e na passagem do 3.0.x para o 4.0.0. |

## Do 3.0.x para o 4.0.0
O 3.0.x lê o mesmo feed, vê o `ludrix-4.0.0-full.lxup` e aplica com o atualizador antigo: remove `app/` e `runtime/` (Python), grava os novos, troca `Ludrix.exe` e `LudrixConsole.exe`. Na primeira abertura o 4.0.0 apaga `updater.exe` e os restos do Python; quando abre bem, apaga também o backup do motor antigo em `data/updates/backup/`. Versões seguintes chegam como patch normal.

## Formato do feed
```json
{
  "latest": {"version": "4.0.0", "kind": "patch", "url": "https://…/ludrix-4.0.0-patch.lxup",
             "sha256": "…", "size": 11200000, "min_version": "4.0.0", "title": "Patch 4.0.0",
             "changelog": "…", "date": "2026-10-21"},
  "all": [ … ]
}
```
