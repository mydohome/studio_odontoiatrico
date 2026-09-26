#!/usr/bin/env bash
# Configurazione iniziale del server:
#   - sceglie il tipo di deploy e crea docker-compose.yml dal template corrispondente
#   - genera il file .env con le password necessarie
#   - avvia l'app e crea il primo utente
#
#   ./setup.sh                  modalità interattiva (consigliata)
#   ./setup.sh --mode npm       Nginx Proxy Manager sullo stesso host (rete Docker proxy-net)
#   ./setup.sh --mode network   NPM su un altro host (o nessun NPM): l'app pubblica una porta HTTP
#   ./setup.sh --yes            nessuna domanda: valori predefiniti e password generate
#   ./setup.sh --start          avvia l'app senza chiederlo
#   ./setup.sh --force          ricrea .env e docker-compose.yml senza chiedere (ne salva una copia)
#
# Con --yes i valori si possono passare come variabili d'ambiente:
#   FIRST_USER=mario FIRST_EMAIL=mario@studio.it FIRST_PASSWORD=... HTTP_PORT=8080 TZ=Europe/Rome

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
    --network) MODE=network ;;
    -h | --help)
      sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
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

port_in_use() {
  command -v ss >/dev/null 2>&1 && ss -ltnH 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1\$"
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
OLD_PORT=''
OLD_TZ=''
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
  OLD_PORT=$(env_get HTTP_PORT "$ENV_FILE")
  OLD_TZ=$(env_get TZ "$ENV_FILE")
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
fi

PORT=${OLD_PORT:-80}
TIMEZONE=${OLD_TZ:-Europe/Rome}
if [ "$REWRITE_ENV" -eq 1 ]; then
  # Porta HTTP (solo se l'app la pubblica).
  if [ "$MODE" = network ]; then
    DEFAULT_PORT=${HTTP_PORT:-${OLD_PORT:-80}}
    if [ -z "$OLD_PORT" ] && [ -z "${HTTP_PORT:-}" ] && port_in_use 80; then
      warn "La porta 80 risulta già occupata su questo server."
      DEFAULT_PORT=8080
    fi
    while :; do
      PORT=$(ask "Porta HTTP su cui pubblicare l'app" "$DEFAULT_PORT")
      if [[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ]; then break; fi
      [ "$ASSUME_YES" -eq 1 ] && die "Porta non valida: $PORT"
      warn "Inserisci un numero tra 1 e 65535."
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
  no_quotes "$DB_PASSWORD" || die "La password del database non può contenere apici singoli."

  [ -f "$ENV_FILE" ] && backup "$ENV_FILE"
  umask 077
  TMP=$(mktemp "$ENV_FILE.XXXXXX")
  trap 'rm -f "$TMP"' EXIT
  cat >"$TMP" <<EOF
# Generato da setup.sh il $(date '+%d/%m/%Y %H:%M'). Non condividere questo file.

# Database (la password viene applicata solo alla prima creazione del database)
POSTGRES_USER=$DB_USER
POSTGRES_DB=$DB_NAME
POSTGRES_PASSWORD='$DB_PASSWORD'

# Chiave per firmare i cookie di sessione (cambiandola si chiudono tutte le sessioni)
SESSION_SECRET='$SESSION'

# Porta HTTP pubblicata sull'host (usata solo con $TPL_NETWORK)
HTTP_PORT=$PORT

# Fuso orario (determina il "giorno di oggi")
TZ=$TIMEZONE
EOF
  mv "$TMP" "$ENV_FILE"
  trap - EXIT
  chmod 600 "$ENV_FILE"
  umask 022
  ok "File $ENV_FILE creato (leggibile solo dal tuo utente)."
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
    docker compose up -d --build
    STARTED=1
    info "Attendo che le API siano pronte..."
    READY=0
    for _ in $(seq 1 60); do
      if [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' studio-odontoiatrico-api 2>/dev/null)" = healthy ]; then
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

# ---------- Riepilogo ----------

HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}') || true
URL="http://${HOST_IP:-<ip-del-server>}"
[ "$PORT" != 80 ] && URL="$URL:$PORT"

title "Riepilogo"
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
echo
if [ "$MODE" = npm ]; then
  echo "  ${B}In Nginx Proxy Manager${N} crea un Proxy Host con:"
  echo "    Scheme: http   Forward Hostname: studio-odontoiatrico-app   Forward Port: 80"
  echo "    Scheda SSL: richiedi il certificato Let's Encrypt e attiva Force SSL."
else
  echo "  ${B}Nel Nginx Proxy Manager remoto${N} crea un Proxy Host con:"
  echo "    Scheme: http   Forward Hostname: ${HOST_IP:-<ip-di-questo-server>}   Forward Port: $PORT"
  echo "  Apri la porta $PORT nel firewall, possibilmente solo verso l'IP del server NPM"
  echo "  (su OCI: Security List + iptables, vedi README)."
fi
echo
echo "  Gestione utenti:  ./manage-users.sh"
if [ "$STARTED" -eq 1 ]; then
  echo "  Log dell'app:     docker compose logs -f"
else
  echo "  Avvio dell'app:   docker compose up -d --build"
fi
echo
