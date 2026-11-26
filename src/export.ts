import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import { jsPDF } from 'jspdf'

// `date` is the same human-readable date shown on screen.
// `note` explains a missing summary (too short, or nothing reliable came back).
export type Result = { date: string; summary: string; note?: string; actions: string[]; attendees: string[] }

export const TITLE = 'Meeting notes'
export const NO_ACTIONS = 'No action items found.'
export const NO_ATTENDEES = 'No attendees found. Add a line like “Attendees: Ana, Ben” to list them.'

/** The exact text shown on screen and written to every export. */
export function sections(r: Result) {
  return {
    summary: (r.summary || r.note || '').split('\n\n'),
    actions: r.actions,
    attendees: r.attendees.length ? r.attendees.join(', ') : NO_ATTENDEES,
  }
}

const stamp = () => new Date().toLocaleDateString('en-CA') // local YYYY-MM-DD, for file names

function download(blob: Blob, ext: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `minutely-${stamp()}.${ext}`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function buildText(r: Result) {
  const s = sections(r)
  const lines = [TITLE, r.date, '', 'Summary', s.summary.join('\n\n'), '', 'Action items']
  lines.push(...(s.actions.length ? s.actions.map((a) => `- ${a}`) : [NO_ACTIONS]), '', 'Attendees', s.attendees)
  return lines.join('\n') + '\n'
}

// Characters the PDF's built-in fonts can draw (Windows-1252). Anything else is drawn as an image.
const PDF_SAFE = /^[\x20-\x7E\xA0-\xFFŒœŠšŸŽžƒˆ˜–—‘-‚“-„†-•…‰‹›€™\s]*$/
export const pdfCanDraw = (text: string) => PDF_SAFE.test(text)

type Font = 'helvetica' | 'times'
// Match the PDF's built-in fonts; the system fills in scripts they don't cover.
const CSS_FONT: Record<Font, string> = {
  helvetica: 'Helvetica, Arial, sans-serif',
  times: '"Times New Roman", Times, serif',
}
const SCALE = 3 // render images at 3x so they stay sharp when printed

// ponytail: lines with characters outside Windows-1252 (Vietnamese, Bengali, Chinese, emoji) are drawn with the
// browser's fonts and embedded as images, so they look right but aren't selectable. Embed a Unicode TTF if that matters.
function imageLines(text: string, font: Font, bold: boolean, size: number, width: number, color: string) {
  const ctx = document.createElement('canvas').getContext('2d')!
  const css = `${bold ? 600 : 400} ${size}px ${CSS_FONT[font]}`
  ctx.font = css
  const graphemes = (t: string) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t)].map((g) => g.segment)
  // Wrap by words; a word wider than the line (e.g. Chinese with no spaces) wraps by character.
  const tokens = (text.match(/\S+\s*/g) ?? []).flatMap((t) => (ctx.measureText(t).width > width ? graphemes(t) : [t]))
  const out: string[] = []
  let line = ''
  for (const t of tokens) {
    if (line && ctx.measureText(line + t).width > width) {
      out.push(line.trimEnd())
      line = t
    } else line += t
  }
  if (line) out.push(line.trimEnd())
  return out.map((l) => {
    const w = Math.max(1, ctx.measureText(l).width)
    const c = document.createElement('canvas')
    c.width = Math.ceil(w * SCALE)
    c.height = Math.ceil(size * 1.4 * SCALE)
    const g = c.getContext('2d')!
    // Opaque white background keeps the embedded image small (no transparency mask).
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, c.width, c.height)
    g.scale(SCALE, SCALE)
    g.font = css
    g.fillStyle = color
    g.fillText(l, 0, size * 1.05)
    return { data: c.toDataURL('image/png'), w, h: size * 1.4 }
  })
}

export function buildPdf(r: Result): Blob {
  const s = sections(r)
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const margin = 64
  const width = doc.internal.pageSize.getWidth() - margin * 2
  const bottom = doc.internal.pageSize.getHeight() - margin
  let y = margin

  const write = (text: string, font: Font, bold: boolean, size: number, color = '#111111', gap = 6) => {
    const room = () => {
      if (y + size > bottom) {
        doc.addPage()
        y = margin
      }
    }
    if (pdfCanDraw(text)) {
      doc.setFont(font, bold ? 'bold' : 'normal').setFontSize(size).setTextColor(color)
      for (const line of doc.splitTextToSize(text, width) as string[]) {
        room()
        doc.text(line, margin, y + size)
        y += size * 1.4
      }
    } else {
      for (const img of imageLines(text, font, bold, size, width, color)) {
        room()
        doc.addImage(img.data, 'PNG', margin, y + size - size * 1.05, img.w, img.h, undefined, 'FAST')
        y += size * 1.4
      }
    }
    y += gap
  }
  const heading = (t: string) => {
    y += 16
    write(t, 'helvetica', true, 13, '#111111', 4)
  }

  write(TITLE, 'helvetica', true, 24, '#111111', 2)
  write(r.date, 'helvetica', false, 10, '#57534E')
  heading('Summary')
  for (const p of s.summary) write(p, 'times', false, 12, r.summary ? '#111111' : '#57534E')
  heading('Action items')
  if (s.actions.length) s.actions.forEach((a) => write(`•  ${a}`, 'helvetica', false, 11, '#111111', 2))
  else write(NO_ACTIONS, 'helvetica', false, 11, '#57534E')
  heading('Attendees')
  write(s.attendees, 'helvetica', false, 11, r.attendees.length ? '#111111' : '#57534E')
  return doc.output('blob')
}

export async function buildDocx(r: Result): Promise<Blob> {
  const s = sections(r)
  const p = (text: string) => new Paragraph({ children: [new TextRun(text)], spacing: { after: 120 } })
  const h = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 120 } })
  const doc = new Document({
    creator: 'Minutely',
    title: TITLE,
    sections: [
      {
        children: [
          new Paragraph({ text: TITLE, heading: HeadingLevel.TITLE }),
          p(r.date),
          h('Summary'),
          ...s.summary.map(p),
          h('Action items'),
          ...(s.actions.length ? s.actions.map((a) => new Paragraph({ text: a, bullet: { level: 0 } })) : [p(NO_ACTIONS)]),
          h('Attendees'),
          p(s.attendees),
        ],
      },
    ],
  })
  return Packer.toBlob(doc)
}

export const exportText = (r: Result) => download(new Blob([buildText(r)], { type: 'text/plain;charset=utf-8' }), 'txt')
export const exportPdf = (r: Result) => download(buildPdf(r), 'pdf')
export const exportDocx = async (r: Result) => download(await buildDocx(r), 'docx')
