import { SUBJECTS } from '../plan'
import type { DayPlan, SubjectCode } from '../plan'
import type { DayResolution } from '../lib/schedule'
import { cellTint, subjectsForDay } from '../lib/schedule'

interface Props {
  date: Date
  iso: string
  plan: DayPlan | undefined
  res: DayResolution | undefined
  inWindow: boolean
  today: boolean
  todayIso: string
  hidden: Set<SubjectCode>
  onOpen: (iso: string) => void
}

export default function DayCell({
  date,
  iso,
  plan,
  res,
  inWindow,
  today,
  todayIso,
  hidden,
  onOpen,
}: Props) {
  const dayNum = date.getDate()

  // Out-of-window days: visible for grid alignment but greyed and inert.
  if (!inWindow) {
    return (
      <div className="aspect-[1/1.05] rounded-lg border border-edge bg-panel p-1.5 opacity-30">
        <div className="text-[13px] font-semibold leading-none">{dayNum}</div>
      </div>
    )
  }

  const active = res?.active ?? []
  const codes = subjectsForDay(res).filter((c) => !hidden.has(c))
  const allDone = active.length > 0 && active.every((a) => a.done)
  const hasIncoming = active.some((a) => a.incoming)

  const tagline =
    plan?.rest && !plan.blocks
      ? 'Rest day'
      : plan?.holiday
        ? 'Holiday'
        : (plan?.theme ?? '')

  return (
    <button
      type="button"
      data-iso={iso}
      onClick={() => onOpen(iso)}
      style={cellTint(plan, res, iso, todayIso)}
      className={`group relative flex aspect-[1/1.05] flex-col gap-0.5 overflow-hidden rounded-lg border border-edge bg-panel p-1.5 text-left transition hover:-translate-y-px hover:border-gold ${
        today ? 'outline outline-2 -outline-offset-2 outline-gold' : ''
      }`}
    >
      <div className="flex items-start text-[13px] font-semibold leading-none">
        <span>{dayNum}</span>
        <span className="ml-auto flex items-center gap-0.5 leading-none">
          {hasIncoming && (
            <span className="text-[9px] text-[#bd6cf0]" title="task rescheduled to this day">
              ⤳
            </span>
          )}
          {allDone && (
            <span className="text-[9px] text-[#4cae8a]" title="all tasks complete">
              ✓
            </span>
          )}
          {plan?.sport && (
            <span className="text-[9px] text-gold" aria-label="sport event">
              ★
            </span>
          )}
        </span>
      </div>

      {tagline && (
        <div className="hidden min-[420px]:block">
          <p className="line-clamp-2 text-[9.5px] leading-snug text-muted">{tagline}</p>
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-0.5">
        {codes.map((c) => (
          <span
            key={c}
            className="h-[7px] w-[7px] flex-none rounded-[2px]"
            style={{ background: SUBJECTS[c].color }}
            title={SUBJECTS[c].name}
          />
        ))}
      </div>
    </button>
  )
}
