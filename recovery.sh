#!/usr/bin/env bash
# Ripristino del database da un backup, scelto da un elenco.
#
#   ./recovery.sh                  mostra i backup disponibili e chiede quale ripristinare
#   ./recovery.sh --list           elenca soltanto i backup
#   ./recovery.sh --latest         propone il backup più recente
#   ./recovery.sh --file PERCORSO  ripristina un backup preciso (cartella di backup.sh o file .sql.gz,
#                                  anche copiato da un altro server)
#   ./recovery.sh --yes            nessuna domanda (con --latest o --file)
#   ./recovery.sh --no-safety      non salva lo stato attuale prima del ripristino (sconsigliato)
#
# Backup elencati: quelli giornalieri di backup.sh (backups/daily), quelli fatti da update.sh prima
# di ogni aggiornamento (backups/pre-update-*.sql.gz) e le copie di sicurezza fatte da questo script
# prima di ogni ripristino (backups/pre-restore), così un ripristino si può sempre annullare.
# Il ripristino è atomico: se qualcosa va storto il database resta com'era.

set -euo pipefail

cd "$(dirname "$0")"

ASSUME_YES=0
LIST_ONLY=0
LATEST=0
SAFETY=1
FILE=''
while [ $# -gt 0 ]; do
  case "$1" in
    -y | --yes) ASSUME_YES=1 ;;
    --list) LIST_ONLY=1 ;;
    --latest) LATEST=1 ;;
    --no-safety) SAFETY=0 ;;
    --file)
      [ -n "${2:-}" ] || {
        echo "--file richiede un percorso" >&2
        exit 1
      }
      FILE=$2
      shift
      ;;
    --file=*) FILE=${1#--file=} ;;
    -h | --help)
      sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Opzione sconosciuta: $1 (usa --help)" >&2
      exit 1
      ;;
  esac
  shift
done

if [ -t 1 ]; then
  B=$'\e[1m' D=$'\e[2m' G=$'\e[32m' Y=$'\e[33m' R=$'\e[31m' C=$'\e[36m' N=$'\e[0m'
else
  B='' D='' G='' Y='' R='' C='' N=''
fi
info() { printf '%s\n' "${C}›${N} $*"; }
ok() { printf '%s\n' "${G}✔${N} $*"; }
warn() { printf '%s\n' "${Y}!${N} $*" >&2; }
die() {
  printf '%s\n' "${R}✖${N} $*" >&2
  exit 1
}

# ---------- Elenco dei backup ----------

