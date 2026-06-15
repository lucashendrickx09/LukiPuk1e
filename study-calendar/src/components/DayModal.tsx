import { useEffect, useRef } from 'react'
import { blockId, PLAN, SUBJECTS, visibleBlocks } from '../plan'
import type { StudyBlock } from '../plan'
import { dayLabel } from '../lib/dates'

interface Props {
  iso: string
  completed: Set<string>
  onToggleBlock: (id: string) => void
  onClose: () => void
}

export default function DayModal({ iso, completed, onToggleBlock, onClose }: Props) {
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

  const blocks = visibleBlocks(plan)
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

          {blocks.length > 0 ? (
            blocks.map((b, i) => (
              <BlockView
                key={i}
                block={b}
                checked={completed.has(blockId(iso, i))}
                onToggle={() => onToggleBlock(blockId(iso, i))}
              />
            ))
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
        </div>
      </div>
    </div>
  )
}

function BlockView({
  block,
  checked,
  onToggle,
}: {
  block: StudyBlock
  checked: boolean
  onToggle: () => void
}) {
  const sub = SUBJECTS[block.subject]

  return (
    <div className="border-b border-edge/60 py-4 last:border-b-0">
      {/* Subject pill + time */}
      <div className="mb-2.5 flex items-center gap-2.5">
        <span
          className="rounded-md px-2.5 py-1 text-[11px] font-bold tracking-wide"
          style={{ background: `${sub.color}22`, color: sub.color }}
        >
          {sub.name}
        </span>
        {block.time && <span className="ml-auto text-[11.5px] text-faint">{block.time}</span>}
      </div>

      {/* Topic heading with completion checkbox */}
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="mt-1 h-4 w-4 flex-none accent-[#e8b339]"
        />
        <span
          className={`text-[15px] font-semibold ${
            checked ? 'text-faint line-through' : 'text-ink'
          }`}
        >
          {block.topic}
        </span>
      </label>

      {/* What to do */}
      {block.whatToDo && (
        <p className="mb-2.5 ml-[26px] mt-2 text-[13.5px] text-muted">{block.whatToDo}</p>
      )}

      {/* Debrief callout (authored static content — may contain <b>) */}
      {block.debrief && (
        <div
          className="debrief-box mb-2.5 ml-[26px] rounded-r-lg border-l-[3px] border-edge bg-panel2 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink"
          dangerouslySetInnerHTML={{ __html: `<b>Debrief — </b>${block.debrief}` }}
        />
      )}

      {/* Video resources */}
      {block.videos.length > 0 && (
        <div className="ml-[26px] flex flex-wrap gap-1.5">
          {block.videos.map((v, j) => (
            <a
              key={j}
              href={v.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-panel2 px-2.5 py-1.5 text-[12px] text-ink transition hover:border-gold hover:bg-[#222a38]"
            >
              <span className="text-[13px] text-[#e24b4a]" aria-hidden>
                ▶
              </span>
              {v.label}
            </a>
          ))}
        </div>
      )}
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
