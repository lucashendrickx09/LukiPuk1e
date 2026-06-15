/* ============================================================================
 *  sync.ts — optional Supabase-backed cross-device sync (low-level helpers).
 * ----------------------------------------------------------------------------
 *  Sync is OFF unless both env vars are set (VITE_SUPABASE_URL +
 *  VITE_SUPABASE_ANON_KEY). Without them the app is local-only and these
 *  helpers no-op. The Supabase client is loaded lazily (dynamic import) so it
 *  only ships to users who actually turn sync on. See README → "Set up sync".
 * ========================================================================== */

import type { SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

/** Table holding one JSON document per "space" (passphrase-derived id). */
export const SYNC_TABLE = 'study_calendar_state'

export function isSyncConfigured(): boolean {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY)
}

let clientPromise: Promise<SupabaseClient | null> | null = null

/** Lazily create (and cache) the Supabase client, or null if not configured. */
export function getClient(): Promise<SupabaseClient | null> {
  if (!isSyncConfigured()) return Promise.resolve(null)
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    )
  }
  return clientPromise
}

/**
 * Derive the document id from a passphrase (SHA-256 hex) so the raw phrase is
 * never the literal row key. Same passphrase on two devices → same id → same
 * shared document.
 */
export async function spaceId(passphrase: string): Promise<string> {
  const bytes = new TextEncoder().encode('study-calendar:v1:' + passphrase.trim())
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
