#!/usr/bin/env bash
# Aggiornamento automatico dall'ultima versione pubblicata su GitHub.
#
#   ./update.sh                     controlla, mostra le novità e chiede conferma
#   ./update.sh --yes               aggiorna senza domande (adatto a cron)
#   ./update.sh --check             controlla soltanto (exit 0 = aggiornato, 10 = aggiornamento disponibile)
#   ./update.sh --install-cron [HH:MM]   aggiornamento automatico ogni notte (predefinito 04:30)
#   ./update.sh --remove-cron       rimuove l'aggiornamento automatico
#   ./update.sh --no-backup         salta il backup del database (sconsigliato)
#   ./update.sh --rebuild           ricostruisce e riavvia anche se non ci sono novità
#
# Cosa fa: scarica le novità (solo fast-forward), salva un backup del database in backups/,
# aggiorna docker-compose.yml se il template usato è cambiato, ricostruisce le immagini,
# riavvia e verifica che l'app risponda. Se l'avvio fallisce torna alla versione precedente.

set -euo pipefail

REPO_DIR=$(cd "$(dirname "$0")" && pwd)

# Lo script stesso può cambiare durante l'aggiornamento: bash lo legge mentre lo esegue,
# quindi si rilancia da una copia temporanea.
if [ -z "${UPDATE_SH_COPY:-}" ]; then
  TMP_SELF=$(mktemp "${TMPDIR:-/tmp}/update-sh.XXXXXX")
  cp "$0" "$TMP_SELF"
  UPDATE_SH_COPY=$TMP_SELF UPDATE_REPO_DIR=$REPO_DIR exec bash "$TMP_SELF" "$@"
fi
trap 'rm -f "$UPDATE_SH_COPY"' EXIT
cd "${UPDATE_REPO_DIR:-$REPO_DIR}"
REPO_DIR=$PWD

# ---------- Opzioni ----------

ORIG_ARGS=("$@")
ASSUME_YES=0
CHECK_ONLY=0
BACKUP=1
REBUILD=0
CRON_ACTION=''
CRON_TIME='04:30'
KEEP_BACKUPS=${KEEP_BACKUPS:-10}
while [ $# -gt 0 ]; do
  case "$1" in
    -y | --yes) ASSUME_YES=1 ;;
    --check) CHECK_ONLY=1 ;;
    --no-backup) BACKUP=0 ;;
    --rebuild) REBUILD=1 ;;
    --install-cron)
      CRON_ACTION=install
      if [[ "${2:-}" =~ ^[0-9]{1,2}:[0-9]{2}$ ]]; then
        CRON_TIME=$2
        shift
      fi
      ;;
    --remove-cron) CRON_ACTION=remove ;;
    -h | --help)
      sed -n '2,15p' "$UPDATE_SH_COPY" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Opzione sconosciuta: $1 (usa --help)" >&2
      exit 1
      ;;
  esac
  shift
done
[ -t 0 ] || ASSUME_YES=1

if [ -t 1 ]; then
  B=$'\e[1m' G=$'\e[32m' Y=$'\e[33m' R=$'\e[31m' C=$'\e[36m' N=$'\e[0m'
else
  B='' G='' Y='' R='' C='' N=''
fi
ts() { date '+%Y-%m-%d %H:%M:%S'; }
info() { printf '%s\n' "${C}›${N} $*"; }
ok() { printf '%s\n' "${G}✔${N} $*"; }
warn() { printf '%s\n' "${Y}!${N} $*" >&2; }
die() {
  printf '%s\n' "${R}✖${N} $*" >&2
  exit 1
}

confirm() {
  local ans
  [ "$ASSUME_YES" -eq 1 ] && return 0
  read -r -p "$1 (S/n): " ans </dev/tty
  case "${ans:-s}" in s | S | si | sì | y | Y) return 0 ;; *) return 1 ;; esac
}

