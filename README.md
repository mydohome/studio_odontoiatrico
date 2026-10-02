# Studio Odontoiatrico · Prestazioni e Campagne

Webapp per registrare ogni giorno le prestazioni di uno studio dentistico, consultarle in una dashboard e ricevere
proposte di **campagne marketing** mese per mese calcolate sui dati raccolti.

| Scheda | Cosa fa |
|---|---|
| **Registra** | Inserimento giornaliero delle quantità per prestazione (igiene orale, visita di controllo, ortopanoramica…), con pulsanti +/−, elenco delle ultime giornate e salvataggio rapido (Ctrl/Cmd + S). |
| **Appuntamenti** | Agenda del giorno o della settimana, promemoria WhatsApp già formattato con **link di conferma** personale per il paziente e stato di ogni appuntamento (da inviare, in attesa, confermato dal paziente, confermato dallo studio). |
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
   delle sessioni; chiede il **nome dell'istanza** (vedi [Più studi sullo stesso server](#più-studi-sullo-stesso-server)),
   la porta HTTP (solo nel primo caso: propone la prima libera tra 80 e 8080–8099) e il fuso orario (predefinito
   `Europe/Rome`).
3. **docker-compose.yml**: lo crea copiando il template scelto. Se ne esiste già uno diverso, ne salva una copia.
4. **Primo utente**: nome utente, email (facoltativa) e password inserita due volte (invio = generata automaticamente).
5. **Avvio**: esegue `docker compose up -d --build`, aspetta che le API siano pronte e crea l'utente. Alla fine mostra
   come configurare il Proxy Host in NPM.

