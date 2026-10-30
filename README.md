# Studio Odontoiatrico · Prestazioni e Campagne

Webapp per registrare ogni giorno le prestazioni di uno studio dentistico, consultarle in una dashboard e ricevere
proposte di **campagne marketing** mese per mese calcolate sui dati raccolti.

| Scheda | Cosa fa |
|---|---|
| **Registra** | Inserimento giornaliero delle quantità per prestazione (igiene orale, visita di controllo, ortopanoramica…), con pulsanti +/−, elenco delle ultime giornate e salvataggio rapido (Ctrl/Cmd + S). |
| **Appuntamenti** | Agenda del giorno o della settimana, promemoria WhatsApp già formattato con **link di conferma** personale per il paziente e stato di ogni appuntamento (da inviare, in attesa, confermato dal paziente, confermato dallo studio). |
| **Dashboard** | Riepilogo per giorno, settimana o mese: totale prestazioni, fatturato stimato, media per giorno lavorato, andamento per categoria (grafico a colonne), dettaglio per prestazione con confronto sul periodo precedente. Con il modulo Appuntamenti, anche le **statistiche per medico**: prestazioni, quota, fatturato stimato, variazione sul periodo precedente, prestazioni più eseguite e andamento (le registrazioni a mano non hanno un medico e vanno in «Senza medico»). |
| **Campagne** | Per i prossimi 12 mesi propone le campagne più convenienti con punteggio, offerta, target, canali e motivazioni. Mostra la previsione per categoria e la mappa della stagionalità. |
| **Impostazioni** | Voci che aprono un menu a parte: **Sicurezza** (verifica in due passaggi, durata della sessione, dispositivi collegati), **Studio** (nome, telefono, indirizzi, logo, modello dei volantini, prezzi), **Dati** (importazione da Excel con template, esportazione completa, dati dimostrativi, eliminazione) e **Moduli** (attiva/disattiva Appuntamenti, Campagne, Gift card). Nella pagina restano **medici**, **categorie** (rinomina, riordina, colore del badge, aggiunta) e **prestazioni** (nome, categoria, prezzo medio, attiva/disattiva). Cambiando il colore di una categoria lo prendono anche le sue prestazioni (quelle con un colore proprio tornano a seguire la categoria). |

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

