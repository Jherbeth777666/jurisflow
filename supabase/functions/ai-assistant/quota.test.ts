// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { MONTHLY_LIMIT_MESSAGE, consumeQuota, monthlyOrgLimitFromEnv } from './quota.ts'

const base = { orgId: 'org', kind: 'assistant' as const, hourlyLimit: 30, monthlyLimit: 3000, hourlyMessage: 'hora' }

describe('consumeQuota', () => {
  it('passa p_monthly_org_limit e aceita true', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    expect(await consumeQuota({ ...base, rpc, countLastHour: async () => 0 })).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith('ai_consume_quota', { p_org: 'org', p_kind: 'assistant', p_limit_per_hour: 30, p_monthly_org_limit: 3000 })
  })
  it('false com uso da hora abaixo do limite → teto mensal (429)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null })
    expect(await consumeQuota({ ...base, rpc, countLastHour: async () => 3 })).toEqual({
      ok: false,
      status: 429,
      code: 'monthly_limit',
      error: MONTHLY_LIMIT_MESSAGE,
    })
  })
  it('false com uso da hora no limite → limite por hora (429)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null })
    expect(await consumeQuota({ ...base, rpc, countLastHour: async () => 30 })).toMatchObject({ status: 429, code: 'rate_limited', error: 'hora' })
  })
  it('banco sem a migration nova (função com 3 argumentos) → usa a assinatura antiga', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'not found', code: 'PGRST202' } })
      .mockResolvedValueOnce({ data: true, error: null })
    expect(await consumeQuota({ ...base, rpc, countLastHour: async () => 0 })).toEqual({ ok: true })
    expect(rpc.mock.calls[1][1]).toEqual({ p_org: 'org', p_kind: 'assistant', p_limit_per_hour: 30 })
  })
  it('erro do banco → 500', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'x', code: '42501' } })
    expect(await consumeQuota({ ...base, rpc, countLastHour: async () => 0 })).toMatchObject({ ok: false, status: 500 })
  })
  it('AI_MONTHLY_ORG_LIMIT com padrão 3000', () => {
    expect(monthlyOrgLimitFromEnv({})).toBe(3000)
    expect(monthlyOrgLimitFromEnv({ AI_MONTHLY_ORG_LIMIT: '500' })).toBe(500)
    expect(monthlyOrgLimitFromEnv({ AI_MONTHLY_ORG_LIMIT: 'abc' })).toBe(3000)
    expect(monthlyOrgLimitFromEnv({ AI_MONTHLY_ORG_LIMIT: '-1' })).toBe(3000)
  })
})
