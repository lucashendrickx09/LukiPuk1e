import { useCallback, useEffect, useRef, useState } from 'react'
import type { BlockStates } from './schedule'
import { getClient, isSyncConfigured, spaceId, SYNC_TABLE } from './sync'

const PASS_KEY = 'study-calendar:sync-pass:v1'

export type SyncState = 'idle' | 'connecting' | 'connected' | 'error'

export interface SyncInfo {
  /** Whether Supabase env vars are present at all. */
  configured: boolean
  state: SyncState
  error?: string
  /** The active passphrase (also the link between devices). */
  passphrase: string | null
  /** Timestamp of the last successful sync, for the UI. */
  lastSyncAt: number | null
  connect: (passphrase: string) => void
  disconnect: () => void
}

interface Row {
  data: BlockStates
  updated_at: string
}

/**
 * Cross-device sync of the block-state document.
 *
 * Strategy: last-writer-wins on the whole document, arbitrated by the server's
 * `updated_at`. Local edits are pushed (debounced); remote edits arrive via
 * Postgres realtime and, as a fallback, a pull on tab focus + a light interval.
 * Single-user + sequential device use means conflicts are effectively absent.
 */
export function useSync(states: BlockStates, applyRemote: (s: BlockStates) => void): SyncInfo {
  const [state, setState] = useState<SyncState>('idle')
  const [error, setError] = useState<string | undefined>()
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [passphrase, setPassphrase] = useState<string | null>(() => {
    try {
      return localStorage.getItem(PASS_KEY)
    } catch {
      return null
    }
  })

  // Refs so callbacks stay stable yet see the latest values.
  const statesRef = useRef(states)
  const applyRef = useRef(applyRemote)
  useEffect(() => {
    statesRef.current = states
  }, [states])
  useEffect(() => {
    applyRef.current = applyRemote
  }, [applyRemote])

  const idRef = useRef<string | null>(null)
  const lastSyncedAtRef = useRef(0) // server updated_at (ms) we're in sync with
  const skipNextPushRef = useRef<string | null>(null) // json we just adopted/seeded
  const teardownRef = useRef<() => void>(() => {})

  const markSynced = useCallback((updatedAt: string, adoptedJson: string) => {
    lastSyncedAtRef.current = Date.parse(updatedAt)
    skipNextPushRef.current = adoptedJson
    setLastSyncAt(Date.now())
  }, [])

  const doPush = useCallback(async (data: BlockStates) => {
    const client = await getClient()
    if (!client || !idRef.current) return
    const { data: r, error: e } = await client
      .from(SYNC_TABLE)
      .upsert({ id: idRef.current, data })
      .select('updated_at')
      .single()
    if (e) {
      setState('error')
      setError(e.message)
      return
    }
    if (r) {
      lastSyncedAtRef.current = Date.parse(r.updated_at)
      setLastSyncAt(Date.now())
    }
    setState('connected') // clear any transient error
    setError(undefined)
  }, [])

  // Apply a freshly-read row: adopt if newer, else push our newer local copy.
  const applyRow = useCallback(
    (row: Row) => {
      const at = Date.parse(row.updated_at)
      const remoteJson = JSON.stringify(row.data ?? {})
      if (at > lastSyncedAtRef.current) {
        markSynced(row.updated_at, remoteJson)
        applyRef.current((row.data ?? {}) as BlockStates)
      } else if (JSON.stringify(statesRef.current) !== remoteJson) {
        void doPush(statesRef.current)
      }
    },
    [doPush, markSynced],
  )

  const pull = useCallback(async () => {
    const client = await getClient()
    if (!client || !idRef.current) return
    const { data: row } = await client
      .from(SYNC_TABLE)
      .select('data, updated_at')
      .eq('id', idRef.current)
      .maybeSingle()
    if (row) applyRow(row as Row)
  }, [applyRow])

  const connect = useCallback(
    async (pass: string) => {
      if (!isSyncConfigured()) return
      const phrase = pass.trim()
      if (!phrase) return

      setState('connecting')
      setError(undefined)
      try {
        const client = await getClient()
        if (!client) throw new Error('Sync is not configured')

        const id = await spaceId(phrase)
        idRef.current = id
        try {
          localStorage.setItem(PASS_KEY, phrase)
        } catch {
          /* ignore */
        }
        setPassphrase(phrase)

        // Adopt the shared document if it exists, otherwise seed it from local.
        const { data: row, error: e } = await client
          .from(SYNC_TABLE)
          .select('data, updated_at')
          .eq('id', id)
          .maybeSingle()
        if (e) throw e

        if (row) {
          const r = row as Row
          markSynced(r.updated_at, JSON.stringify(r.data ?? {}))
          applyRef.current((r.data ?? {}) as BlockStates)
        } else {
          const local = statesRef.current
          const { data: ins, error: e2 } = await client
            .from(SYNC_TABLE)
            .upsert({ id, data: local })
            .select('updated_at')
            .single()
          if (e2) throw e2
          markSynced((ins as { updated_at: string }).updated_at, JSON.stringify(local))
        }

        // Realtime + focus/interval fallback.
        teardownRef.current()
        const channel = client
          .channel('sc-' + id)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: SYNC_TABLE, filter: `id=eq.${id}` },
            (payload) => {
              const r = payload.new as Row | undefined
              if (r?.data) applyRow(r)
            },
          )
          .subscribe()

        const onVisible = () => {
          if (document.visibilityState === 'visible') void pull()
        }
        document.addEventListener('visibilitychange', onVisible)
        window.addEventListener('focus', onVisible)
        const interval = window.setInterval(onVisible, 30000)

        teardownRef.current = () => {
          void client.removeChannel(channel)
          document.removeEventListener('visibilitychange', onVisible)
          window.removeEventListener('focus', onVisible)
          clearInterval(interval)
          teardownRef.current = () => {}
        }

        setLastSyncAt(Date.now())
        setState('connected')
      } catch (err) {
        setState('error')
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [applyRow, markSynced, pull],
  )

  const disconnect = useCallback(() => {
    teardownRef.current()
    idRef.current = null
    lastSyncedAtRef.current = 0
    try {
      localStorage.removeItem(PASS_KEY)
    } catch {
      /* ignore */
    }
    setPassphrase(null)
    setError(undefined)
    setState('idle')
  }, [])

  // Push local changes (debounced) while connected.
  useEffect(() => {
    if (state !== 'connected') return
    const json = JSON.stringify(states)
    if (skipNextPushRef.current !== null && json === skipNextPushRef.current) {
      skipNextPushRef.current = null
      return
    }
    const t = window.setTimeout(() => void doPush(states), 700)
    return () => clearTimeout(t)
  }, [states, state, doPush])

  // Auto-connect once on load if a passphrase was saved.
  const didInit = useRef(false)
  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    if (isSyncConfigured() && passphrase) void connect(passphrase)
  }, [passphrase, connect])

  // Tear down on unmount.
  useEffect(() => () => teardownRef.current(), [])

  return {
    configured: isSyncConfigured(),
    state,
    error,
    passphrase,
    lastSyncAt,
    connect,
    disconnect,
  }
}
