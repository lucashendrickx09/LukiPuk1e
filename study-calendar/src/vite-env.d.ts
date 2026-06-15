/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL — enables cross-device sync when set. */
  readonly VITE_SUPABASE_URL?: string
  /** Supabase public anon key (safe to ship). */
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
