// Ids de abas/painéis (fora do componente para manter o Fast Refresh).

/** Ids estáveis de aba/painel a partir de um prefixo (use o mesmo em Tabs e no painel). */
export const tabId = (prefix: string, value: string) => `${prefix}-tab-${value}`
export const tabPanelId = (prefix: string, value: string) => `${prefix}-panel-${value}`

/** Props para o elemento do painel da aba ativa: `<div {...tabPanelProps('x', tab)}>`. */
export function tabPanelProps(prefix: string, value: string) {
  return { id: tabPanelId(prefix, value), role: 'tabpanel' as const, 'aria-labelledby': tabId(prefix, value), tabIndex: 0 }
}
