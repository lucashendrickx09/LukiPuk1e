import { STUDY_SUBJECTS, SUBJECTS } from '../plan'
import type { SubjectCode } from '../plan'

interface Props {
  hidden: Set<SubjectCode>
  onToggle: (code: SubjectCode) => void
}

/**
 * Doubles as the legend (colour → subject) and the filter: tapping a subject
 * shows / hides its dots across the grid. Sport (★) and Rest are legend-only.
 */
export default function SubjectBar({ hidden, onToggle }: Props) {
  return (
    <section className="mt-5" aria-label="Subjects legend and filter">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        {STUDY_SUBJECTS.map((code) => {
          const sub = SUBJECTS[code]
          const off = hidden.has(code)
          return (
            <button
              key={code}
              type="button"
              onClick={() => onToggle(code)}
              aria-pressed={!off}
              title={off ? `Show ${sub.name}` : `Hide ${sub.name}`}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 transition ${
                off
                  ? 'border-edge/60 text-faint opacity-50'
                  : 'border-edge text-ink hover:border-gold/70'
              }`}
            >
              <span
                className="h-2.5 w-2.5 flex-none rounded-[3px]"
                style={{ background: sub.color, opacity: off ? 0.4 : 1 }}
              />
              {sub.name}
            </button>
          )
        })}

        <span className="ml-0.5 inline-flex items-center gap-1.5 px-1 text-muted">
          <span className="text-gold">★</span> Sport
        </span>
        <span className="inline-flex items-center gap-1.5 px-1 text-muted">
          <span
            className="h-2.5 w-2.5 flex-none rounded-[3px]"
            style={{ background: SUBJECTS.RE.color }}
          />
          Rest
        </span>
      </div>
      <p className="mt-1.5 text-[11px] text-faint">
        Tap a subject to show / hide its dots on the grid.
      </p>
    </section>
  )
}
