import assert from 'node:assert/strict'
import {
  chunkText,
  cleanSummary,
  decodeText,
  EXAMPLE_NOTES,
  extractActionItems,
  extractAttendees,
  keySentences,
  MAX_WORDS,
  MIN_WORDS,
  splitDates,
  TOO_SHORT,
  tooLongMessage,
  tooShortMessage,
  wordCount,
} from './extract.ts'

assert.deepEqual(extractAttendees(EXAMPLE_NOTES), ['Priya Raman', 'Marcus Bell', 'Elena Ortiz', 'Sam Okafor'])
assert.deepEqual(extractAttendees('attendees: Ann and Bo'), ['Ann', 'Bo'])
assert.deepEqual(extractAttendees('no list here'), [])

const items = extractActionItems(EXAMPLE_NOTES)
assert.ok(items.includes('Priya will draft the SSO technical spec by Friday.'))
assert.ok(items.includes('Marcus needs to follow up with the payments vendor about the SDK fix.'))
assert.ok(items.every((i) => !/^attendees/i.test(i) && !i.startsWith('-')))
assert.deepEqual(extractActionItems('We discussed the weather.'), [])
assert.deepEqual(extractActionItems('Nothing here. Bob MUST ship it.'), ['Bob MUST ship it.'])
// "by" must be a whole word, not part of "nearby"
assert.deepEqual(extractActionItems('The office nearby is nice.'), [])

const dates = splitDates('Send it by Dec 3 or next Monday, else EOD 11/30.').filter((p) => p.date).map((p) => p.text)
assert.deepEqual(dates, ['Dec 3', 'next Monday', 'EOD', '11/30'])
assert.equal(splitDates('plain text').map((p) => p.text).join(''), 'plain text')

const long = Array.from({ length: 300 }, (_, i) => `Sentence number ${i} is here.`).join(' ')
const chunks = chunkText(long)
assert.ok(chunks.length > 1 && chunks.every((c) => c.split(' ').length <= 550))
assert.equal(chunks.join(' '), long)

// A tiny trailing chunk is folded into the previous one rather than summarized on its own.
const tail = long + ' Short tail sentence here.'
assert.ok(chunkText(tail).every((c) => c.split(' ').length >= MIN_WORDS))

// Too-short notes: 5 words shows the message instead of running the summarizer.
assert.equal(tooShortMessage('Ana will send the deck.'), TOO_SHORT)
assert.equal(tooShortMessage(''), TOO_SHORT)
assert.equal(tooShortMessage(EXAMPLE_NOTES), null)
// Action items and attendees still come through for short notes.
assert.deepEqual(extractActionItems('Attendees: Ana\nAna will send it.'), ['Ana will send it.'])
assert.deepEqual(extractAttendees('Attendees: Ana\nAna will send it.'), ['Ana'])

