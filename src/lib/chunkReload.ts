// Recuperação de falhas ao carregar partes do app (chunks) após um novo deploy.
// Depois de publicar, os arquivos antigos de /assets deixam de existir; uma aba aberta
// com a versão anterior falha ao abrir uma tela nova. Recarregamos a página UMA vez
// (controle em sessionStorage) para buscar a versão nova; se falhar de novo, a tela de
// erro oferece o botão "Recarregar".

const RELOAD_KEY = 'jurisflow.chunkReloadAt'
/** Janela em que não recarregamos de novo automaticamente (evita laço). */
const RELOAD_WINDOW_MS = 60_000

/** true quando o erro parece ser falha ao baixar um módulo do app (versão desatualizada). */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false
  const e = error as { name?: string; message?: string }
  const msg = `${e.name ?? ''} ${e.message ?? String(error)}`
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Unable to preload CSS|Loading chunk .* failed|is not a valid JavaScript MIME type/i.test(
    msg,
  )
}

interface StorageLike {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
}

function storage(): StorageLike | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/**
 * Registra a tentativa e diz se podemos recarregar automaticamente agora.
 * Sem sessionStorage disponível, não recarrega (evita laço infinito).
 */
export function claimAutoReload(now = Date.now(), store: StorageLike | null = storage()): boolean {
  if (!store) return false
  try {
    const last = Number(store.getItem(RELOAD_KEY) ?? 0)
    if (last && now - last < RELOAD_WINDOW_MS) return false
    store.setItem(RELOAD_KEY, String(now))
    return true
  } catch {
    return false
  }
}

/** Liga o recarregamento automático (no máximo 1 vez por janela) ao evento do Vite. */
export function installPreloadErrorHandler() {
  if (typeof window === 'undefined') return
  window.addEventListener('vite:preloadError', (event) => {
    if (claimAutoReload()) {
      event.preventDefault()
      window.location.reload()
    }
    // Sem recarregar: o erro segue e a ErrorBoundary mostra "Nova versão disponível".
  })
}
