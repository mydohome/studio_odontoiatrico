#!/usr/bin/env bash
# Configurazione iniziale del server:
#   - sceglie il tipo di deploy e crea docker-compose.yml dal template corrispondente
#   - genera il file .env con le password necessarie
#   - avvia l'app, crea il primo utente e attiva il backup giornaliero del database
#
#   ./setup.sh                  modalità interattiva (consigliata)
#   ./setup.sh --mode npm       Nginx Proxy Manager sullo stesso host (rete Docker proxy-net)
#   ./setup.sh --mode network   NPM su un altro host (o nessun NPM): l'app pubblica una porta HTTP
#   ./setup.sh --yes            nessuna domanda: valori predefiniti e password generate
#   ./setup.sh --start          avvia l'app senza chiederlo
#   ./setup.sh --force          ricrea .env e docker-compose.yml senza chiedere (ne salva una copia)
#   ./setup.sh --instance NOME  nome dell'istanza (più studi sullo stesso server: una cartella per studio)
#
# Con --yes i valori si possono passare come variabili d'ambiente:
#   FIRST_USER=mario FIRST_EMAIL=mario@studio.it FIRST_PASSWORD=... HTTP_PORT=8080 TZ=Europe/Rome INSTANCE=studio-rossi
#   BACKUP=no (non attiva il backup giornaliero)

set -euo pipefail

cd "$(dirname "$0")"
ENV_FILE=.env
COMPOSE_FILE=docker-compose.yml
TPL_NETWORK=_deploy_network_example.yml
TPL_NPM=_deploy_npm_example.yml

# ---------- Opzioni ----------

ASSUME_YES=0
FORCE=0
START=0
MODE=''
ARG_INSTANCE=''
while [ $# -gt 0 ]; do
  case "$1" in
    -y | --yes) ASSUME_YES=1 ;;
    -f | --force) FORCE=1 ;;
    -s | --start) START=1 ;;
    --mode)
      MODE=${2:-}
      shift
      ;;
    --mode=*) MODE=${1#--mode=} ;;
    --npm) MODE=npm ;;
    --instance)
      ARG_INSTANCE=${2:-}
      shift
      ;;
    --instance=*) ARG_INSTANCE=${1#--instance=} ;;
    --network) MODE=network ;;
    -h | --help)
      sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Opzione sconosciuta: $1 (usa --help)" >&2
      exit 1
      ;;
  esac
  shift
done
case "$MODE" in '' | npm | network) ;; *)
  echo "Valore di --mode non valido: $MODE (usa npm oppure network)" >&2
  exit 1
  ;;
esac

# Senza terminale (es. script automatici) non si possono fare domande.
if [ "$ASSUME_YES" -eq 0 ] && [ ! -t 0 ]; then
  echo "Nessun terminale interattivo: procedo come con --yes." >&2
  ASSUME_YES=1
fi

# ---------- Utilità ----------

if [ -t 1 ]; then
  B=$'\e[1m' G=$'\e[32m' Y=$'\e[33m' R=$'\e[31m' C=$'\e[36m' N=$'\e[0m'
else
  B='' G='' Y='' R='' C='' N=''
fi
info() { printf '%s\n' "${C}›${N} $*"; }
ok() { printf '%s\n' "${G}✔${N} $*"; }
warn() { printf '%s\n' "${Y}!${N} $*" >&2; }
die() {
  printf '%s\n' "${R}✖${N} $*" >&2
  exit 1
}
title() { printf '\n%s\n' "${B}$*${N}"; }

# Chiave da 32 byte in esadecimale (DATA_KEY).
gen_data_key() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -v -tx1 | tr -d ' \n'
  fi
}

# Stringa casuale alfanumerica (sicura dentro URL e file .env).
gen_secret() {
  local len=${1:-32} out=''
  while [ "${#out}" -lt "$len" ]; do
    if command -v openssl >/dev/null 2>&1; then
      out+=$(openssl rand -base64 48 | LC_ALL=C tr -dc 'A-Za-z0-9')
    else
      out+=$(LC_ALL=C tr -dc 'A-Za-z0-9' < <(head -c 256 /dev/urandom))
    fi
  done
  printf '%s' "${out:0:$len}"
}

# ask "Domanda" "predefinito" → stampa la risposta (o il predefinito)
ask() {
  local prompt=$1 def=${2:-} ans
  if [ "$ASSUME_YES" -eq 1 ]; then
    printf '%s' "$def"
    return
  fi
  if [ -n "$def" ]; then
    read -r -p "$prompt [$def]: " ans </dev/tty
  else
    read -r -p "$prompt: " ans </dev/tty
  fi
  printf '%s' "${ans:-$def}"
}

