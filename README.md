# Studio Odontoiatrico · Prestazioni e Campagne

Webapp per registrare ogni giorno le prestazioni di uno studio dentistico, consultarle in una dashboard e ricevere
proposte di **campagne marketing** mese per mese calcolate sui dati raccolti.

| Scheda | Cosa fa |
|---|---|
| **Registra** | Inserimento giornaliero delle quantità per prestazione (igiene orale, visita di controllo, ortopanoramica…), con pulsanti +/−, elenco delle ultime giornate e salvataggio rapido (Ctrl/Cmd + S). |
| **Dashboard** | Riepilogo per giorno, settimana o mese: totale prestazioni, fatturato stimato, media per giorno lavorato, andamento per categoria (grafico a colonne), dettaglio per prestazione con confronto sul periodo precedente. |
| **Campagne** | Per i prossimi 12 mesi propone le campagne più convenienti con punteggio, offerta, target, canali e motivazioni. Mostra la previsione per categoria e la mappa della stagionalità. |
| **Impostazioni** | Template Excel scaricabile, import da Excel, export completo, gestione delle prestazioni (nome, categoria, prezzo medio, attiva/disattiva), opzione **Mostra prezzi** (nasconde prezzi e fatturato stimato in tutte le viste e nei file Excel), dati dimostrativi, nome dello studio. |

## Architettura

```
Browser ──► NPM ──► app (Nginx + React) ──/api──► api (Node 24 + Fastify) ──► db (PostgreSQL 16)
                     studio-odontoiatrico-app       studio-odontoiatrico-api      studio-odontoiatrico-db
                                            └──────── rete interna "backend" ────────┘
```