// Normal example: raw model output with a repeated sentence (also across chunks) and a cut-off ending.
const raw = [
  'Early test results show a 14% lift in sign-ups. Marcus raised concerns that the mobile release is slipping. ' +
    'Early test results show a 14% lift in sign-ups. The vendor confirmed a fix is coming next',
  'Enterprise accounts want audit logs and SSO. Marcus raised concerns that the mobile release is slipping! The budget was',
]
const summary = cleanSummary(raw)
assert.equal(
  summary,
  'Early test results show a 14% lift in sign-ups. Marcus raised concerns that the mobile release is slipping.\n\n' +
    'Enterprise accounts want audit logs and SSO.',
)
assert.match(summary, /[.!?]$/)
const sentences = summary.split(/(?<=[.!?])\s+/).map((x) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
assert.equal(new Set(sentences).size, sentences.length)
// No complete sentence at all: keep the fragment but end it at a full stop.
assert.equal(cleanSummary(['the team discussed the roadmap,']), 'the team discussed the roadmap.')

// Decimals and versions are not sentence breaks.
assert.equal(cleanSummary(['Sign-ups rose 14.5% after v2.0 shipped. Then it was']), 'Sign-ups rose 14.5% after v2.0 shipped.')

// Grounding: sentences whose words mostly aren't in the notes are dropped as invented.
const notes = 'The team reviewed the onboarding redesign. Dark mode is paused until January.'
assert.equal(
  cleanSummary(['The team reviewed the onboarding redesign. The company is working on a new app that lets users create a new system. Dark mode was paused until January.'], notes),
  'The team reviewed the onboarding redesign. Dark mode was paused until January.',
)
assert.equal(cleanSummary(['Something entirely unrelated happened yesterday.'], notes), '')

// --- QA cases ---
const dateTexts = (t: string) => splitDates(t).filter((p) => p.date).map((p) => p.text)

// 1. Empty and spaces-only notes never reach the model (they're "too short").
assert.equal(wordCount('   \n\t  '), 0)
assert.equal(tooShortMessage('   \n\t '), TOO_SHORT)

// 2. 5 and 30 words are too short; 40 is enough.
assert.equal(tooShortMessage('one two three four five'), TOO_SHORT)
assert.equal(tooShortMessage(Array(30).fill('word').join(' ')), TOO_SHORT)
assert.equal(tooShortMessage(Array(40).fill('word').join(' ')), null)

// 4. Long notes: about 2,000 words splits into several chunks, each within the model's limit.
const twoK = Array.from({ length: 200 }, (_, i) => `Topic ${i % 5} point ${i} was discussed.`).join(' ')
const twoKChunks = chunkText(twoK)
assert.ok(twoKChunks.length >= 3 && twoKChunks.every((c) => c.split(' ').length <= 550 + MIN_WORDS))
assert.ok(twoKChunks.at(-1)!.includes('point 199'), 'last chunk covers the end of the notes')
assert.equal(tooLongMessage(MAX_WORDS + 1).includes('10,000'), true)

// 5. Messy formatting.
assert.deepEqual(extractActionItems('* Ana will go\n• Ben should call\n1. Cy must sign\n2) Dee needs to pay\n\n\n\tEd will email'), [
  'Ana will go',
  'Ben should call',
  'Cy must sign',
  'Dee needs to pay',
  'Ed will email',
])
assert.deepEqual(extractAttendees('Attendees: Ana, Ben\r\nAna will go.\r\n'), ['Ana', 'Ben'])
assert.deepEqual(extractActionItems('Attendees: Ana, Ben\r\nAna will go.\r\n'), ['Ana will go.'])
assert.deepEqual(
  extractActionItems('We met today. Ana will send the deck by Friday. Lunch was good. Ben must call the vendor.'),
  ['Ana will send the deck by Friday.', 'Ben must call the vendor.'],
)
// One very long line with no breaks or punctuation still fits the model.
assert.deepEqual(chunkText(Array(1200).fill("word").join(" ")).map((c) => c.split(" ").length), [550, 550, 100])

// 6. Accented and non-Latin names survive extraction untouched.
assert.deepEqual(extractAttendees('Attendees: José, Zoë, Nguyễn Văn An, রহিম, 王伟'), ['José', 'Zoë', 'Nguyễn Văn An', 'রহিম', '王伟'])
assert.deepEqual(extractActionItems('Zoë will send the deck. 王伟 should review it.'), ['Zoë will send the deck.', '王伟 should review it.'])

// 7. Special characters are kept as plain text.
assert.deepEqual(extractActionItems('Ana will fix <script>alert(1)</script> & “quotes” 🎉'), ['Ana will fix <script>alert(1)</script> & “quotes” 🎉'])

// 8. Catches the common forms.
assert.deepEqual(
  extractActionItems('Sam will send the report by Friday\nAna needs to book the room\nFollow up with IT\nDeadline: Dec 5\nBen should email the dean'),
  ['Sam will send the report by Friday', 'Ana needs to book the room', 'Follow up with IT', 'Deadline: Dec 5', 'Ben should email the dean'],
)
assert.deepEqual(extractActionItems('We will circulate the minutes.\nThe team should rerun the test.\nThe report is due by July 1st.'), [
  'We will circulate the minutes.',
  'The team should rerun the test.',
  'The report is due by July 1st.',
])

// 9. Doesn't catch ordinary sentences.
assert.deepEqual(
  extractActionItems('The weather will be nice.\nWe stood by the window.\nIt will rain later.\nThis should be fine.\nTomorrow will be busy.\nWe sat by the door.'),
  [],
)

// 10. Date formats.
assert.deepEqual(dateTexts('July 1st, 7/1, Dec 5, next Monday, by Friday, 2026-12-01, EOD, 3 March'), [
  'July 1st',
  '7/1',
  'Dec 5',
  'next Monday',
  'Friday',
  '2026-12-01',
  'EOD',
  '3 March',
])
// Lowercase day abbreviations are ordinary words.
assert.deepEqual(dateTexts('We sat in the sun and will march on. Meet Wed.'), ['Wed'])

// 11. Original capitalization is kept.
assert.deepEqual(extractActionItems('- SAM will send the API docs to McKinsey by Friday.'), ['SAM will send the API docs to McKinsey by Friday.'])

// 12. Attendee line variants, separators, extra spaces, trailing comma.
assert.deepEqual(extractAttendees('Attendees: Ana, Ben'), ['Ana', 'Ben'])
assert.deepEqual(extractAttendees('attendees - Ana and Ben'), ['Ana', 'Ben'])
assert.deepEqual(extractAttendees('Present: Ana;  Ben ;Chloe'), ['Ana', 'Ben', 'Chloe'])
assert.deepEqual(extractAttendees('Participants:   Ana Lopez ,  Ben   Wu, and Chloe,'), ['Ana Lopez', 'Ben Wu', 'Chloe'])
assert.deepEqual(extractAttendees('- Attendees: Ana, Ana, Ben.'), ['Ana', 'Ben'])
assert.deepEqual(extractActionItems('Present: Ana will, Ben'), [], 'the attendee line is never an action item')

assert.deepEqual(extractAttendees('Attendees: Ben & Jerry, Ana'), ['Ben & Jerry', 'Ana'], '& is part of a name, not a separator')

// Lines reach the model as separate sentences, without bullet markers.
assert.deepEqual(chunkText('Attendees: Kim\nKim will send the plan\n- Ana should call'), ['Attendees: Kim. Kim will send the plan. Ana should call.'])

// 13. No attendees line.
assert.deepEqual(extractAttendees('We met.\nAna will go.'), [])

// 14. Uploaded file decoding.
const enc = new TextEncoder()
assert.equal(decodeText(enc.encode('José and Zoë\r\nline 2')), 'José and Zoë\nline 2')
assert.equal(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('BOM')])), 'BOM')
assert.equal(decodeText(new Uint8Array([0x4a, 0x6f, 0x73, 0xe9])), 'José', 'Windows-1252 fallback')
assert.equal(decodeText(new Uint8Array([0xff, 0xfe, 0x5a, 0x00, 0xeb, 0x00])), 'Zë', 'UTF-16LE')
assert.equal(decodeText(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0x01])), null, 'binary rejected')
assert.equal(decodeText(new Uint8Array([])), '')

