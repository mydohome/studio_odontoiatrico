// Verifica di DATA_KEY rispetto al valore di controllo di un backup (usata da recovery.sh), senza
// collegarsi al database. Chiave e valore arrivano dall'ambiente, non dagli argomenti del processo.
//
//   DATA_KEY=... DATA_KEY_CHECK=v1:... node src/keyCheck.ts
//
// Exit: 0 la chiave è quella giusta, 1 non lo è (o manca), 2 chiave in un formato non valido.

import { DataKeyError, keyMatchesCheck, parseDataKey } from './dataCrypto.ts'

let key: Buffer | null
try {
  key = parseDataKey(process.env.DATA_KEY)
} catch (e) {
  if (!(e instanceof DataKeyError)) throw e
  console.error(e.message)
  process.exit(2)
}
process.exit(key && keyMatchesCheck(key, process.env.DATA_KEY_CHECK ?? '') ? 0 : 1)
