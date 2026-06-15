// Tiny localStorage wrapper for per-block completion. Values are block ids
// (see blockId() in plan.ts). Bump the version suffix to reset everyone's data.
const KEY = 'study-calendar:completed:v1'

export function loadCompleted(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? (parsed as string[]) : [])
  } catch {
    return new Set()
  }
}

export function saveCompleted(set: Set<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...set]))
  } catch {
    // Storage can be unavailable (private mode / quota) — completion is a
    // nice-to-have, so fail silently rather than break the app.
  }
}
