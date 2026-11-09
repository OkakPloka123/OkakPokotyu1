import type { ProviderInfo } from '../../../shared/types'
import { FolderIcon } from './Icons'

interface TopBarProps {
  workspace: string | null
  providers: ProviderInfo[]
  providerId: string
  onPickWorkspace(): void
  onProviderChange(providerId: string): void
}

export function TopBar({
  workspace,
  providers,
  providerId,
  onPickWorkspace,
  onProviderChange
}: TopBarProps): React.JSX.Element {
  const provider = providers.find((item) => item.id === providerId)
  return (
    <header className="topbar">
      <button
        className={workspace ? 'workspace' : 'workspace workspace-empty'}
        onClick={onPickWorkspace}
        title={
          workspace ? 'Сменить рабочую папку' : 'Агент сможет работать только внутри этой папки'
        }
      >
        <FolderIcon />
        <span className="workspace-path">{workspace ?? 'Выбрать рабочую папку'}</span>
      </button>
      <label className="provider" title={provider?.description}>
        <span className="muted">Агент</span>
        <select value={providerId} onChange={(event) => onProviderChange(event.target.value)}>
          {providers.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
    </header>
  )
}
