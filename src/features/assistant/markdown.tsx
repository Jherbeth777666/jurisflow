// Renderizador mínimo e seguro de markdown: o texto é convertido em elementos
// React (o React escapa todo o conteúdo) — sem dangerouslySetInnerHTML, sem
// links/imagens/HTML. Suporta: parágrafos com quebras, **negrito**, *itálico*,
// `código`, títulos (#), listas com - * • e numeradas, tabelas simples e ---.
import { Fragment, type ReactNode } from 'react'

export type Inline = { type: 'text' | 'bold' | 'italic' | 'code'; text: string }

export type Block =
  | { type: 'heading'; level: number; content: Inline[] }
  | { type: 'paragraph'; lines: Inline[][] }
  | { type: 'ul' | 'ol'; items: Inline[][]; start?: number }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { type: 'hr' }

const INLINE_RE = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|`[^`\n]+`|(?<![\w*])\*(?!\s)[^*\n]+?(?<!\s)\*(?!\w))/g

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0
    if (idx > last) out.push({ type: 'text', text: text.slice(last, idx) })
    const tok = m[0]
    if (tok.startsWith('**') || tok.startsWith('__')) out.push({ type: 'bold', text: tok.slice(2, -2) })
    else if (tok.startsWith('`')) out.push({ type: 'code', text: tok.slice(1, -1) })
    else out.push({ type: 'italic', text: tok.slice(1, -1) })
    last = idx + tok.length
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
  return out
}

const UL_RE = /^\s*[-*•]\s+(.*)$/
const OL_RE = /^\s*(\d{1,3})[.)]\s+(.*)$/
const HEADING_RE = /^(#{1,4})\s+(.*)$/
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
const HR_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => parseInline(c.trim()))

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const h = line.match(HEADING_RE)
    if (h) {
      blocks.push({ type: 'heading', level: h[1].length, content: parseInline(h[2].trim()) })
      i++
      continue
    }
    if (HR_RE.test(line)) {
      blocks.push({ type: 'hr' })
      i++
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const header = splitRow(line)
      const rows: Inline[][][] = []
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]))
        i++
      }
      blocks.push({ type: 'table', header, rows })
      continue
    }
    if (UL_RE.test(line)) {
      const items: Inline[][] = []
      while (i < lines.length && UL_RE.test(lines[i])) {
        items.push(parseInline(lines[i].match(UL_RE)![1]))
        i++
      }
      blocks.push({ type: 'ul', items })
      continue
    }
    if (OL_RE.test(line)) {
      const items: Inline[][] = []
      const start = Number(line.match(OL_RE)![1])
      while (i < lines.length && OL_RE.test(lines[i])) {
        items.push(parseInline(lines[i].match(OL_RE)![2]))
        i++
      }
      blocks.push({ type: 'ol', items, start })
      continue
    }
    const para: Inline[][] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !HEADING_RE.test(lines[i]) &&
      !UL_RE.test(lines[i]) &&
      !OL_RE.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]))
    ) {
      para.push(parseInline(lines[i].trim()))
      i++
    }
    blocks.push({ type: 'paragraph', lines: para })
  }
  return blocks
}

function renderInline(parts: Inline[]): ReactNode {
  return parts.map((p, i) => {
    switch (p.type) {
      case 'bold':
        return (
          <strong key={i} className="font-semibold text-ink">
            {p.text}
          </strong>
        )
      case 'italic':
        return <em key={i}>{p.text}</em>
      case 'code':
        return (
          <code key={i} className="rounded bg-navy-50 px-1 py-0.5 font-mono text-[12.5px]">
            {p.text}
          </code>
        )
      default:
        return <Fragment key={i}>{p.text}</Fragment>
    }
  })
}

export function Markdown({ text }: { text: string }) {
  const blocks = parseMarkdown(text)
  return (
    <div className="space-y-2.5 text-[13.5px] leading-relaxed text-ink">
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'heading':
            return (
              <p key={i} className={b.level <= 2 ? 'text-[14.5px] font-semibold' : 'text-[13.5px] font-semibold'}>
                {renderInline(b.content)}
              </p>
            )
          case 'hr':
            return <hr key={i} className="border-line" />
          case 'ul':
            return (
              <ul key={i} className="list-disc space-y-1 pl-5 marker:text-ink-subtle">
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </ul>
            )
          case 'ol':
            return (
              <ol key={i} start={b.start} className="list-decimal space-y-1 pl-5 marker:text-ink-subtle">
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </ol>
            )
          case 'table':
            return (
              <div key={i} className="overflow-x-auto rounded-md border border-line">
                <table className="w-full text-left text-[12.5px]">
                  <thead className="bg-canvas text-ink-muted">
                    <tr>
                      {b.header.map((c, j) => (
                        <th key={j} className="whitespace-nowrap px-2.5 py-1.5 font-medium">
                          {renderInline(c)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {r.map((c, k) => (
                          <td key={k} className="px-2.5 py-1.5 align-top">
                            {renderInline(c)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          default:
            return (
              <p key={i}>
                {b.lines.map((l, j) => (
                  <Fragment key={j}>
                    {j > 0 && <br />}
                    {renderInline(l)}
                  </Fragment>
                ))}
              </p>
            )
        }
      })}
    </div>
  )
}
