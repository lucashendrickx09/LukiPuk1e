import { useMemo } from 'react'
import { blockId, PLAN, visibleBlocks } from '../plan'
import { planWeeks } from '../lib/dates'

interface Props {
  completed: Set<string>
}

/** Per-week completion bars driven by the localStorage completion set. */
export default function WeekProgress({ completed }: Props) {
  const weeks = useMemo(() => planWeeks(), [])

  const rows = weeks.map((w) => {
    let total = 0
    let done = 0
    for (const iso of w.isoDays) {
      visibleBlocks(PLAN[iso]).forEach((_, i) => {
        total++
        if (completed.has(blockId(iso, i))) done++
      })
    }
    return { ...w, total, done, pct: total === 0 ? 0 : Math.round((done / total) * 100) }
  })

  const grandTotal = rows.reduce((a, r) => a + r.total, 0)
  const grandDone = rows.reduce((a, r) => a + r.done, 0)

  return (
    <section
      className="mt-4 rounded-xl border border-edge bg-panel p-3.5"
      aria-label="Weekly progress"
    >
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold">Progress</h2>
        <span className="text-[12px] text-muted">
          {grandDone}/{grandTotal} blocks done
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
        {rows.map((r) => (
          <div key={r.isoDays[0]} className="min-w-0">
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="truncate text-muted">{r.label}</span>
              <span className="ml-2 flex-none tabular-nums text-faint">
                {r.done}/{r.total}
              </span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-panel2"
              role="progressbar"
              aria-valuenow={r.pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Week of ${r.label}`}
            >
              <div
                className="h-full rounded-full bg-gold transition-[width] duration-300"
                style={{ width: `${r.pct}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
