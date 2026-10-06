// Algoritmo di suggerimento campagne marketing.
//
// 1. Aggrega le prestazioni per categoria e mese.
// 2. Stima un indice stagionale per categoria e mese dell'anno (rapporto tra il mese e la
//    media mobile di 12 mesi attorno a esso), ridotto verso 1 quando le osservazioni sono poche.
// 3. Stima livello e trend recente (ultimi 3 mesi completi destagionalizzati vs i 3 precedenti).
// 4. Previsione mese = livello × indice stagionale × trend smorzato.
// 5. Genera segnali (calo stagionale, richiami a 6 mesi, calo di conversione diagnosi → cure,
//    trend negativo, picchi da sfruttare con cross-selling, ricorrenze di calendario), li
//    trasforma in campagne con un punteggio 0–100 e tiene le migliori per ogni mese.

import { CATEGORIES, CATEGORY_BY_ID } from '../../shared/catalog.ts'
import { addMonths, MONTHS, monthIndex, monthKey } from '../../shared/dates.ts'
import type {
  CampaignResponse,
  CampaignSuggestion,
  CampaignType,
  CategoryForecast,
  CategoryId,
  MonthPlan,
  RecordRow,
  Service,
} from '../../shared/types.ts'

const MAX_PER_MONTH = 5

/** Categorie "cura" che dovrebbero seguire le visite/diagnosi. */
const TREATMENT_CATS: CategoryId[] = ['conservativa', 'chirurgia', 'protesi']
/** Servizi che generano un richiamo a 6 mesi. */
const RECALL_SERVICES = ['igiene', 'visita-controllo']

interface Template {
  title: string
  offer: string
  target: string
  channels: string[]
}

