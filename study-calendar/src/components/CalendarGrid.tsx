import { PLAN } from '../plan'
import type { SubjectCode } from '../plan'
import { DOW_LABELS, inPlanWindow, isoOf, isToday, monthGridCells } from '../lib/dates'
import DayCell from './DayCell'

interface Props {
  year: number
  month: number
  hidden: Set<SubjectCode>
  onOpen: (iso: string) => void
}

export default function CalendarGrid({ year, month, hidden, onOpen }: Props) {
  const cells = monthGridCells(year, month)

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
        {cells.map((date, i) =>
          date === null ? (
            <div key={`pad-${i}`} aria-hidden className="aspect-[1/1.05]" />
          ) : (
            <DayCell
              key={isoOf(date)}
              date={date}
              iso={isoOf(date)}
              plan={PLAN[isoOf(date)]}
              inWindow={inPlanWindow(date)}
              today={isToday(date)}
              hidden={hidden}
              onOpen={onOpen}
            />
          ),
        )}
      </div>
    </div>
  )
}
