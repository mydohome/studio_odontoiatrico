// Alfabeto e carattere di controllo dei codici leggibili (gift card e fidelity card).

/** Caratteri senza ambiguità (niente 0/O, 1/I): si leggono e si dettano senza errori. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
/**
 * Carattere di controllo (algoritmo di Luhn mod N, come per le carte di credito): individua ogni
 * carattere sbagliato e quasi tutti gli scambi tra due caratteri vicini.
 */
export function checkChar(body: string): string {
  const n = CODE_ALPHABET.length
  let factor = 2
  let sum = 0
  for (let i = body.length - 1; i >= 0; i--) {
    const addend = factor * CODE_ALPHABET.indexOf(body[i])
    sum += Math.floor(addend / n) + (addend % n)
    factor = factor === 2 ? 1 : 2
  }
  return CODE_ALPHABET[(n - (sum % n)) % n]
}
