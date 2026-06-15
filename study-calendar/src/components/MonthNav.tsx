import { monthLabel } from '../lib/dates'

interface Props {
  year: number
  month: number
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
}

const btn =
  'flex h-9 w-9 items-center justify-center rounded-lg border border-edge bg-panel text-lg text-ink transition hover:bg-panel2 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-panel'

export default function MonthNav({ year, month, canPrev, canNext, onPrev, onNext }: Props) {
  return (
    <div className="mb-2.5 mt-6 flex items-center justify-between">
      <button type="button" onClick={onPrev} disabled={!canPrev} aria-label="Previous month" className={btn}>
        ‹
      </button>
      <h2 className="text-[19px] font-semibold">{monthLabel(year, month)}</h2>
      <button type="button" onClick={onNext} disabled={!canNext} aria-label="Next month" className={btn}>
        ›
      </button>
    </div>
  )
}
