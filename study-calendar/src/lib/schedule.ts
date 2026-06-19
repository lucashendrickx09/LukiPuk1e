/* ============================================================================
 *  schedule.ts — the live schedule layer.
 * ----------------------------------------------------------------------------
 *  plan.ts is the immutable seed. This module merges it with the user's saved
 *  per-block state (done / rescheduled) so tasks can be approved complete or
 *  moved to another day. A rescheduled block keeps its ORIGIN id (the static
 *  "iso#index"), so it has a stable identity no matter where it currently lives.
 * ========================================================================== */

import { blockId, PLAN, visibleBlocks } from '../plan'
import type { DayPlan, StudyBlock, SubjectCode } from '../plan'
import { planDays } from './dates'

/** Saved state for one block, keyed by its origin id. Absent = pending. */
export interface BlockState {
  /** Approved complete. */
  done?: boolean
  /** ISO date the block was rescheduled to (origin day is unchanged). */
  movedTo?: string
}

export type BlockStates = Record<string, BlockState>

/** A block placed on a day, with its live status resolved. */
export interface ResolvedBlock {
  block: StudyBlock
  /** Origin id "YYYY-MM-DD#index" — stable across reschedules. */
  id: string
  /** The day this block was originally scheduled. */
  originIso: string
  done: boolean
  /** Current scheduled day, when moved away from its origin. */
  movedTo?: string
  /** True when shown on a day other than its origin (rescheduled in). */
  incoming: boolean
}

export interface DayResolution {
  /** Blocks that currently live on this day (native + rescheduled in). */
  active: ResolvedBlock[]
  /** Native blocks that have been rescheduled to another day. */
  movedAway: ResolvedBlock[]
}

/**
 * Resolve the whole plan window into per-day active / moved-away blocks.
 * Built once per state change and shared by the grid, modal and progress.
 */
export function resolveSchedule(states: BlockStates): Map<string, DayResolution> {
  const days = planDays()
  const map = new Map<string, DayResolution>()
  for (const iso of days) map.set(iso, { active: [], movedAway: [] })

  // Native blocks: each either stays put or is parked in movedAway.
  for (const iso of days) {
    const res = map.get(iso)!
    visibleBlocks(PLAN[iso]).forEach((block, i) => {
      const id = blockId(iso, i)
      const st = states[id]
      const movedTo = st?.movedTo && st.movedTo !== iso ? st.movedTo : undefined
      const resolved: ResolvedBlock = {
        block,
        id,
        originIso: iso,
        done: !!st?.done,
        movedTo,
        incoming: false,
      }
      if (movedTo) res.movedAway.push(resolved)
      else res.active.push(resolved)
    })
  }

  // Place moved blocks onto their target day as "incoming".
  for (const res of map.values()) {
    for (const moved of res.movedAway) {
      const target = moved.movedTo ? map.get(moved.movedTo) : undefined
      if (target) {
        target.active.push({ ...moved, incoming: true })
      }
      // If the target is somehow outside the window the block just isn't shown;
      // the reschedule picker constrains choices to the window so this is rare.
    }
  }

  return map
}

/** Distinct subjects currently on a day → the cell's colored dots. */
export function subjectsForDay(res: DayResolution | undefined): SubjectCode[] {
  if (!res) return []
  return [...new Set(res.active.map((r) => r.block.subject))]
}

/** Legend colours for the completion states. */
export const DONE_COLOR = '#3fb950'
export const MISSED_COLOR = '#f85149'

/**
 * Background/border for a day cell. Completion status wins over the day-type
 * tint so done/missed days stand out:
 *   • every task done            → green
 *   • day is in the past, tasks left → red ("finished without finishing")
 * Otherwise the rest / holiday / visitor tint (or none).
 */
export function cellTint(
  plan: DayPlan | undefined,
  res: DayResolution | undefined,
  iso: string,
  todayIso: string,
): { background?: string; borderColor?: string } {
  const active = res?.active ?? []
  if (active.length > 0) {
    if (active.every((a) => a.done)) {
      return { background: 'rgba(63,185,80,0.18)', borderColor: 'rgba(63,185,80,0.55)' }
    }
    if (iso < todayIso) {
      // ISO date strings compare chronologically → strictly before today = past
      return { background: 'rgba(248,81,73,0.2)', borderColor: 'rgba(248,81,73,0.55)' }
    }
  }
  if (plan?.holiday) return { background: 'rgba(232,179,57,0.07)', borderColor: 'rgba(232,179,57,0.35)' }
  if (plan?.visitor) return { background: 'rgba(154,108,240,0.07)' }
  if (plan?.rest) return { background: 'rgba(45,140,107,0.08)' }
  return {}
}

export interface DayRecommendation {
  iso: string
  /** Short human reason, e.g. "No other tasks" or "Same subject". */
  reason: string
}

/**
 * Suggest the best days to move a block to. Lower score = better:
 * favours soon, lightly-loaded days; nudges toward days already studying the
 * same subject; avoids the past, visitor days, and skips rest/holiday days.
 * These are suggestions only — the UI still lets the user pick ANY day.
 */
export function recommendDays(
  originIso: string,
  subject: SubjectCode,
  resolution: Map<string, DayResolution>,
  count = 3,
): DayRecommendation[] {
  const days = planDays()
  const originIdx = days.indexOf(originIso)

  return days
    .map((iso, idx) => ({ iso, idx }))
    .filter(({ iso }) => {
      if (iso === originIso) return false
      const p = PLAN[iso]
      return !(p?.rest || p?.holiday) // protect rest + holiday days
    })
    .map(({ iso, idx }) => {
      const res = resolution.get(iso)
      const load = res ? res.active.length : 0
      const hasSubject = res ? res.active.some((r) => r.block.subject === subject) : false
      const isPast = idx < originIdx
      const dist = Math.abs(idx - originIdx)

      let score = load * 2 + dist
      if (isPast) score += 6
      if (PLAN[iso]?.visitor) score += 4
      if (hasSubject) score -= 2

      return { iso, score, load, hasSubject }
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, count)
    .map(({ iso, load, hasSubject }) => ({
      iso,
      reason: load === 0 ? 'No other tasks' : hasSubject ? 'Same subject' : `${load} task${load > 1 ? 's' : ''}`,
    }))
}

/**
 * "Work ahead": not-yet-done tasks scheduled on days AFTER `afterIso`. Pulling
 * one into an earlier day is just a reschedule to that earlier day.
 */
export function upcomingTasks(
  resolution: Map<string, DayResolution>,
  afterIso: string,
): { iso: string; tasks: ResolvedBlock[] }[] {
  const out: { iso: string; tasks: ResolvedBlock[] }[] = []
  for (const iso of planDays()) {
    if (iso <= afterIso) continue // ISO date strings sort chronologically
    const res = resolution.get(iso)
    if (!res) continue
    const tasks = res.active.filter((r) => !r.done)
    if (tasks.length) out.push({ iso, tasks })
  }
  return out
}