Opzioni: `--mode npm|network` (salta la domanda sul tipo di deploy), `--instance NOME` (nome dell'istanza), `--yes` (nessuna domanda: valori predefiniti e
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
| NPM sullo stesso host (`proxy-net`) | `http` | `<istanza>-app` (es. `studio-odontoiatrico-app`) | `80` |
| NPM su un altro host | `http` | IP di questo server | `HTTP_PORT` (predefinita 80) |

Nella scheda **SSL** richiedi il certificato Let's Encrypt e attiva *Force SSL*. Dietro HTTPS il cookie di sessione viene
marcato `Secure` in automatico grazie all'header `X-Forwarded-Proto` inviato da NPM.

Con NPM su un altro host, apri `HTTP_PORT` nel firewall **solo verso l'IP del server NPM**, ad esempio:

```bash
sudo iptables -I INPUT 6 -p tcp -s <IP-server-NPM> --dport 80 -j ACCEPT && sudo netfilter-persistent save
```

### Più studi sullo stesso server

Ogni studio è un'installazione separata: **una cartella e un nome di istanza diversi**, con database, utenti,
impostazioni e logo propri. Il codice resta uno solo (stesso repository, stesso branch `main`): cambiano solo il `.env`
e i dati di ciascuna cartella.

```bash
git clone https://github.com/mydohome/studio_odontoiatrico.git /home/ubuntu/docker/studio-rossi
cd /home/ubuntu/docker/studio-rossi && ./setup.sh --instance studio-rossi

git clone https://github.com/mydohome/studio_odontoiatrico.git /home/ubuntu/docker/studio-bianchi
cd /home/ubuntu/docker/studio-bianchi && ./setup.sh --instance studio-bianchi
```

- Il nome (minuscole, cifre e trattini; predefinito: il nome della cartella) diventa il prefisso di container, immagini
  e reti: `studio-rossi-app`, `studio-rossi-api`, `studio-rossi-db`. Si salva in `.env` come `INSTANCE`.
- `setup.sh` rifiuta un nome già usato da un'altra cartella e una porta già occupata; con NPM sullo stesso host ogni
  studio ha il suo Proxy Host con Forward Hostname `<istanza>-app`, porta `80`. Senza NPM ogni studio pubblica una
  porta diversa (la prima libera tra 80 e 8080–8099).
- Rinominare un'istanza (rilanciando `setup.sh` con un altro nome) ferma i container col vecchio nome; i dati restano.
- `manage-users.sh`, `update.sh` e `docker compose` agiscono sempre sull'istanza della cartella in cui li lanci.
  L'aggiornamento automatico (`./update.sh --install-cron`) va attivato in ogni cartella: conviene orari diversi
  (es. 04:30 e 04:50) per non ricostruire le immagini in contemporanea.
- Memoria: ogni istanza usa a riposo circa 75–100 MB di RAM (massimo circa 550 MB con i limiti dei container); su una
  VM Ampere Always Free ne stanno comodamente diverse.

Le installazioni create prima dell'introduzione delle istanze continuano a usare il nome `studio-odontoiatrico`.

### Sicurezza dei container

| Container | Reti | Protezioni |
|---|---|---|
| `<istanza>-app` | `proxy-net` oppure porta pubblicata, + `backend` | `no-new-privileges`, `cap_drop: ALL` con solo `CHOWN`/`SETUID`/`SETGID` (necessari a Nginx) |
| `<istanza>-api` | solo `backend` | `no-new-privileges`, `cap_drop: ALL`, utente non root |
| `<istanza>-db` | solo `backend` | `no-new-privileges` |

## Logo dello studio

In **Impostazioni → Studio → Logo** scegli il logo che compare sui volantini:

- tre loghi pronti, che si colorano in automatico con la combinazione di colori del volantino: **Famiglia di dentini**
  (papà, mamma e due figli), **Dente sorridente**, **Dente con cuore**, **Dente stilizzato** (contorno pulito con
  sorriso nel colore d'accento, pensato per il modello Mint);
- **Carica logo**: PNG, JPG, WebP o SVG fino a 1 MB (meglio un PNG con sfondo trasparente, alto almeno 300 px). Il logo
  caricato compare anche nell'intestazione dell'app e si può sostituire o eliminare (si torna alla famiglia di dentini).
  Gli SVG con script, contenuti incorporati o collegamenti esterni vengono rifiutati.

Nell'editor del volantino (*Altri testi → Logo*) puoi usare un logo diverso solo per quel volantino.

## Appuntamenti

La scheda **Appuntamenti** (icona del calendario) contiene l'agenda dello studio.

- **Nuovo appuntamento** (oppure un clic su un orario libero della griglia): data, ora, durata, nome e telefono del
  paziente, prestazione (dall'elenco delle prestazioni) e note interne. I pazienti già inseriti vengono proposti mentre
  scrivi il nome, con il loro telefono. Se l'orario si sovrappone a un altro appuntamento compare un avviso.
- **Vista giorno o settimana**, con frecce, *Oggi* e scelta della data. Sul telefono la settimana diventa un elenco per
  giorno. Un clic sull'intestazione di un giorno apre la vista del giorno.
- Ogni appuntamento ha un'**etichetta colorata**:

  | Etichetta | Significato |
  |---|---|
  | 🟢 *Confermato · link* | il paziente ha confermato aprendo il link ricevuto |
  | 🔵 *Confermato · studio* | confermato a mano dallo studio (es. al telefono), con *Segna confermato* |
  | 🟠 *In attesa* | messaggio preparato, il paziente non ha ancora confermato |
  | ⚪ *Da inviare* | messaggio non ancora preparato |

### Promemoria su WhatsApp

Aprendo un appuntamento si vede il messaggio già pronto (modificabile prima dell'invio), per esempio:

```
Gentile Mario Rossi,
le ricordiamo il suo appuntamento presso *DentalCapri srl*:

📅 *Lunedì 5 ottobre 2026*
🕘 *Ore 10:30*
🦷 Igiene orale
📍 Via Roma 12, 80073 Capri (NA)

✅ Per confermare la sua presenza apra questo link:
https://studio.esempio.it/c/Xy3…

Per spostare o annullare l'appuntamento risponda a questo messaggio o chiami lo 081 837 1234.
A presto!
```

- **Apri in WhatsApp** apre la chat con il paziente (WhatsApp Web o l'app) con il messaggio già scritto: basta premere
  invio. Il numero senza prefisso viene considerato italiano (+39). **Copia messaggio** lo copia negli appunti.
- Il **link è univoco** per ogni appuntamento (codice casuale di 24 caratteri, impossibile da indovinare). Il paziente
  apre una pagina con logo e nome dello studio, data, ora e prestazione, e preme **Confermo l'appuntamento**; da lì può
  anche chiamare lo studio o scrivergli su WhatsApp. La pagina mostra solo il nome di battesimo: niente telefono,
  cognome o note. La conferma richiede il pulsante, quindi l'anteprima automatica del link in WhatsApp non conferma
  nulla. Dopo il giorno dell'appuntamento il link non permette più di confermare.
- L'agenda si aggiorna da sola ogni minuto: quando un paziente conferma compare un avviso.
- Se si cambiano **data o ora** di un appuntamento, conferma e invio si azzerano: va mandato il nuovo messaggio (il link
  resta lo stesso e mostra il nuovo orario). Eliminando l'appuntamento il link smette di funzionare.

**Indirizzo dei link**: i link usano l'indirizzo con cui stai usando l'app. Se dallo studio la apri con un indirizzo
interno (es. `http://192.168.1.10:8080`), imposta in **Impostazioni → Studio → Indirizzo web dell'app** quello pubblico
configurato in NPM (es. `https://studio.esempio.it`), altrimenti il paziente non riesce ad aprirlo. L'app lo segnala
nel riquadro del messaggio.

## Campagne personalizzate

Oltre alle proposte dell'algoritmo puoi creare le tue campagne dalla scheda **Campagne**:

- **Nuova campagna** (o *Crea per &lt;mese&gt;*): titolo, categoria, periodo dal/al (anche su più mesi), offerta, a chi è
  rivolta, canali (scelta rapida o canali liberi) e note interne che non compaiono sul volantino;
- **Personalizza** su una proposta dell'algoritmo la copia tra le tue campagne, già compilata, per modificarla;
- **Duplica** su una tua campagna ne crea una nuova uguale (titolo "… (copia)"), da adattare nel modulo che si apre:
  di solito si cambia il periodo per ripetere la stessa promozione. Viene copiato anche il volantino già preparato,
  con date e mese aggiornati al nuovo periodo (lo stesso succede modificando le date di una campagna);
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

### Modelli: Smile e Mint

In **Impostazioni → Studio → Modello dei volantini** si sceglie la grafica usata da tutti i volantini dello studio:

- **Smile** (predefinito): colorato e allegro, con pennellate, scritte a mano e 5 combinazioni di colori che cambiano
  in base alla categoria della campagna;
- **Mint**: pulito e tecnologico, con riquadro sfumato, schede per le voci dell'offerta, disco del prezzo e caratteri
  moderni. Il nome dello studio diventa un logotipo in due colori (es. **Dental**Capri *srl*: si divide al primo
  spazio o alla maiuscola interna, e la forma giuridica va in piccolo). Tre combinazioni: *Blu e acquamarina*
  (predefinita), *Notte* (sfondo scuro) e *Verde acqua*. Scegliendo Mint il logo diventa il **Dente stilizzato**, se non
  hai caricato il tuo.

Con un logo caricato che contiene già il nome dello studio, nel modello Mint puoi svuotare il campo *Nome dello studio*
nell'editor per mostrare solo il logo. I testi salvati con una campagna restano validi cambiando modello; i colori
tornano quelli predefiniti del nuovo modello.

I font (Lobster per i titoli corsivi, Kalam per le scritte a pennarello, Fredoka per banner e contatti, Nunito per il
modello Mint) sono inclusi nell'app, quindi funziona anche senza accesso a Google Fonts.

La versione precedente all'introduzione dei volantini è marcata con il tag `v1-prima-dei-volantini`. Per tornarci
temporaneamente sul server: `git checkout v1-prima-dei-volantini && ./update.sh --rebuild` (poi `git checkout main` per
tornare all'ultima versione; `update.sh` richiede di essere su un branch per scaricare gli aggiornamenti).

## Utenti

Si accede con **nome utente e password**. La pagina di accesso mostra il **nome e il logo dello studio** (e il nome
compare anche nella scheda del browser), così chi segue più studi vede subito in quale sta entrando: sono gli unici dati
visibili prima dell'accesso, insieme alla pagina di conferma degli appuntamenti aperta con il link personale. Le password sono salvate con hash scrypt; cambiando la password o eliminando
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
| `INSTANCE` | Nome dell'istanza, prefisso di container e immagini (predefinito `studio-odontoiatrico`). |
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

### Backup giornaliero

`setup.sh` propone di attivarlo alla fine dell'installazione; in alternativa:

```bash
./backup.sh --install-cron          # ogni notte alle 02:30 (oppure: --install-cron 03:15)
./backup.sh                         # backup immediato
./backup.sh --list                  # elenco
./backup.sh --remove-cron           # disattiva il backup automatico
```

- Ogni backup è una cartella in `backups/daily/AAAA-MM-GG_hhmmss` con un file per tabella, verificato subito dopo la
  creazione.
- È **incrementale**: le tabelle che non sono cambiate dal backup precedente non vengono copiate di nuovo ma collegate
  (hard link), quindi occupano spazio una volta sola. Ogni cartella resta comunque completa e ripristinabile da sola.
  Dopo un ripristino o un aggiornamento che cambia le tabelle, il primo backup è di nuovo una copia completa.
- Si conservano gli **ultimi 15 giorni**: ogni notte i backup più vecchi vengono cancellati (mai l'ultimo rimasto).
  Per cambiare la durata imposta `BACKUP_KEEP_DAYS=30` nel file `.env`.
- Il database comprende tutto: registrazioni, appuntamenti, campagne e volantini salvati, utenti, impostazioni e logo caricato.
- Il log si trova in `backup.log`. Con più studi sullo stesso server il backup va attivato in ogni cartella.

I backup restano sullo stesso server: per proteggerti anche da un guasto del disco copiali altrove, per esempio con
`rsync -aH backups/ utente@altro-server:backup-studio/` (`-H` mantiene i collegamenti, quindi anche lo spazio ridotto).

### Ripristino

```bash
./recovery.sh
```

Mostra i backup disponibili dal più recente e chiede quale ripristinare:

```
  N.  Data                           Tipo                                 Dimensione
  1   27/09/2026 02:30  oggi         giornaliero                          60K
  2   26/09/2026 02:30  ieri         giornaliero                          60K
  3   20/09/2026 04:30  7 giorni fa  prima dell'aggiornamento (a1b2c3d)   24K
```

Sono elencati i backup giornalieri, quelli fatti da `update.sh` prima di ogni aggiornamento e le copie "prima di un
ripristino". Dopo la scelta chiede di scrivere `RIPRISTINA` per conferma, poi:

1. salva una **copia di sicurezza** dello stato attuale (`backups/pre-restore`, ultime 5), così il ripristino si può
   annullare rilanciando `./recovery.sh`;
2. ferma le API, ripristina il database **in un'unica transazione** (se qualcosa va storto il database resta com'era)
   e riavvia l'app;
3. mostra quante registrazioni contiene il database ripristinato.

Altre opzioni: `--list` (solo elenco), `--latest` (il più recente), `--file PERCORSO` (una cartella di backup o un file
`.sql.gz`, anche copiati da un altro server), `--yes` (senza domande, con `--latest` o `--file`).

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
