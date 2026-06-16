/* ============================================================================
 *  plan.ts — the entire study plan lives here. Edit this file by hand.
 * ----------------------------------------------------------------------------
 *  HOW TO EDIT
 *  -----------
 *  • Each day is keyed by an ISO date string "YYYY-MM-DD".
 *  • Add a day by adding a new key to PLAN. Remove one by deleting its key.
 *  • A normal study day looks like:
 *
 *        '2026-06-17': {
 *          theme: 'Short headline shown on the cell + modal',
 *          blocks: [
 *            block('PH', 'Topic', 'What to do…', 'Why it matters / exam tip',
 *              [ vid('Button label', 'youtube search query') ],
 *              'Morning · 90m'),
 *          ],
 *        },
 *
 *  • Day-type flags (all optional, all boolean):
 *        rest    → green-tinted, "recover" message (Sundays)
 *        holiday → amber-tinted, "fully off" message (7–11 Jul)
 *        visitor → purple-tinted, light-study week (30 Jun–6 Jul)
 *  • sport: 'note'  → puts a ★ on the cell and a banner at the top of the modal.
 *
 *  • Video links: vid(label, query) builds a YouTube SEARCH url scoped to your
 *    query so it always resolves to current results. To pin a specific video
 *    later, just swap it for a literal object: { label: 'My video', url: 'https://youtu.be/…' }.
 *
 *  • Subject codes are the keys of SUBJECTS below. Add a subject there (code,
 *    name, colour) and it is instantly usable in block() and the legend.
 *
 *  The calendar window is PLAN_START_ISO → PLAN_END_ISO (bottom of this file).
 * ========================================================================== */

/* ----------------------------------- types -------------------------------- */

/** Every subject / day-type that can appear, keyed by short code. */
export type SubjectCode =
  | 'PH' // Physics SL
  | 'MA' // Math AI HL
  | 'EC' // Economics HL
  | 'EN' // English Lang & Lit SL
  | 'FR' // French ab initio
  | 'BM' // Business HL
  | 'EE' // Extended Essay (~3h/week)
  | 'DR' // Driving theory test
  | 'AD' // Review / admin
  | 'RE' // Rest (day-type colour, not used as a block)
  | 'SP' // Sport (watch-only blocks; hidden from the grid + modal)

export interface SubjectMeta {
  /** Full display name shown on pills + legend. */
  name: string
  /** Brand colour (hex). Used for dots, pills and tints. */
  color: string
}

export interface VideoResource {
  /** Text shown on the button. */
  label: string
  /** Opened in a new tab. Usually a YouTube search url from vid()/yt(). */
  url: string
}

export interface StudyBlock {
  subject: SubjectCode
  /** Heading for the block, e.g. "Simple harmonic motion". */
  topic: string
  /** Plain-text description of the task. */
  whatToDo: string
  /** Exam-focused tip. May contain <b>…</b> for emphasis (authored content). */
  debrief: string
  /** Free-text time label, e.g. "Morning · 90m". */
  time: string
  videos: VideoResource[]
}

export interface DayPlan {
  /** Short headline for the day. */
  theme?: string
  /** Sunday recovery day. */
  rest?: boolean
  /** Holiday — fully off. */
  holiday?: boolean
  /** Visitor week — keep study light. */
  visitor?: boolean
  /** Sport note → ★ on the cell + banner in the modal. */
  sport?: string
  /** The day's study blocks (omit for pure rest/holiday days). */
  blocks?: StudyBlock[]
}

/** The whole plan: ISO date → day. */
export type Plan = Record<string, DayPlan>

/* --------------------------------- subjects ------------------------------- */
/* Brand colours. Physics is intentionally first / heaviest-weighted in the   */
/* schedule (hardest subject, biggest grade jump), then Math, Econ, English,  */
/* French, Business in descending study load.                                 */

export const SUBJECTS: Record<SubjectCode, SubjectMeta> = {
  PH: { name: 'Physics SL', color: '#e24b4a' },
  MA: { name: 'Math AI HL', color: '#bd6cf0' },
  EC: { name: 'Economics HL', color: '#d4537e' },
  EN: { name: 'English Lang & Lit SL', color: '#1d9e75' },
  FR: { name: 'French ab initio', color: '#378add' },
  BM: { name: 'Business HL', color: '#ba7517' },
  EE: { name: 'Extended Essay', color: '#22c3d6' },
  DR: { name: 'Driving theory test', color: '#5dcaa5' },
  AD: { name: 'Review/admin', color: '#6b7785' },
  RE: { name: 'Rest', color: '#2d8c6b' },
  SP: { name: 'Sport', color: '#e8b339' },
}

