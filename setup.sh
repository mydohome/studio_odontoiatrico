#!/usr/bin/env bash
# Configurazione iniziale: genera il file .env con password casuali e, se richiesto,
# avvia lo stack con docker compose.
#
#   ./setup.sh            modalità interattiva (consigliata)
#   ./setup.sh --yes      nessuna domanda: usa i valori predefiniti e genera tutte le password
#   ./setup.sh --start    avvia docker compose al termine senza chiederlo
#   ./setup.sh --force    sovrascrive un .env esistente senza chiederlo (ne salva una copia)
#   ./setup.sh --npm      deploy dietro Nginx Proxy Manager (docker-compose.npm.yml, rete proxy-net)
#
# In modalità --yes i valori si possono passare come variabili d'ambiente:
#   APP_PASSWORD=... HTTP_PORT=8080 TZ=Europe/Rome ./setup.sh --yes

set -euo pipefail

cd "$(dirname "$0")"
ENV_FILE=.env

# ---------- Opzioni ----------

ASSUME_YES=0
FORCE=0
START=0
NPM=''
for arg in "$@"; do
  case "$arg" in
    -y | --yes) ASSUME_YES=1 ;;
    -f | --force) FORCE=1 ;;
    -s | --start) START=1 ;;
    --npm) NPM=1 ;;
    -h | --help)
      sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Opzione sconosciuta: $arg (usa --help)" >&2
      exit 1
      ;;
  esac
done

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

valid_value() {
  # Gli apici singoli e gli a capo romperebbero il file .env.
  case "$1" in
    *"'"* | *$'\n'*) return 1 ;;
  esac
  return 0
}

port_in_use() {
  command -v ss >/dev/null 2>&1 && ss -ltnH 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1\$"
}

# Nome del volume del database creato da docker compose (<progetto>_pgdata).
volume_name() {
  local project
  project=$(basename "$PWD" | tr '[:upper:]' '[:lower:]' | LC_ALL=C tr -cd 'a-z0-9_-')
  printf '%s_pgdata' "$project"
}

# Dice se il database è già stato inizializzato (e quindi ha già una password).
db_exists() {
  if [ "$NPM" = 1 ]; then
    [ -d db/data ]
  else
    [ "$HAVE_DOCKER" -eq 1 ] && docker volume inspect "$(volume_name)" >/dev/null 2>&1
  fi
}

db_location() {
  if [ "$NPM" = 1 ]; then printf 'cartella db/data'; else printf 'volume %s' "$(volume_name)"; fi
}

# ---------- Controlli preliminari ----------

printf '\n%s\n\n' "${B}Configurazione Studio Odontoiatrico${N}"

HAVE_DOCKER=0
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    HAVE_DOCKER=1
  else
    warn "Docker è installato ma non raggiungibile: il servizio non è avviato oppure il tuo utente non è nel gruppo docker."
    warn "Prova:  sudo systemctl start docker  e/o  sudo usermod -aG docker \$USER  (poi esci e rientra)."
    warn "Il file .env verrà comunque creato."
  fi
else
  warn "Docker con il plugin compose non è installato (o non è utilizzabile da questo utente)."
  warn "Installalo con:  curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker \$USER"
  warn "Il file .env verrà comunque creato."
fi

# Modalità di deploy: stack autonomo con porta pubblicata, oppure dietro Nginx Proxy Manager.
HAVE_PROXY_NET=0
if [ "$HAVE_DOCKER" -eq 1 ] && docker network inspect proxy-net >/dev/null 2>&1; then
  HAVE_PROXY_NET=1
fi
if [ -z "$NPM" ]; then
  NPM=0
  if [ "$HAVE_PROXY_NET" -eq 1 ] && [ "$ASSUME_YES" -eq 0 ]; then
    info "Ho trovato la rete Docker proxy-net: sul server sembra esserci Nginx Proxy Manager."
    confirm "Vuoi pubblicare l'app dietro Nginx Proxy Manager (nessuna porta aperta sull'host)?" s && NPM=1
    echo
  fi
fi
if [ "$NPM" = 1 ]; then
  COMPOSE="docker compose -f docker-compose.npm.yml"
  info "Modalità: dietro Nginx Proxy Manager (docker-compose.npm.yml)."
else
  COMPOSE="docker compose"
  info "Modalità: stack autonomo con porta HTTP pubblicata (docker-compose.yml)."
fi
echo

# Valori esistenti da mantenere.
KEEP_DB_PASSWORD=''
KEEP_DB_USER=''
KEEP_DB_NAME=''
KEEP_SESSION=''
OLD_APP_PASSWORD=''
OLD_PORT=''
OLD_TZ=''

