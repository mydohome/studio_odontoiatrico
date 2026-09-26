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

CRON_TAG="# studio-odontoiatrico update.sh"
if [ -n "$CRON_ACTION" ]; then
  command -v crontab >/dev/null 2>&1 || die "crontab non disponibile (installa il pacchetto cron)."
  current=$(crontab -l 2>/dev/null | grep -vF "$CRON_TAG" || true)
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
exec 9>"$REPO_DIR/.update.lock"
if command -v flock >/dev/null 2>&1 && ! flock -n 9; then
  die "Un altro aggiornamento è già in corso."
fi

[ -d .git ] || die "Questa cartella non è un clone git del repository."
[ -f docker-compose.yml ] || die "docker-compose.yml non trovato: esegui prima ./setup.sh"
[ -f .env ] || die ".env non trovato: esegui prima ./setup.sh"
command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 || die "Docker non è raggiungibile."

echo "${B}[$(ts)] Aggiornamento Studio Odontoiatrico${N}"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$BRANCH" != HEAD ] || die "Il repository non è su un branch (HEAD staccato): esegui 'git checkout main'."
UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo "origin/$BRANCH")
REMOTE=${UPSTREAM%%/*}
REMOTE_BRANCH=${UPSTREAM#*/}

# Modifiche locali ai file versionati bloccherebbero (o verrebbero perse con) l'aggiornamento.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git status --short --untracked-files=no >&2
  die "Ci sono modifiche locali ai file del repository: salvale altrove o annullale con 'git checkout -- .' e riprova."
fi

info "Controllo novità su $UPSTREAM..."
git fetch --quiet "$REMOTE" "$REMOTE_BRANCH" || die "Impossibile contattare GitHub (git fetch non riuscito)."

OLD=$(git rev-parse HEAD)
NEW=$(git rev-parse "$UPSTREAM")
version() { git describe --tags --always "$1" 2>/dev/null || git rev-parse --short "$1"; }

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
fi

if [ -n "$TEMPLATE" ] && [ -f "$TEMPLATE" ] && ! cmp -s docker-compose.yml "$TEMPLATE"; then
  cp docker-compose.yml "docker-compose.yml.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$TEMPLATE" docker-compose.yml
  ok "docker-compose.yml aggiornato dal template $TEMPLATE (copia del precedente salvata)."
elif [ -z "$TEMPLATE" ]; then
  warn "docker-compose.yml è stato personalizzato: non lo modifico. Confrontalo con i template _deploy_*_example.yml."
fi

# Nuove variabili introdotte in .env.example e assenti nel .env.
missing=$(comm -23 <(grep -oE '^[A-Z_]+=' .env.example | sort -u) <(grep -oE '^[A-Z_]+=' .env | sort -u) | tr -d '=' | tr '\n' ' ')
[ -z "$missing" ] || warn "Nuove variabili disponibili in .env.example non presenti nel tuo .env: $missing"

# ---------- Build e riavvio ----------

wait_healthy() {
  for _ in $(seq 1 60); do
    if [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' studio-odontoiatrico-api 2>/dev/null)" = healthy ] &&
      [ "$(docker inspect -f '{{.State.Status}}' studio-odontoiatrico-app 2>/dev/null)" = running ]; then
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
  else
    die "Anche la versione precedente non parte: controlla con 'docker compose logs'. Backup del database in backups/."
  fi
fi
exit 1
