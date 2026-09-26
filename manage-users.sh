#!/usr/bin/env bash
# Gestione degli utenti che possono accedere all'app.
#
#   ./manage-users.sh                          menu interattivo
#   ./manage-users.sh list                     elenco utenti
#   ./manage-users.sh create [utente] [--email <email>]
#   ./manage-users.sh edit   [utente]          cambia nome utente e/o email
#   ./manage-users.sh passwd [utente]          cambia password (chiude le sessioni aperte)
#   ./manage-users.sh delete [utente]
#
# Le password vengono chieste due volte senza mostrarle; in alternativa si possono passare
# sullo standard input (es. da uno script): echo 'password' | ./manage-users.sh create mario
# L'app deve essere avviata (docker compose up -d).

set -euo pipefail
cd "$(dirname "$0")"

if [ -t 1 ]; then
  B=$'\e[1m' G=$'\e[32m' Y=$'\e[33m' R=$'\e[31m' N=$'\e[0m'
else
  B='' G='' Y='' R='' N=''
fi
ok() { printf '%s\n' "${G}✔${N} $*"; }
warn() { printf '%s\n' "${Y}!${N} $*" >&2; }
die() {
  printf '%s\n' "${R}✖${N} $*" >&2
  exit 1
}

INTERACTIVE=0
[ -t 0 ] && INTERACTIVE=1

# ---------- Collegamento all'app ----------

[ -f docker-compose.yml ] || die "docker-compose.yml non trovato: esegui prima ./setup.sh"
command -v docker >/dev/null 2>&1 || die "Docker non è installato."
docker info >/dev/null 2>&1 || die "Docker non è raggiungibile (servizio fermo o utente non nel gruppo docker)."

