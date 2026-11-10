// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { ToolArgError, TOOL_NAMES, buildToolInvocation, clampInt, executeTool, parseISODateArg } from './tools.ts'
import type { RpcExecutor } from './types.ts'

const ORG = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

describe('validação de argumentos', () => {
  it('clampInt limita, trunca e usa padrão', () => {
    expect(clampInt(undefined, 15, 1, 365)).toBe(15)
    expect(clampInt('abc', 15, 1, 365)).toBe(15)
    expect(clampInt(99999, 15, 1, 365)).toBe(365)
    expect(clampInt(-3, 15, 1, 365)).toBe(1)
    expect(clampInt('20', 15, 1, 365)).toBe(20)
    expect(clampInt(7.9, 15, 1, 365)).toBe(7)
  })

  it('parseISODateArg aceita datas válidas e rejeita inválidas', () => {
    expect(parseISODateArg('2026-11-09', 'd')).toBe('2026-11-09')
    expect(parseISODateArg(undefined, 'd')).toBeNull()
    expect(() => parseISODateArg('2026-02-30', 'd')).toThrow(ToolArgError)
    expect(() => parseISODateArg('09/11/2026', 'd')).toThrow(ToolArgError)
    expect(() => parseISODateArg("2026-11-09'; drop table x;--", 'd')).toThrow(ToolArgError)
  })

  it('ai_stalled_demands limita dias', () => {
    expect(buildToolInvocation('ai_stalled_demands', { days: 10000 }, ORG).params).toEqual({ p_days: 365, p_org: ORG })
    expect(buildToolInvocation('ai_stalled_demands', {}, ORG).params).toEqual({ p_days: 15, p_org: ORG })
    expect(buildToolInvocation('ai_upcoming_tasks', { days: 0 }, ORG).params).toEqual({ p_days: 1, p_org: ORG })
  })

  it('ai_count_demands valida status, datas e ordem do período', () => {
    expect(
      buildToolInvocation('ai_count_demands', { category_name: ' salário-maternidade ', from_date: '2026-11-01', to_date: '2026-11-30' }, ORG)
        .params,
    ).toEqual({ p_category_name: 'salário-maternidade', p_from: '2026-11-01', p_to: '2026-11-30', p_org: ORG })
    expect(() => buildToolInvocation('ai_count_demands', { status: 'qualquer' }, ORG)).toThrow(/status inválido/)
    expect(() => buildToolInvocation('ai_count_demands', { from_date: '2026-12-01', to_date: '2026-11-01' }, ORG)).toThrow(
      ToolArgError,
    )
    const long = buildToolInvocation('ai_count_demands', { category_name: 'x'.repeat(500) }, ORG).params
    expect((long.p_category_name as string).length).toBe(80)
  })

  it('aceita argumentos em string JSON e rejeita JSON inválido / tipos errados', () => {
    expect(buildToolInvocation('ai_upcoming_tasks', '{"days": 3}', ORG).params).toEqual({ p_days: 3, p_org: ORG })
    expect(() => buildToolInvocation('ai_upcoming_tasks', '{days', ORG)).toThrow(ToolArgError)
    expect(() => buildToolInvocation('ai_upcoming_tasks', [1, 2], ORG)).toThrow(ToolArgError)
  })
})

describe('whitelist e escritório', () => {
  it('rejeita ferramenta desconhecida sem executar nada', async () => {
    const rpc = vi.fn<RpcExecutor>()
    const out = await executeTool('execute_sql', { sql: 'select * from clients' }, ORG, rpc)
    expect(out).toMatchObject({ ok: false, allowed: false })
    expect(rpc).not.toHaveBeenCalled()
    // nomes de funções reais do banco fora da whitelist também são bloqueados
    for (const n of ['dashboard_metrics', 'anonymize_client', 'is_org_member', '__proto__', 'constructor']) {
      expect((await executeTool(n, {}, ORG, rpc)).ok).toBe(false)
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it('ignora p_org/organization_id enviados pelo modelo', async () => {
    const rpc = vi.fn<RpcExecutor>().mockResolvedValue({ data: { total: 0 }, error: null })
    await executeTool('ai_overdue_tasks', { p_org: OTHER, organization_id: OTHER }, ORG, rpc)
    await executeTool('ai_stalled_demands', { days: 5, p_org: OTHER }, ORG, rpc)
    expect(rpc).toHaveBeenNthCalledWith(1, 'ai_overdue_tasks', { p_org: ORG })
    expect(rpc).toHaveBeenNthCalledWith(2, 'ai_stalled_demands', { p_days: 5, p_org: ORG })
  })

  it('traduz 42501 do financeiro em erro claro de permissão', async () => {
    const rpc = vi.fn<RpcExecutor>().mockResolvedValue({ data: null, error: { message: 'x', code: '42501' } })
    const out = await executeTool('ai_financial_overview', {}, ORG, rpc)
    expect(out).toMatchObject({ ok: false, allowed: true })
    expect(!out.ok && out.error).toMatch(/não pode consultar dados financeiros/)
  })

  it('todas as ferramentas da whitelist mapeiam para funções ai_*', () => {
    expect(TOOL_NAMES.length).toBe(9)
    for (const n of TOOL_NAMES) {
      expect(n).toMatch(/^ai_[a-z_]+$/)
      expect(buildToolInvocation(n, {}, ORG).rpc).toBe(n)
    }
  })
})