# Righe "chiave|percorso|tipo": la chiave (AAAAMMGGhhmmss) serve a ordinare dal più recente.
collect() {
  local p n
  for p in backups/daily/????-??-??_??????/ backups/pre-restore/????-??-??_??????/; do
    [ -f "$p/toc.dat" ] || continue
    p=${p%/}
    n=$(basename "$p")
    case "$p" in
      backups/daily/*) printf '%s|%s|%s\n' "${n//[-_]/}" "$p" "giornaliero" ;;
      *) printf '%s|%s|%s\n' "${n//[-_]/}" "$p" "prima di un ripristino" ;;
    esac
  done
  for p in backups/*.sql.gz; do
    [ -f "$p" ] || continue
    n=$(basename "$p")
    if [[ "$n" =~ ^pre-update-([0-9]{8})-([0-9]{6})-([0-9a-f]+)\.sql\.gz$ ]]; then
      printf '%s|%s|%s\n' "${BASH_REMATCH[1]}${BASH_REMATCH[2]}" "$p" "prima dell'aggiornamento (${BASH_REMATCH[3]})"
    else
      printf '%s|%s|%s\n' "$(date -r "$p" +%Y%m%d%H%M%S)" "$p" "manuale"
    fi
  done
}

# "20260927023000" → "27/09/2026 02:30"
pretty_date() { printf '%s/%s/%s %s:%s' "${1:6:2}" "${1:4:2}" "${1:0:4}" "${1:8:2}" "${1:10:2}"; }

age() {
  local days
  days=$((($(date +%s) - $(date -d "${1:0:4}-${1:4:2}-${1:6:2}" +%s)) / 86400))
  case "$days" in
    0) printf 'oggi' ;;
    1) printf 'ieri' ;;
    *) printf '%s giorni fa' "$days" ;;
  esac
}

mapfile -t ENTRIES < <(collect | sort -t'|' -k1,1r)

print_list() {
  local i=1 e key path kind
  printf '  %s%-3s %-17s %-12s %-36s %s%s\n' "$B" "N." "Data" "" "Tipo" "Dimensione" "$N"
  for e in "${ENTRIES[@]}"; do
    IFS='|' read -r key path kind <<<"$e"
    printf '  %-3s %-17s %s%-12s%s %-36s %s\n' "$i" "$(pretty_date "$key")" "$D" "$(age "$key")" "$N" "$kind" "$(du -sh "$path" | cut -f1)"
    i=$((i + 1))
  done
}

if [ "$LIST_ONLY" -eq 1 ]; then
  if [ "${#ENTRIES[@]}" -eq 0 ]; then
    info "Nessun backup trovato in backups/. Creane uno con ./backup.sh"
  else
    print_list
  fi
  exit 0
fi

# ---------- Controlli ----------

[ -f docker-compose.yml ] || die "docker-compose.yml non trovato: esegui prima ./setup.sh"
command -v docker >/dev/null 2>&1 || die "Docker non trovato."
[ -t 0 ] || [ "$ASSUME_YES" -eq 1 ] || die "Serve un terminale interattivo (oppure --yes con --latest o --file)."

# ---------- Scelta del backup ----------

SRC=''
if [ -n "$FILE" ]; then
  FILE=${FILE%/}
  if [ -d "$FILE" ]; then
    [ -f "$FILE/toc.dat" ] || die "$FILE non è una cartella di backup (manca toc.dat)."
  elif [ -f "$FILE" ]; then
    [[ "$FILE" == *.sql.gz ]] || die "Formato non riconosciuto: $FILE (servono una cartella di backup.sh o un file .sql.gz)."
  else
    die "Backup non trovato: $FILE"
  fi
  SRC=$FILE
  KIND='indicato'
elif [ "${#ENTRIES[@]}" -eq 0 ]; then
  die "Nessun backup trovato in backups/. I backup si creano con ./backup.sh (o in automatico con ./backup.sh --install-cron)."
elif [ "$LATEST" -eq 1 ]; then
  IFS='|' read -r KEY SRC KIND <<<"${ENTRIES[0]}"
  [ "$ASSUME_YES" -eq 1 ] || { print_list | head -n 2 || true; echo; }
else
  [ "$ASSUME_YES" -eq 0 ] || die "Con --yes indica il backup con --latest o --file."
  echo
  printf '%sBackup disponibili%s\n\n' "$B" "$N"
  print_list
  echo
  while :; do
    read -r -p "Numero del backup da ripristinare (invio = annulla): " choice </dev/tty
    [ -n "$choice" ] || {
      info "Nessun ripristino eseguito."
      exit 0
    }
    if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 1 ] && [ "$choice" -le "${#ENTRIES[@]}" ]; then
      IFS='|' read -r KEY SRC KIND <<<"${ENTRIES[$((choice - 1))]}"
      break
    fi
    warn "Scegli un numero tra 1 e ${#ENTRIES[@]}."
  done
fi

echo
info "Backup scelto: ${B}$SRC${N} ($KIND)"
[ -f "$SRC/backup.info" ] && sed -n 's/^versione=/  versione dell\x27app: /p; s/^istanza=\(..*\)/  istanza: \1/p' "$SRC/backup.info"

if [ "$ASSUME_YES" -eq 0 ]; then
  echo
  warn "Tutti i dati attuali (registrazioni, appuntamenti, campagne, utenti, impostazioni, logo) verranno sostituiti con quelli del backup."
  [ "$SAFETY" -eq 1 ] && info "Prima del ripristino salvo una copia dello stato attuale: potrai tornarci con questo stesso script."
  read -r -p "Scrivi RIPRISTINA per confermare: " ans </dev/tty
  [ "$ans" = RIPRISTINA ] || {
    info "Nessun ripristino eseguito."
    exit 0
  }
fi

# ---------- Ripristino ----------

# Il database deve essere acceso (le API no: vengono fermate durante il ripristino).
if [ -z "$(docker compose ps --status running -q db 2>/dev/null)" ]; then
  info "Avvio il database..."
  docker compose up -d db
  for _ in $(seq 1 30); do
    docker compose exec -T db sh -c 'pg_isready -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"' </dev/null && break
    sleep 2
  done
fi

if [ "$SAFETY" -eq 1 ]; then
  ./backup.sh --pre-restore || die "Copia di sicurezza non riuscita: ripristino annullato (usa --no-safety per saltarla)."
fi

API_WAS_RUNNING=0
[ -n "$(docker compose ps --status running -q api 2>/dev/null)" ] && API_WAS_RUNNING=1
info "Fermo le API durante il ripristino..."
docker compose stop api >/dev/null 2>&1 || true

restart_api() {
  [ "$API_WAS_RUNNING" -eq 1 ] || return 0
  docker compose start api >/dev/null 2>&1 || docker compose up -d api >/dev/null
}

# Tutto in una sola transazione: schema svuotato e ricaricato dal backup, oppure nessuna modifica.
PSQL='psql -X -q -v ON_ERROR_STOP=1 --single-transaction -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null'
RESET="SET client_min_messages = warning; DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
info "Ripristino in corso..."
if [ -d "$SRC" ]; then
  tar -C "$SRC" -cf - --exclude=backup.info . | docker compose exec -T db sh -c "
    set -eo pipefail
    d=\$(mktemp -d)
    trap 'rm -rf \"\$d\"' EXIT
    tar -xf - -C \"\$d\"
    { echo '$RESET'; pg_restore --no-owner --no-acl -f - \"\$d\"; } | $PSQL
  " && RESTORED=1 || RESTORED=0
else
  gzip -dc "$SRC" | docker compose exec -T db sh -c "
    set -eo pipefail
    { echo '$RESET'; cat; } | $PSQL
  " && RESTORED=1 || RESTORED=0
fi

if [ "$RESTORED" -eq 0 ]; then
  restart_api
  die "Ripristino non riuscito: il database è rimasto com'era."
fi
ok "Database ripristinato da $SRC."

# ---------- Riavvio e verifica ----------

restart_api
if [ "$API_WAS_RUNNING" -eq 1 ]; then
  info "Attendo che l'app sia pronta..."
  READY=0
  for _ in $(seq 1 45); do
    id=$(docker compose ps -q api 2>/dev/null) || true
    if [ -n "$id" ] && [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id" 2>/dev/null)" = healthy ]; then
      READY=1
      break
    fi
    sleep 2
  done
  [ "$READY" -eq 1 ] && ok "App di nuovo online." || warn "L'app non risulta ancora pronta: controlla con 'docker compose logs api'."
fi

summary=$(docker compose exec -T db sh -c "psql -X -tA -F ' ' -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"SELECT count(*), coalesce(to_char(max(day), 'DD/MM/YYYY'), '—'), (SELECT count(*) FROM users) FROM records\"" </dev/null 2>/dev/null || true)
if [ -n "$summary" ]; then
  read -r n last users <<<"$summary"
  info "Nel database: $n registrazioni (ultima giornata $last), $users utenti."
fi
if [ "$SAFETY" -eq 1 ]; then
  info "Per annullare il ripristino: ./recovery.sh e scegli la copia \"prima di un ripristino\" più recente."
fi
