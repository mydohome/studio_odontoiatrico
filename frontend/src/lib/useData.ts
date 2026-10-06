import { useCallback, useEffect, useState } from 'react'
import type { RecordRow, Service } from '../../../shared/types.ts'
import { setCategories, type Category } from '../../../shared/catalog.ts'
import { api, type AppSettings } from './api.ts'

/** Dati condivisi tra le schede: elenco prestazioni e registrazioni. */
export function useAppData() {
  const [services, setServices] = useState<Service[]>([])
  const [categories, setCategoryList] = useState<Category[]>([])
  const [records, setRecords] = useState<RecordRow[]>([])
  const [settings, setSettings] = useState<AppSettings>({ studioName: 'Studio Odontoiatrico', showPrices: true, phone: '', address: '', doctorName: '', logoType: 'famiglia', logoVersion: 0, flyerStyle: 'smile', publicUrl: '', modules: { appointments: true, campaigns: true, giftcards: false } })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  const reload = useCallback(async () => {
    try {
      const [s, r, st, cats] = await Promise.all([api.services(), api.records(), api.settings(), api.categories()])
      // L'elenco condiviso delle categorie va aggiornato prima che le schede si ridisegnino.
      setCategories(cats)
      setCategoryList(cats)
      setServices(s)
      setRecords(r)
      setSettings(st)
      setError(null)
      setVersion((v) => v + 1)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { services, categories, records, settings, setSettings, loading, error, reload, version }
}

export type AppDataState = ReturnType<typeof useAppData>
