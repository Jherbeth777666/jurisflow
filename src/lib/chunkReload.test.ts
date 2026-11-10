import { claimAutoReload, isChunkLoadError } from './chunkReload'

function memStore() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

describe('isChunkLoadError', () => {
  it('reconhece falhas de import dinâmico de diferentes navegadores', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/a.js'))).toBe(true)
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/x.css'))).toBe(true)
  })
  it('não confunde com erros comuns', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })
})

describe('claimAutoReload', () => {
  it('permite só 1 recarga por janela de tempo', () => {
    const s = memStore()
    expect(claimAutoReload(1_000_000, s)).toBe(true)
    expect(claimAutoReload(1_010_000, s)).toBe(false)
    expect(claimAutoReload(1_000_000 + 61_000, s)).toBe(true)
  })
  it('sem armazenamento não recarrega (evita laço)', () => {
    expect(claimAutoReload(1, null)).toBe(false)
    const broken = { getItem: () => { throw new Error('x') }, setItem: () => {} }
    expect(claimAutoReload(1, broken)).toBe(false)
  })
})
