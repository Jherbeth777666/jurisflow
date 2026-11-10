import { useSearchParams } from 'react-router-dom'
import { PageHeader, Tabs } from '@/components/ui'
import { ProfileTab } from './ProfileTab'
import { OrganizationTab } from './OrganizationTab'
import { TeamTab } from './TeamTab'
import { PrivacyTab } from './PrivacyTab'
import { SETTINGS_TABS, parseTab, type SettingsTab } from './logic'

export function SettingsPage() {
  const [params, setParams] = useSearchParams()
  const tab = parseTab(params.get('aba'))
  const change = (t: SettingsTab) => setParams(t === 'perfil' ? {} : { aba: t }, { replace: true })

  return (
    <div>
      <PageHeader title="Configurações" description="Perfil, escritório, equipe e privacidade." />
      <Tabs value={tab} onChange={change} items={SETTINGS_TABS} className="mb-4 overflow-x-auto" />
      {tab === 'perfil' && <ProfileTab />}
      {tab === 'escritorio' && <OrganizationTab />}
      {tab === 'equipe' && <TeamTab />}
      {tab === 'privacidade' && <PrivacyTab />}
    </div>
  )
}
