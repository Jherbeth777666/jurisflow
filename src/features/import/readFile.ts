// Leitura da planilha 100% no navegador. O arquivo não é enviado nem armazenado.
import { parseCSV } from '@/lib/csv'
import { toTable, type SheetTable } from './mapping'
import type { RawCell } from './normalize'

export const MAX_FILE_BYTES = 5 * 1024 * 1024
export const MAX_ROWS = 5000
export const ACCEPT = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export interface LoadedSheet {
  fileName: string
  sheetName: string | null
  table: SheetTable
}

export class SheetReadError extends Error {}

function toRawCell(v: unknown): RawCell {
  if (v === null || v === undefined) return null
  if (v instanceof Date || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  return String(v)
}

export async function readSpreadsheet(file: File): Promise<LoadedSheet> {
  const name = file.name.toLowerCase()
  if (file.size > MAX_FILE_BYTES) throw new SheetReadError('Arquivo maior que 5 MB. Divida a planilha em partes menores.')
  if (name.endsWith('.xls')) throw new SheetReadError('Formato .xls (Excel antigo) não suportado. No Excel, use "Salvar como" → .xlsx ou CSV.')

  let raw: RawCell[][]
  let sheetName: string | null = null
  if (name.endsWith('.xlsx')) {
    try {
      const { default: readXlsxFile } = await import('read-excel-file/browser')
      const sheets = await readXlsxFile(file)
      const sheet = sheets.find((s) => s.data.some((r) => r.some((c) => c !== null && c !== ''))) ?? sheets[0]
      if (!sheet) throw new SheetReadError('A planilha está vazia.')
      sheetName = sheet.sheet
      raw = sheet.data.map((r) => r.map((c) => toRawCell(c as unknown)))
    } catch (e) {
      if (e instanceof SheetReadError) throw e
      throw new SheetReadError('Não foi possível ler o arquivo .xlsx. Verifique se ele não está protegido por senha.')
    }
  } else if (name.endsWith('.csv') || name.endsWith('.txt') || file.type === 'text/csv') {
    raw = parseCSV(await file.arrayBuffer()).rows
  } else {
    throw new SheetReadError('Envie um arquivo .csv ou .xlsx.')
  }

  const table = toTable(raw)
  if (!table.rows.length) throw new SheetReadError('Nenhuma linha de dados encontrada na planilha.')
  if (table.rows.length > MAX_ROWS) {
    throw new SheetReadError(`A planilha tem ${table.rows.length.toLocaleString('pt-BR')} linhas; o limite é ${MAX_ROWS.toLocaleString('pt-BR')} por importação.`)
  }
  return { fileName: file.name, sheetName, table }
}

/** Modelo de planilha para baixar (cabeçalhos reconhecidos automaticamente). */
export const TEMPLATE_ROWS: string[][] = [
  ['Nome completo', 'CPF', 'Telefone', 'E-mail', 'Data de nascimento', 'Endereço', 'Tipo de demanda', 'Situação', 'Observações'],
  ['(exemplo — apague esta linha) Nome da Cliente', '000.000.000-00', '(00) 90000-0000', 'cliente@exemplo.com', '31/12/1990', 'Rua, número, bairro, cidade', 'Salário-maternidade', 'Ativo', ''],
]