if [ -z "$(docker compose ps --status running -q api 2>/dev/null)" ]; then
  warn "L'app non è in esecuzione."
  if [ "$INTERACTIVE" -eq 1 ]; then
    read -r -p "Avviarla ora con docker compose up -d? (S/n): " a </dev/tty
    case "${a:-s}" in s | S | si | y) ;; *) exit 1 ;; esac
    docker compose up -d
    printf 'Attendo che le API siano pronte'
    for _ in $(seq 1 60); do
      [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' studio-odontoiatrico-api 2>/dev/null)" = healthy ] && break
      printf '.'
      sleep 2
    done
    echo
  else
    die "Avviala con: docker compose up -d"
  fi
fi

# Esegue la CLI utenti dentro il container delle API. Lo standard input viene staccato
# (altrimenti docker exec consumerebbe la password passata in pipe); cli_pw lo usa per la password.
cli() { docker compose exec -T api node src/cli.ts "$@" </dev/null; }
cli_pw() { printf '%s\n' "$1" | docker compose exec -T api node src/cli.ts "${@:2}"; }

# ---------- Input ----------

valid_username() { [[ "$1" =~ ^[A-Za-z0-9._-]{3,32}$ ]]; }
valid_email() { [[ "$1" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; }

need_tty() { [ "$INTERACTIVE" -eq 1 ] || die "Manca $1: passalo come argomento."; }

ask_username() {
  local prompt=${1:-Nome utente} u
  need_tty "il nome utente"
  while :; do
    read -r -p "$prompt: " u </dev/tty
    valid_username "$u" && { printf '%s' "$u"; return; }
    warn "3–32 caratteri tra lettere, numeri, punto, trattino e trattino basso."
  done
}

# Chiede un utente esistente (mostrando l'elenco) se non è stato passato.
pick_user() {
  local u=${1:-}
  if [ -z "$u" ]; then
    need_tty "il nome utente"
    cli list >&2
    echo >&2
    read -r -p "Utente: " u </dev/tty
  fi
  [ -n "$u" ] || die "Nessun utente indicato."
  cli exists "$u" || die "Utente \"$u\" non trovato."
  printf '%s' "$u"
}

# Legge la nuova password: dal terminale (due volte) oppure dalla prima riga di stdin.
read_password() {
  local p1 p2
  if [ "$INTERACTIVE" -eq 0 ]; then
    IFS= read -r p1 || true
    [ "${#p1}" -ge 8 ] || die "La password deve avere almeno 8 caratteri."
    printf '%s' "$p1"
    return
  fi
  while :; do
    read -r -s -p "Nuova password (almeno 8 caratteri): " p1 </dev/tty
    echo >&2
    if [ "${#p1}" -lt 8 ]; then
      warn "Usa almeno 8 caratteri."
      continue
    fi
    read -r -s -p "Ripeti la password: " p2 </dev/tty
    echo >&2
    [ "$p1" = "$p2" ] && break
    warn "Le password non coincidono, riprova."
  done
  printf '%s' "$p1"
}

# ---------- Comandi ----------

cmd_list() { cli list; }

cmd_create() {
  local user='' email='' pw
  while [ $# -gt 0 ]; do
    case "$1" in
      --email)
        email=${2:-}
        shift
        ;;
      *) user=$1 ;;
    esac
    shift
  done
  if [ -z "$user" ]; then
    user=$(ask_username "Nome utente del nuovo utente")
    read -r -p "Email (facoltativa, invio per saltare): " email </dev/tty
  fi
  valid_username "$user" || die "Nome utente non valido: 3–32 caratteri tra lettere, numeri, . _ -"
  [ -z "$email" ] || valid_email "$email" || die "Email non valida."
  if cli exists "$user"; then die "Esiste già un utente \"$user\"."; fi
  pw=$(read_password)
  local args=(create "$user")
  [ -n "$email" ] && args+=(--email "$email")
  cli_pw "$pw" "${args[@]}"
}

cmd_edit() {
  local user newname email args
  user=$(pick_user "${1:-}")
  need_tty "il valore da modificare"
  args=(update "$user")
  while :; do
    read -r -p "Nuovo nome utente (invio = \"$user\"): " newname </dev/tty
    [ -z "$newname" ] || [ "$newname" = "$user" ] && break
    if valid_username "$newname"; then
      args+=(--username "$newname")
      break
    fi
    warn "3–32 caratteri tra lettere, numeri, punto, trattino e trattino basso."
  done
  while :; do
    read -r -p "Nuova email (invio = invariata, - = rimuovi): " email </dev/tty
    if [ -z "$email" ]; then break; fi
    if [ "$email" = - ]; then
      args+=(--no-email)
      break
    fi
    if valid_email "$email"; then
      args+=(--email "$email")
      break
    fi
    warn "Email non valida."
  done
  if [ "${#args[@]}" -eq 2 ]; then
    echo "Nessuna modifica."
    return
  fi
  cli "${args[@]}"
}

cmd_passwd() {
  local user pw
  user=$(pick_user "${1:-}")
  pw=$(read_password)
  cli_pw "$pw" passwd "$user"
}

cmd_delete() {
  local user confirm
  user=$(pick_user "${1:-}")
  if [ "$INTERACTIVE" -eq 1 ]; then
    read -r -p "Per confermare l'eliminazione scrivi il nome utente ($user): " confirm </dev/tty
    [ "$confirm" = "$user" ] || die "Annullato."
  fi
  cli delete "$user"
}

menu() {
  while :; do
    echo
    echo "${B}Gestione utenti · Studio Odontoiatrico${N}"
    echo "  1) Elenco utenti"
    echo "  2) Crea utente"
    echo "  3) Modifica nome utente / email"
    echo "  4) Cambia password"
    echo "  5) Elimina utente"
    echo "  0) Esci"
    read -r -p "Scelta: " c </dev/tty
    echo
    # Ogni operazione gira in una subshell: un errore non chiude il menu.
    case "$c" in
      1) (cmd_list) || true ;;
      2) (cmd_create) || true ;;
      3) (cmd_edit) || true ;;
      4) (cmd_passwd) || true ;;
      5) (cmd_delete) || true ;;
      0 | q | '') exit 0 ;;
      *) warn "Scelta non valida." ;;
    esac
  done
}

case "${1:-}" in
  '') [ "$INTERACTIVE" -eq 1 ] && menu || cmd_list ;;
  list | ls) cmd_list ;;
  create | add) shift && cmd_create "$@" ;;
  edit | update) shift && cmd_edit "$@" ;;
  passwd | password) shift && cmd_passwd "$@" ;;
  delete | del | rm) shift && cmd_delete "$@" ;;
  -h | --help | help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) die "Comando sconosciuto: $1 (usa --help)" ;;
esac