// Libreria di campagne tipo, per categoria.
const BUILTIN_LIBRARY: Record<string, { fill: Template; reactivate: Template; upsell: Template }> = {
  prevenzione: {
    fill: {
      title: 'Pacchetto prevenzione',
      offer: 'Igiene professionale + visita di controllo a prezzo pacchetto (-20%)',
      target: 'Pazienti senza igiene negli ultimi 9–12 mesi',
      channels: ['SMS', 'WhatsApp', 'Email'],
    },
    reactivate: {
      title: 'Ti aspettiamo per il controllo',
      offer: 'Visita di controllo gratuita con prenotazione dell\'igiene',
      target: 'Pazienti inattivi da oltre 12 mesi',
      channels: ['Email', 'Telefonata dalla segreteria'],
    },
    upsell: {
      title: 'Igiene + sbiancamento',
      offer: 'A chi prenota l\'igiene, sbiancamento professionale scontato del 25%',
      target: 'Pazienti che hanno già prenotato l\'igiene',
      channels: ['In studio', 'WhatsApp'],
    },
  },
  diagnostica: {
    fill: {
      title: 'Check-up digitale',
      offer: 'Ortopanoramica + visita a prezzo speciale',
      target: 'Nuovi pazienti e pazienti senza radiografie da oltre 2 anni',
      channels: ['Social (Facebook/Instagram)', 'Google Business'],
    },
    reactivate: {
      title: 'Aggiorna la tua cartella clinica',
      offer: 'Ortopanoramica di controllo inclusa nella visita',
      target: 'Pazienti con ultima radiografia datata',
      channels: ['Email', 'SMS'],
    },
    upsell: {
      title: 'Diagnosi completa',
      offer: 'Piano di cura scritto e preventivo rateizzabile dopo la diagnostica',
      target: 'Pazienti che eseguono ortopanoramica o TAC',
      channels: ['In studio'],
    },
  },
  conservativa: {
    fill: {
      title: 'Cura le carie prima che facciano male',
      offer: 'Otturazioni con pagamento in 3 rate a tasso zero',
      target: 'Pazienti con preventivi di conservativa aperti',
      channels: ['Telefonata dalla segreteria', 'Email'],
    },
    reactivate: {
      title: 'Controllo delle vecchie otturazioni',
      offer: 'Visita + RX endorale a prezzo agevolato per verificare otturazioni datate',
      target: 'Pazienti con ultima cura conservativa da oltre 18 mesi',
      channels: ['Email', 'SMS'],
    },
    upsell: {
      title: 'Dopo la cura, la prevenzione',
      offer: 'Igiene inclusa a prezzo ridotto per chi completa un piano di cure',
      target: 'Pazienti in cura conservativa',
      channels: ['In studio'],
    },
  },
  estetica: {
    fill: {
      title: 'Sorriso smagliante',
      offer: 'Sbiancamento professionale -25% o faccette con consulenza estetica gratuita',
      target: 'Pazienti 25–55 anni, pazienti con igiene recente',
      channels: ['Instagram', 'Facebook', 'Email'],
    },
    reactivate: {
      title: 'Consulenza estetica gratuita',
      offer: 'Simulazione digitale del sorriso senza impegno',
      target: 'Pazienti che hanno chiesto informazioni sull\'estetica',
      channels: ['Instagram', 'WhatsApp'],
    },
    upsell: {
      title: 'Mantieni il bianco',
      offer: 'Kit di mantenimento domiciliare in omaggio con lo sbiancamento',
      target: 'Pazienti in trattamento estetico',
      channels: ['In studio'],
    },
  },
  ortodonzia: {
    fill: {
      title: 'Allineatori: prima visita ortodontica gratuita',
      offer: 'Prima visita ortodontica e scansione 3D gratuite, pagamento rateale',
      target: 'Adulti e ragazzi 12–40 anni, genitori di pazienti pedodontici',
      channels: ['Instagram', 'Facebook', 'Email'],
    },
    reactivate: {
      title: 'Riprendi il tuo sorriso',
      offer: 'Rivalutazione ortodontica gratuita per chi aveva ricevuto un preventivo',
      target: 'Preventivi ortodontici non accettati',
      channels: ['Email', 'Telefonata dalla segreteria'],
    },
    upsell: {
      title: 'Ortodonzia per tutta la famiglia',
      offer: 'Sconto del 10% per il secondo familiare in trattamento',
      target: 'Famiglie con un paziente in ortodonzia',
      channels: ['In studio', 'Email'],
    },
  },
  chirurgia: {
    fill: {
      title: 'Implantologia a rate',
      offer: 'Consulenza e TAC gratuite, finanziamento fino a 24 mesi',
      target: 'Pazienti over 45, pazienti con estrazioni recenti',
      channels: ['Facebook', 'Email', 'Volantini locali'],
    },
    reactivate: {
      title: 'Hai perso un dente? Parliamone',
      offer: 'Rivalutazione gratuita dei preventivi implantari aperti',
      target: 'Preventivi di implantologia non accettati',
      channels: ['Telefonata dalla segreteria'],
    },
    upsell: {
      title: 'Dall\'estrazione all\'impianto',
      offer: 'Piano estrazione + impianto con prezzo bloccato',
      target: 'Pazienti con estrazioni programmate',
      channels: ['In studio'],
    },
  },
  protesi: {
    fill: {
      title: 'Torna a masticare bene',
      offer: 'Visita protesica gratuita e pagamento in 12 rate',
      target: 'Pazienti over 60 e portatori di protesi datate',
      channels: ['Volantini locali', 'Telefonata dalla segreteria'],
    },
    reactivate: {
      title: 'Controllo protesi',
      offer: 'Controllo e ribasatura della protesi a prezzo agevolato',
      target: 'Portatori di protesi mobile senza controllo da 12 mesi',
      channels: ['Telefonata dalla segreteria', 'SMS'],
    },
    upsell: {
      title: 'Protesi e igiene',
      offer: 'Igiene specifica per protesi e impianti inclusa al primo anno',
      target: 'Nuovi pazienti protesici',
      channels: ['In studio'],
    },
  },
  pedodonzia: {
    fill: {
      title: 'Sorrisi piccoli',
      offer: 'Visita pedodontica + sigillature a prezzo pacchetto',
      target: 'Famiglie con bambini 4–12 anni',
      channels: ['Facebook', 'Scuole e associazioni locali', 'Email'],
    },
    reactivate: {
      title: 'Controllo dei più piccoli',
      offer: 'Visita di controllo gratuita per i figli dei pazienti',
      target: 'Pazienti con figli',
      channels: ['Email', 'WhatsApp'],
    },
    upsell: {
      title: 'Valutazione ortodontica precoce',
      offer: 'Screening ortodontico gratuito durante la visita pedodontica',
      target: 'Bambini 6–10 anni',
      channels: ['In studio'],
    },
  },
}

