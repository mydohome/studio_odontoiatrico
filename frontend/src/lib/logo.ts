import { useEffect, useState } from 'react'

/**
 * Logo caricato dallo studio come data URL (null se non c'è o non è ancora pronto).
 * Il data URL viene incorporato così com'è nelle immagini esportate dei volantini.
 */
export function useCustomLogo(version: number): string | null {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!version) {
      setSrc(null)
      return
    }
    let alive = true
    fetch(`/api/logo?v=${version}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const fr = new FileReader()
            fr.onload = () => resolve(String(fr.result))
            fr.onerror = () => reject(fr.error)
            fr.readAsDataURL(blob)
          }),
      )
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null))
    return () => {
      alive = false
    }
  }, [version])
  return src
}
