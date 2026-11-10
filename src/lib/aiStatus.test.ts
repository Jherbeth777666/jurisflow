import { aiNotConfiguredMessage } from './aiStatus'

describe('aiNotConfiguredMessage', () => {
  it('administrador recebe instrução de configuração', () => {
    expect(aiNotConfiguredMessage(true)).toMatch(/CONFIGURAR-IA|README/)
  })
  it('demais papéis só são orientados a avisar o administrador', () => {
    const m = aiNotConfiguredMessage(false)
    expect(m).toMatch(/indisponível no momento/)
    expect(m).toMatch(/administrador/)
    expect(m).not.toMatch(/README|CONFIGURAR/)
  })
})
