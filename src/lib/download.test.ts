import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadBlob } from './download'

// Fake timers + stubs de URL.createObjectURL/revokeObjectURL: o download deve
// criar a URL do Blob com o mime informado, clicar num <a download> com o nome
// e só então revogar a URL.
describe('downloadBlob', () => {
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  let createObjectURL: ReturnType<typeof vi.fn>
  let revokeObjectURL: ReturnType<typeof vi.fn>
  let clickedName: string | null
  let clickedHref: string | null

  beforeEach(() => {
    vi.useFakeTimers()
    clickedName = null
    clickedHref = null
    createObjectURL = vi.fn(() => 'blob:jurisflow')
    revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURL })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clickedName = this.download
      clickedHref = this.getAttribute('href')
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: originalCreate })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: originalRevoke })
  })

  it('cria a URL do Blob com o mime, clica no <a download> com o nome e revoga depois', async () => {
    const content = 'Nome;Idade\r\nAna;30\r\n'
    downloadBlob('clientes.csv', content, 'text/csv;charset=utf-8')

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('text/csv;charset=utf-8')
    expect(await blob.text()).toBe(content)

    expect(clickedName).toBe('clientes.csv')
    expect(clickedHref).toBe('blob:jurisflow')
    expect(revokeObjectURL).not.toHaveBeenCalled()

    vi.runAllTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:jurisflow')
  })

  it('aceita um Blob como conteúdo e mantém o mime e o nome informados', async () => {
    const content = new Blob([JSON.stringify({ ok: true })], { type: 'text/plain' })
    downloadBlob('dados.json', content, 'application/json;charset=utf-8')

    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toBe('application/json;charset=utf-8')
    expect(await blob.text()).toBe('{"ok":true}')
    expect(clickedName).toBe('dados.json')

    vi.runAllTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:jurisflow')
  })
})
