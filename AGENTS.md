# Istruzioni per gli agenti AI (e per chi sviluppa) · Gestionale studio odontoiatrico

Questo file è il prompt di lavoro per qualsiasi agente AI (Claude Code, Codex, Cursor, Copilot, ecc.) che manutiene,
corregge, aggiorna o amplia il progetto. Leggilo per intero prima di toccare il codice. Per la documentazione utente e
di installazione vedi `README.md` (è la fonte di verità su moduli, deploy e amministrazione).

## 1. Cos'è il progetto

Webapp per uno studio odontoiatrico italiano, usata da pochi utenti (circa 4 contemporanei, 4–8 dispositivi). Funzioni:
registro prestazioni e statistiche, campagne con volantini, appuntamenti con promemoria WhatsApp e conferma dal
paziente, gift card, fidelity card, richieste di appuntamento dal sito web, utenti con 2FA. **Lingua dell'interfaccia,
dei commenti, dei messaggi di errore e dei commit: italiano.** Si risponde all'utente in italiano.

Chi ti dà istruzioni è il titolare, non uno sviluppatore: spiega le cose in modo semplice, senza gergo inutile, e dai
istruzioni complete e verificabili quando serve fare qualcosa sul server (Cloudflare, NPM, comandi).

## 2. Architettura in breve

```
Browser ─► Cloudflare ─► Nginx Proxy Manager ─► app (Nginx + React) ─► api (Node 24 + Fastify) ─► db (PostgreSQL 16)
                                                  :80  gestionale          └─ ./studio, setup.sh, update.sh
                                                  :8081 conferme appuntamenti (solo /c/<codice>)
                                                  :8082 fidelity card (solo /f/<token>)
                                                  :8083 richieste web ─► container "booking" (separato, vedi §5)
```

- `frontend/`: React + Vite (TypeScript), compilato in statico; `frontend/nginx.conf` ha **quattro** blocchi `server`
  (80, 8081, 8082, 8083), `frontend/nginx/csp.conf` la CSP, `real-ip.conf` gli IP reali dietro NPM e Cloudflare.
- `backend/`: Fastify in **TypeScript eseguito direttamente da Node 24** (type stripping, nessuna build). `src/server.ts`
  è il punto di ingresso; un file per modulo (`appointments`, `giftCards`, `loyalty`, `inbox`, `webRequests`, …).
  `bookingServer.ts`/`bookingApp.ts` sono il container pubblico delle richieste web.
- `shared/`: tipi e logica usati da frontend **e** backend (importati con percorso relativo `../../shared/...ts`).
- Infrastruttura: `_deploy_network_example.yml` e `_deploy_npm_example.yml` (template Docker Compose, **mai** modificare
  il `docker-compose.yml` di un'installazione: lo copia `setup.sh`/`update.sh`), `setup.sh`, `update.sh`, `studio`
  (comando unico di amministrazione), `backup.sh`, `recovery.sh`, `manage-users.sh`.
- Più studi possono stare sullo stesso server: ogni istanza ha cartella, `.env`, container e porte propri.

## 3. Comandi

```bash
cd backend  && npm ci && npm run typecheck && npm test      # test unitari (node --test), ~70 test
cd frontend && npm ci && npx tsc --noEmit -p . && npm run build
# Prove su PostgreSQL vero (saltate senza la variabile; serve un utente amministratore; CANCELLANO dati del DB di prova):
TEST_DATABASE_URL=postgres://studio:studio@localhost:5432/prova npm test
bash -n setup.sh update.sh studio                            # sintassi degli script
docker compose -f _deploy_network_example.yml config         # validità dei template (serve POSTGRES_PASSWORD)
```

Prima di dichiarare finito un lavoro: typecheck e test del backend, typecheck e build del frontend, `bash -n` sugli
script toccati, `npm audit --omit=dev` senza vulnerabilità. Per cambiamenti a Nginx, Compose, reti o script prova
davvero i container (anche a mano con `docker run` e reti equivalenti se `docker compose --build` non ha Internet) e,
per l'interfaccia, un browser (Playwright). **Non dire «funziona» se non l'hai provato: dì cosa hai verificato e cosa no.**

## 4. Convenzioni di codice

- **Commenti e nomi dei messaggi in italiano**, brevi, che spiegano il perché. Segui densità e stile dei file vicini; non
  aggiungere dipendenze se non servono (ogni libreria nuova va giustificata e `npm audit` deve restare pulito).
- **Node strip-types**: niente `enum`, niente namespace, **niente parameter properties** nei costruttori (dichiara i campi
  esplicitamente), import con estensione `.ts`, `import type` per i soli tipi.
- **SQL**: sempre parametrizzato (`$1`). Si interpolano solo costanti definite nel codice (liste di colonne, nomi di
  schema), mai input dell'utente.
- **Lookup su chiavi scelte dall'utente** (es. `id` di categoria, nome modulo): usa oggetti con prototipo nullo o
  `Object.hasOwn`, mai `obj[key]` su oggetti normali (bug già avvenuto con `constructor`/`__proto__`).
- **Date**: stringhe `YYYY-MM-DD` (nessuna conversione di fuso), helper in `shared/dates.ts`; il «giorno di oggi» è quello
  del fuso dello studio (`TZ`).
- **Errori**: classi con `status` (es. `LoyaltyError`, `WebRequestError`); l'error handler restituisce il messaggio per
  i 4xx e «Errore interno del server» per i 5xx. I messaggi per l'utente sono in italiano e senza dettagli tecnici.
- **Frontend**: componenti funzionali, `useToast()` per gli avvisi, `api` in `frontend/src/lib/api.ts` per ogni chiamata,
  stili in `styles.css` (variabili CSS per tema chiaro/scuro: ogni colore nuovo va definito per entrambi), controlli
  accessibili (label, `aria-*`). La pagina deve restare usabile su telefono.
- **Database**: lo schema si crea/aggiorna con migrazioni idempotenti all'avvio (`CREATE ... IF NOT EXISTS`,
  `ADD COLUMN IF NOT EXISTS`), mai distruttive e compatibili con i dati esistenti. Rispetta l'ordine in `start()`
  (`server.ts`): una migrazione o una pulizia che usa una tabella deve partire **dopo** la sua creazione.

