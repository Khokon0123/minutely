const BULLET_RE = /^\s*(?:[-*•–—·]|\d+[.)]|[a-z][.)]|\[[ x]?\])\s*/i
// "Attendees: …", "attendees - …", "Present: …", "Participants: …", optionally bulleted.
const ATTENDEES_RE = /^(?:attendees|attendance|in attendance|present|participants)\s*(?::|-|–|—)\s*(.*)$/i

const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
const DAYS = 'mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?'
// Matches things like "Dec 3", "July 1st", "3 December", "Friday", "next Monday", "EOD", "11/30", "2026-12-01", "Q1".
const DATE_SRC = `(?:(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})(?:\\s+\\d{4})?|(?:next\\s+|this\\s+)?(?:${DAYS})|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?|today|tomorrow|tonight|next\\s+(?:week|month|quarter)|end\\s+of\\s+(?:the\\s+)?(?:day|week|month|quarter)|eod|eow|q[1-4])`
const DATE_RE = new RegExp(`\\b${DATE_SRC}\\b`, 'gi')
// Lowercase "sat", "sun", "wed"… are ordinary words, not days. Only count abbreviations when capitalized.
const SHORT_DAY = /^(?:mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)$/i
const isDate = (m: string) => !(SHORT_DAY.test(m) && m[0] === m[0].toLowerCase())

function* dateMatches(text: string) {
  for (const m of text.matchAll(DATE_RE)) if (isDate(m[0])) yield m
}

// Always an action, wherever it appears.
const ALWAYS_RE = /\b(?:deadline|follow[- ]?up|action items?|to-?do)\b/i
// Strong obligation: counts whatever the subject.
const MUST_RE = /\b(?:must|needs? to)\b/i
// "will"/"should" only count when someone is doing something ("Priya will…", "We should…"),
// not for things like "The weather will be nice".
const MODAL_RE = /\b(will|should)\b/gi
const PEOPLE = new Set(
  'i we you he she they everyone everybody someone somebody team all both each vendor client customer manager lead owner engineering design marketing sales finance legal ops hr'.split(' '),
)
const NOT_PEOPLE = new Set('the this that it there these those which what who here'.split(' '))
// "by" only counts when a date follows: "by Friday", not "by the window".
const BY_DATE_RE = new RegExp(`\\bby\\s+(?:the\\s+)?${DATE_SRC}\\b`, 'i')
const WHOLE_DATE_RE = new RegExp(`^${DATE_SRC}$`, 'i')

const lines = (text: string) => text.replace(/\r\n?/g, '\n').split('\n')
const clean = (s: string) => s.replace(BULLET_RE, '').trim()

function isAction(s: string): boolean {
  if (ALWAYS_RE.test(s) || MUST_RE.test(s)) return true
  const by = s.match(BY_DATE_RE)
  if (by && isDate(by[0].replace(/^by\s+(?:the\s+)?/i, ''))) return true
  for (const m of s.matchAll(MODAL_RE)) {
    const prev = s.slice(0, m.index).match(/([\p{L}\p{N}'’]+)\W*$/u)?.[1]
    if (!prev) continue
    const word = prev.replace(/['’]s$/i, '')
    const lower = word.toLowerCase()
    // "Tomorrow will be busy" has a date, not a person, as its subject.
    if (NOT_PEOPLE.has(lower) || WHOLE_DATE_RE.test(word)) continue
    // A person's name (capitalized, or in a script without capitals like Chinese or Bengali), a pronoun, or a team/role word.
    if (PEOPLE.has(lower) || /^[\p{Lu}\p{Lo}]/u.test(word)) return true
  }
  return false
}

export function extractAttendees(text: string): string[] {
  for (const line of lines(text)) {
    const m = clean(line).match(ATTENDEES_RE)
    if (!m) continue
    const names = m[1].split(/\s*(?:,|;|\band\b)\s*/i).map((n) => n.trim().replace(/[.,;]+$/, '').replace(/\s+/g, ' '))
    return [...new Set(names.filter(Boolean))]
  }
  return []
}

export function extractActionItems(text: string): string[] {
  const items: string[] = []
  for (const line of lines(text)) {
    const body = clean(line)
    if (ATTENDEES_RE.test(body)) continue
    // A line may hold several sentences; keep only the ones that read as actions.
    for (const sentence of body.split(/(?<=[.!?])\s+(?=[^\p{Ll}])|(?<=[。！？])\s*/u)) {
      const s = sentence.trim()
      if (s && isAction(s) && !items.includes(s)) items.push(s)
    }
  }
  return items
}

/** Splits text into alternating [plain, date, plain, date, ...] parts. */
export function splitDates(text: string): { text: string; date: boolean }[] {
  const parts: { text: string; date: boolean }[] = []
  let last = 0
  for (const m of dateMatches(text)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), date: false })
    parts.push({ text: m[0], date: true })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), date: false })
  return parts
}

