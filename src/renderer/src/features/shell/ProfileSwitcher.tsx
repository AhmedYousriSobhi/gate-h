import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react'
import type { Profile } from '../../../../shared/types'
import type { useProfiles } from '../../hooks/useProfiles'

interface ProfileSwitcherProps {
  profilesState: ReturnType<typeof useProfiles>
  onProfileChanged: () => void
}

export default function ProfileSwitcher({
  profilesState,
  onProfileChanged
}: ProfileSwitcherProps): React.JSX.Element {
  const {
    profiles,
    activeProfileId,
    activeProfile,
    switchTo,
    create,
    rename,
    remove,
    countClusters
  } = profilesState
  const [open, setOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [newProfileName, setNewProfileName] = useState('')
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setRenamingId(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  function handleSwitch(profile: Profile): void {
    if (profile.id !== activeProfileId) {
      switchTo(profile.id)
      onProfileChanged()
    }
    setOpen(false)
  }

  async function handleCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const name = newProfileName.trim()
    if (!name) return
    const created = await create(name)
    setNewProfileName('')
    switchTo(created.id)
    onProfileChanged()
    setOpen(false)
  }

  function startRename(profile: Profile, e: React.MouseEvent): void {
    e.stopPropagation()
    setRenamingId(profile.id)
    setRenameValue(profile.name)
  }

  async function commitRename(id: string): Promise<void> {
    const name = renameValue.trim()
    setRenamingId(null)
    if (name) await rename(id, name)
  }

  async function handleRemove(profile: Profile, e: React.MouseEvent): Promise<void> {
    e.stopPropagation()
    if (profiles.length <= 1) {
      alert('You need at least one profile - create another before deleting this one.')
      return
    }
    const clusterCount = await countClusters(profile.id)
    const warning =
      clusterCount > 0
        ? `Delete profile "${profile.name}"? This also permanently removes its ${clusterCount} cluster${clusterCount === 1 ? '' : 's'}.`
        : `Delete profile "${profile.name}"?`
    if (!confirm(warning)) return
    await remove(profile.id)
    if (profile.id === activeProfileId) onProfileChanged()
  }

  return (
    <div className="profile-switcher" ref={containerRef}>
      <button className="profile-switcher-trigger" onClick={() => setOpen((v) => !v)}>
        <span className="profile-switcher-name">{activeProfile?.name ?? 'Loading...'}</span>
        <ChevronDown size={13} strokeWidth={2} />
      </button>

      {open && (
        <div className="profile-panel">
          <div className="profile-panel-header">Profiles</div>
          <div className="profile-list">
            {profiles.map((profile) => (
              <div
                key={profile.id}
                className={`profile-row${profile.id === activeProfileId ? ' profile-row-active' : ''}`}
                onClick={() => handleSwitch(profile)}
              >
                {renamingId === profile.id ? (
                  <input
                    autoFocus
                    className="profile-rename-input"
                    value={renameValue}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(profile.id)
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    onBlur={() => commitRename(profile.id)}
                  />
                ) : (
                  <>
                    <span className="profile-row-check">
                      {profile.id === activeProfileId && <Check size={13} strokeWidth={2.5} />}
                    </span>
                    <span className="profile-row-name">{profile.name}</span>
                    <div className="profile-row-actions">
                      <button
                        className="icon-btn"
                        title="Rename"
                        onClick={(e) => startRename(profile, e)}
                      >
                        <Pencil size={12} strokeWidth={2} />
                      </button>
                      <button
                        className="icon-btn icon-btn-danger"
                        title="Delete profile"
                        onClick={(e) => handleRemove(profile, e)}
                      >
                        <Trash2 size={12} strokeWidth={2} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          <form className="profile-create-form" onSubmit={handleCreate}>
            <input
              placeholder="New profile name"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
            />
            <button type="submit" className="icon-btn" title="Add profile">
              <Plus size={14} strokeWidth={2.5} />
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