/** Testi pronti per le categorie iniziali; per quelle aggiunte dallo studio, testi generici col suo nome. */
function libraryFor(cat: string): { fill: Template; reactivate: Template; upsell: Template } {
  if (BUILTIN_LIBRARY[cat]) return BUILTIN_LIBRARY[cat]
  const label = CATEGORY_BY_ID[cat]?.label ?? cat
  return {
    fill: { title: `Promozione ${label}`, offer: `Offerta dedicata a ${label} per riempire l'agenda`, target: 'Pazienti dello studio', channels: ['Email', 'WhatsApp'] },
    reactivate: { title: `Torna da noi: ${label}`, offer: `Un incentivo per riprendere i trattamenti di ${label}`, target: `Pazienti che hanno già fatto ${label}`, channels: ['Email', 'Telefonata dalla segreteria'] },
    upsell: { title: `Scopri anche ${label}`, offer: `Un'offerta su ${label} per chi è già in studio`, target: 'Pazienti già in studio', channels: ['In studio', 'WhatsApp'] },
  }
}

const CONVERSION: Template = {
  title: 'Piani di cura in sospeso',
  offer: 'Richiamo dei preventivi non accettati, rateizzazione a tasso zero e 10% di sconto se confermati entro il mese',
  target: 'Pazienti visitati negli ultimi 6 mesi senza cure avviate',
  channels: ['Telefonata dalla segreteria', 'Email'],
}

interface CalendarHook {
  category: CategoryId
  bonus: number
  title: string
  offer: string
  target: string
  channels: string[]
  reason: string
}