if [ -f "$ENV_FILE" ]; then
  warn "Esiste già un file $ENV_FILE."
  if [ "$FORCE" -eq 0 ] && ! confirm "Vuoi ricrearlo? La password del database verrà mantenuta" n; then
    info "Nessuna modifica. Per avviare l'app: $COMPOSE up -d --build"
    exit 0
  fi
  KEEP_DB_PASSWORD=$(env_get POSTGRES_PASSWORD "$ENV_FILE")
  KEEP_DB_USER=$(env_get POSTGRES_USER "$ENV_FILE")
  KEEP_DB_NAME=$(env_get POSTGRES_DB "$ENV_FILE")
  KEEP_SESSION=$(env_get SESSION_SECRET "$ENV_FILE")
  OLD_APP_PASSWORD=$(env_get APP_PASSWORD "$ENV_FILE")
  OLD_PORT=$(env_get HTTP_PORT "$ENV_FILE")
  OLD_TZ=$(env_get TZ "$ENV_FILE")
  BACKUP="$ENV_FILE.bak-$(date +%Y%m%d-%H%M%S)"
  cp -p "$ENV_FILE" "$BACKUP"
  ok "Copia del file precedente salvata in $BACKUP"
elif db_exists; then
  # Il database esiste già ma il .env è andato perso: la password va reinserita,
  # perché PostgreSQL la imposta solo alla prima inizializzazione.
  warn "Il database esiste già ($(db_location)) ma manca il file $ENV_FILE."
  if [ "$ASSUME_YES" -eq 1 ]; then
    die "Serve la password del database esistente: esegui lo script in modo interattivo oppure elimina il database ($(db_location)) per ripartire da zero (cancella i dati)."
  fi
  read -r -s -p "Password del database esistente (invio = annulla): " KEEP_DB_PASSWORD </dev/tty
  echo
  [ -n "$KEEP_DB_PASSWORD" ] || die "Annullato. Per ripartire da zero elimina il database ($(db_location)): cancella i dati."
fi

# ---------- Domande ----------

# Password di accesso all'app.
APP_PW=${APP_PASSWORD:-}
APP_PW_GENERATED=0
if [ "$ASSUME_YES" -eq 1 ]; then
  APP_PW=${APP_PW:-$OLD_APP_PASSWORD}
else
  echo "${B}Password di accesso all'app${N} (serve per entrare dal browser)."
  if [ -n "$OLD_APP_PASSWORD" ]; then
    echo "Premi invio per mantenere quella attuale, scrivi 'nuova' per generarne una."
  else
    echo "Premi invio per generarne una automaticamente."
  fi
  while :; do
    read -r -s -p "Password: " APP_PW </dev/tty
    echo
    if [ -z "$APP_PW" ]; then
      APP_PW=$OLD_APP_PASSWORD
      break
    fi
    if [ "$APP_PW" = nuova ]; then
      APP_PW=''
      break
    fi
    if [ "${#APP_PW}" -lt 8 ]; then
      warn "Usa almeno 8 caratteri."
      continue
    fi
    if ! valid_value "$APP_PW"; then
      warn "La password non può contenere apici singoli (')."
      continue
    fi
    read -r -s -p "Ripeti la password: " APP_PW2 </dev/tty
    echo
    [ "$APP_PW" = "$APP_PW2" ] && break
    warn "Le password non coincidono, riprova."
  done
  echo
fi
if [ -z "$APP_PW" ]; then
  APP_PW=$(gen_secret 16)
  APP_PW_GENERATED=1
fi
valid_value "$APP_PW" || die "APP_PASSWORD non può contenere apici singoli."

# Porta HTTP (non serve dietro NPM: nessuna porta viene pubblicata).
DEFAULT_PORT=${HTTP_PORT:-${OLD_PORT:-80}}
if [ "$NPM" = 1 ]; then
  PORT=$DEFAULT_PORT
elif [ -z "$OLD_PORT" ] && [ -z "${HTTP_PORT:-}" ] && port_in_use 80; then
  warn "La porta 80 risulta già occupata sul server (es. da un altro web server o da Caddy)."
  DEFAULT_PORT=8080
