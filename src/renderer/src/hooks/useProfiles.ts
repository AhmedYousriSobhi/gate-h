import { useEffect, useState } from 'react'
import type { Profile } from '../../../shared/types'

export function useProfiles(): {
  profiles: Profile[]
  activeProfileId: string | null
  activeProfile: Profile | null
  loading: boolean
  switchTo: (id: string) => void
  create: (name: string) => Promise<Profile>
  rename: (id: string, name: string) => Promise<void>
  remove: (id: string) => Promise<void>
  countClusters: (id: string) => Promise<number>
} {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function fetchProfiles(): Promise<{ list: Profile[]; activeId: string }> {
    const [list, activeId] = await Promise.all([
      window.api.profiles.list(),
      window.api.profiles.getActiveId()
    ])
    return { list, activeId }
  }

  async function refresh(): Promise<void> {
    const { list, activeId } = await fetchProfiles()
    setProfiles(list)
    setActiveProfileId(activeId)
    setLoading(false)
  }

  useEffect(() => {
    let cancelled = false
    fetchProfiles().then(({ list, activeId }) => {
      if (cancelled) return
      setProfiles(list)
      setActiveProfileId(activeId)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  function switchTo(id: string): void {
    window.api.profiles.setActiveId(id)
    setActiveProfileId(id)
  }

  async function create(name: string): Promise<Profile> {
    const created = await window.api.profiles.create(name)
    await refresh()
    return created
  }

  async function rename(id: string, name: string): Promise<void> {
    await window.api.profiles.rename(id, name)
    await refresh()
  }

  async function remove(id: string): Promise<void> {
    await window.api.profiles.remove(id)
    await refresh()
  }

  function countClusters(id: string): Promise<number> {
    return window.api.profiles.countClusters(id)
  }

  return {
    profiles,
    activeProfileId,
    activeProfile: profiles.find((p) => p.id === activeProfileId) ?? null,
    loading,
    switchTo,
    create,
    rename,
    remove,
    countClusters
  }
}