# confirm "Domanda" s|n → 0 se sì
confirm() {
  local prompt=$1 def=${2:-s} ans hint
  [ "$ASSUME_YES" -eq 1 ] && { [ "$def" = s ]; return; }
  if [ "$def" = s ]; then hint='S/n'; else hint='s/N'; fi
  read -r -p "$prompt ($hint): " ans </dev/tty
  ans=$(printf '%s' "${ans:-$def}" | tr '[:upper:]' '[:lower:]')
  [ "$ans" = s ] || [ "$ans" = si ] || [ "$ans" = sì ] || [ "$ans" = y ] || [ "$ans" = yes ]
}

# Legge una variabile da un file .env esistente (gestisce i valori tra apici singoli).
env_get() {
  local key=$1 file=$2 line
  line=$(grep -E "^${key}=" "$file" 2>/dev/null | tail -n1) || true
  line=${line#*=}
  line=${line#\'}
  line=${line%\'}
  printf '%s' "$line"
}

no_quotes() {
  case "$1" in
    *"'"* | *$'\n'*) return 1 ;;
  esac
  return 0
}

valid_username() { [[ "$1" =~ ^[A-Za-z0-9._-]{3,32}$ ]]; }
valid_email() { [[ "$1" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; }

valid_instance() { [[ "$1" =~ ^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$ ]]; }

# Cartella dell'installazione che usa già questo nome di istanza (vuoto se nessuna).
instance_owner() {
  [ "$HAVE_DOCKER" -eq 1 ] || return 0
  {
    docker ps -a --filter "label=com.docker.compose.project=$1" --format '{{.Label "com.docker.compose.project.working_dir"}}'
    docker ps -a --filter "name=^/$1-(app|api|db)$" --format '{{.Label "com.docker.compose.project.working_dir"}}'
  } 2>/dev/null | grep -v '^$' | head -n1 || true
}

# Prima porta libera per le conferme degli appuntamenti tra 8180 e 8199 (diversa da quella HTTP).
free_confirm_port() {
  local p
  for p in $(seq 8180 8199); do
    [ "$p" != "${PORT:-}" ] && ! port_in_use "$p" && { printf '%s' "$p"; return; }
  done
  printf '8180'
}

# Indirizzo dei link di conferma: vuoto oppure http(s)://host[/percorso], senza / finale.
normalize_url() {
  local u=$1
  u=${u%/}
  [ -z "$u" ] && return 0
  [[ "$u" =~ ^https?:// ]] || u="https://$u"
  [[ "$u" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~/-]*)?$ ]] || return 1
  printf '%s' "${u%/}"
}

# Prima porta libera tra 80 e 8080–8099.
free_port() {
  local p
  for p in 80 $(seq 8080 8099); do
    port_in_use "$p" || { printf '%s' "$p"; return; }
  done
  printf '8080'
}

# Stato di salute del container delle API di questa installazione (qualunque sia il nome dell'istanza).
api_health() {
  local id
  id=$(docker compose ps -q api 2>/dev/null) || true
  [ -n "$id" ] && docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id" 2>/dev/null
}

# Porta TCP già in ascolto sull'host o pubblicata da un altro container Docker.
port_in_use() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnH 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1\$" && return 0
  else
    local hex
    hex=$(printf '%04X' "$1")
    cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | awk -v h=":$hex" '$4 == "0A" && substr($2, length($2) - 4) == h { f = 1 } END { exit !f }' && return 0
  fi
  [ "${HAVE_DOCKER:-0}" -eq 1 ] && docker ps --format '{{.Ports}}' 2>/dev/null | tr ',' '\n' | grep -qE ":$1->" && return 0
  return 1
}

backup() {
  local f=$1 dest
  dest="$f.bak-$(date +%Y%m%d-%H%M%S)"
  cp -p "$f" "$dest"
  ok "Copia di $f salvata in $dest"
}

# ---------- Controlli preliminari ----------

printf '\n%s\n' "${B}Configurazione Studio Odontoiatrico${N}"
[ -f "$TPL_NETWORK" ] && [ -f "$TPL_NPM" ] || die "Template mancanti: esegui lo script dalla cartella del repository."

HAVE_DOCKER=0
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    HAVE_DOCKER=1
  else
    warn "Docker è installato ma non raggiungibile: il servizio non è avviato oppure il tuo utente non è nel gruppo docker."
    warn "Prova:  sudo systemctl start docker  e/o  sudo usermod -aG docker \$USER  (poi esci e rientra)."
  fi
else
  warn "Docker con il plugin compose non è installato."
  warn "Installalo con:  curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker \$USER"
fi
[ "$HAVE_DOCKER" -eq 1 ] || warn "La configurazione verrà comunque creata; l'app andrà avviata più tardi."

HAVE_PROXY_NET=0
if [ "$HAVE_DOCKER" -eq 1 ] && docker network inspect proxy-net >/dev/null 2>&1; then
  HAVE_PROXY_NET=1
fi

# ---------- 1. Tipo di deploy ----------

title "1. Tipo di deploy"
if [ -z "$MODE" ]; then
  DEFAULT_CHOICE=1
  [ "$HAVE_PROXY_NET" -eq 1 ] && DEFAULT_CHOICE=2
  if [ "$ASSUME_YES" -eq 1 ]; then
    CHOICE=$DEFAULT_CHOICE
  else
    [ "$HAVE_PROXY_NET" -eq 1 ] && info "Ho trovato la rete Docker proxy-net: su questo server sembra esserci Nginx Proxy Manager."
    echo "Dove si trova Nginx Proxy Manager?"
    echo "  1) Su un host diverso (oppure non uso NPM): l'app pubblica una porta HTTP"
    echo "  2) Su questo stesso host: collegamento tramite la rete Docker proxy-net, nessuna porta aperta"
    while :; do
      read -r -p "Scelta [$DEFAULT_CHOICE]: " CHOICE </dev/tty
      CHOICE=${CHOICE:-$DEFAULT_CHOICE}
      { [ "$CHOICE" = 1 ] || [ "$CHOICE" = 2 ]; } && break
      warn "Rispondi 1 oppure 2."
    done
  fi
  if [ "$CHOICE" = 2 ]; then MODE=npm; else MODE=network; fi
fi
if [ "$MODE" = npm ]; then
  TEMPLATE=$TPL_NPM
  ok "Deploy dietro Nginx Proxy Manager sullo stesso host (template $TPL_NPM)."
else
  TEMPLATE=$TPL_NETWORK
  ok "Deploy con porta HTTP pubblicata (template $TPL_NETWORK)."
fi

# ---------- 2. File .env ----------

title "2. Configurazione e password"

KEEP_DB_PASSWORD=''
KEEP_DB_USER=''
KEEP_DB_NAME=''
KEEP_SESSION=''
KEEP_DATA_KEY=''
NEW_DATA_KEY=0
OLD_PORT=''
OLD_TZ=''
OLD_CONFIRM_URL=''
OLD_CONFIRM_PORT=''
OLD_INSTANCE=''
FRESH_INSTALL=1
REWRITE_ENV=1

if [ -f "$ENV_FILE" ]; then
  FRESH_INSTALL=0
  warn "Esiste già un file $ENV_FILE."
  if [ "$FORCE" -eq 0 ] && ! confirm "Vuoi aggiornarlo? Le password esistenti verranno mantenute" n; then
    REWRITE_ENV=0
    info "Mantengo il file $ENV_FILE attuale."
  fi
  KEEP_DB_PASSWORD=$(env_get POSTGRES_PASSWORD "$ENV_FILE")
  KEEP_DB_USER=$(env_get POSTGRES_USER "$ENV_FILE")
  KEEP_DB_NAME=$(env_get POSTGRES_DB "$ENV_FILE")
  KEEP_SESSION=$(env_get SESSION_SECRET "$ENV_FILE")
  KEEP_DATA_KEY=$(env_get DATA_KEY "$ENV_FILE")
  OLD_PORT=$(env_get HTTP_PORT "$ENV_FILE")
  OLD_TZ=$(env_get TZ "$ENV_FILE")
  OLD_CONFIRM_URL=$(env_get CONFIRM_URL "$ENV_FILE")
  OLD_CONFIRM_PORT=$(env_get CONFIRM_PORT "$ENV_FILE")
  # Installazioni create prima dell'introduzione delle istanze: nome storico.
  OLD_INSTANCE=$(env_get INSTANCE "$ENV_FILE")
  OLD_INSTANCE=${OLD_INSTANCE:-studio-odontoiatrico}
elif [ -d db/data ]; then
  # Il database esiste già ma il .env è andato perso: la password va reinserita,
  # perché PostgreSQL la imposta solo alla prima inizializzazione.
  FRESH_INSTALL=0
  warn "Il database esiste già (cartella db/data) ma manca il file $ENV_FILE."
  if [ "$ASSUME_YES" -eq 1 ]; then
    [ -n "${POSTGRES_PASSWORD:-}" ] || die "Serve la password del database esistente: passala con POSTGRES_PASSWORD=... oppure esegui lo script in modo interattivo."
    KEEP_DB_PASSWORD=$POSTGRES_PASSWORD
  else
    read -r -s -p "Password del database esistente (invio = annulla): " KEEP_DB_PASSWORD </dev/tty
    echo
    [ -n "$KEEP_DB_PASSWORD" ] || die "Annullato. Per ripartire da zero elimina la cartella db/data (cancella tutti i dati)."
  fi
  # Anche la chiave dei dati dei pazienti: con una nuova non sarebbero più leggibili.
  if [ -n "${DATA_KEY:-}" ]; then
    KEEP_DATA_KEY=$DATA_KEY
  elif [ "$ASSUME_YES" -eq 0 ]; then
    read -r -s -p "Chiave dei dati dei pazienti DATA_KEY (invio = nessuna, se non era impostata): " KEEP_DATA_KEY </dev/tty
    echo
  fi
  KEEP_DATA_KEY=$(printf '%s' "$KEEP_DATA_KEY" | tr -d '[:space:]')
  case $KEEP_DATA_KEY in
    '' | *[!A-Za-z0-9+/=_-]*) [ -z "$KEEP_DATA_KEY" ] || die "DATA_KEY non valida (deve essere quella del vecchio .env, 64 caratteri esadecimali)." ;;
  esac
fi

PORT=${OLD_PORT:-80}
TIMEZONE=${OLD_TZ:-Europe/Rome}
CONFIRM_LINK=$OLD_CONFIRM_URL
CPORT=${OLD_CONFIRM_PORT:-8180}
INSTANCE_NAME=${ARG_INSTANCE:-${OLD_INSTANCE:-studio-odontoiatrico}}
if [ "$REWRITE_ENV" -eq 1 ]; then
  # Nome dell'istanza: prefisso di container, immagini e reti. Permette più studi sullo stesso
  # server (una cartella e un nome diversi per ciascuno).
  if [ -n "$ARG_INSTANCE" ]; then
    DEFAULT_INSTANCE=$ARG_INSTANCE
  elif [ -n "${INSTANCE:-}" ]; then
    DEFAULT_INSTANCE=$INSTANCE
  elif [ -n "$OLD_INSTANCE" ]; then
    DEFAULT_INSTANCE=$OLD_INSTANCE
  else
    DEFAULT_INSTANCE=$(basename "$PWD" | tr '[:upper:]_ ' '[:lower:]--' | LC_ALL=C tr -cd 'a-z0-9-' | sed 's/^-*//; s/-*$//' | cut -c1-40)
    valid_instance "$DEFAULT_INSTANCE" || DEFAULT_INSTANCE=studio-odontoiatrico
  fi
  [ "$ASSUME_YES" -eq 1 ] || info "Nome dell'istanza: serve a distinguere più studi sullo stesso server (es. studio-rossi)."
  while :; do
    INSTANCE_NAME=$(ask "Nome dell'istanza" "$DEFAULT_INSTANCE")
    if ! valid_instance "$INSTANCE_NAME"; then
      [ "$ASSUME_YES" -eq 1 ] && die "Nome dell'istanza non valido: $INSTANCE_NAME"
      warn "Usa 2–40 caratteri tra lettere minuscole, numeri e trattini (es. studio-rossi)."
      continue
    fi
    OWNER=$(instance_owner "$INSTANCE_NAME")
    if [ -n "$OWNER" ] && [ "$OWNER" != "$PWD" ]; then
      [ "$ASSUME_YES" -eq 1 ] && die "Il nome \"$INSTANCE_NAME\" è già usato dall'installazione in $OWNER."
      warn "Il nome \"$INSTANCE_NAME\" è già usato dall'installazione in $OWNER: scegline un altro."
      continue
    fi
    break
  done

  # Porta HTTP (solo se l'app la pubblica).
  if [ "$MODE" = network ]; then
    DEFAULT_PORT=${HTTP_PORT:-${OLD_PORT:-}}
    if [ -z "$DEFAULT_PORT" ]; then
      DEFAULT_PORT=$(free_port)
      [ "$DEFAULT_PORT" = 80 ] || warn "La porta 80 risulta già occupata su questo server: propongo la $DEFAULT_PORT."
    fi
    while :; do
      PORT=$(ask "Porta HTTP su cui pubblicare l'app" "$DEFAULT_PORT")
      if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
        [ "$ASSUME_YES" -eq 1 ] && die "Porta non valida: $PORT"
        warn "Inserisci un numero tra 1 e 65535."
        continue
      fi
      # La porta attuale di questa istanza è occupata da lei stessa: va bene.
      if [ "$PORT" != "$OLD_PORT" ] && port_in_use "$PORT"; then
        [ "$ASSUME_YES" -eq 1 ] && die "La porta $PORT è già in uso su questo server (un'altra istanza?). Scegline un'altra con HTTP_PORT=..."
        warn "La porta $PORT è già in uso su questo server: scegline un'altra (es. $(free_port))."
        continue
      fi
      break
    done
  fi

  # Link di conferma degli appuntamenti su un dominio separato (facoltativo).
  [ "$ASSUME_YES" -eq 1 ] || info "Link di conferma degli appuntamenti: meglio un dominio separato dal gestionale (es. conferma.dominio.it), che mostra solo la pagina di conferma. Invio senza indirizzo = stesso indirizzo del gestionale; \"-\" toglie quello impostato. Si può cambiare anche dopo, in Impostazioni."
  while :; do
    ans=$(ask "Indirizzo per i link di conferma (es. https://conferma.dominio.it)" "${CONFIRM_URL:-$OLD_CONFIRM_URL}")
    [ "$ans" = - ] && ans=''
    if CONFIRM_LINK=$(normalize_url "$ans"); then break; fi
    [ "$ASSUME_YES" -eq 1 ] && die "Indirizzo per i link di conferma non valido: $ans"
    warn "Indirizzo non valido: scrivi per esempio https://conferma.dominio.it (oppure invio per nessuno)."
  done

  # Porta delle conferme (solo se l'app pubblica le porte).
  if [ "$MODE" = network ]; then
    DEFAULT_CPORT=${CONFIRM_PORT:-${OLD_CONFIRM_PORT:-}}
    [ -n "$DEFAULT_CPORT" ] || DEFAULT_CPORT=$(free_confirm_port)
    while :; do
      CPORT=$(ask "Porta per i link di conferma (solo pagina di conferma)" "$DEFAULT_CPORT")
      if ! [[ "$CPORT" =~ ^[0-9]+$ ]] || [ "$CPORT" -lt 1 ] || [ "$CPORT" -gt 65535 ] || [ "$CPORT" = "$PORT" ]; then
        [ "$ASSUME_YES" -eq 1 ] && die "Porta per le conferme non valida: $CPORT"
        warn "Inserisci un numero tra 1 e 65535 diverso dalla porta HTTP ($PORT)."
        continue
      fi
      if [ "$CPORT" != "$OLD_CONFIRM_PORT" ] && port_in_use "$CPORT"; then
        [ "$ASSUME_YES" -eq 1 ] && die "La porta $CPORT è già in uso su questo server. Scegline un'altra con CONFIRM_PORT=..."
        warn "La porta $CPORT è già in uso su questo server: scegline un'altra (es. $(free_confirm_port))."
        continue
      fi
      break
    done
  fi

  # Fuso orario.
  DEFAULT_TZ=${TZ:-${OLD_TZ:-Europe/Rome}}
  while :; do
    TIMEZONE=$(ask "Fuso orario" "$DEFAULT_TZ")
    if [ ! -d /usr/share/zoneinfo ] || [ -f "/usr/share/zoneinfo/$TIMEZONE" ]; then break; fi
    [ "$ASSUME_YES" -eq 1 ] && die "Fuso orario sconosciuto: $TIMEZONE"
    warn "Fuso orario sconosciuto (esempi: Europe/Rome, Europe/Zurich)."
  done

  DB_USER=${KEEP_DB_USER:-studio}
  DB_NAME=${KEEP_DB_NAME:-studio}
  DB_PASSWORD=${KEEP_DB_PASSWORD:-$(gen_secret 32)}
  SESSION=${KEEP_SESSION:-$(gen_secret 48)}
  DATAKEY=${KEEP_DATA_KEY:-$(gen_data_key)}
  [ -n "$KEEP_DATA_KEY" ] || NEW_DATA_KEY=1
  no_quotes "$DB_PASSWORD" || die "La password del database non può contenere apici singoli."

  [ -f "$ENV_FILE" ] && backup "$ENV_FILE"
  umask 077
  TMP=$(mktemp "$ENV_FILE.XXXXXX")
  trap 'rm -f "$TMP"' EXIT
  cat >"$TMP" <<EOF
# Generato da setup.sh il $(date '+%d/%m/%Y %H:%M'). Non condividere questo file.

# Nome dell'istanza: prefisso di container, immagini e reti (diverso per ogni studio sullo stesso server)
INSTANCE=$INSTANCE_NAME

# Database (la password viene applicata solo alla prima creazione del database)
POSTGRES_USER=$DB_USER
POSTGRES_DB=$DB_NAME
POSTGRES_PASSWORD='$DB_PASSWORD'

# Chiave per firmare i cookie di sessione (cambiandola si chiudono tutte le sessioni)
SESSION_SECRET='$SESSION'

# Chiave che cifra nome, telefono e note dei pazienti nel database. NON cambiarla e conservane una
# copia fuori dal server (es. gestore di password): senza questa chiave i dati non sono più leggibili.
DATA_KEY=$DATAKEY

# Porta HTTP pubblicata sull'host (usata solo con $TPL_NETWORK)
HTTP_PORT=$PORT

# Link di conferma degli appuntamenti su un dominio separato (vuoto = stesso indirizzo del gestionale)
CONFIRM_URL=$CONFIRM_LINK
# Porta pubblicata per le conferme (solo con $TPL_NETWORK; in NPM sullo stesso host si usa la 8081 del container)
CONFIRM_PORT=$CPORT

# Fuso orario (determina il "giorno di oggi")
TZ=$TIMEZONE
EOF
  mv "$TMP" "$ENV_FILE"
  trap - EXIT
  chmod 600 "$ENV_FILE"
  umask 022
  ok "File $ENV_FILE creato (leggibile solo dal tuo utente)."
elif [ -z "$KEEP_DATA_KEY" ]; then
  # .env mantenuto ma senza la chiave dei dati dei pazienti (installazione precedente): si aggiunge.
  DATAKEY=$(gen_data_key)
  NEW_DATA_KEY=1
  printf '\n# Chiave che cifra nome, telefono e note dei pazienti nel database. NON cambiarla e conservane una\n# copia fuori dal server: senza questa chiave i dati non sono più leggibili.\nDATA_KEY=%s\n' "$DATAKEY" >>"$ENV_FILE"
  ok "Aggiunta al $ENV_FILE la chiave DATA_KEY per cifrare i dati dei pazienti."
fi

# ---------- 3. docker-compose.yml ----------

title "3. File docker-compose.yml"
if [ -f "$COMPOSE_FILE" ] && cmp -s "$COMPOSE_FILE" "$TEMPLATE"; then
  ok "$COMPOSE_FILE è già aggiornato ($TEMPLATE)."
else
  if [ -f "$COMPOSE_FILE" ]; then
    warn "Esiste già un $COMPOSE_FILE diverso dal template scelto."
    if [ "$FORCE" -eq 0 ] && ! confirm "Sostituirlo con $TEMPLATE? (ne salvo una copia)" s; then
      die "Annullato: $COMPOSE_FILE non modificato."
    fi
    backup "$COMPOSE_FILE"
  fi
  cp "$TEMPLATE" "$COMPOSE_FILE"
  ok "Creato $COMPOSE_FILE da $TEMPLATE."
fi

# ---------- 4. Primo utente ----------

title "4. Utente per accedere all'app"
CREATE_USER=0
NEW_USER=''
NEW_EMAIL=''
NEW_PW=''
PW_GENERATED=0

if [ "$FRESH_INSTALL" -eq 1 ]; then
  CREATE_USER=1
  info "Crea il primo utente: servirà per entrare nell'app dal browser."
elif [ "$ASSUME_YES" -eq 1 ]; then
  [ -n "${FIRST_USER:-}" ] && CREATE_USER=1
elif confirm "Vuoi creare un nuovo utente? (gli utenti esistenti restano invariati)" n; then
  CREATE_USER=1
fi

if [ "$CREATE_USER" -eq 1 ]; then
  if [ "$ASSUME_YES" -eq 1 ]; then
    NEW_USER=${FIRST_USER:-admin}
    NEW_EMAIL=${FIRST_EMAIL:-}
    NEW_PW=${FIRST_PASSWORD:-}
    valid_username "$NEW_USER" || die "FIRST_USER non valido: 3–32 caratteri tra lettere, numeri, . _ -"
    [ -z "$NEW_EMAIL" ] || valid_email "$NEW_EMAIL" || die "FIRST_EMAIL non valida."
    [ -z "$NEW_PW" ] || [ "${#NEW_PW}" -ge 8 ] || die "FIRST_PASSWORD deve avere almeno 8 caratteri."
  else
    while :; do
      NEW_USER=$(ask "Nome utente" "admin")
      valid_username "$NEW_USER" && break
      warn "3–32 caratteri tra lettere, numeri, punto, trattino e trattino basso."
    done
    while :; do
      NEW_EMAIL=$(ask "Email (facoltativa, invio per saltare)" "")
      { [ -z "$NEW_EMAIL" ] || valid_email "$NEW_EMAIL"; } && break
      warn "Email non valida."
    done
    echo "Password (almeno 8 caratteri). Premi invio per generarne una automaticamente."
    while :; do
      read -r -s -p "Password: " NEW_PW </dev/tty
      echo
      [ -z "$NEW_PW" ] && break
      if [ "${#NEW_PW}" -lt 8 ]; then
        warn "Usa almeno 8 caratteri."
        continue
      fi
      read -r -s -p "Ripeti la password: " PW2 </dev/tty
      echo
      [ "$NEW_PW" = "$PW2" ] && break
      warn "Le password non coincidono, riprova."
    done
  fi
  if [ -z "$NEW_PW" ]; then
    NEW_PW=$(gen_secret 16)
    PW_GENERATED=1
  fi
  ok "Utente \"$NEW_USER\" pronto: verrà creato all'avvio dell'app."
fi

# ---------- 5. Avvio ----------

title "5. Avvio"
CAN_START=$HAVE_DOCKER
if [ "$HAVE_DOCKER" -eq 1 ] && [ "$MODE" = npm ] && [ "$HAVE_PROXY_NET" -eq 0 ]; then
  warn "La rete Docker proxy-net non esiste: di solito la crea lo stack di Nginx Proxy Manager."
  if [ "$ASSUME_YES" -eq 0 ] && confirm "Crearla ora? (poi collega anche il container di NPM a proxy-net)" n; then
    docker network create proxy-net >/dev/null
    ok "Rete proxy-net creata."
  else
    info "Creala con 'docker network create proxy-net' (o avvia prima NPM), poi rilancia ./setup.sh."
    CAN_START=0
  fi
fi

STARTED=0
USER_CREATED=0
if [ "$CAN_START" -eq 1 ]; then
  if [ "$START" -eq 1 ] || [ "$ASSUME_YES" -eq 1 ] || confirm "Avviare ora l'app? (la prima build richiede qualche minuto)" s; then
    # Istanza rinominata: ferma i container col vecchio nome (i dati in db/data restano).
    if [ -n "$OLD_INSTANCE" ] && [ "$OLD_INSTANCE" != "$INSTANCE_NAME" ] && [ "$(instance_owner "$OLD_INSTANCE")" = "$PWD" ]; then
      info "Fermo i container della vecchia istanza $OLD_INSTANCE..."
      docker compose -p "$OLD_INSTANCE" down --remove-orphans
    fi
    docker compose up -d --build
    STARTED=1
    info "Attendo che le API siano pronte..."
    READY=0
    for _ in $(seq 1 60); do
      if [ "$(api_health)" = healthy ]; then
        READY=1
        break
      fi
      sleep 2
    done
    if [ "$READY" -eq 0 ]; then
      warn "Le API non risultano pronte dopo 2 minuti. Controlla i log con: docker compose logs api"
    elif [ "$CREATE_USER" -eq 1 ]; then
      if docker compose exec -T api node src/cli.ts exists "$NEW_USER" </dev/null >/dev/null 2>&1; then
        warn "L'utente \"$NEW_USER\" esiste già: non l'ho modificato (usa ./manage-users.sh per cambiarne la password)."
      else
        args=(create "$NEW_USER")
        [ -n "$NEW_EMAIL" ] && args+=(--email "$NEW_EMAIL")
        if printf '%s\n' "$NEW_PW" | docker compose exec -T api node src/cli.ts "${args[@]}"; then
          USER_CREATED=1
        else
          warn "Creazione dell'utente non riuscita: riprova con ./manage-users.sh create"
        fi
      fi
    fi
  fi
fi

# ---------- 6. Backup ----------

# Backup giornaliero incrementale (backup.sh) con rotazione su 15 giorni; si ripristina con recovery.sh.
BACKUP_STATUS='non attivo (./backup.sh --install-cron)'
if [ "$STARTED" -eq 1 ] && command -v crontab >/dev/null 2>&1; then
  title "6. Backup automatico"
  if crontab -l 2>/dev/null | grep -qF "# studio-odontoiatrico backup.sh $PWD"; then
    ok "Il backup giornaliero è già attivo."
    BACKUP_STATUS='giornaliero, già attivo'
  elif [ "${BACKUP:-yes}" != no ] && confirm "Attivare il backup giornaliero del database (ogni notte alle 02:30, conservati 15 giorni)?" s; then
    if ./backup.sh --install-cron 02:30 && ./backup.sh; then
      BACKUP_STATUS='ogni giorno alle 02:30, ultimi 15 giorni in backups/daily'
    else
      warn "Backup automatico non attivato: riprova con ./backup.sh --install-cron"
    fi
  fi
fi

# ---------- Riepilogo ----------

HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}') || true
URL="http://${HOST_IP:-<ip-del-server>}"
[ "$PORT" != 80 ] && URL="$URL:$PORT"

title "Riepilogo"
echo "  Istanza:        $INSTANCE_NAME (container $INSTANCE_NAME-app, -api, -db)"
if [ "$MODE" = npm ]; then
  echo "  Deploy:         dietro Nginx Proxy Manager sullo stesso host (rete proxy-net)"
  echo "  Indirizzo:      il dominio che configurerai in NPM"
else
  echo "  Deploy:         porta HTTP $PORT pubblicata su questo server"
  echo "  Indirizzo:      $URL"
fi
if [ "$CREATE_USER" -eq 1 ]; then
  echo "  Utente:         $NEW_USER${NEW_EMAIL:+ ($NEW_EMAIL)}"
  if [ "$PW_GENERATED" -eq 1 ]; then
    echo "  Password:       ${B}$NEW_PW${N}  ${Y}← generata ora, salvala in un posto sicuro${N}"
  else
    echo "  Password:       quella che hai scelto"
  fi
  if [ "$USER_CREATED" -eq 0 ]; then
    echo "  ${Y}L'utente non è ancora stato creato:${N} dopo l'avvio esegui  ./manage-users.sh create $NEW_USER"
  fi
fi
echo "  Fuso orario:    $TIMEZONE"
echo "  Link conferma:  ${CONFIRM_LINK:-stesso indirizzo del gestionale (Impostazioni → Studio)}"
echo "  Backup:         $BACKUP_STATUS"
if [ "$NEW_DATA_KEY" -eq 1 ]; then
  echo
  echo "  ${Y}Chiave dei dati dei pazienti (DATA_KEY nel $ENV_FILE):${N} nome, telefono e note sono cifrati"
  echo "  nel database con questa chiave. Salvane una copia fuori dal server (es. gestore di password),"
  echo "  non insieme ai backup: senza la chiave i dati e i backup non sono più leggibili."
  echo "    ${B}$DATAKEY${N}"
fi
echo
CONFIRM_HOST=${CONFIRM_LINK#*://}
CONFIRM_HOST=${CONFIRM_HOST%%/*}
if [ "$MODE" = npm ]; then
  echo "  ${B}In Nginx Proxy Manager${N} crea un Proxy Host per il gestionale:"
  echo "    Scheme: http   Forward Hostname: $INSTANCE_NAME-app   Forward Port: 80"
  if [ -n "$CONFIRM_LINK" ]; then
    echo "  e uno per i link di conferma (${CONFIRM_HOST}), che mostra solo la pagina di conferma:"
    echo "    Scheme: http   Forward Hostname: $INSTANCE_NAME-app   Forward Port: 8081"
  fi
  echo "    Scheda SSL: richiedi il certificato Let's Encrypt e attiva Force SSL."
else
  echo "  ${B}Nel Nginx Proxy Manager remoto${N} crea un Proxy Host per il gestionale:"
  echo "    Scheme: http   Forward Hostname: ${HOST_IP:-<ip-di-questo-server>}   Forward Port: $PORT"
  if [ -n "$CONFIRM_LINK" ]; then
    echo "  e uno per i link di conferma (${CONFIRM_HOST}), che mostra solo la pagina di conferma:"
    echo "    Scheme: http   Forward Hostname: ${HOST_IP:-<ip-di-questo-server>}   Forward Port: $CPORT"
  fi
  echo "  Apri le porte $PORT${CONFIRM_LINK:+ e $CPORT} nel firewall, possibilmente solo verso l'IP del server NPM"
  echo "  (su OCI: Security List + iptables, vedi README)."
fi
if [ -n "$CONFIRM_LINK" ]; then
  echo "  Con le conferme su un dominio separato il gestionale può restare chiuso al pubblico:"
  echo "  in NPM aggiungi al suo Proxy Host una Access List (solo gli IP dello studio, o utente e password)."
fi
echo
echo "  Gestione utenti:  ./manage-users.sh"
echo "  Ripristino:       ./recovery.sh (sceglie da un elenco dei backup disponibili)"
if [ "$STARTED" -eq 1 ]; then
  echo "  Log dell'app:     docker compose logs -f"
else
  echo "  Avvio dell'app:   docker compose up -d --build"
fi
echo