/** Subjects that can appear as study blocks → drive the chips, legend & filter. */
export const STUDY_SUBJECTS: SubjectCode[] = [
  'PH',
  'MA',
  'EC',
  'EN',
  'FR',
  'BM',
  'EE',
  'DR',
  'AD',
]

/** Sport blocks are watch-only — never rendered as study work. */
export const HIDDEN_BLOCK_SUBJECTS: SubjectCode[] = ['SP']

/* --------------------------------- helpers -------------------------------- */

/** Build a YouTube SEARCH url for a query (resolves to live results). */
export function yt(query: string): string {
  return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query)
}

/** Shorthand for a video button backed by a YouTube search. */
export function vid(label: string, query: string): VideoResource {
  return { label, url: yt(query) }
}

/**
 * Concise study-block builder (positional, mirrors the original schedule):
 *   block(subject, topic, whatToDo, debrief, videos?, time?)
 */
export function block(
  subject: SubjectCode,
  topic: string,
  whatToDo: string,
  debrief: string,
  videos: VideoResource[] = [],
  time = '',
): StudyBlock {
  return { subject, topic, whatToDo, debrief, videos, time }
}

/** A day's blocks minus watch-only ones (Sport) — the list that actually renders. */
export function visibleBlocks(day: DayPlan | undefined): StudyBlock[] {
  if (!day?.blocks) return []
  return day.blocks.filter((b) => !HIDDEN_BLOCK_SUBJECTS.includes(b.subject))
}

/** Stable id for a block's completion state: "<iso>#<indexInVisibleBlocks>". */
export function blockId(iso: string, index: number): string {
  return `${iso}#${index}`
}

/* ===========================================================================
 *  THE PLAN
 *  Only study days carry blocks. rest / holiday / visitor flags are styled
 *  separately. The study weighting is intentional: Physics gets the most
 *  blocks, then Math, Econ, English, French, Business in descending load.
 * ========================================================================= */

