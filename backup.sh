#!/usr/bin/env bash
# Backup giornaliero incrementale del database, con rotazione.
#
#   ./backup.sh                          esegue subito un backup
#   ./backup.sh --install-cron [HH:MM]   backup automatico ogni giorno (predefinito 02:30)
#   ./backup.sh --remove-cron            rimuove il backup automatico
#   ./backup.sh --list                   elenca i backup presenti
#
# Ogni backup è una cartella in backups/daily/ con un file per tabella (formato "directory" di
# pg_dump). È incrementale: i file delle tabelle che non sono cambiate dal backup precedente non
# vengono copiati di nuovo ma collegati (hard link), quindi occupano spazio una volta sola. Ogni
# cartella resta comunque completa e ripristinabile da sola con ./recovery.sh.
# Si conservano gli ultimi BACKUP_KEEP_DAYS giorni (predefinito 15): i più vecchi vengono cancellati.
#
# Variabili: BACKUP_KEEP_DAYS (anche nel file .env).

set -euo pipefail

cd "$(dirname "$0")"
REPO_DIR=$PWD

ACTION=backup
CRON_TIME='02:30'
KIND=daily
while [ $# -gt 0 ]; do
  case "$1" in
    --install-cron)
      ACTION=install-cron
      if [[ "${2:-}" =~ ^[0-9]{1,2}:[0-9]{2}$ ]]; then
        CRON_TIME=$2
        shift
      fi
      ;;
    --remove-cron) ACTION=remove-cron ;;
    --list) ACTION=list ;;
    # Uso interno di recovery.sh: copia di sicurezza prima di un ripristino.
    --pre-restore) KIND=pre-restore ;;
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
  G=$'\e[32m' Y=$'\e[33m' R=$'\e[31m' C=$'\e[36m' N=$'\e[0m'
else
  G='' Y='' R='' C='' N=''
fi
info() { printf '%s\n' "${C}›${N} $*"; }
ok() { printf '%s\n' "${G}✔${N} $*"; }
warn() { printf '%s\n' "${Y}!${N} $*" >&2; }
die() {
  printf '%s\n' "${R}✖${N} $*" >&2
  exit 1
}