fi
while [ "$NPM" != 1 ]; do
  PORT=$(ask "Porta HTTP su cui pubblicare l'app" "$DEFAULT_PORT")
  if [[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ]; then
    break
  fi
  [ "$ASSUME_YES" -eq 1 ] && die "Porta non valida: $PORT"
  warn "Inserisci un numero tra 1 e 65535."
done

# Fuso orario.
DEFAULT_TZ=${TZ:-${OLD_TZ:-Europe/Rome}}
while :; do
  TIMEZONE=$(ask "Fuso orario" "$DEFAULT_TZ")
  if [ ! -d /usr/share/zoneinfo ] || [ -f "/usr/share/zoneinfo/$TIMEZONE" ]; then
    break
  fi
  [ "$ASSUME_YES" -eq 1 ] && die "Fuso orario sconosciuto: $TIMEZONE"
  warn "Fuso orario sconosciuto (esempi: Europe/Rome, Europe/Zurich)."
done

# ---------- Scrittura del file ----------

DB_USER=${KEEP_DB_USER:-studio}
DB_NAME=${KEEP_DB_NAME:-studio}
DB_PASSWORD=${KEEP_DB_PASSWORD:-$(gen_secret 32)}
SESSION=${KEEP_SESSION:-$(gen_secret 48)}
valid_value "$DB_PASSWORD" || die "La password del database non può contenere apici singoli."

umask 077
TMP=$(mktemp "$ENV_FILE.XXXXXX")
trap 'rm -f "$TMP"' EXIT
cat >"$TMP" <<EOF
# Generato da setup.sh il $(date '+%d/%m/%Y %H:%M'). Non condividere questo file.

# Database (la password viene applicata solo alla prima creazione del volume)
POSTGRES_USER=$DB_USER
POSTGRES_DB=$DB_NAME
POSTGRES_PASSWORD='$DB_PASSWORD'

# Password per accedere all'applicazione dal browser
APP_PASSWORD='$APP_PW'

# Chiave per firmare i cookie di sessione
SESSION_SECRET='$SESSION'

# Porta HTTP pubblicata sull'host
HTTP_PORT=$PORT

# Fuso orario (determina il "giorno di oggi")
TZ=$TIMEZONE
EOF
mv "$TMP" "$ENV_FILE"
trap - EXIT
chmod 600 "$ENV_FILE"
ok "File $ENV_FILE creato (leggibile solo dal tuo utente)."

# ---------- Riepilogo ----------

HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}') || true
URL="http://${HOST_IP:-<ip-del-server>}"
[ "$PORT" != 80 ] && URL="$URL:$PORT"

echo
echo "${B}Riepilogo${N}"
if [ "$NPM" = 1 ]; then
  echo "  Indirizzo:          il dominio che configurerai in Nginx Proxy Manager"
else
  echo "  Indirizzo:          $URL  (su OCI usa l'IP pubblico dell'istanza)"
fi
if [ "$APP_PW_GENERATED" -eq 1 ]; then
  echo "  Password dell'app:  ${B}$APP_PW${N}  ${Y}← generata ora, salvala in un posto sicuro${N}"
else
  echo "  Password dell'app:  quella che hai scelto"
fi
if [ -n "$KEEP_DB_PASSWORD" ]; then
  echo "  Password database:  mantenuta quella esistente"
else
  echo "  Password database:  generata e salvata in $ENV_FILE"
fi
if [ "$NPM" = 1 ]; then
  echo "  Fuso orario:        $TIMEZONE"
else
  echo "  Porta / fuso:       $PORT / $TIMEZONE"
fi
echo
echo "  Per rivedere le password:  grep PASSWORD $ENV_FILE"
if [ "$NPM" = 1 ]; then
  echo
  echo "  ${B}In Nginx Proxy Manager${N} crea un Proxy Host con:"
  echo "    Scheme: http   Forward Hostname: studio-odontoiatrico-app   Forward Port: 80"
  echo "    Scheda SSL: richiedi il certificato Let's Encrypt e attiva Force SSL."
else
  echo "  Su OCI apri la porta $PORT nella Security List e con iptables (vedi README)."
fi
echo

# ---------- Avvio ----------

CAN_START=$HAVE_DOCKER
if [ "$HAVE_DOCKER" -eq 1 ] && [ "$NPM" = 1 ] && [ "$HAVE_PROXY_NET" -eq 0 ]; then
  warn "La rete Docker proxy-net non esiste: di solito la crea lo stack di Nginx Proxy Manager."
  if [ "$ASSUME_YES" -eq 0 ] && confirm "Crearla ora? (poi collega anche il container di NPM a proxy-net)" n; then
    docker network create proxy-net >/dev/null
    ok "Rete proxy-net creata."
  else
    info "Creala con 'docker network create proxy-net' (o avvia prima NPM), poi: $COMPOSE up -d --build"
    CAN_START=0
  fi
fi

if [ "$CAN_START" -eq 1 ]; then
  if [ "$START" -eq 1 ] || { [ "$ASSUME_YES" -eq 0 ] && confirm "Avviare ora l'app con docker compose (la prima build richiede qualche minuto)?" s; }; then
    $COMPOSE up -d --build
    echo
    if [ "$NPM" = 1 ]; then
      ok "App avviata: ora configura il Proxy Host in Nginx Proxy Manager."
    else
      ok "App avviata: $URL"
    fi
  else
    info "Per avviare l'app: $COMPOSE up -d --build"
  fi
elif [ "$HAVE_DOCKER" -eq 0 ]; then
  info "Quando Docker è disponibile avvia l'app con: $COMPOSE up -d --build"
fi
