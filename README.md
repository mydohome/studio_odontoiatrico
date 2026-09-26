# Studio Odontoiatrico · Prestazioni e Campagne

Webapp per registrare ogni giorno le prestazioni di uno studio dentistico, consultarle in una dashboard e ricevere
proposte di **campagne marketing** mese per mese calcolate sui dati raccolti.

| Scheda | Cosa fa |
|---|---|
| **Registra** | Inserimento giornaliero delle quantità per prestazione (igiene orale, visita di controllo, ortopanoramica…), con pulsanti +/−, elenco delle ultime giornate e salvataggio rapido (Ctrl/Cmd + S). |
| **Dashboard** | Riepilogo per giorno, settimana o mese: totale prestazioni, fatturato stimato, media per giorno lavorato, andamento per categoria (grafico a colonne), dettaglio per prestazione con confronto sul periodo precedente. |
| **Campagne** | Per i prossimi 12 mesi propone le campagne più convenienti con punteggio, offerta, target, canali e motivazioni. Mostra la previsione per categoria e la mappa della stagionalità. |
| **Impostazioni** | Template Excel scaricabile, import da Excel, export completo, gestione delle prestazioni (nome, categoria, prezzo medio, attiva/disattiva), dati dimostrativi, nome dello studio. |

## Architettura

```
Browser ──► frontend (Nginx + React)  ──/api──►  backend (Node 24 + Fastify)  ──►  db (PostgreSQL 16)
             porta 80                             porta 3000 (interna)             volume pgdata
```

- **frontend/**: React + Vite, compilato in file statici serviti da Nginx, che inoltra `/api` al backend.
- **backend/**: API REST in TypeScript eseguito direttamente da Node 24 (niente build), algoritmo campagne, import/export Excel (exceljs).
- **shared/**: tipi, date e catalogo delle categorie usati sia dal frontend sia dal backend.
- **db**: PostgreSQL 16 alpine con parametri ridotti per consumare poca memoria.

A riposo, con due anni di dati, lo stack usa circa **75 MB di RAM** (db ~25 MB, backend ~45 MB, Nginx ~5 MB).
Le immagini sono multi-architettura: funzionano sia su OCI **Ampere A1 (ARM)** sia su **VM.Standard.E2.1.Micro (AMD, 1 GB)**.

## Avvio rapido

```bash
git clone <questo repository> studio && cd studio
cp .env.example .env
nano .env            # imposta almeno POSTGRES_PASSWORD e APP_PASSWORD
docker compose up -d --build
```

Apri `http://<ip-del-server>/`. Per provare subito l'app vai in **Impostazioni → Genera dati demo** (2 anni di dati simulati),
poi cancellali con **Elimina tutti i dati** prima di iniziare a usarla davvero.

### Variabili (`.env`)

| Variabile | Descrizione |
|---|---|
| `POSTGRES_PASSWORD` | Password del database (obbligatoria). |
| `APP_PASSWORD` | Password di accesso all'app. **Impostala sempre se il server è raggiungibile da Internet.** Vuota = nessun login. |
| `SESSION_SECRET` | Chiave per firmare i cookie di sessione (facoltativa; se vuota ne viene derivata una dalla password). |
| `HTTP_PORT` | Porta pubblicata sull'host (predefinita 80). |
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
6. Esegui l'**Avvio rapido** qui sopra.

### HTTPS (consigliato)

Se hai un dominio che punta all'IP del server, il modo più semplice è mettere [Caddy](https://caddyserver.com) davanti
all'app: imposta `HTTP_PORT=8080` nel `.env` e usa un `Caddyfile` come questo, che ottiene il certificato in automatico.

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

## Backup e aggiornamenti

```bash
# Backup del database
docker compose exec -T db pg_dump -U studio studio | gzip > backup-$(date +%F).sql.gz

# Ripristino
gunzip -c backup-AAAA-MM-GG.sql.gz | docker compose exec -T db psql -U studio studio

# Aggiornamento dell'app
git pull && docker compose up -d --build
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
