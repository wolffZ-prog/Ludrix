# Temas

O Ludrix traz um tema, **Padrão**, em claro e escuro. Em **Ajustes → Aparência**: tema, cor de destaque, posição da barra (lateral ou inferior), escala, intensidade de efeitos, redução de movimento. Suas escolhas valem por cima de qualquer tema.

## Importar
Ajustes → Aparência → **Importar .lxtheme / .zip / .json**, ou arraste o arquivo pra janela. Temas assinados pelo projeto aparecem com o selo *oficial*; os demais funcionam igual.

Antes de aplicar, o CSS do tema passa por um filtro: `@import`, `url()` pra endereços externos, `expression`, `behavior` e similares são removidos. Um tema não consegue carregar nada da internet.

## Ludrix Studio
Programa separado pra montar temas. Dez esqueletos (Prateleira, Vitrine, Galeria, Sala, Lista, Quadro, Cinema, Estante, Lançador, Oficina), mais de 300 opções com visualização ao vivo, claro e escuro, papel de parede, botão **Testar no Ludrix** (aplica direto se o Ludrix estiver aberto) e **Exportar** `.lxtheme`.

Formato do `.lxtheme`: zip com `<slug>/theme.json` e, opcionalmente, `extra.css`, `wallpaper.jpg`, `preview.png`, `studio.json` (pra reabrir no Studio) e a assinatura.

O Studio é um programa separado, do mesmo autor, e não faz parte deste repositório. Quando houver novidade sobre distribuição, aparece aqui e na página de releases.
