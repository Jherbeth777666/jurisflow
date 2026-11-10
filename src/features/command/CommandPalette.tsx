import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  BarChart3,
  Briefcase,
  CheckSquare,
  Clock,
  CornerDownLeft,
  FileUp,
  HeartPulse,
  KanbanSquare,
  LayoutDashboard,
  Loader2,
  MessageSquareText,
  Plus,
  Search,
  Settings,
  Sparkles,
  User,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { useOrg } from '@/contexts/AuthContext'
import { supabase, unwrap } from '@/lib/supabase'
import { escapeLike, formatDate, maskCPF } from '@/lib/format'
import { DEMAND_STATUS, TASK_STATUS } from '@/lib/constants'
import { cn } from '@/lib/cn'
import type { DemandStatus, TaskStatus } from '@/types/database'
import {
  assistantPath,
  cpfDigitsFromQuery,
  loadRecents,
  matchesQuery,
  recentIdsByKind,
  recentPath,
  saveRecent,
  type RecentKind,
  type RecentRef,
} from './logic'

// ---------------------------------------------------------------------------
// Conteúdo
// ---------------------------------------------------------------------------
interface Item {
  key: string
  group: string
  label: string
  sublabel?: string
  hint?: string
  icon: LucideIcon
  path: string
  recent?: RecentRef
}

const PAGES: { path: string; label: string; icon: LucideIcon; keywords?: string }[] = [
  { path: '/', label: 'Visão geral', icon: LayoutDashboard, keywords: 'dashboard inicio painel' },
  { path: '/clientes', label: 'Clientes', icon: Users },
  { path: '/demandas', label: 'Demandas', icon: Briefcase, keywords: 'processos casos' },
  { path: '/fluxos', label: 'Fluxos de trabalho', icon: KanbanSquare, keywords: 'kanban etapas quadro' },
  { path: '/tarefas', label: 'Tarefas', icon: CheckSquare, keywords: 'prazos atividades' },
  { path: '/contratos', label: 'Contratos e honorários', icon: Wallet, keywords: 'financeiro pagamentos parcelas' },
  { path: '/mensagens', label: 'Mensagens', icon: MessageSquareText, keywords: 'whatsapp email modelos' },
  { path: '/assistente', label: 'Assistente IA', icon: Sparkles, keywords: 'ia chat' },
  { path: '/relatorios', label: 'Relatórios', icon: BarChart3 },
  { path: '/configuracoes', label: 'Configurações', icon: Settings, keywords: 'equipe escritorio membros' },
  // Mesmos nomes e ícones do menu lateral
  { path: '/importar', label: 'Importar planilha', icon: FileUp, keywords: 'importar dados excel importacao csv' },
  { path: '/qualidade', label: 'Saúde do cadastro', icon: HeartPulse, keywords: 'qualidade dados duplicados revisao' },
]

const ACTIONS: { path: string; label: string; keywords: string }[] = [
  { path: '/clientes?novo=1', label: 'Novo cliente', keywords: 'cadastrar criar adicionar' },
  { path: '/demandas?nova=1', label: 'Nova demanda', keywords: 'criar abrir caso' },
  { path: '/tarefas?nova=1', label: 'Nova tarefa', keywords: 'criar atividade prazo' },
]

const RECENT_ICON: Record<RecentKind, LucideIcon> = { cliente: User, demanda: Briefcase, tarefa: CheckSquare, pagina: ArrowRight }

