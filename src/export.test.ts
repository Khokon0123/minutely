import assert from 'node:assert/strict'
import { unzipSync, strFromU8 } from 'fflate'
import { buildDocx, buildPdf, buildText, NO_ACTIONS, NO_ATTENDEES, pdfCanDraw, sections, TITLE, type Result } from './export.ts'

const r: Result = {
  date: 'November 25, 2026',
  summary: 'The team reviewed the redesign (v2.0) & pricing.\n\nMarcus raised concerns about <timing>.',
  actions: ['Priya will draft the spec by Friday.', 'José should email the dean — “soon”.'],
  attendees: ['Priya Raman', 'José', 'Zoë'],
}
const s = sections(r)

// Plain text: exactly the on-screen content.
assert.equal(
  buildText(r),
  [
    TITLE,
    r.date,
    '',
    'Summary',
    'The team reviewed the redesign (v2.0) & pricing.\n\nMarcus raised concerns about <timing>.',
    '',
    'Action items',
    '- Priya will draft the spec by Friday.',
    '- José should email the dean — “soon”.',
    '',
    'Attendees',
    'Priya Raman, José, Zoë',
    '',
  ].join('\n'),
)
const empty: Result = { date: r.date, summary: '', note: 'Your notes are too short.', actions: [], attendees: [] }
assert.ok(buildText(empty).includes(`Your notes are too short.\n\nAction items\n${NO_ACTIONS}\n\nAttendees\n${NO_ATTENDEES}\n`))

// Word: unzip and read the document text.
const docxText = async (res: Result) => {
  const files = unzipSync(new Uint8Array(await (await buildDocx(res)).arrayBuffer()))
  const xml = strFromU8(files['word/document.xml'])
  const paras = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) => [...p[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(''))
  const unescape = (t: string) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  return { paras: paras.filter(Boolean).map(unescape), xml }
}
const d = await docxText(r)
assert.deepEqual(d.paras, [TITLE, r.date, 'Summary', ...s.summary, 'Action items', ...s.actions, 'Attendees', s.attendees])
assert.ok(d.xml.includes('&lt;timing&gt;') && !d.xml.includes('<timing>'), 'special characters are escaped, not injected')
assert.deepEqual((await docxText(empty)).paras, [TITLE, r.date, 'Summary', 'Your notes are too short.', 'Action items', NO_ACTIONS, 'Attendees', NO_ATTENDEES])
const intl = await docxText({ ...r, attendees: ['Nguyễn Văn An', 'রহিম', '王伟'] })
assert.ok(intl.paras.includes('Nguyễn Văn An, রহিম, 王伟'))

// PDF: uncompressed text drawing operators contain the on-screen text.
const pdf = await buildPdf(r).text()
const shown = [...pdf.matchAll(/\((.*?)(?<!\\)\) Tj/g)].map((m) => m[1].replace(/\\([()\\])/g, '$1')).join(' ')
for (const t of [TITLE, r.date, 'Summary', 'Action items', 'Attendees', 'Priya Raman, Jos']) assert.ok(shown.includes(t), `PDF has "${t}"`)
assert.ok(shown.includes('(v2.0) & pricing.') && shown.includes('<timing>'))

// Which text the built-in PDF fonts can draw; the rest is drawn as an image in the browser.
assert.ok(pdfCanDraw('José, Zoë, Søren, “quotes” — 5 € • …'))
for (const t of ['Nguyễn', 'রহিম', '王伟', '🎉']) assert.equal(pdfCanDraw(t), false, t)

// Analytics: only page views, with the URL stripped to origin + path.
const { pageViewOnly } = await import('./analytics.ts')
assert.deepEqual(pageViewOnly({ type: 'pageview', url: 'https://minutely.app/?q=secret#privacy' }), { type: 'pageview', url: 'https://minutely.app/' })
assert.equal(pageViewOnly({ type: 'event', url: 'https://minutely.app/' }), null)

console.log('export: all checks passed')
