import { useEffect } from 'react'
import { PLAN, SUBJECTS } from '../plan'
import type { DayPlan, SubjectCode } from '../plan'
import type { DayResolution } from '../lib/schedule'
import { DOW_LABELS, inPlanWindow, isoOf, isToday, monthGridCells, monthLabel } from '../lib/dates'

interface Props {
  year: number
  month: number
  resolution: Map<string, DayResolution>
  hidden: Set<SubjectCode>
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
  onOpen: (iso: string) => void
  onClose: () => void
}

function tint(plan: DayPlan | undefined): { background?: string; borderColor?: string } {
  if (!plan) return {}
  if (plan.holiday) return { background: 'rgba(232,179,57,0.07)', borderColor: 'rgba(232,179,57,0.35)' }
  if (plan.visitor) return { background: 'rgba(154,108,240,0.07)' }
  if (plan.rest) return { background: 'rgba(45,140,107,0.08)' }
  return {}
}

const navBtn =
  'flex h-9 w-9 items-center justify-center rounded-lg border border-edge bg-panel text-lg text-ink transition hover:bg-panel2 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-panel'

/** Full-screen, detail-rich calendar. Exit via the ✕ (top-right) or the home view underneath. */
export default function FullCalendar({
  year,
  month,
  resolution,
  hidden,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onOpen,
  onClose,
}: Props) {
  // Lock background scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const cells = monthGridCells(year, month)

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-base animate-[scrim-in_0.15s_ease]">
      <div className="mx-auto max-w-[1400px] px-3 pb-10 sm:px-5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}>
        {/* Header: month nav + exit. Sticks below the safe-area (notch / status bar). */}
        <div
          className="sticky z-10 mb-3 flex items-center justify-between gap-3 bg-base/95 py-2.5 backdrop-blur"
          style={{ top: 'env(safe-area-inset-top)' }}
        >
          <div className="flex items-center gap-2">
            <button type="button" onClick={onPrev} disabled={!canPrev} aria-label="Previous month" className={navBtn}>
              ‹
            </button>
            <h2 className="min-w-[140px] text-center text-lg font-semibold sm:min-w-[180px] sm:text-xl">
              {monthLabel(year, month)}
            </h2>
            <button type="button" onClick={onNext} disabled={!canNext} aria-label="Next month" className={navBtn}>
              ›
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Exit full screen"
            className="flex h-11 flex-none items-center gap-2 rounded-xl border border-edge bg-panel px-4 text-[15px] font-medium text-ink transition hover:border-gold/70 hover:text-gold"
          >
            <span className="text-lg leading-none">✕</span>
            <span>Exit</span>
          </button>
        </div>

        {/* Day-of-week header */}
        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {DOW_LABELS.map((d) => (
            <div
              key={d}
              className="py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-faint sm:text-[11px]"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Detailed grid */}
        <div className="mt-1 grid grid-cols-7 gap-1 sm:gap-2">
          {cells.map((date, i) =>
            date === null ? (
              <div key={`pad-${i}`} aria-hidden className="min-h-[88px] sm:min-h-[132px]" />
            ) : (
              <DetailCell
                key={isoOf(date)}
                date={date}
                iso={isoOf(date)}
                plan={PLAN[isoOf(date)]}
                res={resolution.get(isoOf(date))}
                inWindow={inPlanWindow(date)}
                today={isToday(date)}
                hidden={hidden}
                onOpen={onOpen}
              />
            ),
          )}
        </div>
      </div>
    </div>
  )
}

function DetailCell({
  date,
  iso,
  plan,
  res,
  inWindow,
  today,
  hidden,
  onOpen,
}: {
  date: Date
  iso: string
  plan: DayPlan | undefined
  res: DayResolution | undefined
  inWindow: boolean
  today: boolean
  hidden: Set<SubjectCode>
  onOpen: (iso: string) => void
}) {
  const dayNum = date.getDate()

  if (!inWindow) {
    return (
      <div className="min-h-[88px] rounded-lg border border-edge bg-panel p-1.5 opacity-30 sm:min-h-[132px]">
        <div className="text-[13px] font-semibold leading-none">{dayNum}</div>
      </div>
    )
  }

  const active = res?.active ?? []
  const visible = active.filter((a) => !hidden.has(a.block.subject))
  const allDone = active.length > 0 && active.every((a) => a.done)
  const hasIncoming = active.some((a) => a.incoming)

  const tagline =
    plan?.rest && !plan.blocks ? 'Rest day' : plan?.holiday ? 'Holiday' : (plan?.theme ?? '')

  return (
    <button
      type="button"
      data-iso={iso}
      onClick={() => onOpen(iso)}
      style={tint(plan)}
      className={`flex min-h-[88px] flex-col overflow-hidden rounded-lg border border-edge bg-panel p-1.5 text-left transition hover:border-gold sm:min-h-[132px] sm:p-2 ${
        today ? 'outline outline-2 -outline-offset-2 outline-gold' : ''
      }`}
    >
      <div className="flex items-start justify-between leading-none">
        <span className="text-[13px] font-semibold">{dayNum}</span>
        <span className="flex items-center gap-0.5 text-[10px] leading-none">
          {hasIncoming && <span className="text-[#bd6cf0]" title="task pulled in">⤳</span>}
          {allDone && <span className="text-[#4cae8a]" title="all done">✓</span>}
          {plan?.sport && <span className="text-gold" title="sport">★</span>}
        </span>
      </div>

      {tagline && (
        <p className="mt-0.5 line-clamp-2 text-[9.5px] leading-snug text-muted sm:text-[11px]">{tagline}</p>
      )}

      <div className="mt-1 flex min-h-0 flex-col gap-0.5">
        {visible.slice(0, 4).map((t) => (
          <div key={t.id} className="flex items-center gap-1">
            <span
              className="h-1.5 w-1.5 flex-none rounded-full"
              style={{ background: SUBJECTS[t.block.subject].color }}
            />
            <span
              className={`truncate text-[9.5px] leading-tight sm:text-[11px] ${
                t.done ? 'text-faint line-through' : 'text-ink/90'
              }`}
            >
              {t.block.topic}
            </span>
          </div>
        ))}
        {visible.length > 4 && (
          <span className="text-[9px] text-faint sm:text-[10px]">+{visible.length - 4} more</span>
        )}
      </div>
    </button>
  )
}
