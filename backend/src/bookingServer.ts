// Punto di ingresso del container «booking» (vedi bookingApp.ts). Non importa nulla del gestionale.

import pg from 'pg'
import { buildBookingApp } from './bookingApp.ts'

const url = process.env.BOOKING_DATABASE_URL
const secret = process.env.BOOKING_SECRET ?? ''
if (!url || secret.length < 32) {
  console.error('ERRORE: servono BOOKING_DATABASE_URL e BOOKING_SECRET (almeno 32 caratteri): esegui ./studio update.')
  process.exit(1)
}

const db = new pg.Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 5000 })
db.on('error', (e) => console.error('Database:', e.message))
const app = buildBookingApp(db, secret)

await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' })
console.log('Richieste web in ascolto')

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await app.close()
    await db.end()
    process.exit(0)
  })
}
