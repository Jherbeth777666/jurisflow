// Ponto de extensão para RAG futuro — NÃO implementado nesta versão.
//
// Ideia: um ContextRetriever buscaria trechos de modelos de documentos/base de
// conhecimento do próprio escritório (com RLS por organization_id, ex.: tabela
// com pgvector) e os entregaria ao laço do assistente como uma ferramenta
// adicional da whitelist. Requisitos quando for implementado:
//   * busca sempre com o JWT do usuário (RLS) e limitada ao escritório da requisição;
//   * trechos passam por redact.ts e pseudonymize.ts antes do envio ao provedor;
//   * nada de documentos de clientes sem base legal/consentimento (LGPD).

export interface RetrievedChunk {
  sourceId: string
  title: string
  text: string
  score: number
}

export interface ContextRetriever {
  retrieve(query: string, opts: { orgId: string; limit: number }): Promise<RetrievedChunk[]>
}
