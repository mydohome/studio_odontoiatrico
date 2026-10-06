import assert from 'node:assert/strict'
import { test } from 'node:test'
import { badgeColor, CATEGORIES, CATEGORY_BY_ID, DEFAULT_CATEGORIES, freeSlot, setCategories } from '../../shared/catalog.ts'
import { slugify } from '../../shared/slug.ts'

test('categorie: elenco condiviso ordinato e colori dei grafici', () => {
  setCategories([
    { id: 'b', label: 'B', badge: '#111111', slot: 2, sort: 2 },
    { id: 'a', label: 'A', badge: '#222222', slot: 1, sort: 1 },
    { id: 'x', label: 'X', badge: '#333333', slot: 9, sort: 3 },
  ])
  assert.deepEqual(CATEGORIES.map((c) => c.id), ['a', 'b', 'x'])
  assert.equal(CATEGORY_BY_ID.a.color, 'var(--series-1)')
  assert.equal(CATEGORY_BY_ID.x.color, 'var(--series-1)') // oltre 8 si ricomincia
  assert.equal(badgeColor('b'), '#111111')
  assert.equal(badgeColor('b', '#abcdef'), '#abcdef')
  assert.equal(badgeColor('sconosciuta'), '#6b7280')
  setCategories(DEFAULT_CATEGORIES)
  assert.equal(CATEGORIES.length, 8)
  assert.equal(CATEGORY_BY_ID.a, undefined)
})

test('categorie: nuovo colore del grafico = il meno usato', () => {
  assert.equal(freeSlot(DEFAULT_CATEGORIES), 1)
  assert.equal(freeSlot([{ slot: 1 }, { slot: 2 }, { slot: 1 }]), 3)
  assert.equal(freeSlot(DEFAULT_CATEGORIES.slice(0, 5)), 6)
})

test('slug da nome', () => {
  assert.equal(slugify('Laser e Ozono', 'x'), 'laser-e-ozono')
  assert.equal(slugify('Perché è così!', 'x'), 'perche-e-cosi')
  assert.equal(slugify('!!!', 'categoria'), 'categoria')
})
