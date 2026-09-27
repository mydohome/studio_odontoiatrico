import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CampaignError, parseFlyer, parseInput } from '../src/customCampaigns.ts'

const base = { category: 'estetica', title: ' Open day ', dateFrom: '2026-10-10', dateTo: '2026-11-10' }

test('campagna personalizzata: normalizza i campi validi', () => {
  const c = parseInput({ ...base, channels: ['Instagram', ' Instagram ', '', 'WhatsApp'], offer: '  -30%  ' })
  assert.equal(c.title, 'Open day')
  assert.equal(c.offer, '-30%')
  assert.deepEqual(c.channels, ['Instagram', 'WhatsApp'])
  assert.equal(c.target, '')
  assert.equal(c.notes, '')
})

test('campagna personalizzata: rifiuta dati non validi', () => {
  const bad = [
    { ...base, category: 'nessuna' },
    { ...base, title: '   ' },
    { ...base, title: 'x'.repeat(81) },
    { ...base, dateFrom: '2026-02-30' },
    { ...base, dateTo: '2026-10-01' },
    { ...base, dateTo: '2028-01-01' },
    { ...base, channels: Array.from({ length: 11 }, (_, i) => `c${i}`) },
  ]
  for (const b of bad) assert.throws(() => parseInput(b), CampaignError, JSON.stringify(b))
})

test('volantino salvato: solo oggetti di dimensione ragionevole', () => {
  assert.deepEqual(parseFlyer({ theme: 'rosa' }), { theme: 'rosa' })
  assert.equal(parseFlyer(null), null)
  assert.throws(() => parseFlyer([1, 2]), CampaignError)
  assert.throws(() => parseFlyer({ note: 'x'.repeat(25_000) }), CampaignError)
})