export const PLAN: Plan = {
  /* ----------------------------- Week 1 ---------------------------------- */
  '2026-06-17': {
    theme: 'Kickoff — Physics base + Math refresh',
    blocks: [
      block(
        'PH',
        'Kinematics & forces',
        "Re-derive the suvat equations and free-body diagrams from scratch. Don't memorize — understand why each works.",
        "Goal: rebuild the foundation. If you can't derive it, you don't own it yet. <b>Do 8 problems</b>, then check.",
        [
          vid('Physics Online — kinematics', 'Physics Online IB kinematics suvat'),
          vid('Organic Chem Tutor — forces', 'Organic Chemistry Tutor physics forces free body diagram'),
        ],
        'Morning · 90m',
      ),
      block(
        'MA',
        'Sequences & series',
        'Refresh arithmetic/geometric sequences, sigma notation, sum formulas.',
        'This is warm-up before the hard HL topics. <b>Aim for speed</b> — you rated Math concepts as currently clear.',
        [vid('OCT — sequences & series', 'Organic Chemistry Tutor arithmetic geometric sequences')],
        'Afternoon · 60m',
      ),
      block(
        'DR',
        'Question bank',
        '30 questions from the official China theory bank. Note which categories you miss.',
        "You're mapping weak spots, not chasing a score yet.",
        [],
        'Evening · 20m',
      ),
    ],
  },

  '2026-06-18': {
    theme: 'Physics SHM + Econ micro',
    blocks: [
      block(
        'PH',
        'Simple harmonic motion',
        'Conditions for SHM, the a = −ω²x relationship, displacement/velocity/acceleration graphs and their phase relationships.',
        "SHM is a classic weak point. <b>Master the graphs</b> — examiners love asking why something is/isn't SHM. Restoring force ∝ displacement is the whole idea.",
        [
          vid('Physics Online — SHM', 'Physics Online IB SHM simple harmonic motion'),
          vid('OCT — SHM', 'Organic Chemistry Tutor simple harmonic motion'),
        ],
        'Morning · 90m',
      ),
      block(
        'EC',
        'Micro: elasticity & market failure',
        'PED, PES, YED, XED — and externalities, public goods, the market-failure family.',
        'Content-heavy. <b>Summarize each to one page</b> with a diagram. Diagrams are where the marks live.',
        [
          vid('OCT — elasticity', 'Organic Chemistry Tutor price elasticity demand'),
          vid('IB Econ — market failure', 'IB economics market failure externalities'),
        ],
        'Afternoon · 75m',
      ),
      block('DR', 'Question bank', '30 questions.', 'Daily reps.', [], 'Evening · 20m'),
    ],
  },

  '2026-06-19': {
    theme: 'Math calculus + English warm-up',
    sport: "USA v Australia — 06:00 TST (early AM). Catch highlights, don't lose sleep.",
    blocks: [
      block(
        'MA',
        'Differentiation applications',
        'Tangents, normals, rates of change, optimization. Then GDC calculus features.',
        'Calculus is where AI HL gets harder. <b>Get GDC-fluent</b> — knowing the calculator cold is half the battle.',
        [vid('OCT — derivatives', 'Organic Chemistry Tutor derivatives applications optimization')],
        'Morning · 90m',
      ),
      block(
        'EN',
        'Text-type analysis',
        'Pick one unseen text. Apply the framework: audience → purpose → tone → structure → devices → effect.',
        'Your "analysis brain" is just this framework repeated. <b>Name the device, then explain the effect</b> — never just spot it.',
        [vid('Analysing unseen texts', 'IB English language literature paper 1 unseen text analysis')],
        'Afternoon · 60m',
      ),
      block(
        'FR',
        'Writing — 3 text types',
        'Email, blog, postcard. Time yourself.',
        'Easy 6→7 with reps. Little and often.',
        [vid('French ab initio writing', 'IB French ab initio writing text types')],
        'Evening · 30m',
      ),
    ],
  },

  '2026-06-20': {
    theme: 'Mixed review + Econ macro',
    blocks: [
      block(
        'AD',
        'Weak-spot review',
        'Re-do the questions you got wrong Mon–Fri. Update your error log.',
        'The error log is the single highest-leverage habit for the 5→7 in Physics.',
        [],
        'Morning · 60m',
      ),
      block(
        'EC',
        'Macro: AD/AS',
        'Draw AD/AS, explain shifts, link to inflation/unemployment/growth.',
        '<b>Diagram speed + accuracy.</b> Practice drawing these until automatic.',
        [vid('OCT — AD AS model', 'Organic Chemistry Tutor aggregate demand supply')],
        'Afternoon · 75m',
      ),
      block(
        'EE',
        'Extended Essay — topic & research question',
        'Pick your EE subject and draft a sharp, answerable research question.',
        '<b>The research question is everything.</b> Narrow and arguable beats broad — get it signed off by your supervisor.',
        [vid('EE — research question', 'IB extended essay research question how to')],
        'Weekly · ~3h',
      ),
    ],
  },

  '2026-06-21': {
    rest: true,
    sport: 'CS2 Cologne Major playoffs / grand final today — watch Falcons & Spirit guilt-free.',
  },

  /* ----------------------------- Week 2 ---------------------------------- */
  '2026-06-22': {
    theme: 'Math stats + Physics thermo',
    blocks: [
      block(
        'MA',
        'Statistics & distributions',
        'Normal & binomial distributions, hypothesis testing (chi-square, t-test). Heavy AI HL territory.',
        '<b>Front-load this now.</b> Stats is a big chunk of AI HL and the GDC does the heavy lifting if you know the menus.',
        [
          vid('OCT — normal distribution', 'Organic Chemistry Tutor normal distribution'),
          vid('OCT — hypothesis testing', 'Organic Chemistry Tutor hypothesis testing chi square'),
        ],
        'Morning · 90m',
      ),
      block(
        'PH',
        'Thermodynamics',
        'Internal energy, the gas laws, first law, specific heat capacity.',
        "Lots of formulas — but link them to particle behaviour so they're not just symbols.",
        [vid('Physics Online — thermal', 'Physics Online IB thermal physics gas laws')],
        'Afternoon · 75m',
      ),
      block('DR', 'Question bank', '40 questions.', '', [], 'Evening · 20m'),
    ],
  },

  '2026-06-23': {
    theme: 'Econ paper technique + English',
    blocks: [
      block(
        'EC',
        'Paper 1 essay technique',
        'Structure: define → diagram → explain → evaluate. Write one 10-mark and one 15-mark plan.',
        '<b>The structure is the score.</b> Every P1 essay follows the same skeleton.',
        [vid('IB Econ Paper 1 technique', 'IB economics paper 1 essay structure')],
        'Morning · 80m',
      ),
      block(
        'EN',
        'Guided analysis',
        'One unseen text, full framework, written out.',
        "Building the habit until it's automatic. Compare to a model band-7 answer after.",
        [vid('Paper 1 model answer', 'IB English language literature paper 1 guided analysis')],
        'Afternoon · 60m',
      ),
      block(
        'EE',
        'Extended Essay — reading & sources',
        'Background reading. Build an annotated bibliography of 8–10 credible sources.',
        'Log every source now (author, date, page) so citations are painless later.',
        [vid('EE — sources', 'IB extended essay finding sources annotated bibliography')],
        'Weekly · ~3h',
      ),
    ],
  },

  '2026-06-24': {
    theme: 'Math financial + Physics circular',
    blocks: [
      block(
        'MA',
        'Financial maths & matrices intro',
        'Compound interest, annuities, amortization; then a gentle start on matrices.',
        'Financial maths is reliable marks. Matrices ramp up later — start gentle.',
        [
          vid('OCT — compound interest', 'Organic Chemistry Tutor compound interest annuities'),
          vid('OCT — matrices', 'Organic Chemistry Tutor matrices introduction'),
        ],
        'Morning · 90m',
      ),
      block(
        'PH',
        'Circular motion & gravitation',
        "Centripetal force/acceleration, orbital motion, Newton's law of gravitation.",
        '<b>Watch the vectors</b> — centripetal acceleration points inward even at constant speed. Common confusion.',
        [vid('Physics Online — circular motion', 'Physics Online IB circular motion gravitation')],
        'Afternoon · 75m',
      ),
    ],
  },

  '2026-06-25': {
    theme: 'Econ micro depth + Business',
    sport: 'Paraguay v Australia — 10:00 TST · Türkiye v USA same day.',
    blocks: [
      block(
        'EC',
        'Cost, revenue & market structures',
        'Perfect competition → monopoly → oligopoly. Cost/revenue curves, profit maximization.',
        'Dense. <b>One diagram per structure</b>, know the differences cold.',
        [vid('OCT — market structures', 'Organic Chemistry Tutor market structures monopoly')],
        'Morning · 80m',
      ),
      block(
        'BM',
        'Investment appraisal',
        'Payback, ARR, NPV. Work through the calculations.',
        'Quant Business marks fade fastest over summer — keep them sharp.',
        [vid('Investment appraisal IB', 'IB business management investment appraisal NPV payback')],
        'Afternoon · 60m',
      ),
    ],
  },

  '2026-06-26': {
    theme: 'Physics astro + French',
    blocks: [
      block(
        'PH',
        'Astrophysics SL',
        'Stellar quantities, the HR diagram, luminosity, the life cycle of stars.',
        'More descriptive than calculation-heavy. <b>The HR diagram is the centerpiece.</b>',
        [vid('Physics Online — astrophysics', 'Physics Online IB astrophysics HR diagram')],
        'Morning · 75m',
      ),
      block(
        'FR',
        'Vocab + 2 text types',
        'Theme vocab block, then two timed writing pieces.',
        'Consistency wins here.',
        [vid('French ab initio', 'IB French ab initio writing practice')],
        'Afternoon · 45m',
      ),
      block('DR', 'Question bank', '40 questions.', '', [], 'Evening · 20m'),
    ],
  },

  '2026-06-27': {
    theme: 'Physics full paper (timed)',
    sport: 'New Zealand v Belgium — 09:00 TST.',
    blocks: [
      block(
        'AD',
        'Physics SL past paper',
        'Sit a full SL paper under exam timing. Then mark it with the official rubric.',
        '<b>This is the real diagnostic.</b> Where you lose marks now = your study list for July.',
        [vid('IB Physics past papers', 'IB Physics SL past paper walkthrough')],
        'Morning · 2h',
      ),
      // Sport "watch" block — preserved from the source plan but hidden from
      // the grid + modal (see HIDDEN_BLOCK_SUBJECTS). The day's sport banner
      // above already covers the match.
      block('SP', 'Watch Belgium', "Belgium's final group game. Earned it.", '', [], ''),
    ],
  },

  '2026-06-28': { rest: true, sport: 'World Cup Round of 32 begins today.' },

  /* ------------------- Visitor week (29 Jun – 6 Jul): light --------------- */
  '2026-06-29': {
    visitor: true,
    theme: 'Visitor week — light reps only',
    blocks: [
      block(
        'DR',
        'Question bank — 50 Qs',
        'Phone reps between visitor activities. Low effort.',
        'Visitor in town 30 Jun–6 Jul — keep study light.',
        [],
        'Whenever',
      ),
    ],
  },

  '2026-06-30': {
    visitor: true,
    theme: 'Visitor — light English',
    blocks: [
      block(
        'EN',
        'Read one text',
        'Just read and jot notes. No full analysis.',
        'Keep the habit alive without heavy lifting.',
        [],
        'Light',
      ),
      block('DR', '50 Qs', '', '', [], 'Light'),
    ],
  },

  '2026-07-01': {
    visitor: true,
    theme: 'Visitor — French easy win',
    blocks: [
      block(
        'FR',
        'Duolingo + 1 text type',
        'The lowest-effort, highest-return subject. Perfect for a busy week.',
        '',
        [vid('French ab initio', 'IB French ab initio writing')],
        'Light',
      ),
      block('DR', '50 Qs', '', '', [], 'Light'),
      block(
        'EE',
        'Extended Essay — light reading',
        'Skim one or two sources and jot quick notes. Keep it gentle this week.',
        '',
        [],
        'Light',
      ),
    ],
  },

  '2026-07-02': {
    visitor: true,
    theme: 'Visitor — Business skim',
    blocks: [
      block('BM', 'Skim Unit 3 notes', 'Light reading only.', '', [], 'Light'),
      block('DR', '50 Qs', '', '', [], 'Light'),
    ],
  },

  '2026-07-03': {
    visitor: true,
    theme: 'Driving mock #1',
    blocks: [
      block(
        'DR',
        'Full mock test #1',
        'Sit a complete timed mock. See where you stand against the 90% pass bar.',
        "Benchmark day. Don't panic at the number — you have weeks left.",
        [],
        '30m',
      ),
    ],
  },

  '2026-07-04': { visitor: true, rest: true, sport: 'WC Round of 16 begins. Visitor day — enjoy it.' },

  '2026-07-05': { visitor: true, rest: true },

  '2026-07-06': {
    visitor: true,
    theme: 'Visitor leaves — easy admin',
    blocks: [
      block(
        'AD',
        'Plan the week',
        'Visitor leaves today. Tidy notes, set up the holiday (no study) and the re-engage week after.',
        'Soft landing.',
        [],
        'Light',
      ),
    ],
  },

  /* ------------------------- Holiday (7–11 Jul) -------------------------- */
  '2026-07-07': { holiday: true, sport: 'HOLIDAY 7–11 Jul. WC Quarter-finals 9–11 Jul.' },
  '2026-07-08': { holiday: true },
  '2026-07-09': { holiday: true, sport: 'WC Quarter-finals.' },
  '2026-07-10': { holiday: true },
  '2026-07-11': { holiday: true, sport: 'Last holiday day. Soft start tomorrow.' },

  '2026-07-12': {
    rest: true,
    blocks: [
      block(
        'AD',
        'Soft restart (optional)',
        'Tonight only: skim your error log and notes to wake the brain up.',
        'Ease back in.',
        [],
        '20m',
      ),
    ],
  },

  /* ----------------------- Week 5: re-engage ----------------------------- */
  '2026-07-13': {
    theme: 'Re-attack weak topics + integration',
    blocks: [
      block(
        'PH',
        'Weak topics from June paper',
        'Hit the exact topics you lost marks on in the 27 Jun paper.',
        '<b>Targeted, not general.</b> This is the efficient path to 7.',
        [vid('Physics Online', 'Physics Online IB physics revision')],
        'Morning · 90m',
      ),
      block(
        'MA',
        'Integration',
        'Definite/indefinite integrals, area under curves, GDC integration.',
        'The other half of calculus. Pair with the differentiation you did in June.',
        [vid('OCT — integration', 'Organic Chemistry Tutor integration definite integral')],
        'Afternoon · 75m',
      ),
      block('DR', 'Mock #2', '', 'Should be climbing now.', [], 'Evening · 30m'),
    ],
  },

  '2026-07-14': {
    theme: 'Econ paper 2 + Physics waves',
    sport: 'WC Semi-finals 14–15 Jul.',
    blocks: [
      block(
        'EC',
        'Paper 2 data response',
        'Technique for extracting and using data, applying theory to a real-world stimulus.',
        'Different skill from P1 — practice reading the stimulus fast.',
        [vid('IB Econ Paper 2', 'IB economics paper 2 data response technique')],
        'Morning · 80m',
      ),
      block(
        'PH',
        'Waves & sound',
        'Wave properties, superposition, standing waves, the Doppler effect.',
        'Links to SHM. Standing waves and harmonics are favourite exam topics.',
        [vid('Physics Online — waves', 'Physics Online IB waves superposition standing waves')],
        'Afternoon · 75m',
      ),
    ],
  },

  '2026-07-15': {
    theme: 'Math trig/vectors + English',
    blocks: [
      block(
        'MA',
        'Trigonometry & vectors',
        'Trig ratios, the sine/cosine rules, vector operations and applications.',
        'Vectors recur across AI HL — get comfortable with notation.',
        [
          vid('OCT — vectors', 'Organic Chemistry Tutor vectors'),
          vid('OCT — trigonometry', 'Organic Chemistry Tutor trigonometry law of sines cosines'),
        ],
        'Morning · 90m',
      ),
      block(
        'EN',
        'Comparative analysis',
        'Two texts side by side — compare technique and effect.',
        'Builds toward the harder paper questions.',
        [vid('Comparative text analysis', 'IB English paper 1 comparative analysis')],
        'Afternoon · 60m',
      ),
    ],
  },

  '2026-07-16': {
    theme: 'Physics fields + Business ratios',
    blocks: [
      block(
        'PH',
        'Fields',
        'Gravitational and electric fields, field strength, potential.',
        'Abstract — use field-line diagrams to make it concrete.',
        [vid('Physics Online — fields', 'Physics Online IB fields gravitational electric')],
        'Morning · 90m',
      ),
      block(
        'BM',
        'Ratio analysis',
        'Profitability, liquidity, efficiency ratios. Calculate and interpret.',
        'Interpretation marks matter as much as the calculation.',
        [vid('IB Business ratios', 'IB business management ratio analysis')],
        'Afternoon · 60m',
      ),
      block(
        'EE',
        'Extended Essay — refine RQ + outline',
        'Tighten your research question and outline the essay section by section.',
        '<b>A clear outline now saves the draft later.</b> Map each section back to your RQ.',
        [vid('EE — structure', 'IB extended essay structure outline')],
        'Weekly · ~3h',
      ),
    ],
  },

  '2026-07-17': {
    theme: 'French timed + Math mixed',
    blocks: [
      block(
        'FR',
        'Timed writing',
        'Full writing piece under exam conditions.',
        'Producing under pressure with limited vocab is the real skill.',
        [vid('French ab initio', 'IB French ab initio writing exam')],
        'Morning · 45m',
      ),
      block(
        'MA',
        'Mixed problem set',
        'Calculus + stats + algebra combined.',
        'Keeps everything warm.',
        [],
        'Afternoon · 75m',
      ),
    ],
  },

  '2026-07-18': {
    theme: 'Math AI HL past paper',
    sport: 'WC Final tomorrow — 03:00 TST.',
    blocks: [
      block(
        'AD',
        'Math AI HL past paper',
        'Full timed paper, then mark and log gaps.',
        'Your July Math diagnostic.',
        [vid('Math AI HL past paper', 'IB Math AI HL past paper walkthrough')],
        'Morning · 2h',
      ),
    ],
  },

  '2026-07-19': { rest: true, sport: 'World Cup FINAL tonight — 03:00 TST. MetLife Stadium.' },

  /* ----------------------------- Week 6 ---------------------------------- */
  '2026-07-20': {
    theme: 'English framework + Physics drills',
    blocks: [
      block(
        'EN',
        'Build your analysis framework',
        'Write out your repeatable method as a one-page checklist you apply to every text.',
        '<b>This is the fix for "no analysis brain."</b> A framework you trust removes the fear of unseen texts.',
        [vid('Analysis framework', 'IB English paper 1 analysis framework SCASI')],
        'Morning · 75m',
      ),
      block(
        'PH',
        'Problem-solving drills',
        'Mixed problems forcing you to choose the approach.',
        'Builds the "adapting to questions" skill you flagged.',
        [],
        'Afternoon · 75m',
      ),
    ],
  },

  '2026-07-21': {
    theme: 'Econ micro pass + Math probability',
    blocks: [
      block(
        'EC',
        'Full content pass — micro',
        'Speed-review the entire micro half. One-page summaries.',
        'Beating the volume.',
        [],
        'Morning · 80m',
      ),
      block(
        'MA',
        'Probability',
        'Conditional probability, tree diagrams, distributions link-up.',
        '',
        [vid('OCT — probability', 'Organic Chemistry Tutor probability conditional')],
        'Afternoon · 60m',
      ),
    ],
  },

  '2026-07-22': {
    theme: 'English apply + Driving mock',
    blocks: [
      block(
        'EN',
        'Apply framework × 2',
        'Two unseen texts using your new one-page method. Time it.',
        'Speed comes from repetition now.',
        [],
        'Morning · 75m',
      ),
      block('DR', 'Mock #3', '', 'Targeting 90%+.', [], 'Afternoon · 30m'),
      block(
        'EE',
        'Extended Essay — draft the introduction',
        'Write the introduction and your first body section (~800–1000 words).',
        'Write badly first, fix later — momentum beats perfection on a first draft.',
        [],
        'Weekly · ~3h',
      ),
    ],
  },

  '2026-07-23': {
    theme: 'Econ macro pass + Business',
    blocks: [
      block('EC', 'Full content pass — macro', 'Speed-review the entire macro half.', '', [], 'Morning · 80m'),
      block('BM', 'Marketing & operations', 'Review notes on the qualitative units.', '', [], 'Afternoon · 60m'),
    ],
  },

  '2026-07-24': {
    theme: 'Physics timed + French',
    blocks: [
      block(
        'PH',
        'Timed section practice',
        'One section under strict timing — builds exam stamina.',
        '',
        [],
        'Morning · 75m',
      ),
      block('FR', '2 text types', '', ' ', [vid('French', 'IB French ab initio writing')], 'Afternoon · 45m'),
    ],
  },

  '2026-07-25': {
    theme: 'English Paper 1 (timed)',
    blocks: [
      block(
        'AD',
        'English Paper 1 practice',
        'Full timed paper using your framework.',
        'Confirm the framework holds under pressure.',
        [vid('Paper 1 practice', 'IB English language literature paper 1 walkthrough')],
        'Morning · 1.5h',
      ),
    ],
  },

  '2026-07-26': { rest: true },

  /* ----------------------------- Week 7 ---------------------------------- */
  '2026-07-27': {
    theme: 'Driving target + Physics cleanup',
    blocks: [
      block(
        'DR',
        'Mock #4 — book the test',
        'Should hit 90%+. If so, book your theory test for this week.',
        "<b>Test week.</b> Sit it while everything's fresh.",
        [],
        'Morning · 30m',
      ),
      block('PH', 'Weak-topic cleanup', 'Final sweep of anything still shaky.', '', [], 'Afternoon · 75m'),
    ],
  },

  '2026-07-28': {
    theme: 'Econ diagrams + Math paper',
    blocks: [
      block(
        'EC',
        'Diagram speed drills',
        'Draw every key diagram from memory, fast and accurate.',
        'Marks per minute — this is exam efficiency.',
        [],
        'Morning · 60m',
      ),
      block('MA', 'Mixed HL paper', 'Full paper.', '', [], 'Afternoon · 90m'),
    ],
  },

  '2026-07-29': {
    theme: 'Business paper + English',
    blocks: [
      block(
        'BM',
        'Past paper question',
        'One full question, marked.',
        "Confirm you're still at 7.",
        [vid('IB Business past paper', 'IB business management HL past paper')],
        'Morning · 60m',
      ),
      block('EN', 'Essay refinement', 'Polish a previous essay against the rubric.', '', [], 'Afternoon · 50m'),
    ],
  },

  '2026-07-30': {
    theme: 'THEORY TEST + Physics paper',
    blocks: [
      block(
        'DR',
        'Sit the theory test',
        'Test window — sit it this week if booked.',
        "<b>The goal you've been building to.</b>",
        [],
        '',
      ),
      block(
        'PH',
        'Full paper',
        'Another timed SL paper — measure improvement vs 27 Jun.',
        '',
        [],
        'Afternoon · 2h',
      ),
    ],
  },

  '2026-07-31': {
    theme: 'Math review + French timed',
    blocks: [
      block('MA', 'Calculus + stats review', 'Combined review of your two biggest HL chunks.', '', [], 'Morning · 80m'),
      block('FR', 'Timed writing', '', ' ', [], 'Afternoon · 45m'),
      block(
        'EE',
        'Extended Essay — draft the analysis',
        'Draft the main body / analysis sections, leaning on your sources.',
        'Quote, then analyse — every source should earn its place against the RQ.',
        [],
        'Weekly · ~3h',
      ),
    ],
  },

  '2026-08-01': {
    theme: 'Cross-subject review',
    blocks: [
      block(
        'AD',
        'Weak-spot sweep',
        'Review your error log across all subjects. Re-do the worst offenders.',
        '',
        [],
        'Morning · 90m',
      ),
    ],
  },

  '2026-08-02': { rest: true },

  /* ----------------------- Week 8: past papers --------------------------- */
  '2026-08-03': {
    theme: 'Past papers — Physics + Math',
    blocks: [
      block('PH', 'Past paper + full mark-up', 'Sit, then mark in detail.', '', [], 'Morning · 2h'),
      block('MA', 'Past paper', 'Full timed paper.', '', [], 'Afternoon · 1.5h'),
    ],
  },

  '2026-08-04': {
    theme: 'Econ P1+P2 + English',
    blocks: [
      block('EC', 'Paper 1 + Paper 2 timed', 'Both under timing.', '', [], 'Morning · 2h'),
      block('EN', 'Unseen practice', 'One more unseen, framework applied.', '', [], 'Afternoon · 60m'),
    ],
  },

  '2026-08-05': {
    theme: 'Physics error re-do',
    blocks: [
      block(
        'PH',
        'Re-do every wrong question',
        "Go through this year's errors and re-attempt them all.",
        '<b>Highest-leverage Physics day of the summer.</b>',
        [],
        'Morning · 2h',
      ),
    ],
  },

  '2026-08-06': {
    theme: 'Business paper + French sweep',
    blocks: [
      block('BM', 'Full past paper', '', ' ', [], 'Morning · 75m'),
      block('FR', 'Final text-type sweep', 'All the text types, one last cycle.', '', [], 'Afternoon · 45m'),
      block(
        'EE',
        'Extended Essay — full first draft',
        'Draft the remaining sections + conclusion. Assemble a complete first draft.',
        '<b>A complete rough draft is the milestone.</b> You can only edit something that exists.',
        [],
        'Weekly · ~3h',
      ),
    ],
  },

  '2026-08-07': {
    theme: 'Math paper + Econ flashcards',
    blocks: [
      block('MA', 'Past paper #2', '', ' ', [], 'Morning · 1.5h'),
      block('EC', 'Definitions & diagrams', 'Flashcard sweep of terms and diagrams.', '', [], 'Afternoon · 60m'),
    ],
  },

  '2026-08-08': {
    theme: 'Whole-week error review',
    blocks: [
      block('AD', 'Error review', 'Consolidate everything you got wrong this week.', '', [], 'Morning · 90m'),
    ],
  },

  '2026-08-09': { rest: true },

  /* ------------------------- Week 9: taper ------------------------------- */
  '2026-08-10': {
    theme: 'Polish — Physics + English',
    blocks: [
      block('PH', 'Targeted weak topics only', 'No new material. Just shore up the last gaps.', '', [], 'Morning · 60m'),
      block('EN', 'Framework refresh', 'Re-read your one-page method.', '', [], 'Afternoon · 40m'),
    ],
  },

  '2026-08-11': {
    theme: 'Light review',
    blocks: [
      block('MA', 'Light Math review', 'No new material.', 'Taper — protect your energy.', [], 'Morning · 50m'),
      block('EC', 'Skim diagrams', '', ' ', [], 'Afternoon · 40m'),
    ],
  },

  '2026-08-12': {
    theme: 'Light — French + Business',
    blocks: [
      block('FR', 'Light French', '', ' ', [], 'Morning · 30m'),
      block('BM', 'Skim notes', '', ' ', [], 'Afternoon · 30m'),
    ],
  },

  '2026-08-13': {
    theme: 'Confidence pass',
    blocks: [
      block(
        'AD',
        'Re-read your best notes',
        'Read what you know well. Build confidence, not stress.',
        '',
        [],
        'Light',
      ),
      block(
        'EE',
        'Extended Essay — review draft + reflections',
        'Read your draft critically and write the three RPPF reflections.',
        '<b>The RPPF reflections are assessed</b> — do them before the end of term, not after.',
        [],
        'Review',
      ),
    ],
  },

  '2026-08-14': {
    theme: 'Organize for Year 12',
    blocks: [
      block('AD', 'Set up Year 12 folders', 'Light admin. Get organized for the term ahead.', '', [], 'Light'),
    ],
  },

  '2026-08-15': { rest: true, sport: 'END — you made it. Adjust if your real date differs.' },
}

/* --------------------------- calendar window ------------------------------ */
/* The grid shows June–August 2026; days outside this window are greyed out.  */
export const PLAN_START_ISO = '2026-06-17'
export const PLAN_END_ISO = '2026-08-15'