## 5. Sicurezza: regole che non si rompono

Il progetto tratta dati sanitari e personali di pazienti. Il titolare vuole «estrema sicurezza»: nel dubbio scegli la
soluzione più restrittiva e dillo.

1. **Cifratura dei dati** (`backend/src/dataCrypto.ts`, AES-256-GCM, chiave `DATA_KEY` nel `.env`): nome, telefono e note
   dei pazienti, dati delle fidelity card e segreti TOTP sono cifrati con un **AAD per campo** (es. `patient_name`).
   Un dato nuovo di persona va cifrato allo stesso modo. **Non cambiare né perdere `DATA_KEY`**: i dati diventano
   illeggibili. Non scrivere mai chiavi, password o dati reali nel repository, nei test, nel README o nei log.
2. **Dati fittizi**: in codice, test, documentazione ed esempi usa solo nomi, telefoni, indirizzi e domini inventati
   (`example.it`, `Studio Prova`, `02 1234567`). Mai dati reali dello studio.
3. **Pagine pubbliche** (conferme, fidelity card, richieste web): dominio e porta dedicati, risposta 404 identica per
   «non esiste/non valido/disattivo», token da CSPRNG (≥192 bit) mai derivati da dati personali, nel database solo
   impronta o cifrato, limiti per IP (Nginx `limit_req` + backend), `noindex`, `no-store`, `Referrer-Policy: no-referrer`,
   mostrare il minimo (nome di battesimo, niente dati sanitari). Ogni nuovo gateway ha la sua intestazione
   `X-Public-Gateway`, il suo prefisso API consentito (hook `onRequest` in `server.ts`) e il suo blocco Nginx.
4. **Richieste web = container separato** (`booking`): senza `DATA_KEY`, `SESSION_SECRET`, `POSTGRES_PASSWORD`; utente
   PostgreSQL `booking_inbox` che vede **solo** lo schema `inbox`; reti Docker interne dedicate; filesystem in sola
   lettura; richieste sigillate con chiave pubblica (X25519, privata ricavata da `DATA_KEY`); il gestionale le importa
   ogni 10 secondi **ricontrollandole come input non fidato**. Non dare mai a `booking` accesso alle tabelle del
   gestionale, a `api` o a Internet, e non aggiungere segreti al suo ambiente. Prima di modificare quel perimetro rilancia
   la prova `backend/test/webRequests.db.test.ts` (verifica i «permesso negato»).
5. **CSP rigida** (`frontend/nginx/csp.conf`: `script-src 'self'`, `connect-src 'self'`, ecc.): niente script inline, niente
   risorse da altri domini (font, CDN, analytics). Se una funzione le richiede, discutine con il titolare prima.
6. **Autenticazione**: cookie `sid` firmato, `SameSite=Strict`, invalidazione per versione di sessione, 2FA TOTP con codici
   di recupero, limitatori dei tentativi (`loginLimiter.ts`). Tutte le rotte `/api/*` richiedono login **tranne** quelle
   elencate nell'hook `onRequest`; una rotta pubblica nuova va aggiunta lì consapevolmente e protetta come al punto 3.
