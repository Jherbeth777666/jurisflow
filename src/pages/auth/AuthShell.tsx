import type { ReactNode } from 'react'

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <div className="hidden flex-col justify-between bg-navy-900 p-10 text-navy-100 lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-md bg-accent-600 text-white">
            <svg viewBox="0 0 32 32" className="size-4" aria-hidden>
              <path d="M8 7h16M16 7v18M10 25h12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
            </svg>
          </span>
          <span className="text-[16px] font-semibold text-white">
            JurisFlow <span className="font-normal text-navy-300">AI</span>
          </span>
        </div>
        <div className="max-w-md">
          <p className="text-[26px] font-semibold leading-snug tracking-tight text-white">
            Clientes, demandas, prazos e honorários do escritório em um só lugar.
          </p>
          <ul className="mt-6 space-y-2.5 text-[14px] text-navy-200">
            <li>— Fluxos de trabalho por tipo de demanda, em Kanban</li>
            <li>— Tarefas com alertas de vencimento</li>
            <li>— Controle de contratos, parcelas e recebimentos</li>
            <li>— Assistente de IA que consulta apenas dados autorizados</li>
          </ul>
        </div>
        <p className="text-[12px] text-navy-400">Ferramenta de organização administrativa. Não substitui o controle oficial de prazos processuais.</p>
      </div>
      <div className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-[380px]">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="mt-1 text-[13.5px] text-ink-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
          {footer && <div className="mt-6 text-center text-[13px] text-ink-muted">{footer}</div>}
        </div>
      </div>
    </div>
  )
}
