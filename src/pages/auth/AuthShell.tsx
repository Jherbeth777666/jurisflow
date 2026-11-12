import type { ReactNode } from 'react'
import { CalendarCheck2, KanbanSquare, ShieldCheck, Sparkles, Wallet } from 'lucide-react'
import { LogoMark } from '@/components/ui'

const FEATURES = [
  { icon: KanbanSquare, title: 'Fluxos em Kanban', text: 'Cada tipo de demanda com suas próprias etapas.' },
  { icon: CalendarCheck2, title: 'Agenda unificada', text: 'Tarefas, próximas ações e parcelas no mesmo lugar.' },
  { icon: Wallet, title: 'Honorários sob controle', text: 'Contratos, parcelas e recebimentos.' },
  { icon: Sparkles, title: 'Assistente de IA', text: 'Consulta só dados autorizados e pede sua confirmação.' },
]

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-canvas lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="relative hidden overflow-hidden bg-navy-950 p-10 text-navy-100 lg:flex lg:flex-col lg:justify-between xl:p-14">
        {/* pauta discreta, como papel de livro-razão */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60 [background-image:repeating-linear-gradient(0deg,rgb(255_255_255/0.035)_0,rgb(255_255_255/0.035)_1px,transparent_1px,transparent_32px)] [mask-image:linear-gradient(to_bottom,transparent,black_30%,black_70%,transparent)]"
        />

        <div className="relative flex items-center gap-2.5">
          <LogoMark className="size-8 bg-white text-navy-950" />
          <span className="text-title font-semibold tracking-[-0.01em] text-white">
            JurisFlow <span className="font-medium text-navy-300">AI</span>
          </span>
        </div>

        <div className="relative max-w-md">
          <p className="eyebrow !text-navy-300">Gestão para escritórios de advocacia</p>
          <p className="mt-4 text-[34px] font-semibold leading-[1.12] tracking-[-0.03em] text-white">
            A rotina do escritório, organizada e sob controle.
          </p>
          <p className="mt-4 text-body-lg text-navy-200">
            Clientes, demandas, prazos internos e honorários em um só lugar, com a equipe vendo a mesma informação.
          </p>

          <ul className="mt-10 divide-y divide-white/10 border-y border-white/10">
            {FEATURES.map(({ icon: Icon, title: t, text }) => (
              <li key={t} className="flex items-start gap-3.5 py-3.5">
                <Icon className="mt-0.5 size-[18px] shrink-0 text-accent-200" strokeWidth={1.8} aria-hidden />
                <span>
                  <span className="block text-body font-medium text-white">{t}</span>
                  <span className="block text-label text-navy-300">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative flex items-start gap-2 text-caption text-navy-300">
          <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden />
          Dados isolados por escritório. Ferramenta de organização administrativa: não substitui o controle oficial de
          prazos processuais.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center px-5 py-10 sm:px-10">
        <div className="mb-10 flex items-center gap-2.5 lg:hidden">
          <LogoMark className="size-8" />
          <span className="text-title font-semibold tracking-[-0.01em] text-ink">
            JurisFlow <span className="font-medium text-ink-subtle">AI</span>
          </span>
        </div>
        <div className="w-full max-w-[400px] animate-rise rounded-[var(--radius-dialog)] bg-surface p-6 shadow-[var(--shadow-lift)] sm:p-8">
          <h1 className="text-heading font-semibold tracking-[-0.025em] text-ink">{title}</h1>
          {subtitle && <p className="mt-1.5 text-body text-ink-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-6 text-center text-body-sm text-ink-muted">{footer}</div>}
      </div>
    </div>
  )
}
