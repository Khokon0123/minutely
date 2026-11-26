const ACTION_RE = /\b(will|should|must|needs to|by|deadline|follow[- ]up)\b/i
const ATTENDEES_RE = /^\s*attendees\s*:\s*(.*)$/i
const BULLET_RE = /^\s*(?:[-*•–]|\d+[.)]|\[[ x]?\])\s*/i

const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
const DAYS = 'mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?'
// Matches things like "Dec 3", "3 December", "Friday", "next week", "EOD", "11/30", "2026-12-01", "Q1".
export const DATE_RE = new RegExp(
  `\\b(?:(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})(?:\\s+\\d{4})?|(?:next\\s+|this\\s+)?(?:${DAYS})|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?|today|tomorrow|tonight|next\\s+(?:week|month|quarter)|end\\s+of\\s+(?:the\\s+)?(?:day|week|month|quarter)|eod|eow|q[1-4])\\b`,
  'gi',
)

const clean = (s: string) => s.replace(BULLET_RE, '').trim()

export function extractAttendees(text: string): string[] {
  for (const line of text.split('\n')) {
    const m = line.match(ATTENDEES_RE)
    if (m) return m[1].split(/\s*(?:,|;|\band\b|&)\s*/i).map((s) => s.trim().replace(/\.$/, '')).filter(Boolean)
  }
  return []
}

export function extractActionItems(text: string): string[] {
  const items: string[] = []
  for (const line of text.split('\n')) {
    if (ATTENDEES_RE.test(line)) continue
    // A line may hold several sentences; keep only the ones that read as actions.
    for (const sentence of clean(line).split(/(?<=[.!?])\s+(?=[A-Z])/)) {
      const s = sentence.trim()
      if (s && ACTION_RE.test(s) && !items.includes(s)) items.push(s)
    }
  }
  return items
}

/** Splits text into alternating [plain, date, plain, date, ...] parts. */
export function splitDates(text: string): { text: string; date: boolean }[] {
  const parts: { text: string; date: boolean }[] = []
  let last = 0
  for (const m of text.matchAll(DATE_RE)) {
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
  const sentences = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/)
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
  if (cur.length) chunks.push(cur.join(' '))
  return chunks
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
