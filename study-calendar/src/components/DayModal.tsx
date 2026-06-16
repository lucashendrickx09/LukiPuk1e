import { useEffect, useRef, useState } from 'react'
import { PLAN, SUBJECTS } from '../plan'
import type { SubjectCode } from '../plan'
import type { DayRecommendation, DayResolution, ResolvedBlock } from '../lib/schedule'
import { dayLabel } from '../lib/dates'
import BlockItem from './BlockItem'

interface Props {
  iso: string
  resolution: DayResolution | undefined
  onSetDone: (id: string, done: boolean) => void
  onReschedule: (id: string, toIso: string) => void
  onUndoMove: (id: string) => void
  onRecommend: (originIso: string, subject: SubjectCode) => DayRecommendation[]
  onGetUpcoming: (afterIso: string) => { iso: string; tasks: ResolvedBlock[] }[]
  onClose: () => void
}

export default function DayModal({
  iso,
  resolution,
  onSetDone,
  onReschedule,
  onUndoMove,
  onRecommend,
  onGetUpcoming,
  onClose,
}: Props) {
  const plan = PLAN[iso]
  const closeRef = useRef<HTMLButtonElement>(null)

  // Escape closes; focus the close button on open.
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Lock background scroll while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const active = resolution?.active ?? []
  const movedAway = resolution?.movedAway ?? []
  const hasContent = active.length > 0 || movedAway.length > 0
  const title =
    plan?.theme ?? (plan?.holiday ? 'Holiday' : plan?.rest ? 'Rest day' : 'Free day')

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-10 animate-[scrim-in_0.15s_ease]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${dayLabel(iso)} — ${title}`}
        className="w-full max-w-[620px] animate-pop rounded-xl border border-edge bg-panel"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3.5 rounded-t-xl border-b border-edge bg-panel px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.1em] text-gold">
              {dayLabel(iso)}
            </div>
            <h3 className="mt-1 text-xl font-semibold">{title}</h3>
            {plan?.visitor && !plan.holiday && (
              <div className="mt-0.5 text-[13px] text-muted">Visitor in town — keep it light</div>
            )}
            {plan?.holiday && (
              <div className="mt-0.5 text-[13px] text-muted">Holiday — fully off</div>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg border border-edge text-muted transition hover:bg-panel2 hover:text-ink"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-5 pb-6 pt-2">
          {plan?.sport && (
            <div className="my-3.5 flex items-center gap-2.5 rounded-lg border border-gold/30 bg-gold/10 px-3.5 py-2.5 text-[13px] text-[#f0c454]">
              <span aria-hidden>★</span>
              <span>{plan.sport}</span>
            </div>
          )}

          {hasContent ? (
            <>
              {active.map((rb) => (
                <BlockItem
                  key={rb.id}
                  block={rb}
                  onSetDone={onSetDone}
                  onReschedule={onReschedule}
                  onRecommend={onRecommend}
                />
              ))}
              {movedAway.map((rb) => (
                <MovedAwayStub key={rb.id} block={rb} onUndoMove={onUndoMove} />
              ))}
            </>
          ) : plan?.holiday ? (
            <EmptyDay
              big="Holiday — fully off"
              small="Nothing scheduled. Switch off completely and come back fresh."
              color="#f0c454"
            />
          ) : plan?.rest ? (
            <EmptyDay
              big="Rest day"
              small="No study scheduled. Recover — it's part of the plan."
              color="#4cae8a"
            />
          ) : (
            <EmptyDay
              big="No plan set"
              small="This day is outside the active schedule."
              color="#9aa7b4"
            />
          )}

          <WorkAhead iso={iso} onGetUpcoming={onGetUpcoming} onPull={(id) => onReschedule(id, iso)} />
        </div>
      </div>
    </div>
  )
}

/** Compact stub on the origin day for a task that's been rescheduled elsewhere. */
function MovedAwayStub({
  block,
  onUndoMove,
}: {
  block: ResolvedBlock
  onUndoMove: (id: string) => void
}) {
  const sub = SUBJECTS[block.block.subject]
  return (
    <div className="border-b border-edge/60 py-3 last:border-b-0">
      <div className="flex items-center gap-2.5">
        <span
          className="rounded-md px-2.5 py-1 text-[11px] font-bold tracking-wide opacity-60"
          style={{ background: `${sub.color}22`, color: sub.color }}
        >
          {sub.name}
        </span>
        <span className="text-[13.5px] text-faint line-through">{block.block.topic}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-[12px]">
        <span className="inline-flex items-center gap-1.5 text-[#c79cf2]">
          ⤳ Rescheduled to {block.movedTo ? dayLabel(block.movedTo) : 'another day'}
        </span>
        <button
          type="button"
          onClick={() => onUndoMove(block.id)}
          className="text-faint underline-offset-2 hover:text-ink hover:underline"
        >
          Undo
        </button>
      </div>
    </div>
  )
}

function EmptyDay({ big, small, color }: { big: string; small: string; color: string }) {
  return (
    <div className="py-9 text-center" style={{ color }}>
      <div className="mb-1.5 text-lg font-semibold">{big}</div>
      <div className="text-[14px] opacity-90">{small}</div>
    </div>
  )
}

/** "Work ahead" — pull a not-done task from a later day into this day. */
function WorkAhead({
  iso,
  onGetUpcoming,
  onPull,
}: {
  iso: string
  onGetUpcoming: (afterIso: string) => { iso: string; tasks: ResolvedBlock[] }[]
  onPull: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const upcoming = onGetUpcoming(iso)
  if (upcoming.length === 0) return null
  const count = upcoming.reduce((n, d) => n + d.tasks.length, 0)

  return (
    <div className="mt-4 border-t border-edge/60 pt-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-panel2 px-3 py-1.5 text-[12.5px] text-muted transition hover:border-gold/60 hover:text-ink"
      >
        <span aria-hidden>⏩</span> Work ahead
        {!open && (
          <span className="text-faint">
            · {count} task{count > 1 ? 's' : ''} from later days
          </span>
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-[12px] text-muted">
            Pull a task from a later day into <span className="text-ink">{dayLabel(iso)}</span> to do it
            early — it leaves the later day automatically.
          </p>
          {upcoming.map((d) => (
            <div key={d.iso}>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">
                {dayLabel(d.iso)}
              </div>
              <div className="space-y-1.5">
                {d.tasks.map((t) => {
                  const sub = SUBJECTS[t.block.subject]
                  return (
                    <div
                      key={t.id}
                      className="flex items-center gap-2.5 rounded-md border border-edge bg-panel2 px-2.5 py-1.5"
                    >
                      <span
                        className="flex-none rounded px-2 py-0.5 text-[10.5px] font-bold"
                        style={{ background: `${sub.color}22`, color: sub.color }}
                      >
                        {sub.name}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{t.block.topic}</span>
                      <button
                        type="button"
                        onClick={() => onPull(t.id)}
                        className="flex-none rounded-md border border-gold/40 bg-gold/15 px-2 py-1 text-[11.5px] font-semibold text-gold transition hover:bg-gold/25"
                      >
                        Pull in
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
