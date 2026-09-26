import ExcelJS from 'exceljs'
import { CATEGORIES, CATEGORY_BY_ID } from '../../shared/catalog.ts'
import { isValidISO } from '../../shared/dates.ts'
import type { RecordRow, Service } from '../../shared/types.ts'

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } }
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' } }

function styleHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1)
  row.eachCell((c) => {
    c.fill = HEADER_FILL
    c.font = HEADER_FONT
    c.alignment = { vertical: 'middle' }
  })
  row.height = 22
  ws.views = [{ state: 'frozen', ySplit: 1 }]
}

/** Converte una data ISO in una Date UTC, così Excel mostra il giorno corretto. */
const isoToExcelDate = (iso: string) => new Date(`${iso}T00:00:00Z`)

function addServicesSheet(wb: ExcelJS.Workbook, services: Service[]) {
  const ws = wb.addWorksheet('Prestazioni')
  ws.columns = [
    { header: 'Prestazione', key: 'name', width: 34 },
    { header: 'Categoria', key: 'cat', width: 30 },
    { header: 'Prezzo medio (€)', key: 'price', width: 18 },
  ]
  for (const s of services) ws.addRow({ name: s.name, cat: CATEGORY_BY_ID[s.category]?.label ?? s.category, price: s.price })
  styleHeader(ws)
  return ws
}

async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer())
}

export async function buildTemplate(services: Service[], exampleDate: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Studio Odontoiatrico'
  const active = services.filter((s) => s.active)

  const ws = wb.addWorksheet('Dati')
  ws.columns = [
    { header: 'Data', key: 'd', width: 14, style: { numFmt: 'dd/mm/yyyy' } },
    { header: 'Prestazione', key: 's', width: 34 },
    { header: 'Quantità', key: 'q', width: 12 },
  ]
  const examples = active.slice(0, 3)
  examples.forEach((s, i) => ws.addRow({ d: isoToExcelDate(exampleDate), s: s.name, q: [4, 6, 2][i] }))
  styleHeader(ws)

  const list = addServicesSheet(wb, active)
  const listRange = `Prestazioni!$A$2:$A$${Math.max(2, active.length + 1)}`
  for (let r = 2; r <= 1500; r++) {
    ws.getCell(`A${r}`).dataValidation = {
      type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(Date.UTC(2000, 0, 1))],
      showErrorMessage: true, errorTitle: 'Data non valida', error: 'Inserisci una data (gg/mm/aaaa).',
    }
    ws.getCell(`B${r}`).dataValidation = {
      type: 'list', allowBlank: true, formulae: [listRange],
      showErrorMessage: true, errorTitle: 'Prestazione non valida', error: 'Scegli una prestazione dal foglio "Prestazioni".',
    }
    ws.getCell(`C${r}`).dataValidation = {
      type: 'whole', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0],
      showErrorMessage: true, errorTitle: 'Quantità non valida', error: 'Inserisci un numero intero ≥ 0.',
    }
  }
  list.state = 'visible'

  const info = wb.addWorksheet('Istruzioni')
  info.getColumn(1).width = 110
  const lines = [
    'Come compilare il file',
    '',
    '1. Compila il foglio "Dati": una riga per ogni prestazione eseguita in una giornata.',
    '2. Colonna "Data": formato gg/mm/aaaa (es. 15/03/2026).',
    '3. Colonna "Prestazione": scegli dal menu a tendina. I nomi validi sono nel foglio "Prestazioni".',
    '4. Colonna "Quantità": numero intero di prestazioni eseguite quel giorno.',
    '5. Se la stessa prestazione compare più volte nello stesso giorno, le quantità vengono sommate.',
    '',
    'In alternativa è accettato il formato "a colonne": prima colonna "Data" e una colonna per ogni prestazione',
    '(intestazione = nome della prestazione) con le quantità nelle celle.',
    '',
    'Per aggiungere nuove prestazioni usa la sezione Impostazioni dell\'applicazione, poi riscarica il template.',
    `Categorie disponibili: ${CATEGORIES.map((c) => c.label).join(', ')}.`,
  ]
  lines.forEach((l, i) => {
    const c = info.getCell(`A${i + 1}`)
    c.value = l
    if (i === 0) c.font = { bold: true, size: 14, color: { argb: 'FF0F766E' } }
  })
  return toBuffer(wb)
}

export async function buildExport(services: Service[], records: RecordRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const names = new Map(services.map((s) => [s.id, s.name]))
  const ws = wb.addWorksheet('Dati')
  ws.columns = [
    { header: 'Data', key: 'd', width: 14, style: { numFmt: 'dd/mm/yyyy' } },
    { header: 'Prestazione', key: 's', width: 34 },
    { header: 'Quantità', key: 'q', width: 12 },
  ]
  for (const r of records) ws.addRow({ d: isoToExcelDate(r.d), s: names.get(r.s) ?? r.s, q: r.q })
  styleHeader(ws)
  addServicesSheet(wb, services)
  return toBuffer(wb)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Interpreta una cella data: Date, seriale Excel, "gg/mm/aaaa", "aaaa-mm-gg". */
export function parseDateCell(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    // exceljs restituisce le date come mezzanotte UTC; arrotonda per sicurezza.
    const d = new Date(v.getTime() + 12 * 3600 * 1000)
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000)
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  }
  if (typeof v === 'string') {
    const s = v.trim()
    let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
    if (m) {
      const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
      const iso = `${y}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`
      return isValidISO(iso) ? iso : null
    }
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
    if (m) {
      const iso = `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`
      return isValidISO(iso) ? iso : null
    }
  }
  return null
}