- **frontend/**: React + Vite, compilato in file statici serviti da Nginx, che inoltra `/api` alle API.
- **backend/**: API REST in TypeScript eseguito direttamente da Node 24 (niente build), algoritmo campagne, import/export Excel (exceljs), utenti.
- **shared/**: tipi, date e catalogo delle categorie usati sia dal frontend sia dal backend.
- **db**: PostgreSQL 16 alpine con parametri ridotti; i dati stanno in `./db/data` (escluso da git).
- API e database stanno su una rete Docker interna (`internal: true`): niente porte pubblicate e niente accesso a Internet.

A riposo, con due anni di dati, lo stack usa circa **75–100 MB di RAM**.
Le immagini sono multi-architettura: funzionano sia su OCI **Ampere A1 (ARM)** sia su **VM.Standard.E2.1.Micro (AMD, 1 GB)**.

## Avvio rapido

```bash
git clone https://github.com/mydohome/studio_odontoiatrico.git /home/ubuntu/docker/studio-odontoiatrico
cd /home/ubuntu/docker/studio-odontoiatrico
./setup.sh
```

`setup.sh` ti guida in 5 passi:

1. **Tipo di deploy**: dove si trova Nginx Proxy Manager (NPM)?
   - *Su un host diverso* (o non usi NPM) → usa `_deploy_network_example.yml`: l'app pubblica una porta HTTP (predefinita 80).
   - *Sullo stesso host* → usa `_deploy_npm_example.yml`: l'app si collega alla rete Docker `proxy-net` e non apre porte.
     Se la rete `proxy-net` esiste già, lo script propone questa scelta come predefinita.
2. **Configurazione**: crea `.env` (permessi `600`) generando **in automatico** la password del database e la chiave
   delle sessioni; chiede la porta HTTP (solo nel primo caso) e il fuso orario (predefinito `Europe/Rome`).
3. **docker-compose.yml**: lo crea copiando il template scelto. Se ne esiste già uno diverso, ne salva una copia.
4. **Primo utente**: nome utente, email (facoltativa) e password inserita due volte (invio = generata automaticamente).
5. **Avvio**: esegue `docker compose up -d --build`, aspetta che le API siano pronte e crea l'utente. Alla fine mostra
   come configurare il Proxy Host in NPM.

Opzioni: `--mode npm|network` (salta la domanda sul tipo di deploy), `--yes` (nessuna domanda: valori predefiniti e
password generate), `--start` (avvia senza chiedere), `--force` (aggiorna `.env` e `docker-compose.yml` senza chiedere).
Con `--yes` i valori si passano come variabili:

```bash
FIRST_USER=mario FIRST_EMAIL=mario@studio.it FIRST_PASSWORD='...' ./setup.sh --mode npm --yes
```

Se rilanci lo script su un'installazione esistente, le password del database e delle sessioni vengono **mantenute**
(PostgreSQL imposta la password solo alla prima creazione del database), i file sostituiti vengono salvati come
`*.bak-<data>` e puoi aggiungere un nuovo utente. Se il `.env` è andato perso ma `db/data` esiste ancora, lo script
chiede la password del database esistente.

Per provare subito l'app vai in **Impostazioni → Genera dati demo** (2 anni di dati simulati), poi cancellali con
**Elimina tutti i dati** prima di iniziare a usarla davvero.

### Collegare Nginx Proxy Manager

Crea un **Proxy Host** in NPM (`http://127.0.0.1:81` tramite tunnel SSH, se l'interfaccia non è esposta):

| Deploy | Scheme | Forward Hostname | Forward Port |
|---|---|---|---|
| NPM sullo stesso host (`proxy-net`) | `http` | `studio-odontoiatrico-app` | `80` |
| NPM su un altro host | `http` | IP di questo server | `HTTP_PORT` (predefinita 80) |

Nella scheda **SSL** richiedi il certificato Let's Encrypt e attiva *Force SSL*. Dietro HTTPS il cookie di sessione viene
marcato `Secure` in automatico grazie all'header `X-Forwarded-Proto` inviato da NPM.

Con NPM su un altro host, apri `HTTP_PORT` nel firewall **solo verso l'IP del server NPM**, ad esempio:

```bash
sudo iptables -I INPUT 6 -p tcp -s <IP-server-NPM> --dport 80 -j ACCEPT && sudo netfilter-persistent save
```

### Sicurezza dei container

| Container | Reti | Protezioni |
|---|---|---|
| `studio-odontoiatrico-app` | `proxy-net` oppure porta pubblicata, + `backend` | `no-new-privileges`, `cap_drop: ALL` con solo `CHOWN`/`SETUID`/`SETGID` (necessari a Nginx) |
| `studio-odontoiatrico-api` | solo `backend` | `no-new-privileges`, `cap_drop: ALL`, utente non root |
| `studio-odontoiatrico-db` | solo `backend` | `no-new-privileges` |

## Campagne personalizzate

Oltre alle proposte dell'algoritmo puoi creare le tue campagne dalla scheda **Campagne**:

- **Nuova campagna** (o *Crea per &lt;mese&gt;*): titolo, categoria, periodo dal/al (anche su più mesi), offerta, a chi è
  rivolta, canali (scelta rapida o canali liberi) e note interne che non compaiono sul volantino;
- **Personalizza** su una proposta dell'algoritmo la copia tra le tue campagne, già compilata, per modificarla;
- le tue campagne compaiono in cima a ogni mese che toccano, con *Modifica*, *Elimina* e *Genera volantino*; nella
  striscia dei mesi un contatore indica quante ce ne sono;
- il volantino di una campagna personalizzata usa il suo periodo e il suo titolo, e i testi modificati nell'editor si
  salvano con la campagna (**Salva testi**, oppure in automatico quando scarichi o condividi il PNG).

## Volantini (beta)

Ogni campagna proposta nella scheda **Campagne** ha il pulsante **Genera volantino**. Si apre un editor con l'anteprima
in tempo reale di un volantino verticale (800×1200, esportato in PNG a 1600×2400) già compilato in base alla campagna:

- **titolo** con il mese, **banner** e **nome dell'offerta** scelti in base alla categoria e al tipo di campagna (per le
  campagne stagionali un testo dedicato a ogni mese, es. "Mese della PREVENZIONE" in ottobre);
- **periodo** "dal 01 al 31 Ottobre", modificabile con le date di inizio e fine;
- **voci dell'offerta** con icone ricavate dal testo della campagna (igiene, check-up, ortopanoramica, sbiancamento, …);
- **etichetta prezzo** proposta dal testo (GRATIS, -25%, A RATE) oppure scritta a mano (es. 90€), o nascosta;
- **nome del dottore** (Impostazioni → Studio) su una riga sotto "Studio odontoiatrico", nascosta se vuoto;
- **telefono/WhatsApp** e **indirizzo** dello studio: l'indirizzo compare in basso a destra con il segnaposto delle
  mappe (su due righe, via e città). Si impostano in **Impostazioni → Studio** oppure dall'editor;
- 5 combinazioni di colori, e tutti i testi (slogan, parole chiave, nome dello studio) modificabili.

Il pulsante **Scarica** usa di default il **JPG** (1600×2400, circa 500 KB): su WhatsApp arriva come *foto*, con
l'anteprima direttamente nella chat. Con la freccetta accanto si sceglie **PNG** (qualità massima, file più pesante)
oppure **PDF** (pagina A4 pronta da stampare, ~300 dpi; su WhatsApp arriva come documento, senza anteprima grande).
L'ultimo formato scelto viene ricordato. Su smartphone **Condividi** invia sempre il JPG, quindi come foto.

I font (Lobster per i titoli corsivi, Kalam per le scritte a pennarello, Fredoka per banner e contatti) sono inclusi
nell'app, quindi funziona anche senza accesso a Google Fonts.

La funzione è sul branch `beta/genera-volantino`. Per provarla sul server: `git checkout beta/genera-volantino && ./update.sh --rebuild`;
per tornare indietro: `git checkout main && ./update.sh --rebuild`.

## Utenti

Si accede con **nome utente e password**. Le password sono salvate con hash scrypt; cambiando la password o eliminando
un utente le sue sessioni aperte vengono chiuse subito. Dopo un tentativo errato, i successivi per lo stesso
nome utente vengono rallentati sempre di più (fino a 5 secondi).

```bash
./manage-users.sh                 # menu interattivo
./manage-users.sh list            # elenco (con data di creazione e ultimo accesso)
./manage-users.sh create mario --email mario@studio.it
./manage-users.sh edit mario      # cambia nome utente e/o email ("-" rimuove l'email)
./manage-users.sh passwd mario    # cambia password
./manage-users.sh delete mario    # chiede di riscrivere il nome per conferma
```

Le password vengono chieste due volte senza mostrarle; da uno script si possono passare sullo standard input
(`echo 'password' | ./manage-users.sh create mario`). Non è possibile eliminare l'ultimo utente rimasto.

### Variabili (`.env`)

| Variabile | Descrizione |
|---|---|
| `POSTGRES_PASSWORD` | Password del database (generata da `setup.sh`). |
| `SESSION_SECRET` | Chiave per firmare i cookie di sessione (generata; cambiandola si chiudono tutte le sessioni). |
| `HTTP_PORT` | Porta pubblicata sull'host, solo con `_deploy_network_example.yml` (predefinita 80). |
| `TZ` | Fuso orario, determina il "giorno di oggi" (predefinito `Europe/Rome`). |

## Deploy su OCI Always Free

1. Crea l'istanza (Ubuntu 22.04/24.04, Ampere A1 o E2.1.Micro).
2. Nella **Security List** (o nel Network Security Group) della VCN aggiungi una regola di ingresso TCP per la porta 80 (e 443 se usi HTTPS).
3. Le immagini Ubuntu di OCI bloccano le porte anche con iptables: aprile sulla VM
   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```
4. Installa Docker:
   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER   # poi esci e rientra
   ```
5. Sull'istanza AMD da 1 GB conviene aggiungere uno swap di 1–2 GB, utile soprattutto durante la build:
   ```bash
   sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```
6. Esegui l'**Avvio rapido** qui sopra (`./setup.sh`). Se scegli il deploy dietro NPM sullo stesso host,
   i passi 2–3 servono solo per le porte 80/443 di NPM.

### HTTPS senza NPM

Se non usi NPM, puoi mettere [Caddy](https://caddyserver.com) davanti all'app: scegli il deploy "host diverso" con
`HTTP_PORT=8080` e usa un `Caddyfile` come questo, che ottiene il certificato in automatico.

```
tuodominio.it {
    reverse_proxy localhost:8080
}
```

## Excel

- **Template**: *Impostazioni → Scarica template Excel*. Contiene il foglio `Dati` (colonne **Data · Prestazione · Quantità**,
  con menu a tendina e validazione), il foglio `Prestazioni` con i nomi validi e il foglio `Istruzioni`.
- **Import**: accetta il formato del template, e anche un formato "a colonne" (prima colonna `Data`, poi una colonna per
  ogni prestazione). Date accettate: `gg/mm/aaaa`, `aaaa-mm-gg` o celle data di Excel. Se una giornata esiste già puoi
  scegliere se **sostituirla** o **sommare** le quantità. Righe con prestazioni sconosciute o valori non validi vengono
  saltate e segnalate.
- **Export**: *Impostazioni → Esporta tutto in Excel*, nello stesso formato del template (quindi reimportabile).

## Come funziona l'algoritmo delle campagne

Il codice è in `backend/src/campaigns.ts`. Per ogni categoria (prevenzione, diagnostica, conservativa, estetica,
ortodonzia, chirurgia/implantologia, protesi, pedodonzia):

1. **Stagionalità**: per ogni mese calcola il rapporto tra il volume e la media mobile di 12 mesi attorno a esso, poi fa
   la media sugli anni disponibili (con poche osservazioni l'indice viene avvicinato a 1).
2. **Livello e trend**: media destagionalizzata degli ultimi 3 mesi completi. Il trend confronta gli ultimi 3 mesi con gli
   stessi mesi dell'anno precedente (oppure con i 3 mesi precedenti se lo storico è inferiore a 15 mesi) e viene considerato
   solo se supera il rumore statistico.
3. **Previsione** del mese = livello × indice stagionale × trend smorzato.
4. **Segnali → campagne**, ciascuna con un punteggio da 0 a 100:
   - *Calo stagionale* → promozioni per riempire l'agenda (nei mesi di chiusura il calo è misurato rispetto all'attività complessiva dello studio);
   - *Picco* → cross-selling ai pazienti già in studio (es. igiene + sbiancamento);
   - *Richiami*: igieni e controlli di 6 mesi prima;
   - *Trend negativo* → riattivazione;
   - *Calo del rapporto cure/visite* → recupero dei preventivi non accettati;
   - *Calendario*: ricorrenze italiane (San Valentino, matrimoni, rientro a scuola, mese della prevenzione, detrazioni di fine anno, Natale…).

Per ogni mese vengono mostrate le 5 campagne con il punteggio più alto. L'affidabilità cresce con lo storico:
bassa sotto i 6 mesi, media fino a 18, alta oltre.

## Aggiornamenti

`update.sh` installa l'ultima versione pubblicata su GitHub:

```bash
./update.sh                  # mostra le novità e chiede conferma
./update.sh --check          # controlla soltanto (exit 0 = aggiornato, 10 = aggiornamento disponibile)
./update.sh --yes            # aggiorna senza domande
./update.sh --install-cron   # aggiornamento automatico ogni notte alle 04:30 (oppure: --install-cron 03:15)
./update.sh --remove-cron    # disattiva l'aggiornamento automatico
```

Cosa fa, in ordine:

1. controlla che non ci siano modifiche locali ai file del repository e scarica le novità (solo *fast-forward*);
2. mostra l'elenco delle modifiche;
3. salva un **backup del database** in `backups/pre-update-<data>-<versione>.sql.gz` (conserva gli ultimi 10);
4. aggiorna il codice e, se il template usato per `docker-compose.yml` è cambiato, lo rigenera salvando una copia del
   precedente (se l'hai personalizzato a mano non lo tocca e ti avvisa);
5. ricostruisce le immagini con l'app ancora in funzione, poi riavvia: il fermo dura pochi secondi;
6. verifica che API e interfaccia rispondano. **Se l'avvio fallisce torna da solo alla versione precedente**; quella
   versione non viene riprovata in automatico finché su GitHub non ne arriva una più recente.

Con l'aggiornamento automatico il log finisce in `update.log`. Se il repository è privato, il server deve poter
eseguire `git fetch` senza password (chiave SSH di deploy o token salvato).

## Backup

```bash
# Backup manuale del database
docker compose exec -T db pg_dump -U studio studio | gzip > backup-$(date +%F).sql.gz

# Ripristino (anche dei backup creati da update.sh)
gunzip -c backups/pre-update-AAAAMMGG-HHMMSS-xxxxxxx.sql.gz | docker compose exec -T db psql -U studio studio
```

In alternativa, *Esporta tutto in Excel* produce un file reimportabile con tutte le registrazioni.

## Sviluppo locale

Serve Node 22.18+ (o 24) e un PostgreSQL raggiungibile.

```bash
cd backend && npm install
DATABASE_URL=postgres://studio:studio@localhost:5432/studio npm run dev   # API su :3000
npm test                                                                 # test dell'algoritmo

cd ../frontend && npm install && npm run dev                             # UI su :5173 (proxy /api → :3000)
npm run typecheck
```
