import type { ReactNode } from 'react'
import { BellRing, CalendarCheck2, KanbanSquare, ShieldCheck, Sparkles, Wallet } from 'lucide-react'
import { LogoMark } from '@/components/ui'

const FEATURES = [
  { icon: KanbanSquare, title: 'Fluxos em Kanban', text: 'Cada tipo de demanda com suas etapas.' },
  { icon: CalendarCheck2, title: 'Agenda unificada', text: 'Tarefas, próximas ações e parcelas.' },
  { icon: Wallet, title: 'Honorários sob controle', text: 'Contratos, parcelas e recebimentos.' },
  { icon: Sparkles, title: 'Assistente de IA', text: 'Consulta só dados autorizados e pede confirmação.' },
]

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-surface lg:grid-cols-[1fr_1.05fr]">
      <div className="bg-hero relative hidden overflow-hidden p-10 text-navy-100 lg:flex lg:flex-col lg:justify-between xl:p-14">
        <div className="bg-dots pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_70%)]" aria-hidden />

        <div className="relative flex items-center gap-2.5">
          <LogoMark className="size-9" />
          <span className="text-[17px] font-semibold tracking-tight text-white">
            JurisFlow <span className="font-medium text-accent-200">AI</span>
          </span>
        </div>

        <div className="relative max-w-lg">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[12px] font-medium text-accent-100 ring-1 ring-inset ring-white/15">
            <BellRing className="size-3.5" aria-hidden /> Seu escritório organizado, todo dia às 7h
          </span>
          <p className="mt-5 text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] text-white xl:text-[36px]">
            Clientes, demandas, prazos e honorários{' '}
            <span className="bg-gradient-to-r from-accent-200 to-white bg-clip-text text-transparent">em um só lugar.</span>
          </p>

          <ul className="mt-8 grid grid-cols-2 gap-3">
            {FEATURES.map(({ icon: Icon, title: t, text }) => (
              <li key={t} className="rounded-xl bg-white/[0.06] p-3.5 ring-1 ring-inset ring-white/10 backdrop-blur-sm">
                <span className="flex size-8 items-center justify-center rounded-lg bg-accent-500/20 text-accent-200">
                  <Icon className="size-4" aria-hidden />
                </span>
                <p className="mt-2.5 text-[13.5px] font-semibold text-white">{t}</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-navy-200">{text}</p>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative flex items-start gap-2 text-[12px] text-navy-300">
          <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden />
          Ferramenta de organização administrativa. Não substitui o controle oficial de prazos processuais.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center px-5 py-10">
        <div className="mb-8 flex items-center gap-2.5 lg:hidden">
          <LogoMark className="size-9" />
          <span className="text-[17px] font-semibold tracking-tight text-ink">
            JurisFlow <span className="font-medium text-accent-600">AI</span>
          </span>
        </div>
        <div className="animate-rise w-full max-w-[400px]">
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">{title}</h1>
          {subtitle && <p className="mt-1.5 text-[14px] text-ink-muted">{subtitle}</p>}
          <div className="mt-7">{children}</div>
          {footer && <div className="mt-7 text-center text-[13px] text-ink-muted">{footer}</div>}
        </div>
      </div>
    </div>
  )
}