function cellValue(c: ExcelJS.Cell): unknown {
  const v = c.value
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return (v as ExcelJS.CellFormulaValue).result
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('')
    if ('text' in v) return (v as ExcelJS.CellHyperlinkValue).text
  }
  return v
}

const norm = (s: unknown) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

export interface ParsedImport {
  rows: number
  days: Map<string, Map<string, number>>
  errors: string[]
}

export async function parseImport(buf: Buffer, services: Service[]): Promise<ParsedImport> {
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer)
  } catch {
    throw new Error('Il file non è un Excel valido (.xlsx).')
  }
  const ws = wb.getWorksheet('Dati') ?? wb.worksheets[0]
  if (!ws) throw new Error('Il file non contiene fogli.')

  const lookup = new Map<string, string>()
  for (const s of services) {
    lookup.set(norm(s.name), s.id)
    lookup.set(norm(s.id), s.id)
  }

  // Cerca la riga di intestazione nelle prime 10 righe.
  let headerRow = 0
  let headers: string[] = []
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const vals: string[] = []
    ws.getRow(r).eachCell({ includeEmpty: true }, (c, col) => (vals[col] = norm(cellValue(c))))
    if (vals.some((v) => v === 'data' || v === 'giorno' || v === 'date')) {
      headerRow = r
      headers = vals
      break
    }
  }
  if (!headerRow) throw new Error('Intestazione non trovata: serve una colonna "Data".')

  const find = (...keys: string[]) => headers.findIndex((h) => h && keys.some((k) => h.startsWith(k)))
  const colDate = find('data', 'giorno', 'date')
  const colSvc = find('prestazion', 'intervent', 'trattament', 'servizi')
  const colQty = find('quantit', 'qta', 'numero', 'n ')

  const days = new Map<string, Map<string, number>>()
  const errors: string[] = []
  const unknown = new Set<string>()
  let rows = 0
  const addQty = (day: string, sid: string, q: number) => {
    const m = days.get(day) ?? new Map<string, number>()
    m.set(sid, (m.get(sid) ?? 0) + q)
    days.set(day, m)
  }
  const pushErr = (msg: string) => {
    if (errors.length < 50) errors.push(msg)
  }

  // Formato "a colonne": Data + una colonna per prestazione.
  const wideCols =
    colSvc < 0
      ? headers
          .map((h, i) => ({ i, sid: lookup.get(h) }))
          .filter((x): x is { i: number; sid: string } => x.i !== colDate && !!x.sid)
      : []
  if (colSvc < 0) {
    const ignored = headers.filter((h, i) => h && i !== colDate && !lookup.has(h))
    if (ignored.length) errors.push(`Colonne non riconosciute (ignorate): ${ignored.slice(0, 15).join(', ')}`)
  }
  if (colSvc < 0 && !wideCols.length) {
    throw new Error('Colonne non riconosciute: usa "Data | Prestazione | Quantità" oppure una colonna per prestazione.')
  }

  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const rawDate = cellValue(row.getCell(colDate))
    if (rawDate === null || rawDate === undefined || rawDate === '') continue
    const day = parseDateCell(rawDate)
    if (!day) {
      pushErr(`Riga ${r}: data non valida (${String(rawDate)})`)
      continue
    }
    if (colSvc >= 0) {
      const name = cellValue(row.getCell(colSvc))
      if (!name) continue
      const sid = lookup.get(norm(name))
      if (!sid) {
        unknown.add(String(name).trim())
        continue
      }
      const rawQ = colQty >= 0 ? cellValue(row.getCell(colQty)) : 1
      const q = Number(rawQ ?? 0)
      if (!Number.isFinite(q) || q < 0 || !Number.isInteger(q)) {
        pushErr(`Riga ${r}: quantità non valida (${String(rawQ)})`)
        continue
      }
      rows++
      if (q > 0) addQty(day, sid, q)
      else if (!days.has(day)) days.set(day, new Map())
    } else {
      rows++
      if (!days.has(day)) days.set(day, new Map())
      for (const { i, sid } of wideCols) {
        const raw = cellValue(row.getCell(i))
        if (raw === null || raw === undefined || raw === '') continue
        const q = Number(raw)
        if (!Number.isFinite(q) || q < 0 || !Number.isInteger(q)) {
          pushErr(`Riga ${r}, colonna ${i}: quantità non valida (${String(raw)})`)
          continue
        }
        if (q > 0) addQty(day, sid, q)
      }
    }
  }
  if (unknown.size) {
    errors.unshift(
      `Prestazioni non riconosciute (righe ignorate): ${[...unknown].slice(0, 15).join(', ')}. Aggiungile in Impostazioni e reimporta.`,
    )
  }
  return { rows, days, errors }
}
