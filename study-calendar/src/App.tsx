import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SubjectCode } from './plan'
import { MONTHS } from './lib/dates'
import { loadStates, saveStates } from './lib/storage'
import { recommendDays, resolveSchedule } from './lib/schedule'
import type { BlockStates } from './lib/schedule'
import { useSync } from './lib/useSync'
import Header from './components/Header'
import SyncButton from './components/SyncButton'
import SubjectBar from './components/SubjectBar'
import WeekProgress from './components/WeekProgress'
import MonthNav from './components/MonthNav'
import CalendarGrid from './components/CalendarGrid'
import DayModal from './components/DayModal'

export default function App() {
  const [monthIndex, setMonthIndex] = useState(0)
  const [openIso, setOpenIso] = useState<string | null>(null)
  const [states, setStates] = useState<BlockStates>(loadStates)
  const [hidden, setHidden] = useState<Set<SubjectCode>>(() => new Set())

  // Persist block state (done / rescheduled) whenever it changes.
  useEffect(() => {
    saveStates(states)
  }, [states])

  // Live schedule (static plan merged with saved state), shared everywhere.
  const resolution = useMemo(() => resolveSchedule(states), [states])

  // Update one block's saved state, dropping the entry when it returns to default.
  const patchState = useCallback(
    (id: string, change: (cur: { done?: boolean; movedTo?: string }) => void) => {
      setStates((prev) => {
        const next = { ...prev }
        const cur = { ...(next[id] ?? {}) }
        change(cur)
        if (!cur.done && !cur.movedTo) delete next[id]
        else next[id] = cur
        return next
      })
    },
    [],
  )

  const setDone = useCallback(
    (id: string, done: boolean) => patchState(id, (cur) => {
      if (done) cur.done = true
      else delete cur.done
    }),
    [patchState],
  )

  const reschedule = useCallback(
    (id: string, toIso: string) => patchState(id, (cur) => {
      const origin = id.split('#')[0]
      if (toIso === origin) delete cur.movedTo
      else cur.movedTo = toIso
    }),
    [patchState],
  )

  const undoMove = useCallback(
    (id: string) => patchState(id, (cur) => {
      delete cur.movedTo
    }),
    [patchState],
  )

  const recommend = useCallback(
    (originIso: string, subject: SubjectCode) => recommendDays(originIso, subject, resolution),
    [resolution],
  )

  const toggleSubject = useCallback((code: SubjectCode) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }, [])

  // Cross-device sync (Supabase). No-op until configured + a passphrase is set.
  const sync = useSync(states, setStates)

  const month = MONTHS[monthIndex]

  return (
    <div className="mx-auto max-w-[1000px] px-4 pb-20 pt-6 sm:px-5">
      <div className="flex items-start justify-between gap-4">
        <Header />
        <SyncButton info={sync} />
      </div>
      <SubjectBar hidden={hidden} onToggle={toggleSubject} />
      <WeekProgress resolution={resolution} />

      <MonthNav
        year={month.year}
        month={month.month}
        canPrev={monthIndex > 0}
        canNext={monthIndex < MONTHS.length - 1}
        onPrev={() => setMonthIndex((i) => Math.max(0, i - 1))}
        onNext={() => setMonthIndex((i) => Math.min(MONTHS.length - 1, i + 1))}
      />

      <CalendarGrid
        year={month.year}
        month={month.month}
        resolution={resolution}
        hidden={hidden}
        onOpen={setOpenIso}
      />

      <footer className="mt-7 text-center text-[12px] leading-relaxed text-faint">
        Video links open YouTube searches scoped to trusted IB channels (Organic Chemistry
        Tutor, Physics Online, IB-specific revision channels) so they always resolve to current
        results.
        <br />
        Sports times in Taiwan time (UTC+8). End date Sat 15 Aug — placeholder.
      </footer>

      {openIso && (
        <DayModal
          iso={openIso}
          resolution={resolution.get(openIso)}
          onSetDone={setDone}
          onReschedule={reschedule}
          onUndoMove={undoMove}
          onRecommend={recommend}
          onClose={() => setOpenIso(null)}
        />
      )}
    </div>
  )
}
