import { useCallback, useEffect, useState } from 'react'
import type { RecordRow, Service } from '../../../shared/types.ts'
import { api } from './api.ts'

/** Dati condivisi tra le schede: elenco prestazioni e registrazioni. */
export function useAppData() {
  const [services, setServices] = useState<Service[]>([])
  const [records, setRecords] = useState<RecordRow[]>([])
  const [studioName, setStudioName] = useState('Studio Odontoiatrico')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  const reload = useCallback(async () => {
    try {
      const [s, r, st] = await Promise.all([api.services(), api.records(), api.settings()])
      setServices(s)
      setRecords(r)
      setStudioName(st.studioName)
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

  return { services, records, studioName, setStudioName, loading, error, reload, version }
}

export type AppDataState = ReturnType<typeof useAppData>
