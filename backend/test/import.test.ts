import assert from 'node:assert/strict'
import { test } from 'node:test'
import ExcelJS from 'exceljs'
import { DEFAULT_SERVICES } from '../../shared/catalog.ts'
import { MAX_IMPORT_UNZIPPED, parseImport, zipUncompressedSize } from '../src/excel.ts'

/** Uno zip finto: un solo file che dichiara `size` byte da decomprimere (indice centrale + fine indice). */
function fakeZip(size: number): Buffer {
  const name = Buffer.from('xl/worksheets/sheet1.xml')
  const cd = Buffer.alloc(46 + name.length)
  cd.writeUInt32LE(0x02014b50, 0)
  cd.writeUInt32LE(1000, 20) // compresso
  cd.writeUInt32LE(size, 24) // da decomprimere
  cd.writeUInt16LE(name.length, 28)
  name.copy(cd, 46)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(0, 16) // l'indice parte all'inizio del buffer
  return Buffer.concat([cd, eocd])
}

async function sheet(rows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Dati')
  ws.addRow(['Data', 'Prestazione', 'Quantità'])
  for (const r of rows) ws.addRow(r)
  return Buffer.from(await wb.xlsx.writeBuffer())
}

test('import Excel: un file normale si legge e la dimensione dello zip è quella reale', async () => {
  const buf = await sheet([['15/03/2026', 'Igiene orale', 3]])
  const size = zipUncompressedSize(buf)
  assert.ok(size !== null && size > 0 && size < 1_000_000)
  const r = await parseImport(buf, DEFAULT_SERVICES)
  assert.equal(r.days.get('2026-03-15')?.get('igiene'), 3)
})

test('import Excel: un file «bomba» (pochi byte, tanti da decomprimere) è rifiutato prima di aprirlo', async () => {
  assert.equal(zipUncompressedSize(fakeZip(5_000)), 5_000)
  assert.equal(zipUncompressedSize(Buffer.from('non è uno zip')), null)
  await assert.rejects(parseImport(fakeZip(MAX_IMPORT_UNZIPPED + 1), DEFAULT_SERVICES), /troppo grande/)
  // Un file che non è uno zip continua a dare il solito errore.
  await assert.rejects(parseImport(Buffer.from('ciao'), DEFAULT_SERVICES), /non è un Excel valido/)
})