// ponytail: word-count chunking (~1 word ≈ 1.3 tokens keeps us under the model's 1024-token limit);
// switch to tokenizer-based chunking if summaries start getting truncated.
export function chunkText(text: string, maxWords = 550): string[] {
  // Split on sentence ends, then break any run-on "sentence" longer than a chunk into word slices.
  // Treat each line as its own sentence: strip bullets and close unpunctuated lines, so headings and
  // list items don't run into each other ("Attendees: Kim" + "Kim will…" must not read as "Kim Kim will…").
  const sentences = lines(text)
    .map(clean)
    .filter(Boolean)
    .map((l) => (/[.!?:;]["')\]]*$/.test(l) ? l : l + '.'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .flatMap((s) => {
      const words = s.split(' ')
      if (words.length <= maxWords) return [s]
      const slices: string[] = []
      for (let i = 0; i < words.length; i += maxWords) slices.push(words.slice(i, i + maxWords).join(' '))
      return slices
    })
  const chunks: string[] = []
  let cur: string[] = []
  let count = 0
  for (const s of sentences) {
    const n = s.split(' ').length
    if (count + n > maxWords && cur.length) {
      chunks.push(cur.join(' '))
      cur = []
      count = 0
    }
    cur.push(s)
    count += n
  }
  if (cur.length) {
    // A tiny trailing chunk gives the model too little to work with, so it invents text. Fold it into the previous one.
    if (count < MIN_WORDS && chunks.length) chunks[chunks.length - 1] += ' ' + cur.join(' ')
    else chunks.push(cur.join(' '))
  }
  return chunks
}

/**
 * Decodes an uploaded file: UTF-16 with a byte-order mark, UTF-8 (BOM stripped), or, if the bytes aren't
 * valid UTF-8, Windows-1252, the usual encoding of older Windows text files. Returns null for binary data.
 */
export function decodeText(bytes: Uint8Array): string | null {
  let text: string
  if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le').decode(bytes)
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be').decode(bytes)
  else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      text = new TextDecoder('windows-1252').decode(bytes)
    }
  }
  return text.includes('\0') ? null : text.replace(/\r\n?/g, '\n')
}

export const MIN_WORDS = 40
export const TOO_SHORT = 'Your notes are too short to summarize. Add a few more sentences and try again.'

export const MAX_WORDS = 10000
export const tooLongMessage = (words: number) =>
  `These notes are ${words.toLocaleString()} words long. Minutely summarizes up to ${MAX_WORDS.toLocaleString()} words at a time, so split them into parts.`

export const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0)

/** Returns the message to show instead of a summary, or null when the notes are long enough to summarize. */
export const tooShortMessage = (text: string) => (wordCount(text) < MIN_WORDS ? TOO_SHORT : null)

const sentenceKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

export const NO_RELIABLE_SUMMARY = "Couldn't write a reliable summary of these notes. The action items and attendees below come straight from your text."

const tokens = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
const NUMBER_RE = /\d+(?:[.,]\d+)*/g

// ponytail: grounding check. A sentence is kept only if every word and number in it appears in the notes,
// most of its word pairs do too, and it has no long stretch of new phrasing. Catches invented facts and figures; a sentence that
// recombines real phrases into a wrong claim can still get through.
const GROUNDED = 0.6
// Joining words a summary may add even if the notes don't use them.
const GLUE = new Set(
  'a an the and or but of to in on at for with by from as is are was were be been has have had it its he she they their them his her this that these those who which also said says will would'.split(' '),
)
// For phrase matching, ignore articles, the tense of "to be" and plural "s", so "including hiring plans"
// matches "including the hiring plan" and "was paused" matches "is paused".
const BE = new Set(['is', 'was', 'are', 'were', 'be', 'been', 'being'])
const phraseWords = (words: string[]) =>
  words.filter((w) => w !== 'the' && w !== 'a' && w !== 'an').map((w) => (BE.has(w) ? 'be' : w.length > 3 ? w.replace(/s$/, '') : w))
const trigrams = (words: string[]) => words.slice(2).map((w, i) => `${words[i]} ${words[i + 1]} ${w}`)
// Three new three-word phrases in a row means the model stitched real words into a new claim,
// e.g. "the dark-mode project was approved for January" when the notes say it was paused.
const MAX_NEW_RUN = 3

