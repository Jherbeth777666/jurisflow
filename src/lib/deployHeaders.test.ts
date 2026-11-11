/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const toml = readFileSync(resolve(process.cwd(), 'netlify.toml'), 'utf8')

/** Lê `Chave = "valor"` do TOML (os cabeçalhos ficam no bloco [[headers]] for = "/*"). */
function headerValues(source: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9-]+)\s*=\s*"([^"]*)"\s*$/)
    if (match) values[match[1]] = match[2]
  }
  return values
}

function cspDirectives(csp: string): Map<string, string[]> {
  const directives = new Map<string, string[]>()
  for (const part of csp.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) continue
    directives.set(tokens[0], tokens.slice(1))
  }
  return directives
}

const headers = headerValues(toml)

describe('cabeçalhos de segurança do deploy (netlify.toml)', () => {
  it('mantém os cabeçalhos existentes e acrescenta HSTS', () => {
    expect(headers['X-Frame-Options']).toBe('DENY')
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=()')
    expect(headers['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains')
  })

  it('define a CSP com exatamente as diretivas previstas', () => {
    const csp = headers['Content-Security-Policy'] ?? ''
    expect(csp).not.toBe('')

    const directives = cspDirectives(csp)
    expect(directives.get('default-src')).toEqual(["'self'"])
    expect(directives.get('script-src')).toEqual(["'self'"])
    expect(directives.get('style-src')).toEqual(["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'])
    expect(directives.get('font-src')).toEqual(["'self'", 'https://fonts.gstatic.com', 'data:'])
    expect(directives.get('img-src')).toEqual(["'self'", 'data:', 'blob:'])
    expect(directives.get('connect-src')).toEqual(["'self'", 'https://*.supabase.co', 'wss://*.supabase.co'])
    expect(directives.get('frame-ancestors')).toEqual(["'none'"])
    expect(directives.get('base-uri')).toEqual(["'self'"])
    expect(directives.get('form-action')).toEqual(["'self'"])
    expect(directives.get('object-src')).toEqual(["'none'"])
  })

  it('script-src não permite eval nem script inline e connect-src alcança o Supabase', () => {
    const scriptSrc = cspDirectives(headers['Content-Security-Policy'] ?? '').get('script-src') ?? []
    expect(scriptSrc).toContain("'self'")
    expect(scriptSrc).not.toContain("'unsafe-eval'")
    expect(scriptSrc).not.toContain("'unsafe-inline'")

    const connectSrc = cspDirectives(headers['Content-Security-Policy'] ?? '').get('connect-src') ?? []
    expect(connectSrc).toContain('https://*.supabase.co')
    expect(connectSrc).toContain('wss://*.supabase.co')
  })
})
