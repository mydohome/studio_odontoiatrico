// Sigillo per la «inbox» delle richieste web: il container pubblico cifra con una chiave pubblica e non
// può riaprire ciò che ha scritto; solo il gestionale, che ricava la chiave privata da DATA_KEY, lo apre.
// Schema: X25519 con chiave temporanea + HKDF-SHA256 + AES-256-GCM. L'identificativo della richiesta
// entra nei dati autenticati: un testo sigillato non si può attribuire a un'altra richiesta.
// Formato: s1.<chiave temporanea>.<iv>.<testo cifrato + tag>, tutto base64url.

import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from 'node:crypto'

const SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex')
const PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex')

const b64 = (b: Buffer) => b.toString('base64url')

export const publicKeyObject = (raw: Buffer): KeyObject => createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' })

/** Coppia di chiavi del gestionale, ricavata da DATA_KEY: non c'è un segreto in più da custodire. */
export function inboxKeys(dataKey: Buffer): { privateKey: KeyObject; publicRaw: Buffer } {
  const seed = Buffer.from(hkdfSync('sha256', dataKey, 'studio-odontoiatrico', 'booking-inbox-x25519', 32))
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' })
  const publicRaw = Buffer.from(createPublicKey(privateKey).export({ format: 'der', type: 'spki' })).subarray(-32)
  return { privateKey, publicRaw: Buffer.from(publicRaw) }
}

function derive(shared: Buffer, ephPub: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', shared, ephPub, 'booking-inbox-v1', 32))
}

export function seal(publicRaw: Buffer, plaintext: string, aad: string): string {
  if (publicRaw.length !== 32) throw new Error('Chiave pubblica non valida')
  const eph = generateKeyPairSync('x25519')
  const ephPub = Buffer.from(eph.publicKey.export({ format: 'der', type: 'spki' })).subarray(-32)
  const key = derive(diffieHellman({ privateKey: eph.privateKey, publicKey: publicKeyObject(publicRaw) }), Buffer.from(ephPub))
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  c.setAAD(Buffer.from(aad))
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final(), c.getAuthTag()])
  return `s1.${b64(Buffer.from(ephPub))}.${b64(iv)}.${b64(ct)}`
}

/** Testo originale, oppure null se il sigillo è manomesso, per un'altra richiesta o con un'altra chiave. */
export function open(privateKey: KeyObject, sealed: string, aad: string): string | null {
  try {
    const [v, ephB64, ivB64, ctB64, extra] = sealed.split('.')
    if (v !== 's1' || extra !== undefined) return null
    const ephPub = Buffer.from(ephB64, 'base64url')
    const iv = Buffer.from(ivB64, 'base64url')
    const ct = Buffer.from(ctB64, 'base64url')
    if (ephPub.length !== 32 || iv.length !== 12 || ct.length < 16) return null
    const key = derive(diffieHellman({ privateKey, publicKey: publicKeyObject(ephPub) }), ephPub)
    const d = createDecipheriv('aes-256-gcm', key, iv)
    d.setAAD(Buffer.from(aad))
    d.setAuthTag(ct.subarray(ct.length - 16))
    return Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString('utf8')
  } catch {
    return null
  }
}
