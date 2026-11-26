import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import { jsPDF } from 'jspdf'

export type Result = { summary: string; actions: string[]; attendees: string[] }

const stamp = () => new Date().toLocaleDateString('en-CA') // local YYYY-MM-DD

function download(blob: Blob, ext: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `minutely-${stamp()}.${ext}`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function toText(r: Result) {
  const lines = ['MINUTELY — MEETING NOTES', stamp(), '', '01 SUMMARY', r.summary, '', '02 ACTION ITEMS']
  lines.push(...(r.actions.length ? r.actions.map((a) => `[ ] ${a}`) : ['None found.']), '', '03 ATTENDEES')
  lines.push(...(r.attendees.length ? r.attendees.map((a) => `- ${a}`) : ['None listed.']))
  return lines.join('\n') + '\n'
}

export const exportText = (r: Result) => download(new Blob([toText(r)], { type: 'text/plain;charset=utf-8' }), 'txt')

export function exportPdf(r: Result) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const margin = 64
  const width = doc.internal.pageSize.getWidth() - margin * 2
  const bottom = doc.internal.pageSize.getHeight() - margin
  let y = margin

  const write = (text: string, font: 'times' | 'helvetica' | 'courier', style: string, size: number, color = '#1A1A1A', gap = 6) => {
    doc.setFont(font, style).setFontSize(size).setTextColor(color)
    for (const line of doc.splitTextToSize(text, width) as string[]) {
      if (y + size > bottom) {
        doc.addPage()
        y = margin
      }
      doc.text(line, margin, y + size)
      y += size * 1.4
    }
    y += gap
  }
  const label = (t: string) => {
    y += 14
    write(t, 'courier', 'normal', 9, '#1F4D3A', 2)
    doc.setDrawColor('#D9D3C7').line(margin, y, margin + width, y)
    y += 10
  }

  write('Meeting notes', 'times', 'normal', 28, '#1A1A1A', 2)
  write(`MINUTELY · ${stamp()}`, 'courier', 'normal', 8, '#5C5850')
  label('01  SUMMARY')
  for (const p of r.summary.split('\n\n')) write(p, 'helvetica', 'normal', 11)
  label('02  ACTION ITEMS')
  if (r.actions.length) r.actions.forEach((a, i) => write(`${String(i + 1).padStart(2, '0')}  ${a}`, 'helvetica', 'normal', 11, '#1A1A1A', 2))
  else write('None found.', 'helvetica', 'italic', 11, '#5C5850')
  label('03  ATTENDEES')
  write(r.attendees.length ? r.attendees.join(' · ') : 'None listed.', 'helvetica', 'normal', 11)
  download(doc.output('blob'), 'pdf')
}

export async function exportDocx(r: Result) {
  const p = (text: string) => new Paragraph({ children: [new TextRun(text)], spacing: { after: 120 } })
  const h = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 120 } })
  const doc = new Document({
    creator: 'Minutely',
    title: 'Meeting notes',
    sections: [
      {
        children: [
          new Paragraph({ text: 'Meeting notes', heading: HeadingLevel.TITLE }),
          p(stamp()),
          h('Summary'),
          ...r.summary.split('\n\n').map(p),
          h('Action items'),
          ...(r.actions.length ? r.actions.map((a) => new Paragraph({ text: a, bullet: { level: 0 } })) : [p('None found.')]),
          h('Attendees'),
          ...(r.attendees.length ? r.attendees.map((a) => new Paragraph({ text: a, bullet: { level: 0 } })) : [p('None listed.')]),
        ],
      },
    ],
  })
  download(await Packer.toBlob(doc), 'docx')
}
