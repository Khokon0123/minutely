import assert from 'node:assert/strict'
import { chunkText, EXAMPLE_NOTES, extractActionItems, extractAttendees, splitDates } from './extract.ts'

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

console.log('extract: all checks passed')
