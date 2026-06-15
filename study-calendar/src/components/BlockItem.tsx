import { useState } from 'react'
import { PLAN_END_ISO, PLAN_START_ISO, SUBJECTS } from '../plan'
import type { SubjectCode } from '../plan'
import type { DayRecommendation, ResolvedBlock } from '../lib/schedule'
import { dayLabel } from '../lib/dates'

interface Props {
  block: ResolvedBlock
  onSetDone: (id: string, done: boolean) => void
  onReschedule: (id: string, toIso: string) => void
  onRecommend: (originIso: string, subject: SubjectCode) => DayRecommendation[]
}

export default function BlockItem({ block, onSetDone, onReschedule, onRecommend }: Props) {
  const [picking, setPicking] = useState(false)
  const { block: b, id, done, incoming, originIso } = block
  const sub = SUBJECTS[b.subject]

  const pick = (toIso: string) => {
    onReschedule(id, toIso)
    setPicking(false)
  }

  return (
    <div className="border-b border-edge/60 py-4 last:border-b-0">
      {incoming && (
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-[#bd6cf0]/15 px-2 py-0.5 text-[11px] font-medium text-[#c79cf2]">
          ↩ Moved from {dayLabel(originIso)}
        </div>
      )}

      {/* Subject pill + time */}
      <div className="mb-2.5 flex items-center gap-2.5">
        <span
          className="rounded-md px-2.5 py-1 text-[11px] font-bold tracking-wide"
          style={{ background: `${sub.color}22`, color: sub.color }}
        >
          {sub.name}
        </span>
        {b.time && <span className="ml-auto text-[11.5px] text-faint">{b.time}</span>}
      </div>

      <h4 className={`text-[15px] font-semibold ${done ? 'text-faint line-through' : 'text-ink'}`}>
        {b.topic}
      </h4>

      {b.whatToDo && <p className="mb-2.5 mt-2 text-[13.5px] text-muted">{b.whatToDo}</p>}

      {b.debrief && (
        <div
          className="debrief-box mb-2.5 rounded-r-lg border-l-[3px] border-edge bg-panel2 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink"
          dangerouslySetInnerHTML={{ __html: `<b>Debrief — </b>${b.debrief}` }}
        />
      )}

      {b.videos.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {b.videos.map((v, j) => (
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

      {/* Approve complete / reschedule */}
      {picking ? (
        <ReschedulePanel
          recommendations={onRecommend(originIso, b.subject)}
          onPick={pick}
          onCancel={() => setPicking(false)}
        />
      ) : done ? (
        <div className="flex items-center gap-3 text-[12.5px]">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-[#2d8c6b]/20 px-2.5 py-1 font-semibold text-[#4cae8a]">
            ✓ Completed
          </span>
          <button
            type="button"
            onClick={() => onSetDone(id, false)}
            className="text-faint underline-offset-2 hover:text-ink hover:underline"
          >
            Undo
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onSetDone(id, true)}
            className="rounded-md border border-gold/40 bg-gold/15 px-3 py-1.5 text-[12.5px] font-semibold text-gold transition hover:bg-gold/25"
          >
            ✓ Mark complete
          </button>
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="rounded-md border border-edge bg-panel2 px-3 py-1.5 text-[12.5px] text-muted transition hover:border-gold/60 hover:text-ink"
          >
            ⤳ Can't do — reschedule
          </button>
        </div>
      )}
    </div>
  )
}

function ReschedulePanel({
  recommendations,
  onPick,
  onCancel,
}: {
  recommendations: DayRecommendation[]
  onPick: (iso: string) => void
  onCancel: () => void
}) {
  return (
    <div className="rounded-lg border border-edge bg-panel2 p-3">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[12.5px] font-semibold text-ink">Reschedule to…</span>
        <button
          type="button"
          onClick={onCancel}
          className="text-[12px] text-faint underline-offset-2 hover:text-ink hover:underline"
        >
          Cancel
        </button>
      </div>

      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-faint">
        Recommended
      </div>
      {recommendations.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {recommendations.map((r) => (
            <button
              key={r.iso}
              type="button"
              onClick={() => onPick(r.iso)}
              className="rounded-md border border-edge bg-panel px-2.5 py-1.5 text-left transition hover:border-gold"
            >
              <div className="text-[12.5px] font-semibold text-ink">{dayLabel(r.iso)}</div>
              <div className="text-[10.5px] text-faint">{r.reason}</div>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-faint">No suggestions — pick any day below.</p>
      )}

      <label className="mt-3 block text-[10.5px] font-semibold uppercase tracking-wide text-faint">
        Or pick any day
      </label>
      <input
        type="date"
        min={PLAN_START_ISO}
        max={PLAN_END_ISO}
        onChange={(e) => {
          const v = e.target.value
          if (v) onPick(v)
        }}
        className="mt-1 rounded-md border border-edge bg-panel px-2.5 py-1.5 text-[12.5px] text-ink [color-scheme:dark]"
      />
      <p className="mt-1.5 text-[11px] text-faint">
        Recommendations are just suggestions — you decide.
      </p>
    </div>
  )
}