// Ricorrenze e contesti stagionali italiani, indice = mese (0 = gennaio).
const CALENDAR: CalendarHook[][] = [
  [{ category: 'prevenzione', bonus: 20, title: 'Buoni propositi: anno nuovo, sorriso sano', offer: 'Pacchetto igiene + controllo con prenotazione del richiamo di luglio', target: 'Tutti i pazienti', channels: ['Email', 'Social'], reason: 'Gennaio: periodo dei buoni propositi per la salute' }],
  [{ category: 'estetica', bonus: 20, title: 'San Valentino: sorridi a chi ami', offer: 'Sbiancamento di coppia o gift card estetica', target: 'Pazienti 20–50 anni', channels: ['Instagram', 'Facebook'], reason: 'Febbraio: San Valentino favorisce le promozioni estetiche' }],
  [{ category: 'estetica', bonus: 15, title: 'Primavera: rinnova il sorriso', offer: 'Consulenza estetica gratuita e sbiancamento scontato', target: 'Pazienti 25–55 anni', channels: ['Instagram', 'Email'], reason: 'Marzo: con la primavera cresce l\'attenzione all\'aspetto' }],
  [{ category: 'estetica', bonus: 20, title: 'Sposi e cerimonie', offer: 'Pacchetto sorriso per matrimoni e comunioni (igiene + sbiancamento)', target: 'Futuri sposi, famiglie con cerimonie', channels: ['Instagram', 'Facebook'], reason: 'Aprile–maggio: stagione di matrimoni, comunioni e cresime' }],
  [{ category: 'estetica', bonus: 20, title: 'Pronti per l\'estate', offer: 'Sbiancamento professionale prima delle vacanze', target: 'Pazienti 20–55 anni', channels: ['Instagram', 'WhatsApp'], reason: 'Maggio: si prepara il sorriso per l\'estate e le cerimonie' }],
  [{ category: 'ortodonzia', bonus: 15, title: 'Finita la scuola, iniziamo l\'apparecchio', offer: 'Prima visita ortodontica gratuita per ragazzi', target: 'Genitori di ragazzi 8–16 anni', channels: ['Facebook', 'Email'], reason: 'Giugno: con la fine della scuola le famiglie hanno tempo per le visite' }],
  [{ category: 'prevenzione', bonus: 15, title: 'Controllo prima delle vacanze', offer: 'Visita di controllo rapida per partire senza sorprese', target: 'Tutti i pazienti', channels: ['SMS', 'WhatsApp'], reason: 'Luglio: si evitano urgenze durante le ferie' }],
  [{ category: 'ortodonzia', bonus: 15, title: 'Allineatori d\'estate', offer: 'Inizia gli allineatori in estate con scansione 3D gratuita', target: 'Ragazzi e adulti', channels: ['Instagram'], reason: 'Agosto: periodo più tranquillo per iniziare un trattamento' }],
  [{ category: 'pedodonzia', bonus: 20, title: 'Si torna a scuola', offer: 'Visita pedodontica + sigillature per il nuovo anno scolastico', target: 'Famiglie con bambini 4–12 anni', channels: ['Facebook', 'Scuole locali', 'Email'], reason: 'Settembre: il rientro a scuola è il momento dei controlli per i bambini' }],
  [{ category: 'prevenzione', bonus: 20, title: 'Mese della prevenzione dentale', offer: 'Visita di controllo gratuita con igiene scontata', target: 'Nuovi pazienti e pazienti inattivi', channels: ['Social', 'Google Business', 'Volantini'], reason: 'Ottobre: mese nazionale della prevenzione dentale' }],
  [{ category: 'protesi', bonus: 15, title: 'Detrai entro fine anno', offer: 'Pianifica ora le cure: spese detraibili al 19% nella dichiarazione', target: 'Pazienti con preventivi aperti', channels: ['Email', 'Telefonata dalla segreteria'], reason: 'Novembre: chi vuole detrarre le spese mediche chiude le cure entro dicembre' }],
  [{ category: 'estetica', bonus: 20, title: 'Regala un sorriso', offer: 'Gift card igiene o sbiancamento da mettere sotto l\'albero', target: 'Tutti i pazienti', channels: ['Email', 'Instagram', 'In studio'], reason: 'Dicembre: le gift card sono un regalo di Natale facile' }],
]

const CROSS_SELL: Partial<Record<CategoryId, CategoryId>> = {
  prevenzione: 'estetica',
  diagnostica: 'conservativa',
  pedodonzia: 'ortodonzia',
  chirurgia: 'protesi',
  conservativa: 'prevenzione',
  estetica: 'estetica',
  ortodonzia: 'ortodonzia',
  protesi: 'protesi',
}

const round1 = (n: number) => Math.round(n * 10) / 10
const pct = (n: number) => `${n >= 0 ? '+' : ''}${Math.round(n * 100)}%`
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

function suggestion(
  type: CampaignType,
  category: CategoryId,
  t: Template,
  score: number,
  reasons: string[],
  key = '',
): CampaignSuggestion {
  return { id: `${type}-${category}${key}`, type, category, ...t, score: clamp(Math.round(score), 1, 100), reasons }
}

