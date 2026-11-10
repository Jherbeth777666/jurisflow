import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { isSupabaseConfigured } from '@/lib/supabase'
import { AppLayout } from '@/components/layout/AppLayout'
import { Spinner, ErrorState } from '@/components/ui'

// Telas de acesso também sob demanda: quem já está logado não baixa login/cadastro.
const LoginPage = lazy(() => import('@/pages/auth/LoginPage').then((x) => ({ default: x.LoginPage })))
const SignupPage = lazy(() => import('@/pages/auth/SignupPage').then((x) => ({ default: x.SignupPage })))
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage').then((x) => ({ default: x.ForgotPasswordPage })))
const ResetPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage').then((x) => ({ default: x.ResetPasswordPage })))
const OnboardingPage = lazy(() => import('@/pages/auth/OnboardingPage').then((x) => ({ default: x.OnboardingPage })))
const ChooseOrganizationPage = lazy(() => import('@/pages/auth/ChooseOrganizationPage').then((x) => ({ default: x.ChooseOrganizationPage })))

// Rotas carregadas sob demanda (code-splitting)
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage').then((x) => ({ default: x.DashboardPage })))
const ClientsPage = lazy(() => import('@/features/clients/ClientsPage').then((x) => ({ default: x.ClientsPage })))
const ClientDetailPage = lazy(() => import('@/features/clients/ClientDetailPage').then((x) => ({ default: x.ClientDetailPage })))
const DemandsPage = lazy(() => import('@/features/demands/DemandsPage').then((x) => ({ default: x.DemandsPage })))
const DemandDetailPage = lazy(() => import('@/features/demands/DemandDetailPage').then((x) => ({ default: x.DemandDetailPage })))
const WorkflowsPage = lazy(() => import('@/features/workflows/WorkflowsPage').then((x) => ({ default: x.WorkflowsPage })))
const TasksPage = lazy(() => import('@/features/tasks/TasksPage').then((x) => ({ default: x.TasksPage })))
const ContractsPage = lazy(() => import('@/features/contracts/ContractsPage').then((x) => ({ default: x.ContractsPage })))
const ContractDetailPage = lazy(() => import('@/features/contracts/ContractDetailPage').then((x) => ({ default: x.ContractDetailPage })))
const AssistantPage = lazy(() => import('@/features/assistant/AssistantPage').then((x) => ({ default: x.AssistantPage })))
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage').then((x) => ({ default: x.ReportsPage })))
const MessagesPage = lazy(() => import('@/features/messages/MessagesPage').then((x) => ({ default: x.MessagesPage })))
const ImportPage = lazy(() => import('@/features/import/ImportPage').then((x) => ({ default: x.ImportPage })))
const QualityPage = lazy(() => import('@/features/data-quality/QualityPage').then((x) => ({ default: x.QualityPage })))
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage').then((x) => ({ default: x.SettingsPage })))

function ConfigMissing() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-md rounded-xl bg-surface p-6 shadow-[var(--shadow-card)]">
        <h1 className="text-[16px] font-semibold">Configuração necessária</h1>
        <p className="mt-2 text-[13.5px] text-ink-muted">
          Defina <code className="rounded bg-canvas px-1">VITE_SUPABASE_URL</code> e <code className="rounded bg-canvas px-1">VITE_SUPABASE_ANON_KEY</code>{' '}
          em <code className="rounded bg-canvas px-1">.env.local</code> (veja <code>.env.example</code> e o README).
        </p>
      </div>
    </div>
  )
}

export default function App() {
  const { session, loading, organization, memberships, error, refresh } = useAuth()

  if (!isSupabaseConfigured) return <ConfigMissing />
  if (loading) return <Spinner className="min-h-dvh" label="Carregando JurisFlow…" />

  const page = <Spinner className="min-h-dvh" />

  if (!session) {
    return (
      <Suspense fallback={page}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/cadastro" element={<SignupPage />} />
        <Route path="/recuperar-senha" element={<ForgotPasswordPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
      </Suspense>
    )
  }

  if (error && !organization) return <ErrorState className="min-h-dvh" message={error} onRetry={refresh} />

  if (!organization) {
    return (
      <Suspense fallback={page}>
      <Routes>
        <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
        <Route path="*" element={memberships.length > 1 ? <ChooseOrganizationPage /> : <OnboardingPage />} />
      </Routes>
      </Suspense>
    )
  }

  return (
    <Routes>
      <Route
        path="/redefinir-senha"
        element={
          <Suspense fallback={page}>
            <ResetPasswordPage />
          </Suspense>
        }
      />
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="clientes" element={<ClientsPage />} />
        <Route path="clientes/:id" element={<ClientDetailPage />} />
        <Route path="demandas" element={<DemandsPage />} />
        <Route path="demandas/:id" element={<DemandDetailPage />} />
        <Route path="fluxos" element={<WorkflowsPage />} />
        <Route path="tarefas" element={<TasksPage />} />
        <Route path="contratos" element={<ContractsPage />} />
        <Route path="contratos/:id" element={<ContractDetailPage />} />
        <Route path="assistente" element={<AssistantPage />} />
        <Route path="relatorios" element={<ReportsPage />} />
        <Route path="mensagens" element={<MessagesPage />} />
        <Route path="importar" element={<ImportPage />} />
        <Route path="qualidade" element={<QualityPage />} />
        <Route path="configuracoes" element={<SettingsPage />} />
      </Route>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/cadastro" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
