import type { BlockStates } from './schedule'

// Per-block state (done / rescheduled), keyed by origin block id.
const STATES_KEY = 'study-calendar:blockstate:v1'
// Old completion-only store (a Set of completed ids) — migrated once if present.
const LEGACY_COMPLETED_KEY = 'study-calendar:completed:v1'

export function loadStates(): BlockStates {
  try {
    const raw = localStorage.getItem(STATES_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as BlockStates
      }
      return {}
    }

    // One-time migration: turn the old completed-id array into done flags.
    const legacy = localStorage.getItem(LEGACY_COMPLETED_KEY)
    if (legacy) {
      const arr: unknown = JSON.parse(legacy)
      if (Array.isArray(arr)) {
        const states: BlockStates = {}
        for (const id of arr) if (typeof id === 'string') states[id] = { done: true }
        return states
      }
    }
    return {}
  } catch {
    return {}
  }
}

export function saveStates(states: BlockStates): void {
  try {
    localStorage.setItem(STATES_KEY, JSON.stringify(states))
  } catch {
    // Storage can be unavailable (private mode / quota) — fail silently.
  }
}
