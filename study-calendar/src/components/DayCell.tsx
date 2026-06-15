import { SUBJECTS, visibleBlocks } from '../plan'
import type { DayPlan, SubjectCode } from '../plan'

interface Props {
  date: Date
  iso: string
  plan: DayPlan | undefined
  inWindow: boolean
  today: boolean
  hidden: Set<SubjectCode>
  onOpen: (iso: string) => void
}

// Day-type → subtle tint (inline so the exact rgba matches the source design).
function tint(plan: DayPlan | undefined): { background?: string; borderColor?: string } {
  if (!plan) return {}
  if (plan.holiday) return { background: 'rgba(232,179,57,0.07)', borderColor: 'rgba(232,179,57,0.35)' }
  if (plan.visitor) return { background: 'rgba(154,108,240,0.07)' }
  if (plan.rest) return { background: 'rgba(45,140,107,0.08)' }
  return {}
}

export default function DayCell({ date, iso, plan, inWindow, today, hidden, onOpen }: Props) {
  const dayNum = date.getDate()

  // Out-of-window days: visible for grid alignment but greyed and inert.
  if (!inWindow) {
    return (
      <div className="aspect-[1/1.05] rounded-lg border border-edge bg-panel p-1.5 opacity-30">
        <div className="text-[13px] font-semibold leading-none">{dayNum}</div>
      </div>
    )
  }

  const codes = [...new Set(visibleBlocks(plan).map((b) => b.subject))].filter(
    (c) => !hidden.has(c),
  )

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
      style={tint(plan)}
      className={`group relative flex aspect-[1/1.05] flex-col gap-0.5 overflow-hidden rounded-lg border border-edge bg-panel p-1.5 text-left transition hover:-translate-y-px hover:border-gold ${
        today ? 'outline outline-2 -outline-offset-2 outline-gold' : ''
      }`}
    >
      <div className="flex items-start text-[13px] font-semibold leading-none">
        <span>{dayNum}</span>
        {plan?.sport && (
          <span className="ml-auto text-[9px] leading-none text-gold" aria-label="sport event">
            ★
          </span>
        )}
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
