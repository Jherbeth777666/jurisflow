import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** true quando as variáveis de ambiente do Supabase estão configuradas */
export const isSupabaseConfigured = Boolean(url && anonKey)

// Com variáveis ausentes, criamos um cliente apontando para um host inválido apenas
// para não quebrar o import; a UI mostra a tela de configuração (ConfigMissing).
export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

/** Converte erros do PostgREST/Postgres em mensagens em português para o usuário. */
export function friendlyError(error: unknown): string {
  if (!error) return 'Ocorreu um erro inesperado.'
  const e = error as { message?: string; code?: string; details?: string }
  const msg = e.message ?? String(error)
  switch (e.code) {
    case '23505':
      if (msg.includes('cpf')) return 'Já existe um cliente com este CPF neste escritório.'
      if (msg.includes('invitations')) return 'Já existe um convite pendente para este e-mail.'
      return 'Registro duplicado.'
    case '23503':
      return 'Este registro está vinculado a outros dados e não pode ser excluído ou alterado assim.'
    case '23514':
      return 'Algum campo está em formato inválido. Revise os dados informados.'
    case '42501':
      return 'Você não tem permissão para realizar esta ação.'
    case 'PGRST116':
      return 'Registro não encontrado.'
    case 'P0001':
    case 'P0002':
      return msg
  }
  if (msg.includes('Failed to fetch')) return 'Não foi possível conectar ao servidor. Verifique sua internet.'
  if (msg.includes('Invalid login credentials')) return 'E-mail ou senha incorretos.'
  if (msg.includes('Email not confirmed')) return 'Confirme seu e-mail antes de entrar (verifique sua caixa de entrada).'
  if (msg.includes('User already registered')) return 'Já existe uma conta com este e-mail.'
  if (msg.includes('Password should be')) return 'A senha deve ter pelo menos 8 caracteres.'
  return msg
}

/** Lança um Error amigável se a resposta do supabase tiver erro; senão devolve data. */
export function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw new Error(friendlyError(res.error))
  return res.data as T
}

/** Tamanho de página do PostgREST (padrão max_rows do Supabase). */
export const PAGE_SIZE = 1000

/**
 * Busca todas as linhas de uma consulta, paginando de PAGE_SIZE em PAGE_SIZE.
 * A consulta montada em `build` precisa de ordenação estável (termine com uma coluna única, ex.: id).
 */
export async function fetchAllRows<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const rows = unwrap(await build(from, from + PAGE_SIZE - 1)) ?? []
    out.push(...rows)
    if (rows.length < PAGE_SIZE) break
  }
  return out
}

/**
 * Erro causado por uma linha específica: integridade (classe 23: duplicado, chave estrangeira, check, not null),
 * dado inválido (classe 22: data/número malformado) ou validação de trigger (P0001).
 */
export function isRowConstraintError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && (code.startsWith('23') || code.startsWith('22') || code === 'P0001')
}