Crea in NPM (`http://127.0.0.1:81` tramite tunnel SSH, se l'interfaccia non è esposta) un **Proxy Host** per il
gestionale e, consigliato, uno per i **link di conferma** degli appuntamenti su un dominio separato:

| Proxy Host | Deploy | Scheme | Forward Hostname | Forward Port |
|---|---|---|---|---|
| gestionale (es. `studio.dominio.it`) | NPM sullo stesso host (`proxy-net`) | `http` | `<istanza>-app` (es. `studio-odontoiatrico-app`) | `80` |
| | NPM su un altro host | `http` | IP di questo server | `HTTP_PORT` (predefinita 80) |
| conferme (es. `conferma.dominio.it`) | NPM sullo stesso host (`proxy-net`) | `http` | `<istanza>-app` | `8081` |
| | NPM su un altro host | `http` | IP di questo server | `CONFIRM_PORT` (predefinita 8180) |
| fidelity card (es. `carte.dominio.it`, solo se usi il modulo) | NPM sullo stesso host (`proxy-net`) | `http` | `<istanza>-app` | `8082` |
| | NPM su un altro host | `http` | IP di questo server | `CARD_PORT` (predefinita 8200) |
| richieste web (es. `prenota.dominio.it`, solo se usi il modulo) | NPM sullo stesso host (`proxy-net`) | `http` | `<istanza>-app` | `8083` |
| | NPM su un altro host | `http` | IP di questo server | `BOOKING_PORT` (predefinita 8220) |

**Perché un dominio separato per le conferme.** Sulla porta delle conferme il container risponde **solo** alla pagina
`/c/<codice>`, alle API pubbliche dell'appuntamento e al logo: niente gestionale, niente pagina di accesso, tutto il resto
è "Pagina non trovata" (il controllo è sia in Nginx sia nel backend). Togliendo il codice dal link non si arriva da
nessuna parte, e il gestionale **può restare chiuso al pubblico**: in NPM, sul Proxy Host del gestionale, aggiungi una
**Access List** (scheda *Access*) che ammetta solo gli IP dello studio, oppure chieda nome utente e password prima del
login dell'app. Il dominio delle conferme resta aperto. Nota: i sottodomini con certificato Let's Encrypt sono elencati in
registri pubblici (es. crt.sh), quindi il nome del gestionale non è segreto: la protezione vera è l'Access List.

`setup.sh` chiede l'indirizzo delle conferme (`CONFIRM_URL`, facoltativo) e, con NPM su un altro host, la porta
(`CONFIRM_PORT`, la prima libera tra 8180 e 8199). L'indirizzo si può anche cambiare in **Impostazioni → Studio**.

Nella scheda **SSL** richiedi il certificato Let's Encrypt e attiva *Force SSL*. Dietro HTTPS il cookie di sessione viene
marcato `Secure` in automatico grazie all'header `X-Forwarded-Proto` inviato da NPM.

Con NPM su un altro host, apri `HTTP_PORT` (e `CONFIRM_PORT`) nel firewall **solo verso l'IP del server NPM**, ad esempio:

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

### Intestazioni di sicurezza, chiavi e aggiornamenti

- **Politica di sicurezza dei contenuti (CSP)** su tutte le pagine dell'app (gestionale, conferme, carte, richieste web): gli script si
  eseguono solo dai file dell'app, quindi un testo iniettato in una pagina non può far partire codice, e le pagine non
  possono caricare risorse né inviare dati ad altri domini. È in `frontend/nginx/csp.conf`. In più `Permissions-Policy`
  (la fotocamera è consentita solo al gestionale, per lo scanner delle fidelity card), `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff` e `Referrer-Policy`. Se aggiungi funzioni che caricano risorse da altri domini, vanno
  elencate in `csp.conf`. **HSTS** (forza https) si attiva in NPM: sul Proxy Host, scheda *SSL* → *HSTS Enabled*.
- **Chiave delle sessioni (`SESSION_SECRET`)** nel `.env`, non nel database: così non finisce nei backup e nei dump.
  `./studio update` la sposta nel `.env` nelle installazioni vecchie, mantenendo lo stesso valore (nessuno deve rifare
  l'accesso). Insieme a `DATA_KEY` è un segreto da custodire.
- **Import Excel**: un file che da decomprimere supera 80 MB, o con più di 200.000 righe, viene rifiutato prima di aprirlo
  (protegge da file «bomba»).
- **Aggiornamenti**: `./studio update` ricostruisce le immagini con quelle di base aggiornate (Node, Nginx, PostgreSQL). Se
  non lo lanci spesso, programmalo con `./studio update --install-cron`. Le dipendenze dei pacchetti si controllano con
  `npm audit` nelle cartelle `backend` e `frontend` (oggi 0 vulnerabilità).

### Limiti ai tentativi di accesso e IP reale (NPM, Cloudflare)

- **Accesso:** ogni 15 minuti al massimo 10 tentativi per nome utente dallo stesso IP, 30 errori per IP (con
  qualsiasi nome utente) e 50 tentativi per nome utente da IP nuovi, contro chi prova da tanti indirizzi. Dagli IP da cui
  un utente è già entrato (ultimi 30 giorni) si accede anche durante un attacco. In più Nginx accetta al massimo 20
  richieste di accesso al minuto per IP. Oltre i limiti la risposta è *Troppi tentativi di accesso: riprova tra N
  minuti*. Le richieste in parallelo contano tutte.
- **Pagina delle conferme:** al massimo 60 richieste al minuto per IP (con 30 di scorta), ampiamente sufficienti
  per un paziente.
- **IP reale:** l'app riconosce l'indirizzo del client anche dietro NPM e Cloudflare (`X-Forwarded-For`, solo dai
  proxy fidati: reti private, quindi NPM sullo stesso host o in rete locale, e le reti di Cloudflare). L'elenco di
  Cloudflare viene aggiornato a ogni build dell'immagine (`./studio update`), con una copia di riserva nel repository.
  Un `X-Forwarded-For` falsificato dal client non conta.
- Con NPM su un altro server raggiunto tramite un **IP pubblico**, quell'IP non è tra i proxy fidati: tutti i client
  risultano con l'IP di NPM e i limiti per IP diventano comuni. Aggiungilo a `frontend/nginx/real-ip.conf`
  (`set_real_ip_from <ip-di-npm>;`) e ricostruisci con `./studio update --rebuild`.

## Moduli

In **Impostazioni → Moduli** si possono spegnere **Appuntamenti** e **Campagne** per uno studio che non li usa. Un
modulo spento è solo nascosto: la sua scheda sparisce, insieme alle impostazioni che lo riguardano (indirizzo dei link di
conferma e colori dei badge per gli appuntamenti, modello dei volantini per le campagne), ma i dati restano salvati e
tornano visibili riattivandolo. I moduli **Gift card**, **Fidelity card** e **Richieste web** (sezioni dedicate più sotto) sono spenti di default. Con gli appuntamenti spenti, i link di conferma già inviati continuano a funzionare e gli
appuntamenti confermati contano ancora nelle statistiche.

## Gift card

Modulo facoltativo, **spento all'installazione**: si attiva in **Impostazioni → Moduli → Gift card** e compare la
scheda *Gift card*.

- **Nuova gift card**: a **credito** (es. 100 €), a **prestazioni** (es. 1 visita di controllo + 2 sedute di igiene)
  oppure da un **pacchetto** (modelli predefiniti, con prezzo, creati con *Pacchetti*). Facoltativi: intestatario, chi
  l'ha acquistata, prezzo pagato, scadenza (proposta: un anno) e note interne.
- Ogni gift card ha un **codice univoco** (es. `GC-7KQ2-MXP4-RTH`, con un carattere di controllo che riconosce gli
  errori di battitura) stampato anche come **codice a barre Code 128**, leggibile da qualsiasi lettore (anche quelli USB
  che "scrivono" il codice). La grafica, in formato carta di credito con logo e nome dello studio nei colori del modello
  dei volantini, si scarica come **immagine PNG** (da inviare su WhatsApp o per email), **PDF** a grandezza reale
  (85,6 × 54 mm, per la tipografia) o si **stampa** su A4 da ritagliare.
- **Usa una gift card**: si legge il codice a barre (o si scrive il codice, anche solo gli **ultimi 3 caratteri**:
  se più gift card finiscono così, si sceglie dall'elenco) e compaiono credito residuo o prestazioni rimaste. Si scala tutto o una parte del credito, oppure si segna una prestazione usata, con una nota facoltativa.
  Ogni utilizzo resta nello storico (chi, quando) e si può **stornare** se registrato per errore. Due operatori insieme
  non possono usare due volte lo stesso credito.
- Una gift card può essere **annullata** (e riattivata); quelle scadute si usano dopo aver prolungato la scadenza
  con *Modifica*. Intestatario, acquirente e note sono cifrati nel database come i dati dei pazienti.
- Gli utilizzi delle gift card **non** entrano nelle statistiche delle prestazioni (che contano già registrazioni e
  appuntamenti).

### Eliminare il modulo

Per nasconderlo basta spegnerlo in *Impostazioni → Moduli* (i dati restano). Per toglierlo del tutto:

1. su GitHub, nella pull request che ha introdotto il modulo, **Revert** e unisci la pull request di annullamento,
   poi `./studio update` su ogni server;
2. cancella i dati delle gift card (irreversibile: prima `./studio backup`):
   ```bash
   ./studio db
   DROP TABLE gift_card_movements, gift_card_items, gift_cards, gift_packages;
   DELETE FROM settings WHERE key = 'moduleGiftcards';
   ```

## Fidelity card

Modulo facoltativo, **spento all'installazione**: si attiva in **Impostazioni → Moduli → Fidelity card** e compare la
scheda *Fidelity*. È una **carta a timbri digitale**: a ogni visita il cliente riceve un timbro (un dentino pieno) e al
traguardo (di base 10 timbri) ottiene un premio (di base «Igiene professionale gratuita»).

### Come si usa

- **Programma** (pulsante *Programma*): timbri per il premio, descrizione del premio, validità della carta in giorni
  (facoltativa) e **ore da attendere tra due timbri** sulla stessa carta (12). Le modifiche valgono per le carte create da
  ora: quelle già emesse tengono numero di timbri e premio di quando sono state create.
- **Nuova carta**: nome e telefono del cliente (si può scegliere un paziente già noto: il telefono si compila da solo). Ogni
  carta ha un **link personale**, un **QR code** e un **codice breve** leggibile (es. `K7QM-X2PD`, con carattere di controllo).
  Nome e telefono sono cifrati nel database con `DATA_KEY` come i dati dei pazienti.
- **Dettaglio**: dentini, **Aggiungi timbro**, storico con **chi e quando** per ogni timbro, **Annulla** (il timbro resta
  nello storico), disattivazione/riattivazione, modifica dei dati, link con **Copia** e **Rigenera il link** (il vecchio
  smette subito di funzionare).
- **Invia carta al cliente**: prepara il messaggio con il link (app WhatsApp, WhatsApp Web o *Copia messaggio*, come per gli
  appuntamenti: l'app non invia nulla da sola). Il messaggio contiene solo nome di battesimo, premio e link.
  Il consenso alle comunicazioni oggi non è gestito dal portale: sulla carta c'è una casella facoltativa che lo **registra**
  (data) senza bloccare nulla; si potrà usare in seguito per vincolare l'invio.
- **Stampa carta**: la carta a formato carta di credito (logo, nome dello studio, QR e codice) si scarica in **PNG** o
  **PDF** a grandezza reale (85,6 × 54 mm) o si stampa su A4 da ritagliare; il QR è letto dallo scanner come quello sul telefono.
- **Scanner** (pulsante *Scanner*): la fotocamera legge il QR della carta e registra il timbro, con conferma di cliente e
  conteggio e **Annulla timbro**. Serve l'https (come per qualsiasi fotocamera nel browser); senza fotocamera si scrive il
  **codice breve**. **Anti-abuso**: un solo timbro per carta ogni 12 ore (configurabile), con messaggio chiaro se è troppo
  presto; dal dettaglio (non dallo scanner) lo staff può aggiungere un timbro *comunque*, per correggere. Una carta
  disattivata, scaduta o già completa non riceve timbri.

### La pagina del cliente

Il link apre una pagina pensata per il telefono, **senza accesso**: carta con i dentini (pieni = timbri ottenuti,
tratteggiati = mancanti, l'ultimo posto è il premio) nei colori del modello grafico dello studio (Smile o Mint), «X di N
timbri», data dell'ultimo timbro, premio, **QR code** e codice breve, messaggio di **premio raggiunto**. Si può installare
come app sulla schermata Home (Android: pulsante *Aggiungi alla schermata Home*; iPhone: Condividi → Aggiungi alla
schermata Home) e si riapre anche senza rete con l'ultimo stato visto. Mostra **solo il nome di battesimo**: nessun dato
sanitario, nessun dettaglio degli appuntamenti. Intestazioni `noindex, nofollow`, `Referrer-Policy: no-referrer`,
`Cache-Control: no-store`.

### Dominio dedicato (richiesto)

I link delle carte stanno su un **dominio diverso da quello del gestionale** (es. `https://carte.dominio.it`), servito da
una porta propria del container `app`: sulla **8082** risponde **soltanto** la pagina `/f/<token>` con le sue risorse
(script, icone, service worker), le API pubbliche della carta e il logo. Il gestionale, le altre API, la pagina di accesso e
le conferme degli appuntamenti **non sono raggiungibili** da quel dominio (404; il controllo è in Nginx e, con
l'intestazione `X-Public-Gateway: cards`, anche nel backend).

1. **DNS**: un record `carte.dominio.it` che punta al server (o all'IP del NPM).
2. **`.env`**: `CARD_BASE_URL=https://carte.dominio.it` (senza `/` finale), poi `./studio restart`. `./studio status` segnala
   le carte attive senza dominio.
3. **NPM**: un Proxy Host per `carte.dominio.it` come nella tabella sopra (porta `8082` del container `app`, oppure
   `CARD_PORT` di questo server se NPM è su un altro host), con certificato Let's Encrypt e *Force SSL*. Con NPM su un altro
   host apri `CARD_PORT` nel firewall solo verso l'IP di NPM.

`setup.sh` chiede l'indirizzo e, con NPM su un altro host, la porta; `update.sh` assegna `CARD_PORT` (una libera tra 8200 e 8219)
alle installazioni esistenti.

| Variabile | Significato |
|---|---|
| `CARD_BASE_URL` | Dominio delle carte (`https://carte.dominio.it`): compare nei link, nei QR e nelle stampe. Senza, le carte si gestiscono ma non si possono inviare né stampare. |
| `CARD_PORT` | Porta pubblicata per le carte, solo con `_deploy_network_example.yml` (predefinita 8200). |

### Token e sicurezza

- Il **token** del link è di **192 bit** (24 byte da `crypto.randomBytes`, 32 caratteri base64url), mai derivato da nome,
  ID, telefono o email. Nel database ci sono solo la sua **impronta SHA-256** (con indice univoco, per cercare la carta)
  e il token **cifrato** con `DATA_KEY` (per poter rimandare lo stesso link): un dump non contiene link utilizzabili.
- Token inesistente, malformato o carta disattivata → **stessa risposta 404**. Frenata sulle richieste pubbliche: limite di
  Nginx (come per le conferme) più un tetto di token sbagliati per indirizzo IP nel backend (30 ogni 15 minuti).
- Area staff: serve l'accesso (come il resto del portale; non esistono ruoli, ogni utente può fare tutto). Il cookie è
  `SameSite=Strict`, quindi le azioni non partono da altri siti. I timbri si registrano con la carta bloccata nel database:
  due scansioni insieme danno un solo timbro.
- **Wallet** (Apple/Google): non c'è nulla ora; token, codice breve e modello dati sono pronti per aggiungerlo in seguito.

### Eliminare il modulo

Per nasconderlo basta spegnerlo in *Impostazioni → Moduli* (le carte restano). Per toglierlo del tutto:

1. su GitHub, nella pull request che ha introdotto il modulo, **Revert** e unisci la pull request di annullamento,
   poi `./studio update` su ogni server;
2. cancella i dati (irreversibile: prima `./studio backup`):
   ```bash
   ./studio db
   DROP TABLE loyalty_stamps, loyalty_cards, loyalty_programs;
   DELETE FROM settings WHERE key IN ('moduleLoyalty', 'loyaltyInit');
   ```

### Test

I test del modulo (token, codice breve, lettura del QR, regole dei timbri, messaggio) girano con `npm test` nella cartella
`backend`. La prova completa su PostgreSQL (creazione, cifratura, attesa tra due timbri, completamento, annullamento,
pagina pubblica, 404 identici, rigenerazione del link, scanner) parte con un database di prova:

```bash
TEST_DATABASE_URL=postgres://studio:studio@localhost:5432/prova npm test   # cancella le carte fidelity di quel database
```

## Richieste web (da WordPress o da qualsiasi sito)

Il pulsante **«Prenota appuntamento»** del sito dello studio apre un modulo su un **dominio dedicato** (es.
`https://prenota.dominio.it`). Il cliente lascia nome, cognome, telefono, una breve descrizione e la fascia oraria in cui
preferisce essere richiamato; la richiesta arriva nell'agenda come **«Richiesta web»**: l'operatore chiama il cliente, poi
sceglie prestazione, medico, data e ora e prosegue come per ogni appuntamento (messaggio da inviare, conferma). **Il
cliente non vede mai l'agenda e il sito non riceve né conserva i dati**: il modulo è una pagina dell'app, non del sito.
Nessuna notifica esterna: solo il riquadro nell'agenda, il contatore sulla scheda *Appuntamenti* e un avviso nell'app.
Il modulo è **spento di default**: si attiva in *Impostazioni → Moduli → Richieste web* e richiede il modulo Appuntamenti.

### Come funziona e come è protetto

- **Codice monouso a tempo.** Aprendo la pagina il server emette un codice casuale di 192 bit **firmato** (HMAC-SHA256 con
  la chiave dell'app) che vale **10 minuti** e **una sola volta**: all'invio il suo identificativo viene registrato con la
  richiesta (indice univoco), quindi rinviare lo stesso modulo o riusare il codice dà errore. Mentre il cliente scrive il
  codice si rinnova da solo (ultimi 2 minuti), fino a 30 minuti in tutto; un codice scaduto o già usato non si rinnova.
  Il codice non sta nel database finché non viene usato: chi apre la pagina e non invia non lascia tracce.
- **Antibot.** Campo trappola invisibile (se compilato la richiesta viene scartata senza avvisare), tempo minimo di 3 secondi
  per compilare, al massimo **3 richieste all'ora e 8 al giorno per indirizzo IP**, limite di codici emessi e di invii
  respinti per IP, limite di Nginx sulle API del modulo e, **davanti a tutto, la sfida di Cloudflare** (vedi sotto).
  Oltre **200 richieste da gestire** il modulo smette di accettarne e invita a telefonare.
- **Container separato.** La pagina pubblica non gira nel gestionale ma nel container **`booking`** (stessa immagine,
  altro programma: `bookingServer.ts`). Non riceve `DATA_KEY`, `SESSION_SECRET` né la password principale del database;
  ha il filesystem in sola lettura e nessun permesso speciale; sta su reti interne proprie, quindi **non raggiunge né
  `api` né Internet** e `api` non raggiunge lui. Sulla porta **8083** Nginx lo fa rispondere **soltanto** alla pagina
  `/prenota`, alle sue risorse e alle API `/api/public/requests/…` (controllo anche nel container con
  `X-Public-Gateway: requests`); gestionale, accesso e altre API sono 404 da quel dominio, e quelle API non rispondono
  dal dominio del gestionale.
- **Database con un utente limitato.** Il container si collega con l'utente `booking_inbox`, che vede **solo lo schema
  `inbox`**: può inserire richieste, codici usati e contatori e leggere le impostazioni pubblicate dal gestionale. Su
  `appointments`, `users`, `settings` e il resto ottiene «permesso negato», e **non può leggere nemmeno le richieste** che
  ha scritto. Anche violando il container, un attaccante non trova pazienti, utenti o agenda.
- **Richieste sigillate.** Il container cifra nome, telefono e testo con una **chiave pubblica** (X25519 + AES-256-GCM) e
  non sa riaprirli. La chiave privata la ricava solo il gestionale da `DATA_KEY`: **non c'è un segreto in più da
  custodire**. Il gestionale legge la inbox **ogni 10 secondi**, **ricontrolla ogni richiesta** come se arrivasse da
  fuori (sigillo valido per quella richiesta, campi e lunghezze, tetto di 200 in attesa), la salva nell'agenda cifrata
  con `DATA_KEY` e la toglie dalla inbox; una richiesta non valida viene scartata. Il badge compare quindi con circa 10
  secondi di ritardo. Se il gestionale è fermo le richieste restano in coda e arrivano alla ripartenza.
- **Interruttore.** Attivare o spegnere il modulo, o cambiare l'informativa, si fa dal gestionale come sempre: lo stato
  viene pubblicato nella inbox subito e ogni 10 secondi. Se il gestionale non lo aggiorna per più di **5 minuti** (fermo
  o guasto), la pagina si chiude da sola.
- **Dati.** Nome, telefono e testo sono **cifrati con `DATA_KEY`** come quelli dei pazienti. Si registrano data e versione
  del **consenso** (con l'indirizzo dell'informativa mostrata). L'indirizzo IP non si salva: solo un'impronta con chiave
  per i limiti, tenuta **un giorno**. Le richieste **non gestite si cancellano dopo 30 giorni**; quelle fissate
  diventano appuntamenti normali. Il modulo invita a non scrivere dati sulla salute.
- **Informativa.** Il consenso rimanda alla pagina privacy del sito, il cui indirizzo si imposta nelle Impostazioni del
  modulo: **finché manca, il modulo online resta chiuso**. Il testo dell'informativa va redatto con chi si occupa di privacy
  per lo studio: l'app registra solo che il cliente l'ha accettata.

### Configurazione passo per passo

Sostituisci `prenota.dominio.it` con il tuo dominio.

**1. Sul server** (cartella dell'istanza): `./studio update`. Aggiunge nel `.env` `BOOKING_SECRET` e `BOOKING_DB_PASSWORD`
(generate, non vanno condivise), sostituisce `docker-compose.yml` con il template aggiornato (copia del precedente
salvata) e avvia il nuovo container `booking`: se avevi personalizzato il compose non lo tocca e avvisa, e va unito a
mano con il template. Poi nel `.env` aggiungi

```
BOOKING_BASE_URL=https://prenota.dominio.it
```

(senza `/` finale) e `./studio restart`. Con NPM su un altro host `update.sh` ha già assegnato `BOOKING_PORT` (8220–8239):
apri quella porta nel firewall solo verso l'IP di NPM. `./studio status` segnala il modulo attivo senza dominio.

**2. Cloudflare → DNS.** Record `A` (o `CNAME`) `prenota` verso l'IP del server/di NPM, con la **nuvola arancione** (proxy).

**3. Cloudflare → SSL/TLS.** *Overview*: modalità **Full (strict)**. *Edge Certificates*: **Always Use HTTPS** attivo. Il
certificato lo emette NPM (Let's Encrypt); se la richiesta fallisce con il proxy attivo, passa temporaneamente alla nuvola
grigia, ottieni il certificato e riattiva l'arancione.

**4. NPM → Proxy Host** `prenota.dominio.it`: Scheme `http`, Forward Hostname `<istanza>-app` e porta `8083` (NPM sullo
stesso host) oppure IP del server e `BOOKING_PORT`; scheda *SSL*: certificato Let's Encrypt, **Force SSL**, **HSTS**;
nessuna Access List (il modulo deve essere pubblico).

**5. Cloudflare → Security → WAF → Custom rules → Create rule** «Prenota - sfida». *Edit expression*:

```
(http.host eq "prenota.dominio.it" and (http.request.uri.path eq "/" or http.request.uri.path eq "/prenota" or starts_with(http.request.uri.path, "/api/public/requests")))
```

Azione **Managed Challenge**. Chi apre la pagina supera la verifica (di solito invisibile) e Cloudflare gli assegna un
cookie; una chiamata diretta alle API senza quel cookie, come fanno i programmi automatici, riceve la sfida e non arriva
all'app. Controllo (deve rispondere `403` con `cf-mitigated: challenge`; dal browser invece la pagina si apre):

```bash
curl -sI https://prenota.dominio.it/api/public/requests/session | grep -i "HTTP\|cf-mitigated"
```

In *Security → Settings* lascia **Challenge Passage** a 30 minuti (o più): è la durata massima di un modulo.

**6. Cloudflare → Security → WAF → Rate limiting rules.** Piano gratuito: una regola, finestra di 10 secondi. Espressione
`(http.host eq "prenota.dominio.it" and http.request.method eq "POST")`, conteggio per IP, **5 richieste ogni 10 secondi**,
azione **Block**. È solo una prima barriera: i limiti veri (orari e giornalieri) sono nell'app.

**7. Cloudflare → altre impostazioni.** *Security → Bots*: **Bot Fight Mode** attivo. Per questo dominio **spegni**:
*Speed → Optimization → Rocket Loader*, l'inserimento automatico di *Web Analytics*, *Email Address Obfuscation* e le
minificazioni automatiche (riscrivono o aggiungono script e la CSP della pagina li blocca). Nessuna regola *Cache
Everything* su questo dominio.

**8. Nell'app.** *Impostazioni → Moduli → Richieste web*: attiva, scrivi l'**indirizzo dell'informativa** (pagina privacy del
sito) e salva: compare il link da usare. Nel `.env` ora deve esserci `BOOKING_BASE_URL`.

**9. Sul sito WordPress.** Nessun plugin né codice: il pulsante o la voce di menu «Prenota appuntamento» è un normale
**link** a `https://prenota.dominio.it/prenota` (anche la sola radice del dominio funziona). Conviene aprirlo nella stessa
scheda e avere nel sito la pagina con l'informativa privacy indicata al punto 8.

**Prova.** Apri il link dal telefono, invia una richiesta: entro un minuto compaiono il riquadro *Richieste web* e il
contatore sulla scheda *Appuntamenti*. Riaprire la stessa pagina e inviare di nuovo funziona (nuovo codice); rinviare il
modulo già inviato, o attendere oltre 10 minuti senza scrivere nulla, mostra un errore e la pagina ne emette uno nuovo.

Nota: con la nuvola arancione Cloudflare vede in chiaro il traffico del modulo (come per ogni sito dietro Cloudflare): è il
prezzo della sfida antibot. Il certificato Let's Encrypt del sottodominio compare nei registri pubblici (crt.sh): il nome
del dominio non è segreto, la protezione sta nei controlli sopra.

### Eliminare il modulo

Per nasconderlo basta spegnerlo in *Impostazioni → Moduli* (il modulo online smette di rispondere, le richieste già
arrivate restano). Per toglierlo del tutto:

1. su GitHub, nella pull request che ha introdotto il modulo, **Revert** e unisci la pull request di annullamento,
   poi `./studio update` su ogni server;
2. cancella i dati (irreversibile: prima `./studio backup`):
   ```bash
   ./studio db
   DELETE FROM appointments WHERE day IS NULL AND web_request_at IS NOT NULL;
   DROP SCHEMA inbox CASCADE;
   DROP OWNED BY booking_inbox;
   DROP ROLE booking_inbox;
   ALTER TABLE appointments DROP COLUMN web_request_at, DROP COLUMN web_slot, DROP COLUMN web_nonce, DROP COLUMN web_consent, DROP COLUMN web_ip_hash;
   DELETE FROM settings WHERE key IN ('moduleRequests', 'bookingPrivacyUrl');
   ```

### Test

I test del modulo (codice firmato, scadenza e rinnovi, validazione, limiti, sigillo della inbox) girano con `npm test`
nella cartella `backend`. La prova su PostgreSQL parte con un database di prova (serve un utente amministratore: crea
lo schema e l'utente della inbox) e controlla tra l'altro che l'utente del container pubblico riceva «permesso negato»
su tutto tranne la inbox, che la inbox contenga solo testo sigillato, l'importazione con richieste manomesse o non
valide, il codice monouso anche dopo l'importazione, i limiti per IP, il tetto di richieste e la pulizia:

```bash
TEST_DATABASE_URL=postgres://studio:studio@localhost:5432/prova npm test   # cancella le richieste web di quel database
```

Per vedere cosa fa il container: `./studio logs booking -f`.

## Amministrazione: il comando `./studio`

Tutte le operazioni di amministrazione passano da un unico comando, da lanciare nella cartella dell'istanza:

```bash
./studio                  # stato: container, versione, cifratura, ultimo backup, attività pianificate, disco, avvisi
./studio start | stop | restart
./studio logs [api|app|db] [-f]
./studio backup           # backup subito (--list, --install-cron [HH:MM], --remove-cron)
./studio restore          # ripristino da un elenco (--latest, --file PERCORSO)
./studio update           # aggiornamento (--check, --yes, --rebuild, --install-cron, --remove-cron)
./studio user             # utenti: list, create, edit, passwd, delete
./studio key              # impronta della chiave dei dati; key show la mostra, key verify controlla la copia salvata
./studio cron             # backup e aggiornamento automatici attivi
./studio db               # console SQL del database
./studio setup            # configurazione iniziale
```

`./studio` (senza argomenti) segnala cosa sistemare, ad esempio backup più vecchio di 36 ore, backup automatico
spento, chiave mancante, appuntamenti non cifrati, container fermi, disco quasi pieno o `.env` leggibile da altri.
`./studio key verify` chiede di incollare la copia della chiave che hai salvato e conferma che sia giusta: conviene
farlo subito dopo averla salvata. Gli script `setup.sh`, `backup.sh`, `recovery.sh`, `update.sh` e `manage-users.sh`
restano utilizzabili direttamente (le attività pianificate usano quelli) e `./studio` accetta le stesse opzioni.

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

La scheda **Appuntamenti** (icona del calendario, la prima e quella che si apre all'accesso) contiene l'agenda dello
studio.

- **Nuovo appuntamento** (oppure un clic su un orario libero della griglia): data, ora, durata, nome e telefono del
  paziente, prestazione (dall'elenco delle prestazioni) e note interne. I pazienti già inseriti vengono proposti mentre
  scrivi il nome, con il loro telefono. Se l'orario si sovrappone a un altro appuntamento compare un avviso.
- **Vista giorno o settimana**, con frecce, *Oggi*, scelta della data e *Nuovo appuntamento* nella barra del
  calendario. Su computer l'altezza delle ore si adatta alla finestra perché la fascia **9–19** si veda senza scorrere
  (sugli schermi più bassi, es. 1366×768, fino alle 18:30 circa); prima o dopo si scorre nella griglia. Sul telefono la settimana diventa un elenco per
  giorno. Un clic sull'intestazione di un giorno apre la vista del giorno.
- Ogni appuntamento mostra il **badge della prestazione**, a tinta piena con scritta bianca: di base il colore della
  categoria (es. Ortodonzia fucsia) oppure quello della singola prestazione (Igiene orale verde scuro). Si cambia in
  **Impostazioni → Prestazioni** cliccando sul badge accanto alla categoria (il colore di default di ogni categoria si cambia in **Impostazioni → Categorie**) (la freccia circolare torna al colore della
  categoria). Negli appuntamenti più corti di mezz'ora il badge diventa un pallino colorato.
- **Cerca** (nella barra del calendario): si scrive una parte del nome, del cognome o il telefono del paziente e compare
  l'anteprima dei suoi appuntamenti (prossimi, da riprogrammare, passati) con medico, prestazione e stato; un clic apre
  la scheda e porta il calendario su quel giorno. Frecce e Invio da tastiera.
- **Medici**: in **Impostazioni → Medici** si inseriscono i medici dello studio (nome, colore, attivo/disattivo; all'inizio
  ce ne sono tre di esempio, viola, verde e rosso, da rinominare). Nel modulo dell'appuntamento si sceglie il medico;
  nell'agenda l'appuntamento mostra il suo **badge colorato** con il nome e una **striscia** dello stesso colore sul bordo
  destro. Un medico con appuntamenti non si elimina ma si disattiva (non si può scegliere nei nuovi, lo storico resta).
  I colori delle categorie evitano rosso, verde e viola per non confondersi con i medici.
- Nell'agenda gli appuntamenti di mezz'ora (o meno) stanno su una riga: **ora, paziente, medico, prestazione, nota**;
  quello che non entra si tronca da destra, partendo dalla nota. Quelli di un'ora hanno il nome sopra e, sotto, medico,
  prestazione e nota. Nella settimana, con appuntamenti affiancati, i badge si riducono a chip colorati.
- Nel modulo la **prestazione** si sceglie dall'elenco per categoria (clic sul campo) oppure si cerca scrivendo, con
  completamento automatico (nome o categoria, anche una parte; frecce e Invio da tastiera).
- Ogni appuntamento ha anche un'**etichetta di stato**:

  | Etichetta | Significato |
  |---|---|
  | 🟢 *Confermato · link* | il paziente ha confermato aprendo il link ricevuto |
  | 🔵 *Confermato · studio* | confermato a mano dallo studio (es. al telefono), con *Segna confermato* |
  | 🟠 *In attesa* | messaggio preparato, il paziente non ha ancora confermato |
  | ⚪ *Da inviare* | messaggio non ancora preparato |
  | 🔴 *Non presentato* | il paziente non si è presentato (nome barrato in agenda): non conta nelle statistiche |
  | 🟪 *Da riprogrammare* | il paziente deve spostare l'appuntamento: è senza data né ora |

  *Non presentato* si segna dalla scheda dell'appuntamento, dal suo giorno in poi (*Era presente* lo annulla).
  Spostando l'appuntamento a un'altra data lo stato riparte da capo.

### Dati dei pazienti cifrati

Nome, telefono e note degli appuntamenti sono **cifrati nel database** (AES-256-GCM) con la chiave `DATA_KEY` del
`.env`, che non sta nel database né nei backup: chi ottenesse un dump, un backup, la cartella `db/data` o l'accesso a
PostgreSQL vedrebbe solo codici `v1:…`. Nell'app non cambia nulla: il backend cifra prima di salvare e decifra in
lettura.

- La chiave la genera `setup.sh` (nuove installazioni) o `update.sh` (installazioni esistenti); al primo avvio gli
  appuntamenti già inseriti vengono cifrati.
- ⚠️ **Conserva una copia di `DATA_KEY` fuori dal server** (es. in un gestore di password), non insieme ai backup:
  senza la chiave i dati dei pazienti e i backup non sono più leggibili. Per spostare lo studio su un altro server,
  copia anche la chiave nel nuovo `.env`.
- Non cambiarla: se nel `.env` c'è una chiave diversa da quella usata per cifrare (o manca), le API non partono e il
  log (`docker compose logs api`) lo spiega, così non si rischiano dati illeggibili o cifrati con due chiavi.
- Non protegge da chi ottiene il pieno controllo del server (potrebbe leggere anche il `.env`): per quello servono
  server aggiornato, accesso SSH con chiavi e l'Access List sul gestionale in NPM.

### Appuntamenti nelle statistiche

Un appuntamento **confermato** (dal link o dallo studio) e con una **prestazione** conta nelle statistiche come una
prestazione registrata a mano, dal suo giorno in poi: dashboard, campagne ed Excel lo includono. Il conteggio è calcolato
dall'agenda, quindi spostando, riprogrammando o eliminando l'appuntamento, o togliendo la conferma, i numeri si aggiornano
da soli. Non contano gli appuntamenti futuri, quelli non confermati, quelli senza prestazione e i pazienti non
presentati.

In **Registra** accanto a ogni prestazione compare *N da agenda*: lì si inseriscono solo le prestazioni in più (es.
pazienti senza appuntamento o trattamenti aggiunti), altrimenti verrebbero contate due volte. *Esporta tutto in Excel*
mette le registrazioni a mano nel foglio *Dati* (reimportabile) e quelle dagli appuntamenti nel foglio *Da appuntamenti*.
*Elimina tutti i dati* cancella solo le registrazioni a mano.

### Da riprogrammare

Quando un paziente, confermato o no, deve spostare l'appuntamento: **Modifica → Da riprogrammare**. L'appuntamento
perde data e ora (il posto in agenda si libera e il link di conferma smette di funzionare), ricorda quelle di prima e
compare nel riquadro indaco **Da riprogrammare**, in cima alla pagina, con il telefono, la data che aveva e da quando
aspetta. **Riprogramma** apre il modulo con data e ora da scegliere: salvando torna in agenda come *Da inviare* e si
apre il nuovo messaggio di conferma (il link resta lo stesso).

### Da confermare

Nella colonna a sinistra dell'agenda (sopra il calendario sugli schermi stretti) ci sono i riquadri **Da
riprogrammare** e **Da confermare**; il calendario occupa il resto dello schermo. **Da confermare** elenca gli
appuntamenti non ancora confermati da adesso ai **2 giorni lavorativi successivi** (es. il lunedì: oggi, martedì e
mercoledì; il venerdì: oggi, sabato, domenica, lunedì e martedì), raggruppati per giorno, con prestazione, stato
dell'invio e chiamate senza risposta già fatte (passando il mouse: quando). Le azioni, con un'icona ciascuna:

- **WhatsApp (Invia / Reinvia)**: apre il messaggio. Se il paziente l'ha già ricevuto, il testo diventa un
  **sollecito** ("non abbiamo ancora ricevuto la conferma del suo appuntamento di domani…");
- **Chiama** (sul telefono avvia la chiamata), poi **Non risponde** per registrare il tentativo (così chi arriva dopo
  sa che è già stato cercato) oppure **Confermato** se il paziente conferma a voce.

Quando tutti hanno confermato il riquadro lo dice in verde. Spostando un appuntamento, invii e chiamate si azzerano.

### Promemoria su WhatsApp

Aprendo un appuntamento si vede il messaggio già pronto (modificabile prima dell'invio), per esempio:

```
*Studio Dentistico Sorriso*
Promemoria appuntamento

Gentile Mario Rossi,
le ricordiamo il suo prossimo appuntamento:

📅 Mercoledì 7 ottobre 2026
⏰ Ore 12:30
📋 Visita di controllo
📍 Via Roma 1, 20100 Milano

👉 *Confermi la sua presenza* da questo link:
https://studio.esempio.it/c/Xy3…
Dalla stessa pagina può aggiungere l'appuntamento al calendario del telefono.

📞 Per spostarlo o annullarlo risponda a questo messaggio o chiami lo 02 1234567.

A presto!
```

Le icone sono solo emoji del 2010 (Unicode 6.0), visibili su qualsiasi telefono.

- **Dal computer**: **App WhatsApp** (o **WhatsApp Web**) apre la chat del paziente con il messaggio già scritto
  **senza icone** (voci in grassetto: *Data:*, *Ora:*…): da computer WhatsApp, sia l'app sia Web, sostituisce con «�»
  le icone del testo ricevuto dal link, mentre lettere accentate e grassetto arrivano intatti. Con la casella **Con le
  icone** la chat si apre vuota e il messaggio con le icone viene copiato: si incolla con Cmd/Ctrl + V.
- **Dal telefono**: **Apri in WhatsApp** apre l'app con il messaggio già scritto.
- Il numero senza prefisso viene considerato italiano (+39). **Copia messaggio** lo copia negli appunti.
- Il **link è univoco** per ogni appuntamento (codice casuale di 24 caratteri, impossibile da indovinare). Il paziente
  apre una pagina con logo e nome dello studio, data, ora e prestazione, e preme **Confermo l'appuntamento**; da lì può
  anche chiamare lo studio o scrivergli su WhatsApp, e **aggiungere l'appuntamento al calendario** del telefono, con
  promemoria il giorno prima e due ore prima: su iPhone (e sugli altri calendari) con un file `.ics`, su Android con
  Google Calendar. La pagina mostra solo il nome di battesimo: niente telefono,
  cognome o note. La conferma richiede il pulsante, quindi l'anteprima automatica del link in WhatsApp non conferma
  nulla. Dopo il giorno dell'appuntamento il link non permette più di confermare e **3 giorni dopo scade**: la pagina
  non mostra più nulla (l'appuntamento resta nell'agenda). La pagina e le risposte pubbliche chiedono ai motori di
  ricerca di non indicizzarle (`noindex`).
- L'agenda si aggiorna da sola ogni minuto: quando un paziente conferma compare un avviso.
- Se si cambiano **data o ora** di un appuntamento, conferma e invio si azzerano: va mandato il nuovo messaggio (il link
  resta lo stesso e mostra il nuovo orario). Eliminando l'appuntamento il link smette di funzionare.

**Indirizzo dei link**: i link usano l'indirizzo impostato in **Impostazioni → Studio → Indirizzo dei link di conferma**
(o scelto con `setup.sh`), altrimenti quello con cui stai usando l'app. Conviene un dominio separato, es.
`https://conferma.dominio.it` (vedi [Collegare Nginx Proxy Manager](#collegare-nginx-proxy-manager)). Se dallo studio
apri l'app con un indirizzo interno (es. `http://192.168.1.10:8080`) e non hai impostato l'indirizzo dei link, il
paziente non riesce ad aprirli: l'app lo segnala nel riquadro del messaggio.

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
./manage-users.sh 2fa mario       # verifica in due passaggi (QR code), vedi sotto
./manage-users.sh logout mario    # disconnette da tutti i dispositivi
```

Le password vengono chieste due volte senza mostrarle; da uno script si possono passare sullo standard input
(`echo 'password' | ./manage-users.sh create mario`). Non è possibile eliminare l'ultimo utente rimasto.

### Verifica in due passaggi (2FA) e sessioni

Oltre alla password si può chiedere un **codice a 6 cifre** generato da un'app sul telefono (Google Authenticator,
Microsoft Authenticator, Authy, 2FAS, Aegis…): standard TOTP, funziona senza internet né SMS.

- **Attivazione** (ognuno per sé): **Impostazioni → Sicurezza → Attiva la verifica in due passaggi**. Si conferma la
  password, si inquadra il **QR code** con l'app (o si digita la chiave) e si scrive il primo codice: solo allora la verifica
  si attiva, quindi un QR inquadrato male non chiude fuori nessuno. Subito dopo compaiono **10 codici di recupero**
  monouso, da salvare (non vengono mostrati di nuovo; se ne generano di nuovi dalla stessa pagina).
- **Accesso**: nome utente e password, poi il codice dell'app. «Ricorda questo dispositivo per 30 giorni» evita di
  riscriverlo ogni volta da quel computer o telefono; se si è perso il telefono si usa un codice di recupero. Lo stesso codice
  non vale due volte e i codici sbagliati hanno un limite (come le password).
- **Obbligo per tutti**: in **Sicurezza** l'interruttore «Richiedi la verifica a tutti» (si può accendere solo con la
  verifica attiva sul proprio account). Chi non l'ha ancora la configura al **primo accesso**: dopo la password compare il
  QR code e non entra finché non finisce. In emergenza si toglie dal server: `./studio user 2fa-require off`.
- **Dal server** (amministratore): `./studio user 2fa mario` mostra il QR code nel terminale (da inquadrare o da leggere
  all'utente), chiede il primo codice e stampa i codici di recupero; `./studio user 2fa-reset mario` toglie la verifica a chi
  ha perso telefono e codici (se l'obbligo è attivo la riconfigura al prossimo accesso).
- **Sessioni**: restano aperte per **30 giorni** dall'ultimo uso (si rinnovano usando l'app). In **Sicurezza → Durata della
  sessione** si sceglie da 1 giorno a **Nessuna scadenza** (il dispositivo resta collegato finché non esce o non resta
  inutilizzato per oltre 400 giorni). Con una sessione lunga conviene tenere attiva la verifica in due passaggi.
- **Furto o smarrimento di un dispositivo**: da **Sicurezza → Disconnetti gli altri dispositivi** (resta collegato quello
  in uso) oppure dal server `./studio user logout mario` (un utente) o `./studio user logout-all` (tutti). Si chiudono anche i
  dispositivi «ricordati»; cambiare la password fa lo stesso.
- **Aggiornamento**: dopo `./studio update` la verifica **non è obbligatoria** (è facoltativa finché non la si impone) e nessuno
  deve riconfigurare nulla; le sessioni già aperte restano valide. Ordine consigliato: aggiornare, attivare la verifica sul
  proprio account (e controllare che il codice dell'app sia accettato), farla attivare agli altri utenti (da Sicurezza o con
  `./studio user 2fa <utente>`) e solo alla fine accendere l'obbligo con `./studio user 2fa-require on`. Dal server l'obbligo si
  accende anche se il proprio account non l'ha ancora: in quel caso si associa l'app al prossimo accesso.
- Il segreto della verifica è salvato **cifrato con `DATA_KEY`** (come i dati dei pazienti) e i codici di recupero solo come
  impronta: un backup non li rivela. Come per i dati dei pazienti, senza la chiave originale i segreti non si leggono: dopo un
  ripristino con chiave diversa gli utenti vanno riconfigurati con `./studio user 2fa-reset`.

### Variabili (`.env`)

| Variabile | Descrizione |
|---|---|
| `INSTANCE` | Nome dell'istanza, prefisso di container e immagini (predefinito `studio-odontoiatrico`). |
| `POSTGRES_PASSWORD` | Password del database (generata da `setup.sh`). |
| `SESSION_SECRET` | Chiave per firmare i cookie di sessione (generata; cambiandola si chiudono tutte le sessioni). |
| `DATA_KEY` | Chiave che cifra nome, telefono e note dei pazienti (generata; **non cambiarla e conservane una copia fuori dal server**). |
| `HTTP_PORT` | Porta pubblicata sull'host, solo con `_deploy_network_example.yml` (predefinita 80). |
| `CONFIRM_URL` | Indirizzo dei link di conferma su un dominio separato, es. `https://conferma.dominio.it` (facoltativo; vale se non è impostato in Impostazioni). |
| `CARD_BASE_URL` | Dominio delle fidelity card (`https://carte.dominio.it`), vedi la sezione *Fidelity card*. |
| `CARD_PORT` | Porta pubblicata per le carte, solo con `_deploy_network_example.yml` (predefinita 8200; `update.sh` ne assegna una libera se manca). |
| `BOOKING_BASE_URL` | Dominio delle richieste web (`https://prenota.dominio.it`), vedi la sezione *Richieste web*. |
| `BOOKING_SECRET` | Chiave che firma i codici dei moduli, solo per il container `booking` (generata da `setup.sh`/`update.sh`). |
| `BOOKING_DB_PASSWORD` | Password dell'utente `booking_inbox` del database, che vede solo la inbox (generata). |
| `BOOKING_PORT` | Porta pubblicata per le richieste web, solo con `_deploy_network_example.yml` (predefinita 8220; `update.sh` ne assegna una libera tra 8220 e 8239 se manca). |
| `CONFIRM_PORT` | Porta pubblicata per le conferme, solo con `_deploy_network_example.yml` (predefinita 8180; `update.sh` ne assegna una libera se manca). |
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

`update.sh` segue il **branch** su cui si trova la cartella. Le installazioni di produzione devono stare su `main`: se
una è rimasta su un branch di prova (es. `beta/...`), `./studio` e `update.sh` lo segnalano con quante versioni di
`main` mancano, e il passaggio è `git checkout main && ./studio update`. Per vedere su cosa punta un'installazione:
la prima riga di `./studio` (*Versione … (branch main)*) oppure `git rev-parse --abbrev-ref HEAD`.

Le versioni importanti hanno un **tag** (es. `v2.0`: appuntamenti, conferme su dominio separato, dati cifrati, comando
`./studio`, moduli): `git tag` le elenca e la versione in uso compare in `./studio` come `v2.0` o `v2.0-N-g…`
(N aggiornamenti dopo `v2.0`).

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

Nei backup nome, telefono e note dei pazienti sono cifrati con `DATA_KEY`. Prima di toccare il database
`recovery.sh` verifica che la chiave del `.env` apra il backup; se non è quella (es. backup di un altro server)
**chiede la chiave originale**, la verifica e dopo il ripristino la scrive nel `.env` (la precedente resta in una copia
`.env.bak-*`). Senza la chiave giusta non ripristina nulla. Con `--yes` la chiave si passa con
`RESTORE_DATA_KEY=... ./recovery.sh --file ... --yes`. Un backup fatto prima della cifratura viene cifrato al riavvio.

### Recupero completo su un altro server

Per poter ricostruire lo studio se il server si guasta o va sostituito, conserva **fuori dal server**:

- una copia recente dei backup (`backups/daily/`, es. con `rsync` o `scp` su un altro computer o NAS): i backup che
  restano solo sul server si perdono insieme a lui;
- la chiave `DATA_KEY` (es. in un gestore di password), **separata** dai backup.

Sul nuovo server:

1. Installa Docker, clona il repository e lancia `./setup.sh` come per una nuova installazione (stesso nome
   dell'istanza, stesso tipo di deploy, indirizzo dei link di conferma). L'utente creato ora verrà sostituito da quelli
   del backup.
2. Copia sul nuovo server la cartella del backup più recente, es.
   `scp -r backups/daily/2026-10-02_023000 nuovo-server:~/docker/studio_odontoiatrico/backups/`.
3. Ripristina: `./recovery.sh --file backups/2026-10-02_023000`. Lo script chiede la `DATA_KEY` del vecchio server,
   la verifica sul backup, ripristina utenti, appuntamenti, impostazioni e logo e riavvia l'app.
4. Punta DNS e Nginx Proxy Manager al nuovo server (gestionale e link di conferma).

In alternativa, *Esporta tutto in Excel* produce un file reimportabile con tutte le registrazioni.

## Sviluppo locale

Per chi sviluppa o usa un agente AI: **`AGENTS.md`** raccoglie architettura, comandi, convenzioni, regole di sicurezza e
processo di lavoro del progetto (usalo come prompt di partenza).

Serve Node 22.18+ (o 24) e un PostgreSQL raggiungibile.

```bash
cd backend && npm install
DATABASE_URL=postgres://studio:studio@localhost:5432/studio npm run dev   # API su :3000
npm test                                                                 # test dell'algoritmo

cd ../frontend && npm install && npm run dev                             # UI su :5173 (proxy /api → :3000)
npm run typecheck
```
