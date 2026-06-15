import { useCallback, useEffect, useState } from 'react'
import type { SubjectCode } from './plan'
import { MONTHS } from './lib/dates'
import { loadCompleted, saveCompleted } from './lib/storage'
import Header from './components/Header'
import SubjectBar from './components/SubjectBar'
import WeekProgress from './components/WeekProgress'
import MonthNav from './components/MonthNav'
import CalendarGrid from './components/CalendarGrid'
import DayModal from './components/DayModal'

export default function App() {
  const [monthIndex, setMonthIndex] = useState(0)
  const [openIso, setOpenIso] = useState<string | null>(null)
  const [completed, setCompleted] = useState<Set<string>>(loadCompleted)
  const [hidden, setHidden] = useState<Set<SubjectCode>>(() => new Set())

  // Persist completion to localStorage whenever it changes.
  useEffect(() => {
    saveCompleted(completed)
  }, [completed])

  const toggleBlock = useCallback((id: string) => {
    setCompleted((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleSubject = useCallback((code: SubjectCode) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }, [])

  const month = MONTHS[monthIndex]

  return (
    <div className="mx-auto max-w-[1000px] px-4 pb-20 pt-6 sm:px-5">
      <Header />
      <SubjectBar hidden={hidden} onToggle={toggleSubject} />
      <WeekProgress completed={completed} />

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
          completed={completed}
          onToggleBlock={toggleBlock}
          onClose={() => setOpenIso(null)}
        />
      )}
    </div>
  )
}