function groundingIndex(notes: string) {
  const words = tokens(notes)
  return {
    words: new Set(words),
    pairs: new Set(words.slice(1).map((w, i) => words[i] + ' ' + w)),
    triples: new Set(trigrams(phraseWords(words))),
    numbers: new Set(notes.match(NUMBER_RE) ?? []),
  }
}
function grounded(sentence: string, index: ReturnType<typeof groundingIndex>) {
  if ((sentence.match(NUMBER_RE) ?? []).some((n) => !index.numbers.has(n))) return false
  const words = tokens(sentence)
  // Every word must come from the notes (allowing a plural "s"), which rules out invented names, places and
  // run-together words like "thenew".
  const known = (w: string) => GLUE.has(w) || index.words.has(w) || index.words.has(w.replace(/s$/, '')) || index.words.has(w + 's')
  if (!words.every(known)) return false
  if (words.length < 2) return true
  const pairs = words.slice(1).map((w, i) => words[i] + ' ' + w)
  if (pairs.filter((p) => index.pairs.has(p)).length / pairs.length < GROUNDED) return false
  let run = 0
  for (const t of trigrams(phraseWords(words))) {
    run = index.triples.has(t) ? 0 : run + 1
    if (run >= MAX_NEW_RUN) return false
  }
  return true
}

/**
 * Tidies raw model output (one string per chunk): drops sentences that repeat an earlier one,
 * anywhere in the summary, trims an unfinished last sentence so each part ends at a full stop,
 * and, when `notes` is given, drops sentences that aren't grounded in the notes (see `grounded`).
 */
export function cleanSummary(parts: string[], notes?: string): string {
  const source = notes === undefined ? null : groundingIndex(notes)
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of parts) {
    const sentences = (part.trim().match(/.+?[.!?]+["')\]]*(?=\s|$)|.+$/gs) ?? []).map((x) => x.trim()).filter(Boolean)
    const complete = sentences.filter((x) => /[.!?]["')\]]*$/.test(x))
    // If the model produced no complete sentence at all, keep the fragment and close it.
    if (!complete.length && sentences.length) complete.push(sentences.join(' ').replace(/[,;:\s]+$/, '') + '.')
    const kept = complete.filter((x) => {
      const k = sentenceKey(x)
      if (!k || seen.has(k) || (source && !grounded(x, source))) return false
      seen.add(k)
      return true
    })
    if (kept.length) out.push(kept.join(' '))
  }
  return out.join('\n\n')
}

// Common words that say nothing about what a sentence is about.
const STOP = new Set(
  'that this with from have were been will would should could about into their there they them then than what when which while also only just more most some such very each other after before over under because'.split(' '),
)

/**
 * Picks the `n` most representative sentences of a chunk, word for word and in their original order.
 * Used when the model's summary of a chunk can't be trusted, so every part of the notes is still covered.
 */
export function keySentences(chunk: string, n = 2): string {
  const sentences = (chunk.match(/.+?[.!?]+["')\]]*(?=\s|$)|.+$/gs) ?? []).map((x) => x.trim()).filter((x) => x.split(' ').length >= 6)
  const content = (t: string) => tokens(t).filter((w) => w.length >= 4 && !STOP.has(w))
  const freq = new Map<string, number>()
  for (const w of content(chunk)) freq.set(w, (freq.get(w) ?? 0) + 1)
  const score = (x: string) => {
    const words = content(x)
    return words.reduce((sum, w) => sum + (freq.get(w) ?? 0), 0) / Math.sqrt(words.length || 1)
  }
  const top = new Set([...sentences].sort((a, b) => score(b) - score(a)).slice(0, n))
  return sentences.filter((x) => top.has(x)).join(' ')
}

export const EXAMPLE_NOTES = `Q4 Product Planning — Weekly Sync
Date: November 24, 2026
Attendees: Priya Raman, Marcus Bell, Elena Ortiz, Sam Okafor

Discussion
- The team reviewed the onboarding redesign. Early test results show a 14% lift in completed sign-ups, but users still get stuck on the workspace setup step.
- Marcus raised concerns that the mobile release is slipping because the payments SDK upgrade is taking longer than planned. The vendor confirmed a fix is coming next week.
- Elena shared customer interview findings: enterprise accounts want audit logs and SSO before they expand seats. Two large prospects are blocked on this.
- We agreed to pause the dark-mode project until January so engineering can focus on enterprise readiness.
- Budget for the January offsite was approved, pending final headcount.

Decisions
- Enterprise features (SSO, audit logs) are the top priority for Q1.
- Dark mode moves to the January backlog.

Next steps
- Priya will draft the SSO technical spec by Friday.
- Marcus needs to follow up with the payments vendor about the SDK fix.
- Elena should share the full interview notes with the design team by Dec 3.
- Sam must confirm offsite headcount with finance — deadline is end of the month.
- Everyone will review the updated Q1 roadmap before next Monday's sync.`
