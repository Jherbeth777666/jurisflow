import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui'
import { isChunkLoadError } from '@/lib/chunkReload'

interface Props {
  children: ReactNode
  /** Muda a cada navegação: limpa o erro ao trocar de tela. */
  resetKey?: string
}

interface State {
  error: unknown
  key?: string
}

/** Evita a "tela branca": mostra aviso de nova versão ou erro genérico com ação. */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // Navegou para outra tela: limpa o erro anterior.
    if (props.resetKey !== state.key) return { error: null, key: props.resetKey }
    return null
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Erro ao exibir a tela', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const stale = isChunkLoadError(error)
    return (
      <div role="alert" className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className={stale ? 'mb-3 flex size-10 items-center justify-center rounded-lg bg-accent-50 text-accent-700' : 'mb-3 flex size-10 items-center justify-center rounded-lg bg-red-50 text-red-600'}>
          {stale ? <RefreshCw className="size-5" /> : <AlertTriangle className="size-5" />}
        </div>
        <p className="text-[14px] font-medium text-ink">{stale ? 'Nova versão disponível' : 'Algo deu errado ao abrir esta tela'}</p>
        <p className="mt-1 max-w-sm text-[13px] text-ink-muted">
          {stale
            ? 'O JurisFlow foi atualizado. Recarregue a página para continuar com a versão mais recente.'
            : 'Tente recarregar a página. Se o problema continuar, avise o administrador do escritório.'}
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="primary" size="sm" icon={<RefreshCw className="size-3.5" />} onClick={() => window.location.reload()}>
            Recarregar
          </Button>
          {!stale && (
            <Button size="sm" onClick={() => this.setState({ error: null })}>
              Tentar novamente
            </Button>
          )}
        </div>
      </div>
    )
  }
}
