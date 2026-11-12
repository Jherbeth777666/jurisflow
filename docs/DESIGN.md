# Sistema visual do JurisFlow — "papel e tinta"

Fundo de papel levemente quente, tinta azul-marinho e um único azul de destaque. A hierarquia vem da
tipografia, do espaçamento e de linhas finas, não de cor forte, gradiente ou sombra pesada.
Tokens em `src/index.css` (`@theme`). Nada de `text-[NNpx]`, cores soltas ou sombras próprias nos componentes.

## Cores
| Token | Uso |
|---|---|
| `canvas` #f7f7f5 | fundo da aplicação |
| `sidebar` #f1f1ee | menu lateral |
| `surface` / `surface-muted` | cartões / cabeçalhos de tabela, rodapés, hover |
| `line` / `line-strong` | divisórias / bordas de controles |
| `ink` / `ink-muted` / `ink-subtle` | texto principal / secundário / meta (todos ≥ 4,5:1 no canvas e no sidebar) |
| `navy-*` | marca, botão primário, ativo |
| `accent-*` | links, foco, ícone ativo, dado principal em gráficos |
| vermelho / âmbar / verde (Tailwind) | só para estado: vencido, atenção, ok |

## Tipografia (Geist)
`text-2xs` 11 · `text-caption` 12 · `text-label` 12,5 · `text-body-sm` 13 · `text-body` 13,5 (padrão) ·
`text-body-lg` 14,5 · `text-title` 16 · `text-heading` 22 · `text-display` 28.
Rótulos de seção: classe `eyebrow` (11px, maiúsculas, espaçado). Números: `tabular`.

## Forma
Raios: `--radius-control` 8px (botões, inputs, itens de menu), `--radius-card` 12px (cartões),
`--radius-dialog` 16px (modais, paleta de busca). Selos e avatares: `rounded-full`.
Sombras: `--shadow-xs` (controles), `--shadow-card` (cartões), `--shadow-lift` (hover/realce), `--shadow-pop` (menus, modais).
Ícones: lucide, 16–18px, traço 1,8.

## Movimento
`animate-rise` (troca de página, 280ms), `animate-pop` (modais, menus, toasts), `animate-fade` (fundos, estados vazios),
`animate-shimmer` (skeleton). Botões: `active:scale-[0.97]`. Respeita `prefers-reduced-motion`.

## Padrões
- Ação principal da tela: `Button variant="primary"` (azul-marinho). Uma por área.
- Revisão antes de gravar (passos sugeridos, propostas da IA): o botão de confirmar vem primeiro.
- Menu lateral recolhível (lembra a escolha no navegador); no celular vira gaveta.
- Painel inicial: indicadores num único bloco com comparação real com o mês anterior; "Precisa de atenção" só mostra o que existe.
- Toque: controles com `touch-target` (44px em telas de toque).