env_get() {
  local line
  line=$(grep -E "^$1=" .env 2>/dev/null | tail -n1) || true
  line=${line#*=}
  line=${line#\'}
  line=${line%\'}
  printf '%s' "$line"
}

# ---------- Aggiornamento automatico (cron) ----------

# Il riferimento alla cartella rende indipendente la riga di ogni installazione (più studi sullo
# stesso server). La riga senza cartella è quella creata dalle versioni precedenti.
CRON_TAG="# studio-odontoiatrico update.sh $REPO_DIR"
LEGACY_TAG="# studio-odontoiatrico update.sh"
if [ -n "$CRON_ACTION" ]; then
  command -v crontab >/dev/null 2>&1 || die "crontab non disponibile (installa il pacchetto cron)."
  # Toglie solo le righe di questa cartella (nuove o delle versioni precedenti), non quelle degli altri studi.
  current=$(crontab -l 2>/dev/null | awk -v d="cd '$REPO_DIR' " -v t="$LEGACY_TAG" 'index($0, d) == 0 || index($0, t) == 0' || true)
  if [ "$CRON_ACTION" = remove ]; then
    printf '%s\n' "$current" | sed '/^$/d' | crontab -
    ok "Aggiornamento automatico rimosso."
    exit 0
  fi
  h=${CRON_TIME%%:*}
  m=${CRON_TIME##*:}
  [ "$((10#$h))" -le 23 ] && [ "$((10#$m))" -le 59 ] || die "Orario non valido: $CRON_TIME"
  line="$((10#$m)) $((10#$h)) * * * cd '$REPO_DIR' && ./update.sh --yes >> '$REPO_DIR/update.log' 2>&1 $CRON_TAG"
  { printf '%s\n' "$current" | sed '/^$/d'; echo "$line"; } | crontab -
  ok "Aggiornamento automatico impostato ogni giorno alle $CRON_TIME (log in update.log)."
  exit 0
fi

# ---------- Controlli ----------

# Un solo aggiornamento alla volta (es. cron + lancio manuale).
# (Quando lo script si rilancia nella nuova versione il blocco è già preso, ereditato sul descrittore 9.)
if [ -z "${UPDATE_OLD:-}" ]; then
  exec 9>"$REPO_DIR/.update.lock"
  if command -v flock >/dev/null 2>&1 && ! flock -n 9; then
    die "Un altro aggiornamento è già in corso."
  fi
fi

[ -d .git ] || die "Questa cartella non è un clone git del repository."
[ -f docker-compose.yml ] || die "docker-compose.yml non trovato: esegui prima ./setup.sh"
[ -f .env ] || die ".env non trovato: esegui prima ./setup.sh"
command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 || die "Docker non è raggiungibile."

[ -n "${UPDATE_OLD:-}" ] || echo "${B}[$(ts)] Aggiornamento Studio Odontoiatrico${N}"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$BRANCH" != HEAD ] || die "Il repository non è su un branch (HEAD staccato): esegui 'git checkout main'."
UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo "origin/$BRANCH")
REMOTE=${UPSTREAM%%/*}
REMOTE_BRANCH=${UPSTREAM#*/}

version() { git describe --tags --always "$1" 2>/dev/null || git rev-parse --short "$1"; }

if [ -z "${UPDATE_OLD:-}" ]; then

# Modifiche locali ai file versionati bloccherebbero (o verrebbero perse con) l'aggiornamento.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git status --short --untracked-files=no >&2
  die "Ci sono modifiche locali ai file del repository: salvale altrove o annullale con 'git checkout -- .' e riprova."
fi

info "Controllo novità su $UPSTREAM..."
git fetch --quiet "$REMOTE" "$REMOTE_BRANCH" || die "Impossibile contattare GitHub (git fetch non riuscito)."

# Un server rimasto su un branch di prova non riceve gli aggiornamenti di main: lo si dice ogni volta
# (anche nel log dell'aggiornamento notturno), con quante versioni di main mancano.
if [ "$BRANCH" != main ] && git fetch --quiet "$REMOTE" main 2>/dev/null; then
  behind_main=$(git rev-list --count "$UPSTREAM..$REMOTE/main" 2>/dev/null || echo '?')
  if [ "$behind_main" != 0 ]; then
    warn "Questa installazione segue il branch $BRANCH, non main: mancano $behind_main versioni di main."
  else
    warn "Questa installazione segue il branch $BRANCH, non main: i prossimi aggiornamenti di main non arriveranno qui."
  fi
  warn "Per passare a main: git checkout main && ./studio update"
fi

OLD=$(git rev-parse HEAD)
NEW=$(git rev-parse "$UPSTREAM")

if [ "$OLD" = "$NEW" ]; then
  ok "Già aggiornato alla versione più recente ($(version "$OLD"))."
  [ "$CHECK_ONLY" -eq 1 ] && exit 0
  [ "$REBUILD" -eq 1 ] || exit 0
  info "Ricostruzione richiesta con --rebuild."
else
  git merge-base --is-ancestor "$OLD" "$NEW" ||
    die "La versione locale contiene commit non presenti su GitHub: aggiornamento automatico non possibile."
  # Una versione che ha già fallito non viene riprovata in automatico (es. da cron) finché
  # su GitHub non ne arriva una più recente; da terminale si può forzare.
  if [ -f .update-failed ] && [ "$(cat .update-failed)" = "$NEW" ] && [ "$CHECK_ONLY" -eq 0 ]; then
    warn "L'aggiornamento a $(version "$NEW") è già fallito una volta ed è stato annullato."
    if [ ! -t 0 ]; then
      info "Lo salto: riproverò quando sarà disponibile una versione più recente."
      exit 1
    fi
    ASSUME_YES=0
  fi
  echo
  echo "${B}Novità disponibili${N} ($(version "$OLD") → $(version "$NEW")):"
  git log --no-merges --format='  • %s (%cd)' --date=format:'%d/%m/%Y' "$OLD..$NEW" | head -30
  echo
  if [ "$CHECK_ONLY" -eq 1 ]; then
    exit 10
  fi
  confirm "Installare l'aggiornamento?" || {
    info "Aggiornamento annullato."
    exit 0
  }
fi

# ---------- Backup del database ----------

if [ "$BACKUP" -eq 1 ]; then
  if [ -n "$(docker compose ps --status running -q db 2>/dev/null)" ]; then
    mkdir -p backups
    chmod 700 backups
    FILE="backups/pre-update-$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short "$OLD").sql.gz"
    DB_USER=$(env_get POSTGRES_USER)
    DB_NAME=$(env_get POSTGRES_DB)
    info "Backup del database in $FILE..."
    if docker compose exec -T db pg_dump -U "${DB_USER:-studio}" "${DB_NAME:-studio}" </dev/null | gzip >"$FILE" &&
      [ "$(gzip -dc "$FILE" | head -c 1000 | wc -c)" -gt 0 ]; then
      chmod 600 "$FILE"
      ok "Backup completato ($(du -h "$FILE" | cut -f1))."
      # Conserva solo gli ultimi backup automatici.
      ls -1t backups/pre-update-*.sql.gz 2>/dev/null | tail -n "+$((KEEP_BACKUPS + 1))" | xargs -r rm -f
    else
      rm -f "$FILE"
      die "Backup del database non riuscito: aggiornamento interrotto (usa --no-backup per saltarlo)."
    fi
  else
    warn "Il database non è in esecuzione: salto il backup."
  fi
fi

# ---------- Aggiornamento del codice ----------

# Quale template è stato usato per docker-compose.yml? (confronto con la versione attuale)
TEMPLATE=''
for t in _deploy_network_example.yml _deploy_npm_example.yml; do
  if git cat-file -e "$OLD:$t" 2>/dev/null && cmp -s docker-compose.yml <(git show "$OLD:$t"); then
    TEMPLATE=$t
  fi
done

if [ "$OLD" != "$NEW" ]; then
  git merge --ff-only --quiet "$NEW"
  ok "Codice aggiornato a $(version "$NEW")."
  # Se è cambiato anche questo script, i passi successivi (es. nuove variabili nel .env) li fa la
  # nuova versione: si rilancia da una sua copia, ripartendo da qui.
  if ! git diff --quiet "$OLD" "$NEW" -- update.sh; then
    NEXT=$(mktemp "${TMPDIR:-/tmp}/update-sh.XXXXXX")
    cp update.sh "$NEXT"
    rm -f "$UPDATE_SH_COPY"
    trap - EXIT
    UPDATE_SH_COPY=$NEXT UPDATE_REPO_DIR=$REPO_DIR UPDATE_OLD=$OLD UPDATE_TEMPLATE=$TEMPLATE \
      exec bash "$NEXT" "${ORIG_ARGS[@]}"
  fi
fi

else
  # Rilanciato dalla versione precedente dello script, a codice già aggiornato.
  OLD=$UPDATE_OLD
  NEW=$(git rev-parse HEAD)
  TEMPLATE=${UPDATE_TEMPLATE:-}
fi

if [ -n "$TEMPLATE" ] && [ -f "$TEMPLATE" ] && ! cmp -s docker-compose.yml "$TEMPLATE"; then
  cp docker-compose.yml "docker-compose.yml.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$TEMPLATE" docker-compose.yml
  ok "docker-compose.yml aggiornato dal template $TEMPLATE (copia del precedente salvata)."
elif [ -z "$TEMPLATE" ]; then
  warn "docker-compose.yml è stato personalizzato: non lo modifico. Confrontalo con i template _deploy_*_example.yml."
fi

# Porta delle conferme (solo con NPM su un altro server): ogni studio sullo stesso server ne usa una
# diversa. Se manca nel .env se ne sceglie una libera, così l'avvio non fallisce per un conflitto.
port_busy() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnH 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1\$" && return 0
  else
    local hex
    hex=$(printf '%04X' "$1")
    cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | awk -v h=":$hex" '$4 == "0A" && substr($2, length($2) - 4) == h { f = 1 } END { exit !f }' && return 0
  fi
  docker ps --format '{{.Ports}}' 2>/dev/null | tr ',' '\n' | grep -qE ":$1->" && return 0
  return 1
}
if grep -q 'CONFIRM_PORT' docker-compose.yml && [ -z "$(env_get CONFIRM_PORT)" ]; then
  for p in $(seq 8180 8199); do
    if ! port_busy "$p"; then
      printf '\n# Porta pubblicata per le conferme degli appuntamenti (aggiunta da update.sh)\nCONFIRM_PORT=%s\n' "$p" >>.env
      ok "Porta per le conferme degli appuntamenti: $p (CONFIRM_PORT nel .env)."
      break
    fi
  done
fi

# Chiave che cifra i dati dei pazienti: si genera una volta sola e poi non va più cambiata.
if [ -z "$(env_get DATA_KEY)" ]; then
  if grep -q 'DATA_KEY' docker-compose.yml; then
    if command -v openssl >/dev/null 2>&1; then
      key=$(openssl rand -hex 32)
    else
      key=$(head -c 32 /dev/urandom | od -An -v -tx1 | tr -d ' \n')
    fi
    printf '\n# Chiave che cifra nome, telefono e note dei pazienti nel database (aggiunta da update.sh).\n# NON cambiarla e conservane una copia fuori dal server: senza questa chiave i dati non sono più leggibili.\nDATA_KEY=%s\n' "$key" >>.env
    ok "Generata la chiave DATA_KEY: al riavvio nome, telefono e note dei pazienti vengono cifrati nel database."
    warn "Salva una copia della chiave fuori dal server (es. gestore di password), non insieme ai backup:"
    echo "    $key"
  else
    warn "docker-compose.yml personalizzato senza DATA_KEY: i dati dei pazienti restano in chiaro. Aggiungi DATA_KEY: \${DATA_KEY:-} all'ambiente del servizio api."
  fi
fi

# Nuove variabili introdotte in .env.example e assenti nel .env.
missing=$(comm -23 <(grep -oE '^[A-Z_]+=' .env.example | sort -u) <(grep -oE '^[A-Z_]+=' .env | sort -u) | tr -d '=' | tr '\n' ' ')
[ -z "$missing" ] || warn "Nuove variabili disponibili in .env.example non presenti nel tuo .env: $missing"

# ---------- Build e riavvio ----------

wait_healthy() {
  for _ in $(seq 1 60); do
    local api app
    api=$(docker compose ps -q api 2>/dev/null) || true
    app=$(docker compose ps -q app 2>/dev/null) || true
    if [ -n "$api" ] && [ -n "$app" ] &&
      [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$api" 2>/dev/null)" = healthy ] &&
      [ "$(docker inspect -f '{{.State.Status}}' "$app" 2>/dev/null)" = running ]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

deploy() {
  # La build avviene con l'app ancora in funzione: il fermo dura solo il tempo del riavvio.
  docker compose build --pull --quiet && docker compose up -d --remove-orphans && wait_healthy
}

info "Ricostruzione delle immagini e riavvio (qualche minuto)..."
if deploy; then
  rm -f .update-failed
  docker image prune -f >/dev/null 2>&1 || true
  ok "[$(ts)] Aggiornamento completato: versione $(version HEAD) in funzione."
  exit 0
fi

# ---------- Ripristino ----------

warn "L'app non risulta funzionante dopo l'aggiornamento."
docker compose logs --tail 30 api >&2 || true
if [ "$OLD" = "$(git rev-parse HEAD)" ]; then
  die "Controlla i log con: docker compose logs"
fi
if confirm "Tornare alla versione precedente ($(version "$OLD"))?"; then
  git rev-parse HEAD >.update-failed
  git reset --quiet --hard "$OLD"
  if [ -n "$TEMPLATE" ] && git cat-file -e "$OLD:$TEMPLATE" 2>/dev/null; then
    git show "$OLD:$TEMPLATE" >docker-compose.yml
  fi
  if deploy; then
    warn "Ripristinata la versione precedente $(version "$OLD"). Il backup del database è in backups/."
    warn "Se nome e telefono dei pazienti appaiono come codici «v1:…», ripristina quel backup con ./recovery.sh."
  else
    die "Anche la versione precedente non parte: controlla con 'docker compose logs'. Backup del database in backups/."
  fi
fi
exit 1