interface SearchResult {
  clients: { id: string; full_name: string; cpf: string | null }[]
  demands: { id: string; title: string; status: DemandStatus; client: { full_name: string } | null }[]
  tasks: { id: string; title: string; status: TaskStatus; due_date: string | null; demand_id: string | null }[]
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Conteúdo da paleta — carregado sob demanda pelo CommandPalette (CommandHost.tsx). */
export default function Palette({ onClose }: { onClose: () => void }) {
  const { orgId } = useOrg()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [recents, setRecents] = useState<RecentRef[]>(() => loadRecents(orgId))
  // Rótulos dos recentes buscados no servidor (nada de nomes no localStorage).
  const recentIds = recentIdsByKind(recents)
  const recentLabels = useQuery({
    queryKey: ['command-search', orgId, 'recents', recentIds],
    enabled: recents.some((r) => r.kind !== 'pagina'),
    staleTime: 30_000,
    queryFn: async () => {
      const labels = new Map<string, string>()
      const [c, d, t] = await Promise.all([
        recentIds.cliente.length
          ? supabase.from('clients').select('id, full_name').eq('organization_id', orgId).is('anonymized_at', null).in('id', recentIds.cliente)
          : null,
        recentIds.demanda.length ? supabase.from('demands').select('id, title').eq('organization_id', orgId).in('id', recentIds.demanda) : null,
        recentIds.tarefa.length ? supabase.from('tasks').select('id, title').eq('organization_id', orgId).in('id', recentIds.tarefa) : null,
      ])
      if (c) (unwrap(c) as { id: string; full_name: string }[]).forEach((x) => labels.set(`cliente:${x.id}`, x.full_name))
      if (d) (unwrap(d) as { id: string; title: string }[]).forEach((x) => labels.set(`demanda:${x.id}`, x.title))
      if (t) (unwrap(t) as { id: string; title: string }[]).forEach((x) => labels.set(`tarefa:${x.id}`, x.title))
      return labels
    },
  })
  const debounced = useDebounced(query.trim(), 200)

  // Foco inicial e devolução de foco ao fechar
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    inputRef.current?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      prev?.focus?.()
    }
  }, [])

  const cpf = cpfDigitsFromQuery(debounced)
  const searchEnabled = cpf ? cpf.length >= 3 : debounced.length >= 2

  const search = useQuery({
    queryKey: ['command-search', orgId, debounced],
    enabled: searchEnabled,
    staleTime: 15_000,
    queryFn: async (): Promise<SearchResult> => {
      const term = `%${escapeLike(debounced)}%`
      let clientsQ = supabase
        .from('clients')
        .select('id, full_name, cpf')
        .eq('organization_id', orgId)
        .is('anonymized_at', null)
        .order('full_name')
        .limit(5)
      clientsQ = cpf ? clientsQ.like('cpf', `%${cpf}%`) : clientsQ.ilike('full_name', term)
      if (cpf) return { clients: unwrap(await clientsQ) as SearchResult['clients'], demands: [], tasks: [] }
      const [c, d, t] = await Promise.all([
        clientsQ,
        supabase
          .from('demands')
          .select('id, title, status, client:clients(full_name)')
          .eq('organization_id', orgId)
          .ilike('title', term)
          .order('updated_at', { ascending: false })
          .limit(5),
        supabase
          .from('tasks')
          .select('id, title, status, due_date, demand_id')
          .eq('organization_id', orgId)
          .ilike('title', term)
          .order('updated_at', { ascending: false })
          .limit(5),
      ])
      return {
        clients: unwrap(c) as SearchResult['clients'],
        demands: unwrap(d) as unknown as SearchResult['demands'],
        tasks: unwrap(t) as SearchResult['tasks'],
      }
    },
  })

  const q = query.trim()
  const items: Item[] = useMemo(() => {
    const out: Item[] = []
    if (!q) {
      recents.forEach((r) => {
        // Registro excluído/anonimizado ou sem acesso: some dos recentes.
        const label = r.kind === 'pagina' ? PAGES.find((p) => p.path === r.id)?.label : recentLabels.data?.get(`${r.kind}:${r.id}`)
        if (!label) return
        out.push({ key: `r:${r.kind}:${r.id}`, group: 'Recentes', label, icon: RECENT_ICON[r.kind], path: recentPath(r), recent: r, hint: labelKind(r.kind) })
      })
    }
    const data = searchEnabled && debounced === q ? search.data : undefined
    data?.clients.forEach((c) =>
      out.push({
        key: `c:${c.id}`,
        group: 'Clientes',
        label: c.full_name,
        sublabel: c.cpf ? maskCPF(c.cpf) : undefined,
        icon: User,
        path: `/clientes/${c.id}`,
        recent: { kind: 'cliente', id: c.id },
        hint: 'Cliente',
      }),
    )
    data?.demands.forEach((d) =>
      out.push({
        key: `d:${d.id}`,
        group: 'Demandas',
        label: d.title,
        sublabel: [d.client?.full_name, DEMAND_STATUS[d.status]?.label].filter(Boolean).join(' · '),
        icon: Briefcase,
        path: `/demandas/${d.id}`,
        recent: { kind: 'demanda', id: d.id },
        hint: 'Demanda',
      }),
    )
    data?.tasks.forEach((t) => {
      const path = t.demand_id ? `/demandas/${t.demand_id}` : `/tarefas?tarefa=${t.id}`
      out.push({
        key: `t:${t.id}`,
        group: 'Tarefas',
        label: t.title,
        sublabel: [TASK_STATUS[t.status]?.label, t.due_date ? `vence ${formatDate(t.due_date)}` : null].filter(Boolean).join(' · '),
        icon: CheckSquare,
        path,
        recent: { kind: 'tarefa', id: t.id },
        hint: 'Tarefa',
      })
    })
    ACTIONS.filter((a) => matchesQuery(q, a.label, a.keywords)).forEach((a) =>
      out.push({ key: `a:${a.path}`, group: q ? 'Ações' : 'Ações rápidas', label: a.label, icon: Plus, path: a.path, hint: 'Ação' }),
    )
    PAGES.filter((p) => matchesQuery(q, p.label, p.keywords, 'ir para')).forEach((p) =>
      out.push({ key: `p:${p.path}`, group: 'Ir para', label: p.label, icon: p.icon, path: p.path, hint: 'Página' }),
    )
    if (q.length >= 2 && !cpfDigitsFromQuery(q)) {
      out.push({
        key: 'ai',
        group: 'Assistente',
        label: `Perguntar ao assistente: “${q.length > 70 ? `${q.slice(0, 70)}…` : q}”`,
        icon: Sparkles,
        path: assistantPath(q.slice(0, 2000)),
        hint: 'IA',
      })
    }
    return out
  }, [q, debounced, searchEnabled, search.data, recents, recentLabels.data])

  useEffect(() => setActive(0), [q, search.data])

  // Mantém o item ativo visível
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  const run = useCallback(
    (item: Item | undefined) => {
      if (!item) return
      if (item.recent) setRecents(saveRecent(orgId, item.recent))
      onClose()
      navigate(item.path)
    },
    [navigate, onClose, orgId],
  )

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (items.length ? (i + 1) % items.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (items.length ? (i - 1 + items.length) % items.length : 0))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(Math.max(0, items.length - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(items[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Tab') {
      e.preventDefault()
    }
  }

  // Agrupa preservando a ordem
  const groups: { name: string; items: { item: Item; index: number }[] }[] = []
  items.forEach((item, index) => {
    const g = groups.find((x) => x.name === item.group)
    if (g) g.items.push({ item, index })
    else groups.push({ name: item.group, items: [{ item, index }] })
  })

  const loading = searchEnabled && (search.isFetching || debounced !== q)
  const optionId = (i: number) => `${listId}-opt-${i}`

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-3 pt-[10vh] sm:pt-[14vh]">
      <div className="absolute inset-0 bg-navy-950/30 backdrop-blur-[1.5px]" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Busca e comandos"
        className="relative flex max-h-[min(72vh,560px)] w-full max-w-[640px] flex-col overflow-hidden rounded-xl bg-surface shadow-[0_24px_60px_-12px_rgb(6_16_36/0.35),0_0_0_1px_rgb(15_23_42/0.08)]"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          {loading ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-ink-subtle" aria-hidden />
          ) : (
            <Search className="size-4 shrink-0 text-ink-subtle" aria-hidden />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={items[active] ? optionId(active) : undefined}
            aria-label="Buscar clientes, demandas, tarefas ou comandos"
            placeholder="Buscar clientes, CPF, demandas, tarefas… ou digite um comando"
            maxLength={2000}
            spellCheck={false}
            autoComplete="off"
            className="h-[52px] min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink-subtle focus:outline-none"
          />
          <kbd className="hidden rounded bg-canvas px-1.5 py-0.5 text-[10.5px] font-medium text-ink-subtle ring-1 ring-line sm:inline">Esc</kbd>
        </div>

        <div ref={listRef} id={listId} role="listbox" aria-label="Resultados" className="scrollbar-thin flex-1 overflow-y-auto p-1.5">
          {groups.map((g) => {
            const headId = `${listId}-g-${g.name.replace(/\W+/g, '')}`
            return (
              <div key={g.name} role="group" aria-labelledby={headId} className="mb-1 last:mb-0">
                <div id={headId} className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-ink-subtle">
                  {g.name}
                </div>
                {g.items.map(({ item, index }) => {
                  const Icon = item.icon
                  const isActive = index === active
                  return (
                    <div
                      key={item.key}
                      id={optionId(index)}
                      role="option"
                      aria-selected={isActive}
                      data-index={index}
                      onMouseMove={() => !isActive && setActive(index)}
                      onClick={() => run(item)}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-[13.5px]',
                        isActive ? 'bg-navy-50 text-ink' : 'text-ink/90',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-7 shrink-0 items-center justify-center rounded-md ring-1 ring-inset',
                          isActive ? 'bg-surface text-navy-700 ring-line-strong' : 'bg-canvas text-ink-muted ring-line',
                          item.key === 'ai' && 'text-accent-600',
                        )}
                      >
                        <Icon className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{item.label}</span>
                        {item.sublabel && <span className="block truncate text-[12px] text-ink-subtle">{item.sublabel}</span>}
                      </span>
                      {isActive ? (
                        <CornerDownLeft className="size-3.5 shrink-0 text-ink-subtle" aria-hidden />
                      ) : (
                        item.hint && <span className="shrink-0 text-[11.5px] text-ink-subtle">{item.hint}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}

          {search.isError && searchEnabled && (
            <p className="px-3 py-2 text-[12.5px] text-red-600" role="alert">
              Não foi possível buscar agora. {(search.error as Error).message}
            </p>
          )}
          {searchEnabled && !loading && !search.isError && search.data && !search.data.clients.length && !search.data.demands.length && !search.data.tasks.length && (
            <p className="px-3 pb-1 pt-2 text-[12.5px] text-ink-subtle">Nenhum cliente, demanda ou tarefa encontrado para “{q}”.</p>
          )}
          {!items.length && !loading && <p className="px-3 py-8 text-center text-[13px] text-ink-muted">Nada encontrado.</p>}
          {!q && !recents.length && (
            <p className="flex items-center gap-1.5 px-3 pb-1 pt-1 text-[12px] text-ink-subtle">
              <Clock className="size-3" /> Itens que você abrir pela busca aparecerão aqui.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line bg-canvas/70 px-4 py-2 text-[11.5px] text-ink-subtle">
          <span className="hidden items-center gap-3 sm:flex">
            <span className="inline-flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> navegar
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>↵</Kbd> abrir
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>esc</Kbd> fechar
            </span>
          </span>
          <span className="truncate">Busca por nome, CPF (só dígitos) ou título</span>
        </div>
      </div>
    </div>
  )
}

function Kbd({ children }: { children: string }) {
  return <kbd className="rounded bg-surface px-1 py-px font-sans text-[10.5px] font-medium text-ink-muted ring-1 ring-line">{children}</kbd>
}

const labelKind = (k: RecentKind) => ({ cliente: 'Cliente', demanda: 'Demanda', tarefa: 'Tarefa', pagina: 'Página' })[k]
