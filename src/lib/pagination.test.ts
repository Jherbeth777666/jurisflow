import { clampPage, isRangeError, pageOrEmpty } from './pagination'

describe('clampPage', () => {
  it('página vazia além do fim → última página válida', () => {
    expect(clampPage(3, 41, 20, 0)).toBe(2)
    expect(clampPage(5, 20, 20, 0)).toBe(0)
  })
  it('não mexe quando a página tem linhas, é a primeira ou não há registros', () => {
    expect(clampPage(2, 41, 20, 1)).toBeNull()
    expect(clampPage(0, 41, 20, 0)).toBeNull()
    expect(clampPage(3, 0, 20, 0)).toBeNull()
  })
  it('sem count (erro 416) volta ao menos uma página por vez', () => {
    const r = pageOrEmpty({ data: null, error: { code: 'PGRST103' }, count: null }, 60)!
    expect(r).toEqual({ rows: [], total: 60 })
    expect(clampPage(3, r.total, 20, 0)).toBe(2)
  })
})

describe('isRangeError', () => {
  it('reconhece PGRST103 e 416', () => {
    expect(isRangeError({ code: 'PGRST103' })).toBe(true)
    expect(isRangeError({ status: 416 })).toBe(true)
    expect(isRangeError({ code: '42501' })).toBe(false)
    expect(isRangeError(null)).toBe(false)
  })
  it('pageOrEmpty ignora sucesso e outros erros', () => {
    expect(pageOrEmpty({ data: [], error: null, count: 0 }, 0)).toBeNull()
    expect(pageOrEmpty({ data: null, error: { code: '42501' }, count: null }, 0)).toBeNull()
  })
})
