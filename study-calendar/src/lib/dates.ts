import {
  addDays,
  format,
  getDay,
  getDaysInMonth,
  isSameDay,
  isWithinInterval,
  parseISO,
  startOfWeek,
} from 'date-fns'
import { PLAN_END_ISO, PLAN_START_ISO } from '../plan'

/** The three months the grid can navigate (month is 0-based: 5 = June). */
export const MONTHS: { year: number; month: number }[] = [
  { year: 2026, month: 5 }, // June
  { year: 2026, month: 6 }, // July
  { year: 2026, month: 7 }, // August
]

export const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const PLAN_START = parseISO(PLAN_START_ISO)
export const PLAN_END = parseISO(PLAN_END_ISO)

/** Date → "YYYY-MM-DD" (local), the key format used by PLAN. */
export function isoOf(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

/** Modal date label, e.g. "Wed 17 Jun". */
export function dayLabel(iso: string): string {
  return format(parseISO(iso), 'EEE d MMM')
}

/** Month heading, e.g. "June 2026". */
export function monthLabel(year: number, month: number): string {
  return format(new Date(year, month, 1), 'MMMM yyyy')
}

/**
 * Cells for one month's grid: leading nulls to offset to the correct weekday
 * (weeks start Sunday), then one Date per day of the month.
 */
export function monthGridCells(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1)
  const offset = getDay(first) // 0 = Sunday
  const total = getDaysInMonth(first)
  const cells: (Date | null)[] = []
  for (let i = 0; i < offset; i++) cells.push(null)
  for (let d = 1; d <= total; d++) cells.push(new Date(year, month, d))
  return cells
}

/** Is this date inside the active plan window (inclusive)? */
export function inPlanWindow(date: Date): boolean {
  return isWithinInterval(date, { start: PLAN_START, end: PLAN_END })
}

export function isToday(date: Date): boolean {
  return isSameDay(date, new Date())
}

export interface WeekInfo {
  /** ISO dates within this week that fall inside the plan window. */
  isoDays: string[]
  /** Display label spanning the in-window days, e.g. "17–21 Jun". */
  label: string
}

/** Sunday-start weeks covering the plan window, each limited to in-window days. */
export function planWeeks(): WeekInfo[] {
  const weeks: WeekInfo[] = []
  let cursor = startOfWeek(PLAN_START, { weekStartsOn: 0 })
  const lastWeekStart = startOfWeek(PLAN_END, { weekStartsOn: 0 })

  while (cursor <= lastWeekStart) {
    const isoDays: string[] = []
    for (let i = 0; i < 7; i++) {
      const d = addDays(cursor, i)
      if (inPlanWindow(d)) isoDays.push(isoOf(d))
    }
    if (isoDays.length > 0) {
      weeks.push({ isoDays, label: weekLabel(isoDays) })
    }
    cursor = addDays(cursor, 7)
  }
  return weeks
}

function weekLabel(isoDays: string[]): string {
  const start = parseISO(isoDays[0])
  const end = parseISO(isoDays[isoDays.length - 1])
  if (start.getMonth() === end.getMonth()) {
    return `${format(start, 'd')}–${format(end, 'd MMM')}`
  }
  return `${format(start, 'd MMM')} – ${format(end, 'd MMM')}`
}