7. **Input**: valida lunghezze, tipi e formati lato server (mai fidarsi del frontend); rimuovi caratteri di controllo dal
   testo libero; niente HTML costruito da input (React fa l'escape: non usare `dangerouslySetInnerHTML`).
8. **Dipendenze**: aggiornale con attenzione (`npm audit`), preferisci patch/minor; dopo ogni aggiornamento rilancia tutto.
9. **Log e errori**: non loggare dati personali, token o chiavi. Report di sicurezza: se trovi un problema, correggilo e
   dillo chiaramente al titolare, con impatto e rimedio.

## 6. Pattern dei moduli

I moduli (Appuntamenti, Campagne, Gift card, Fidelity card, Richieste web) si attivano in *Impostazioni → Moduli*
(`MODULE_KEYS` in `server.ts`, impostazioni `moduleXxx`), i nuovi sono **spenti di default**, vivono in file propri,
spenti nascondono solo la scheda (i dati restano) e hanno nel README: come si usa, dominio dedicato, variabili `.env`,
sicurezza, **come eliminarli del tutto** (SQL di rimozione) e come si testano.

### Checklist per un nuovo dominio/porta pubblico (es. nuovo gateway)

`frontend/nginx.conf` (blocco `server`, `limit_req`, CSP, `absolute_redirect off` se c'è un redirect) · `frontend/Dockerfile`
(`EXPOSE`) · i **due** template Compose (porta `${XXX_PORT:-82nn}`, variabile `XXX_BASE_URL` nell'ambiente di `api`) ·
`.env.example` · `setup.sh` (domanda, porta libera, scrittura `.env`, istruzioni NPM) · `update.sh` (assegna la porta alle
installazioni esistenti, intervalli distinti: carte 8200–8219, richieste 8220–8239) · `studio` (stato/avvisi) · README
(tabella NPM, variabili, configurazione DNS/Cloudflare/NPM passo per passo) · hook `onRequest` del backend · test.

## 7. Come lavorare (processo)

1. **Esplora prima di scrivere**: leggi i file coinvolti e i moduli analoghi; riusa i pattern esistenti invece di inventarne.
2. **Funzioni grandi o che toccano sicurezza/infrastruttura**: prima un piano breve (file, tabelle, rotte, rischi, test,
   commit) e **aspetta la conferma del titolare**. Per correzioni piccole e chiare procedi direttamente. Se una scelta
   è davvero del titolare (costi, privacy, comportamento visibile) chiedi; per il resto scegli il default sensato e dillo.
3. **Piccoli commit** coerenti, messaggio in italiano che spiega cosa e perché (es. «Richieste web, 2/4: container
   booking, reti isolate, …»). Dopo ogni commit i test devono passare.
4. **Test**: ogni correzione di bug ha un test che fallisce senza la correzione; ogni funzione nuova ha test della logica
   pura (`backend/test/*.test.ts`) e, se tocca il database o i permessi, una prova `*.db.test.ts` con `TEST_DATABASE_URL`.
5. **Documentazione**: aggiorna il README (e questo file se cambiano regole o architettura) nello stesso lavoro.
6. **Verifica reale** (§3) e riferisci con onestà: cosa è provato, cosa no (es. Cloudflare, il primo avvio sul server).
7. **Aggiornamenti delle installazioni esistenti**: ogni cambiamento deve funzionare con `./studio update` su un server già
   in uso (migrazioni idempotenti, variabili nuove generate/assegnate da `update.sh`, compose personalizzato segnalato
   e non sovrascritto, nessuna perdita di dati, nessun nuovo login forzato senza motivo).

## 8. Git

- Sviluppa sul branch indicato dal titolare/dall'ambiente (non sul `main`); non fare push su altri branch.
- **Mai** force-push né riscrivere la storia di lavoro non ancora unita; se la pull request del tuo branch è già stata
  unita, riparti da `origin/main` (`git checkout -B <branch> origin/main`) per il lavoro successivo.
- **Apri una pull request solo se il titolare lo chiede** («apri la pull request e fai il merge»). Descrizione: cosa cambia,
  come è stato verificato, cosa non è stato verificato. Segui l'eventuale template del repository.
- Non committare `.env`, chiavi, backup, `db/data`, `node_modules`, `dist`.

## 9. Trappole già incontrate

- `docker compose restart` **non** rilegge il `.env`: serve `up -d` (lo fa già `./studio restart`).
- Nginx: un `return 302 /percorso` assoluto includerebbe la porta interna (8083): usa `absolute_redirect off`.
- Nel container API `pkill -f` può uccidere la propria shell: usa PID o nomi precisi.
- `docker compose up --build` può non avere accesso a npm in ambienti isolati: prova i container a mano.
- Le colonne cifrate non si confrontano in SQL: si filtra dopo la decifratura (vedi `searchAppointments`).
- Cloudflare/NPM non si verificano dal repository: fornisci al titolare comandi di controllo (es. `curl -sI … | grep cf-mitigated`).
- Un controllo sul `Referer` è solo di comodo (falsificabile): non presentarlo come protezione.
- `loyalty.db.test.ts` e `webRequests.db.test.ts` cancellano dati del database di prova: mai puntarli a dati reali.

## 10. Definizione di «fatto»

Funziona nel caso d'uso reale · typecheck, test, build e audit puliti · sicurezza e privacy rispettate (§5) · README
aggiornato · aggiornamento di un'installazione esistente non rompe nulla (§7.7) · dati fittizi ovunque · commit piccoli e
chiari · riepilogo onesto al titolare con eventuali passi da fare sul server.
