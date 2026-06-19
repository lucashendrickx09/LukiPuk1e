import { PLAN } from '../plan'
import type { SubjectCode } from '../plan'
import type { DayResolution } from '../lib/schedule'
import { DOW_LABELS, inPlanWindow, isoOf, isToday, monthGridCells } from '../lib/dates'
import DayCell from './DayCell'

interface Props {
  year: number
  month: number
  resolution: Map<string, DayResolution>
  hidden: Set<SubjectCode>
  onOpen: (iso: string) => void
}

export default function CalendarGrid({ year, month, resolution, hidden, onOpen }: Props) {
  const cells = monthGridCells(year, month)
  const todayIso = isoOf(new Date())

  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5">
        {DOW_LABELS.map((d) => (
          <div
            key={d}
            className="py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-faint"
          >
            {d}
          </div>
        ))}
      </div>

      <div className="mt-1.5 grid grid-cols-7 gap-1.5">
        {cells.map((date, i) => {
          if (date === null) return <div key={`pad-${i}`} aria-hidden className="aspect-[1/1.05]" />
          const iso = isoOf(date)
          return (
            <DayCell
              key={iso}
              date={date}
              iso={iso}
              plan={PLAN[iso]}
              res={resolution.get(iso)}
              inWindow={inPlanWindow(date)}
              today={isToday(date)}
              todayIso={todayIso}
              hidden={hidden}
              onOpen={onOpen}
            />
          )
        })}
      </div>
    </div>
  )
}
