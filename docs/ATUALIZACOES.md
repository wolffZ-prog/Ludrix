# Atualizações

## Automático
O Ludrix consulta `https://github.com/wolffZ-prog/Ludrix/releases/latest/download/ludrix-updates.json`. Quando há versão nova compatível, avisa. Você aceita → ele baixa o `.lxup`, confere tamanho, SHA-256 e assinatura Ed25519, fecha, aplica, reabre.

- Só `https`. Limite de 600 MB.
- Um `.lxup` sem assinatura válida não é aplicado.
- Depois de atualizar, se o Ludrix não conseguir abrir duas vezes seguidas, ele volta sozinho pra versão anterior.
- O changelog completo aparece na caixa de atualização.

Em **Ajustes → Sistema** dá pra checar na hora, apontar um endereço `https` próprio (feed no mesmo formato) ou aplicar um `.lxup` baixado manualmente (também arrastando pra janela).

## Tipos de pacote
| Pacote | Troca |
|---|---|
| `ludrix-<v>-patch.lxup` | só `app/` (código, interface, catálogos). Pequeno. |
| `ludrix-<v>-full.lxup` | `app/` + `runtime/` + executáveis. Quando o Python ou o WebView2 embutidos mudam. |

Cada `.lxup` carrega `min_version`: a versão mínima que aceita aplicá-lo.

## Voltar versão
Ajustes → Sistema → Voltar versão: pede o zip de código-fonte da versão desejada (também assinado), aplica e reabre. A pasta `data/` não é tocada.

## Formato do feed
```json
{
  "latest": {"version": "2.34.1", "kind": "patch", "url": "https://…/ludrix-2.34.1-patch.lxup",
             "sha256": "…", "size": 1177600, "min_version": "1.0.0", "title": "Patch 2.34.1",
             "changelog": "…", "date": "2026-10-06"},
  "all": [ … ]
}
```