// Grounding: invented sentences seen from the real model on long notes are dropped; faithful ones stay.
const opsNotes = `Omar opened with an update on the warehouse automation pilot in the Columbus facility. The biggest problem has been the cart charging schedule.
Grace's team built a bulk refund script with the billing team, and the backlog is now down to 640 tickets. Paul noted the hiring freeze is still in place for most departments.
The group agreed to pilot rolling forecasts in operations only for the second half of the year. Lucia added a short sustainability update at the end of the day.
Most tickets were simple refund requests.`
assert.equal(
  cleanSummary(
    [
      'The warehouse automation pilot in Columbus, Ohio, has been working with a company for two years. The biggest problem has been the cart charging schedule.',
      'The backlog of refund requests has been reduced to 640.2 million people. A new company is offering a free-to-the-table refund for the first time since February. The company\'s hiring freeze was put in place before the end of the year.',
      'The group agreed to pilot rolling forecasts in operations only for the second half of the year. Columbus team has been given a short sustainability update on the city\'s waste and energy policy.',
    ],
    opsNotes,
  ),
  'The biggest problem has been the cart charging schedule.\n\nThe group agreed to pilot rolling forecasts in operations only for the second half of the year.',
)
assert.equal(cleanSummary(['The backlog is now down to 640 tickets.'], opsNotes), 'The backlog is now down to 640 tickets.')
assert.equal(cleanSummary(['The backlog is now down to 600 tickets.'], opsNotes), '', 'a number not in the notes is dropped')

// Fallback key sentences: quoted from the chunk, most representative first, in original order, headings skipped.
const chunk = 'Topic 2: Suppliers. Three suppliers missed delivery windows this quarter. The packaging supplier was late on nine shipments. Lunch was served at noon in the main hall. Lucia proposed qualifying a second packaging supplier for shipments.'
const key = keySentences(chunk)
assert.equal(key, 'The packaging supplier was late on nine shipments. Lucia proposed qualifying a second packaging supplier for shipments.')
assert.ok(key.split(/(?<=\.)\s/).every((x) => chunk.includes(x)), 'every fallback sentence is a verbatim quote')
assert.equal(keySentences('Too short. Also short.'), '')

// Run-together words and words that aren't in the notes are rejected; plurals are fine.
const office = 'Discussion point 2 covered the plan for the new office move and the timeline for the IT setup.'
assert.equal(cleanSummary(['Discussionpoint 2 covered the plan for thenew office move.'], office), '')
assert.equal(cleanSummary(['Discussion point 2 covered the plans for the new office move.'], office), 'Discussion point 2 covered the plans for the new office move.')

// Recombined claims are dropped; normal compression and tense changes are kept (real model output on the example).
const exampleOut =
  "The team reviewed the onboarding redesign. Early test results show a 14% lift in completed sign-ups. The vendor confirmed a fix is coming next week. The dark-mode project was approved for January so engineering can focus on enterprise readiness. The team will review the updated Q1 roadmap before next Monday's sync."
assert.equal(
  cleanSummary([exampleOut], EXAMPLE_NOTES),
  "The team reviewed the onboarding redesign. Early test results show a 14% lift in completed sign-ups. The vendor confirmed a fix is coming next week. The team will review the updated Q1 roadmap before next Monday's sync.",
)
assert.equal(
  cleanSummary(['The team agreed on the priorities, including hiring plan, office move and pricing page.'], 'The team agreed on the priorities, including the hiring plan, the office move and the new pricing page.'),
  'The team agreed on the priorities, including hiring plan, office move and pricing page.',
)

// Grounding works for non-English summaries too.
assert.equal(cleanSummary(['José presentó el plan.'], 'José presentó el plan de ventas.'), 'José presentó el plan.')

console.log('extract: all checks passed')
