// Rigenera nginx/real-ip.conf con l'elenco attuale degli IP di Cloudflare (eseguito nella build
// dell'immagine). Se Cloudflare non risponde o l'elenco non è valido resta la copia nel repository.
import { readFileSync, writeFileSync } from 'node:fs'

const FILE = new URL('../nginx/real-ip.conf', import.meta.url)
const CIDR = /^(\d{1,3}(\.\d{1,3}){3}\/\d{1,2}|[0-9a-f:]+\/\d{1,3})$/i

async function list(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) })
  if (!r.ok) throw new Error(`${url}: ${r.status}`)
  const items = (await r.text()).split(/\s+/).filter(Boolean)
  if (!items.length || !items.every((x) => CIDR.test(x))) throw new Error(`${url}: elenco non valido`)
  return items
}

try {
  const ips = [...(await list('https://www.cloudflare.com/ips-v4')), ...(await list('https://www.cloudflare.com/ips-v6'))]
  const conf = readFileSync(FILE, 'utf8')
  const start = conf.search(/^# Cloudflare.*$/m)
  const end = conf.indexOf('\nreal_ip_header')
  if (start < 0 || end < 0) throw new Error('real-ip.conf: formato inatteso')
  const block = `# Cloudflare (elenco aggiornato il ${new Date().toISOString().slice(0, 10)})\n${ips.map((ip) => `set_real_ip_from ${ip};`).join('\n')}\n`
  writeFileSync(FILE, conf.slice(0, start) + block + conf.slice(end))
  console.log(`real-ip.conf: ${ips.length} reti di Cloudflare`)
} catch (e) {
  console.warn(`real-ip.conf: uso l'elenco incluso (${e.message})`)
}