export function buildCampaigns(
  services: Service[],
  records: RecordRow[],
  todayIso: string,
  horizon = 12,
): CampaignResponse {
  const CAT_IDS = CATEGORIES.map((c) => c.id)
  const catOf = new Map(services.map((s) => [s.id, s.category]))
  const currentMonth = monthKey(todayIso)
  const lastComplete = addMonths(currentMonth, -1)

  // Totali mensili per categoria e per servizio.
  const byCat: Record<string, Record<string, number>> = Object.fromEntries(CAT_IDS.map((c) => [c, {}]))
  const bySvc: Record<string, Record<string, number>> = {}
  let firstMonth: string | null = null
  for (const r of records) {
    const ym = monthKey(r.d)
    if (ym > lastComplete) continue // il mese in corso è parziale
    const cat = catOf.get(r.s)
    if (!cat) continue
    if (!byCat[cat]) continue
    byCat[cat][ym] = (byCat[cat][ym] ?? 0) + r.q
    ;(bySvc[r.s] ??= {})[ym] = (bySvc[r.s][ym] ?? 0) + r.q
    if (!firstMonth || ym < firstMonth) firstMonth = ym
  }

  const months: string[] = []
  if (firstMonth) for (let m = firstMonth; m <= lastComplete; m = addMonths(m, 1)) months.push(m)
  const historyMonths = months.length
  const confidence: CampaignResponse['confidence'] =
    historyMonths === 0 ? 'nessuna' : historyMonths < 6 ? 'bassa' : historyMonths < 18 ? 'media' : 'alta'

  const val = (cat: string, ym: string) => byCat[cat]?.[ym] ?? 0

  // Indici stagionali.
  const seasonality: CampaignResponse['seasonality'] = []
  const SI: Record<string, number[]> = {}
  for (const cat of CAT_IDS) {
    const sums = Array(12).fill(0)
    const obs = Array(12).fill(0)
    months.forEach((ym, i) => {
      const lo = Math.max(0, i - 6)
      const hi = Math.min(months.length - 1, i + 5)
      let tot = 0
      for (let j = lo; j <= hi; j++) tot += val(cat, months[j])
      const base = tot / (hi - lo + 1)
      if (base <= 0) return
      sums[monthIndex(ym)] += val(cat, ym) / base
      obs[monthIndex(ym)] += 1
    })
    // Con poche osservazioni l'indice viene "ristretto" verso 1.
    const idx = sums.map((s, m) => (obs[m] ? 1 + (s / obs[m] - 1) * (obs[m] / (obs[m] + 0.5)) : 1))
    // Normalizza in modo che la media dei mesi osservati sia 1.
    const observed = idx.filter((_, m) => obs[m] > 0)
    const mean = observed.length ? observed.reduce((a, b) => a + b, 0) / observed.length : 1
    SI[cat] = idx.map((v, m) => (obs[m] ? v / mean : 1))
    seasonality.push({ category: cat, index: SI[cat].map((v) => Math.round(v * 100) / 100), observations: obs })
  }

  const deseason = (cat: string, ym: string) => val(cat, ym) / (SI[cat][monthIndex(ym)] || 1)
  const meanOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  const lastN = (n: number, offset = 0) => months.slice(Math.max(0, months.length - n - offset), months.length - offset)

  // Livello e trend.
  const level: Record<string, number> = {}
  const trend: Record<string, number> = {}
  const average: Record<string, number> = {}
  for (const cat of CAT_IDS) {
    level[cat] = meanOf(lastN(3).map((m) => deseason(cat, m)))
    average[cat] = meanOf(lastN(12).map((m) => deseason(cat, m)))
    let t = 0
    // Minimo di volume e variazione oltre il rumore statistico (≈2,5 deviazioni standard di Poisson).
    const significant = (cur: number, prev: number) => prev >= 20 && Math.abs(cur - prev) > 2.5 * Math.sqrt(prev)
    if (months.length >= 15) {
      // Con più di un anno di storico: confronto con gli stessi mesi dell'anno precedente,
      // immune alla stagionalità.
      const cur = lastN(3).reduce((a, m) => a + val(cat, m), 0)
      const prev = lastN(3).reduce((a, m) => a + val(cat, addMonths(m, -12)), 0)
      if (significant(cur, prev)) t = cur / prev - 1
    } else if (months.length >= 6) {
      const prev = meanOf(lastN(3, 3).map((m) => deseason(cat, m)))
      if (significant(level[cat] * 3, prev * 3)) t = level[cat] / prev - 1
    }
    trend[cat] = clamp(t, -0.3, 0.3)
  }
  const totalAvg = CAT_IDS.reduce((a, c) => a + average[c], 0) || 1
  // Indice di attività complessiva dello studio per mese (media pesata degli indici).
  const activity = Array.from({ length: 12 }, (_, m) =>
    historyMonths ? CAT_IDS.reduce((a, c) => a + SI[c][m] * average[c], 0) / totalAvg : 1,
  )

  const forecastCat = (cat: string, ym: string, ahead: number) => {
    if (ym <= lastComplete && months.includes(ym)) return val(cat, ym)
    const damp = Math.pow(0.8, ahead) // il trend pesa sempre meno andando avanti
    return Math.max(0, level[cat] * SI[cat][monthIndex(ym)] * (1 + trend[cat] * damp))
  }

  const svcValue = (sid: string, ym: string) => {
    if (months.includes(ym)) return bySvc[sid]?.[ym] ?? 0
    // Mese futuro/non osservato: stima con la quota del servizio nella categoria.
    const cat = catOf.get(sid)
    if (!cat) return 0
    const catTot = meanOf(lastN(6).map((m) => val(cat, m)))
    const svcTot = meanOf(lastN(6).map((m) => bySvc[sid]?.[m] ?? 0))
    const share = catTot > 0 ? svcTot / catTot : 0
    return share * forecastCat(cat, ym, 1)
  }

  // Conversione diagnosi/visite → cure: ultimi 3 mesi vs storico.
  const visitCats: CategoryId[] = ['diagnostica']
  const visitSvcs = ['visita-controllo', 'prima-visita']
  const convRatio = (ms: string[]) => {
    const treat = ms.reduce((a, m) => a + TREATMENT_CATS.reduce((b, c) => b + val(c, m), 0), 0)
    const visits = ms.reduce(
      (a, m) => a + visitCats.reduce((b, c) => b + val(c, m), 0) + visitSvcs.reduce((b, s) => b + (bySvc[s]?.[m] ?? 0), 0),
      0,
    )
    return visits > 0 ? treat / visits : null
  }
  const convRecent = convRatio(lastN(3))
  // Il rapporto è stagionale (d'estate più visite, meno cure): se possibile si confronta
  // con gli stessi mesi dell'anno precedente.
  const convHist = convRatio(months.length >= 15 ? lastN(3).map((m) => addMonths(m, -12)) : lastN(12, 3))
  const convDrop = convRecent !== null && convHist && months.length >= 9 ? 1 - convRecent / convHist : 0

  const plans: MonthPlan[] = []
  for (let k = 0; k < horizon; k++) {
    const ym = addMonths(currentMonth, k)
    const m = monthIndex(ym)
    const ahead = k + 1
    const found = new Map<string, CampaignSuggestion>()
    const add = (s: CampaignSuggestion) => {
      const prev = found.get(s.id)
      if (prev) {
        prev.score = clamp(prev.score + s.score * 0.5, 1, 100)
        prev.reasons.push(...s.reasons)
      } else found.set(s.id, s)
    }

    const forecast: CategoryForecast[] = CAT_IDS.map((cat) => ({
      category: cat,
      expected: round1(forecastCat(cat, ym, ahead)),
      average: round1(average[cat]),
      index: Math.round(SI[cat][m] * 100) / 100,
    }))

    if (historyMonths > 0) {
      for (const cat of CAT_IDS) {
        const share = average[cat] / totalAvg
        if (share < 0.01) continue
        const label = CATEGORY_BY_ID[cat].label
        const si = SI[cat][m]
        // Nei mesi con chiusure (ferie, festività) il calo va misurato rispetto all'attività
        // complessiva dello studio, altrimenti ogni categoria risulterebbe "in calo".
        const reduced = activity[m] < 0.85
        const dipIndex = reduced ? si / activity[m] : si
        const weight = 0.6 + Math.min(1, share * 4) // le categorie più frequenti pesano di più

        // 1. Calo stagionale atteso: riempire l'agenda.
        if (dipIndex < 0.92) {
          add(
            suggestion('calo', cat, libraryFor(cat).fill, (1 - dipIndex) * 180 * weight, [
              reduced
                ? `${label}: in ${MONTHS[m].toLowerCase()} cala più del resto dello studio (${pct(dipIndex - 1)} rispetto all'attività complessiva)`
                : `${label}: in ${MONTHS[m].toLowerCase()} il volume è storicamente ${pct(si - 1)} rispetto a un mese medio`,
              `Previsti circa ${Math.round(forecastCat(cat, ym, ahead))} interventi contro una media di ${Math.round(average[cat])}`,
            ]),
          )
        }

        // 2. Picco di domanda: sfruttarlo con cross-selling.
        if (si > 1.12) {
          const wanted = CROSS_SELL[cat]
          const target = wanted && CATEGORY_BY_ID[wanted] ? wanted : cat
          add(
            suggestion('crosssell', target, libraryFor(cat).upsell, (si - 1) * 120 * weight, [
              `${label}: mese di picco (${pct(si - 1)} sulla media), molti pazienti in studio da intercettare con un'offerta complementare`,
            ], `-${cat}`),
          )
        }

        // 3. Trend in calo negli ultimi mesi: riattivazione (solo mesi vicini).
        if (trend[cat] < -0.1 && k < 3) {
          add(
            suggestion('trend', cat, libraryFor(cat).reactivate, -trend[cat] * 220 * weight * (1 - k * 0.25), [
              months.length >= 15
                ? `${label}: negli ultimi 3 mesi il volume è ${pct(trend[cat])} rispetto agli stessi mesi dell'anno scorso`
                : `${label}: negli ultimi 3 mesi il volume (destagionalizzato) è ${pct(trend[cat])} rispetto ai 3 precedenti`,
            ]),
          )
        }
      }

      // 4. Richiami semestrali di igiene e controlli.
      const due = RECALL_SERVICES.reduce((a, s) => a + svcValue(s, addMonths(ym, -6)), 0)
      const avgRecall = meanOf(lastN(12).map((mm) => RECALL_SERVICES.reduce((a, s) => a + (bySvc[s]?.[mm] ?? 0), 0)))
      if (due > 0 && avgRecall > 0) {
        const ratio = due / avgRecall
        add({
          id: 'richiamo-prevenzione',
          type: 'richiamo',
          category: 'prevenzione',
          title: 'Richiamo semestrale igiene e controllo',
          offer: 'Promemoria personalizzato con prenotazione online e priorità in agenda',
          target: `Circa ${Math.round(due)} pazienti visti 6 mesi prima (${MONTHS[monthIndex(addMonths(ym, -6))].toLowerCase()})`,
          channels: ['SMS', 'WhatsApp', 'Email'],
          score: clamp(Math.round(30 + (ratio - 1) * 60), 15, 85),
          reasons: [
            `${Math.round(due)} igieni/controlli 6 mesi prima: ${pct(ratio - 1)} rispetto alla media mensile`,
          ],
        })
      }

      // 5. Calo della conversione diagnosi → cure (solo prossimi mesi).
      if (convDrop > 0.1 && k < 3 && CATEGORY_BY_ID.conservativa) {
        add(
          suggestion('conversione', 'conservativa', CONVERSION, convDrop * 200 * (1 - k * 0.25), [
            `Rapporto cure/visite negli ultimi 3 mesi ${pct(-convDrop)} rispetto allo storico: ci sono piani di cura da recuperare`,
          ]),
        )
      }
    }

    // 6. Ricorrenze di calendario (sempre presenti, rafforzate dai dati).
    for (const hook of CALENDAR[m]) {
      if (!SI[hook.category]) continue // categoria eliminata dallo studio
      const si = SI[hook.category][m]
      const dataBoost = historyMonths > 0 ? clamp((1 - si) * 40, -10, 20) : 0
      add({
        id: `calendario-${hook.category}-${m}`,
        type: 'calendario',
        category: hook.category,
        title: hook.title,
        offer: hook.offer,
        target: hook.target,
        channels: hook.channels,
        score: clamp(Math.round(20 + hook.bonus + dataBoost), 1, 100),
        reasons: [hook.reason],
      })
    }

    const campaigns = [...found.values()].sort((a, b) => b.score - a.score).slice(0, MAX_PER_MONTH)
    plans.push({ month: ym, activity: Math.round(activity[m] * 100) / 100, campaigns, forecast })
  }

  return { generatedAt: new Date().toISOString(), historyMonths, confidence, months: plans, seasonality }
}