env_get() {
  local line
  line=$(grep -E "^$1=" .env 2>/dev/null | tail -n1) || true
  line=${line#*=}
  line=${line#\'}
  line=${line%\'}
  printf '%s' "$line"
}

KEEP_DAYS=${BACKUP_KEEP_DAYS:-$(env_get BACKUP_KEEP_DAYS)}
KEEP_DAYS=${KEEP_DAYS:-15}
[[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] && [ "$KEEP_DAYS" -ge 1 ] || die "BACKUP_KEEP_DAYS non valido: $KEEP_DAYS"
# Copie di sicurezza fatte da recovery.sh prima di ogni ripristino.
KEEP_PRE_RESTORE=5

DAILY_DIR=backups/daily
PRE_RESTORE_DIR=backups/pre-restore

# ---------- Backup automatico (cron) ----------

# Il riferimento alla cartella rende indipendente la riga di ogni installazione (più studi).
CRON_TAG="# studio-odontoiatrico backup.sh $REPO_DIR"
if [ "$ACTION" = install-cron ] || [ "$ACTION" = remove-cron ]; then
  command -v crontab >/dev/null 2>&1 || die "crontab non disponibile (installa il pacchetto cron)."
  current=$(crontab -l 2>/dev/null | awk -v t="$CRON_TAG" 'index($0, t) == 0' || true)
  if [ "$ACTION" = remove-cron ]; then
    printf '%s\n' "$current" | sed '/^$/d' | crontab -
    ok "Backup automatico rimosso."
    exit 0
  fi
  h=${CRON_TIME%%:*}
  m=${CRON_TIME##*:}
  [ "$((10#$h))" -le 23 ] && [ "$((10#$m))" -le 59 ] || die "Orario non valido: $CRON_TIME"
  line="$((10#$m)) $((10#$h)) * * * cd '$REPO_DIR' && ./backup.sh >> '$REPO_DIR/backup.log' 2>&1 $CRON_TAG"
  { printf '%s\n' "$current" | sed '/^$/d'; echo "$line"; } | crontab -
  ok "Backup automatico ogni giorno alle $CRON_TIME: conservati gli ultimi $KEEP_DAYS giorni (log in backup.log)."
  exit 0
fi

# ---------- Elenco ----------

if [ "$ACTION" = list ]; then
  found=0
  for d in $(ls -1d "$DAILY_DIR"/*/ "$PRE_RESTORE_DIR"/*/ 2>/dev/null | sort -r || true); do
    found=1
    printf '%s  %s\n' "${d%/}" "$(du -sh "$d" | cut -f1)"
  done
  [ "$found" -eq 1 ] || info "Nessun backup in $DAILY_DIR."
  exit 0
fi

# ---------- Backup ----------

[ -f docker-compose.yml ] || die "docker-compose.yml non trovato: esegui prima ./setup.sh"
command -v docker >/dev/null 2>&1 || die "Docker non trovato."

# Un solo backup alla volta (es. cron + lancio manuale).
exec 9>"$REPO_DIR/.backup.lock"
if command -v flock >/dev/null 2>&1 && ! flock -n 9; then
  die "Un altro backup è già in corso."
fi

[ -n "$(docker compose ps --status running -q db 2>/dev/null)" ] || die "Il database non è in esecuzione (docker compose up -d)."

BASE_DIR=$DAILY_DIR
[ "$KIND" = pre-restore ] && BASE_DIR=$PRE_RESTORE_DIR
umask 077
mkdir -p "$BASE_DIR"
chmod 700 backups "$BASE_DIR"

NAME=$(date +%Y-%m-%d_%H%M%S)
DEST="$BASE_DIR/$NAME"
TMP="$BASE_DIR/.tmp-$NAME"
[ -e "$DEST" ] && die "Esiste già un backup $DEST."
rm -rf "$TMP"
mkdir "$TMP"
trap 'rm -rf "$TMP"' EXIT

# pg_dump nel container del database (stessa versione di PostgreSQL), verifica con pg_restore -l,
# poi la cartella arriva qui come archivio tar.
info "Backup del database in $DEST..."
docker compose exec -T db sh -c '
  set -e
  d=$(mktemp -d)
  trap "rm -rf \"$d\"" EXIT
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fd -Z 6 -f "$d/dump"
  pg_restore -l "$d/dump" >/dev/null
  tar -C "$d/dump" -cf - .
' </dev/null | tar -xf - --no-same-owner --no-same-permissions -C "$TMP" || die "Backup non riuscito."
[ -s "$TMP/toc.dat" ] || die "Backup non riuscito: indice (toc.dat) mancante."

# Incrementale: le tabelle identiche al backup precedente diventano hard link ai suoi file.
PREV=$(ls -1d "$DAILY_DIR"/????-??-??_??????/ 2>/dev/null | sort | tail -n1 || true)
PREV=${PREV%/}
linked=0
new=0
for f in "$TMP"/*.dat.gz; do
  [ -e "$f" ] || continue
  b=$(basename "$f")
  if [ -n "$PREV" ] && [ -f "$PREV/$b" ] && cmp -s "$f" "$PREV/$b" && ln -f "$PREV/$b" "$f" 2>/dev/null; then
    linked=$((linked + 1))
  else
    new=$((new + 1))
  fi
done

{
  echo "data=$(date '+%Y-%m-%d %H:%M:%S')"
  echo "istanza=$(env_get INSTANCE)"
  echo "versione=$(git rev-parse --short HEAD 2>/dev/null || echo '?')"
  echo "tabelle_nuove=$new"
  echo "tabelle_invariate=$linked"
} >"$TMP/backup.info"
mv "$TMP" "$DEST"
trap - EXIT

if [ -n "$PREV" ] && [ "$linked" -gt 0 ]; then
  ok "Backup completato ($(du -sh "$DEST" | cut -f1)): tabelle modificate $new, invariate $linked (collegate a $(basename "$PREV"))."
else
  # Primo backup, oppure dopo un ripristino o un aggiornamento che ha cambiato le tabelle: copia completa.
  ok "Backup completato ($(du -sh "$DEST" | cut -f1), copia completa)."
fi

# ---------- Rotazione ----------

if [ "$KIND" = pre-restore ]; then
  { ls -1d "$PRE_RESTORE_DIR"/????-??-??_??????/ 2>/dev/null || true; } | sort -r | tail -n "+$((KEEP_PRE_RESTORE + 1))" | xargs -r rm -rf
  exit 0
fi

# Cancella i backup più vecchi di KEEP_DAYS giorni, ma mai il più recente.
LIMIT=$(date -d "-$KEEP_DAYS days" +%Y-%m-%d_%H%M%S 2>/dev/null || date -v "-${KEEP_DAYS}d" +%Y-%m-%d_%H%M%S)
removed=0
for d in $(ls -1d "$DAILY_DIR"/????-??-??_??????/ 2>/dev/null | sort | head -n -1 || true); do
  d=${d%/}
  if [[ "$(basename "$d")" < "$LIMIT" ]]; then
    rm -rf "$d"
    removed=$((removed + 1))
  fi
done
[ "$removed" -eq 0 ] || info "Eliminati $removed backup più vecchi di $KEEP_DAYS giorni."
