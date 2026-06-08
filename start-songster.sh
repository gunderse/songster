#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_PREFIX="$REPO_ROOT/.conda-env"
SERVER_PORT="${SONGSTER_SERVER_PORT:-${PORT:-4338}}"
CLIENT_PORT="${SONGSTER_CLIENT_PORT:-4337}"

log() {
  printf '[songster] %s\n' "$*"
}

fail() {
  printf '[songster] %s\n' "$*" >&2
  exit 1
}

is_private_ipv4() {
  local address="$1"
  [[ "$address" =~ ^10\. ]] || [[ "$address" =~ ^192\.168\. ]] || [[ "$address" =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. ]]
}

is_virtual_interface() {
  local name="$1"
  [[ "$name" =~ ^(lo|lo0|utun[0-9]*|awdl[0-9]*|llw[0-9]*|bridge[0-9]*|docker[0-9]*|vboxnet[0-9]*|vmnet[0-9]*|tap[0-9]*|tun[0-9]*|vnic[0-9]*|gif[0-9]*|stf[0-9]*|anpi[0-9]*)$ ]]
}

load_conda() {
  if command -v conda >/dev/null 2>&1; then
    eval "$(conda shell.bash hook)"
    return 0
  fi

  if [[ -n "${CONDA_EXE:-}" ]] && [[ -x "${CONDA_EXE}" ]]; then
    eval "$(${CONDA_EXE} shell.bash hook)"
    return 0
  fi

  local candidates=(
    "$HOME/miniconda3/etc/profile.d/conda.sh"
    "$HOME/anaconda3/etc/profile.d/conda.sh"
    "/opt/homebrew/Caskroom/miniconda/base/etc/profile.d/conda.sh"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      # shellcheck source=/dev/null
      source "$candidate"
      return 0
    fi
  done

  return 1
}

activate_env() {
  if [[ -d "$ENV_PREFIX" ]]; then
    export PATH="$ENV_PREFIX/bin:$PATH"
    if load_conda; then
      conda activate "$ENV_PREFIX" 2>/dev/null || true
    fi
  else
    log "Conda environment not found at $ENV_PREFIX. Falling back to system Node and pnpm."
  fi
}

detect_lan_host() {
  if [[ -n "${SONGSTER_BIND_HOST:-}" ]]; then
    printf '%s\n' "${SONGSTER_BIND_HOST}"
    return
  fi

  local iface_candidates=()
  local default_iface
  default_iface="$(route -n get default 2>/dev/null | awk '/interface: / { print $2; exit }')"

  if [[ -n "$default_iface" ]] && ! is_virtual_interface "$default_iface"; then
    iface_candidates+=("$default_iface")
  fi

  iface_candidates+=(en0 en1 en2 eth0 wlan0)

  local seen=" "
  local iface
  for iface in "${iface_candidates[@]}"; do
    [[ -n "$iface" ]] || continue
    if [[ "$seen" == *" $iface "* ]]; then
      continue
    fi

    seen+="${iface} "

    local address
    address="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    if is_private_ipv4 "$address"; then
      printf '%s\n' "$address"
      return
    fi
  done

  printf '127.0.0.1\n'
}

stop_repo_listener() {
  local port="$1"
  local label="$2"
  local pids
  pids="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN || true)"

  [[ -z "$pids" ]] && return 0

  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    local command_line
    command_line="$(ps -o command= -p "$pid" 2>/dev/null || true)"
    local process_files
    process_files="$(lsof -p "$pid" 2>/dev/null || true)"

    if [[ "$command_line" != *"$REPO_ROOT"* ]] && [[ "$process_files" != *"$REPO_ROOT"* ]]; then
      fail "Port $port is already in use by a non-Songster process (pid $pid): $command_line"
    fi

    log "Stopping existing $label listener on port $port (pid $pid)"
    kill "$pid" 2>/dev/null || true
  done <<< "$pids"

  local deadline=$((SECONDS + 10))
  while (( SECONDS < deadline )); do
    if [[ -z "$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN || true)" ]]; then
      return 0
    fi
    sleep 0.5
  done

  pids="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN || true)"
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    log "Force stopping lingering $label listener on port $port (pid $pid)"
    kill -9 "$pid" 2>/dev/null || true
  done <<< "$pids"
}

main() {
  cd "$REPO_ROOT"
  activate_env

  command -v pnpm >/dev/null 2>&1 || fail "pnpm is not available after activating the project environment."

  if [[ ! -d "$REPO_ROOT/node_modules" ]]; then
    log "Installing dependencies (first run)"
    pnpm install
  fi

  local bind_host
  bind_host="$(detect_lan_host)"

  export PORT="$SERVER_PORT"
  export SONGSTER_SERVER_PORT="$SERVER_PORT"
  export SONGSTER_CLIENT_PORT="$CLIENT_PORT"
  export SONGSTER_SERVER_HOST="${SONGSTER_SERVER_HOST:-127.0.0.1}"
  export SONGSTER_BIND_HOST="$bind_host"
  export SONGSTER_CLIENT_ORIGIN="${SONGSTER_CLIENT_ORIGIN:-http://${bind_host}:${CLIENT_PORT}}"
  export SONGSTER_PUBLIC_ORIGIN="${SONGSTER_PUBLIC_ORIGIN:-$SONGSTER_CLIENT_ORIGIN}"

  stop_repo_listener "$SERVER_PORT" "server"
  stop_repo_listener "$CLIENT_PORT" "client"

  log "Running database migrations"
  pnpm db:migrate

  log "Starting Songster"
  log "Client bind host: ${SONGSTER_BIND_HOST}"
  log "Share origin:     ${SONGSTER_PUBLIC_ORIGIN}"
  log "Hub:     ${SONGSTER_PUBLIC_ORIGIN}/hub/ABCD"
  log "Admin:   ${SONGSTER_PUBLIC_ORIGIN}/admin"
  log "Library: ${SONGSTER_PUBLIC_ORIGIN}/library"
  log "Player:  ${SONGSTER_PUBLIC_ORIGIN}/?code=ABCD"
  log "API:     http://127.0.0.1:${SERVER_PORT}/healthz"

  exec pnpm dev
}

main "$@"
