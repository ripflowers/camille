#!/usr/bin/env bash
set -Eeuo pipefail

ARTIFACT="${1:?usage: remote-deploy.sh <release.tar.gz> <git-sha>}"
RELEASE_ID="${2:?usage: remote-deploy.sh <release.tar.gz> <git-sha>}"
APP_LINK="${APP_DIR:-/root/workspace/enstudy-release-20260714-173624}"
DEPLOY_BASE_DIR="${DEPLOY_BASE_DIR:-/root/workspace/camille-deploy}"
RELEASES_DIR="${DEPLOY_BASE_DIR}/releases"
PERSISTENT_DIR="${DEPLOY_BASE_DIR}/persistent"
PERSISTENT_STORAGE="${PERSISTENT_DIR}/storage"
BACKUP_DIR="${DEPLOY_BASE_DIR}/backups"
STORAGE_BACKUP_DIR="${BACKUP_DIR}/storage"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:4173/api/health}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
KEEP_STORAGE_BACKUPS="${KEEP_STORAGE_BACKUPS:-30}"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
RELEASE_ID="$(printf '%s' "${RELEASE_ID}" | tr -cd '0-9a-fA-F')"

log() {
  printf '[deploy] %s\n' "$*" >&2
}

fail() {
  log "ERROR: $*"
  return 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

for command_name in systemctl journalctl tar grep find ln mv rm readlink curl flock awk sort basename dirname wc seq sleep; do
  require_command "${command_name}"
done

[[ "${EUID}" -eq 0 ]] || fail "deployment must run as root"
[[ -f "${ARTIFACT}" ]] || fail "release artifact does not exist: ${ARTIFACT}"
[[ ${#RELEASE_ID} -ge 7 ]] || fail "invalid release id"
[[ "${KEEP_RELEASES}" =~ ^[0-9]+$ && "${KEEP_RELEASES}" -ge 2 ]] || fail "KEEP_RELEASES must be an integer >= 2"
[[ "${KEEP_STORAGE_BACKUPS}" =~ ^[0-9]+$ && "${KEEP_STORAGE_BACKUPS}" -ge 1 ]] || fail "KEEP_STORAGE_BACKUPS must be an integer >= 1"

mkdir -p "${RELEASES_DIR}" "${PERSISTENT_DIR}" "${STORAGE_BACKUP_DIR}"

exec 9>"${DEPLOY_BASE_DIR}/deploy.lock"
flock 9

NEW_RELEASE="${RELEASES_DIR}/${RELEASE_ID}"
STAGING_RELEASE="${RELEASES_DIR}/.staging-${RELEASE_ID}-$$"
SERVICE_NAME=""
PREVIOUS_TARGET=""
SERVICE_STOPPED=0
SUCCESS=0

cleanup_and_rollback() {
  local exit_code=$?
  trap - EXIT INT TERM

  rm -rf "${STAGING_RELEASE}" 2>/dev/null || true
  rm -f "${ARTIFACT}" 2>/dev/null || true

  if [[ "${SUCCESS}" -ne 1 && "${SERVICE_STOPPED}" -eq 1 ]]; then
    log "deployment failed; rolling application code back"
    systemctl stop "${SERVICE_NAME}" >/dev/null 2>&1 || true

    if [[ -n "${PREVIOUS_TARGET}" && -d "${PREVIOUS_TARGET}" ]]; then
      if [[ -d "${PERSISTENT_STORAGE}" && ! -e "${PREVIOUS_TARGET}/storage" ]]; then
        ln -s "${PERSISTENT_STORAGE}" "${PREVIOUS_TARGET}/storage" || true
      fi
      switch_app_link "${PREVIOUS_TARGET}" || true
    fi

    systemctl start "${SERVICE_NAME}" >/dev/null 2>&1 || true
    systemctl status "${SERVICE_NAME}" --no-pager -l >&2 || true
  fi

  exit "${exit_code}"
}
trap cleanup_and_rollback EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

switch_app_link() {
  local target="$1"
  local next_link="${APP_LINK}.next.$$"
  rm -f "${next_link}"
  ln -s "${target}" "${next_link}"
  mv -Tf "${next_link}" "${APP_LINK}"
}

discover_service() {
  local -a unit_paths=()
  local -a units=()
  local -a active_units=()
  local path unit
  declare -A seen=()

  mapfile -t unit_paths < <(
    grep -RIlF --include='*.service' "${APP_LINK}" \
      /etc/systemd/system /usr/lib/systemd/system /run/systemd/system 2>/dev/null || true
  )

  for path in "${unit_paths[@]}"; do
    unit="$(basename "${path}")"
    if [[ -z "${seen[${unit}]:-}" ]]; then
      units+=("${unit}")
      seen["${unit}"]=1
    fi
  done

  if [[ ${#units[@]} -eq 0 ]]; then
    while read -r unit _; do
      [[ -n "${unit}" ]] || continue
      if systemctl show "${unit}" -p WorkingDirectory -p ExecStart --value 2>/dev/null | grep -Fq "${APP_LINK}"; then
        units+=("${unit}")
      fi
    done < <(systemctl list-unit-files --type=service --no-legend 2>/dev/null || true)
  fi

  for unit in "${units[@]}"; do
    if systemctl is-active --quiet "${unit}"; then
      active_units+=("${unit}")
    fi
  done

  if [[ ${#active_units[@]} -eq 1 ]]; then
    printf '%s\n' "${active_units[0]}"
    return 0
  fi

  if [[ ${#units[@]} -eq 1 ]]; then
    printf '%s\n' "${units[0]}"
    return 0
  fi

  if [[ ${#units[@]} -eq 0 ]]; then
    fail "cannot find a systemd service referencing ${APP_LINK}"
  else
    fail "multiple systemd services reference ${APP_LINK}: ${units[*]}"
  fi
}

count_user_records() {
  local storage_path="$1"
  if [[ -d "${storage_path}/users" ]]; then
    find "${storage_path}/users" -maxdepth 1 -type f -name '*.json' -print | wc -l | awk '{print $1}'
  else
    printf '0\n'
  fi
}

backup_storage() {
  local storage_path="$1"
  local user_count="$2"
  local backup_file="${STORAGE_BACKUP_DIR}/${TIMESTAMP}-${RELEASE_ID:0:12}-users-${user_count}.tar.gz"

  log "backing up storage (${user_count} user record files) -> ${backup_file}"
  tar -C "$(dirname "${storage_path}")" -czf "${backup_file}" "$(basename "${storage_path}")"
  tar -tzf "${backup_file}" >/dev/null
}

prune_old_files() {
  local current_target
  local -a release_dirs=()
  local -a backup_files=()
  local kept=0
  local dir
  local i

  current_target="$(readlink -f "${APP_LINK}")"
  mapfile -t release_dirs < <(
    find "${RELEASES_DIR}" -mindepth 1 -maxdepth 1 -type d ! -name '.staging-*' \
      -printf '%T@ %p\n' | sort -nr | awk '{$1=""; sub(/^ /, ""); print}'
  )

  for dir in "${release_dirs[@]}"; do
    if [[ "${dir}" == "${current_target}" || "${dir}" == "${PREVIOUS_TARGET}" ]]; then
      kept=$((kept + 1))
      continue
    fi
    if [[ "${kept}" -lt "${KEEP_RELEASES}" ]]; then
      kept=$((kept + 1))
    else
      rm -rf "${dir}"
    fi
  done

  mapfile -t backup_files < <(
    find "${STORAGE_BACKUP_DIR}" -maxdepth 1 -type f -name '*.tar.gz' -printf '%T@ %p\n' \
      | sort -nr | awk '{$1=""; sub(/^ /, ""); print}'
  )

  for ((i=KEEP_STORAGE_BACKUPS; i<${#backup_files[@]}; i++)); do
    rm -f "${backup_files[$i]}"
  done
}

SERVICE_NAME="$(discover_service)"
log "systemd service: ${SERVICE_NAME}"
log "stable application path: ${APP_LINK}"

if [[ -L "${APP_LINK}" ]]; then
  PREVIOUS_TARGET="$(readlink -f "${APP_LINK}")"
  [[ -d "${PREVIOUS_TARGET}" ]] || fail "current application symlink target is missing: ${PREVIOUS_TARGET}"
  [[ -d "${PERSISTENT_STORAGE}" ]] || fail "persistent storage is missing: ${PERSISTENT_STORAGE}"
  [[ "$(readlink -f "${APP_LINK}/storage")" == "$(readlink -f "${PERSISTENT_STORAGE}")" ]] \
    || fail "current release is not using the expected persistent storage"
else
  [[ -d "${APP_LINK}" ]] || fail "application directory does not exist: ${APP_LINK}"
  [[ -d "${APP_LINK}/storage" ]] || fail "critical storage directory does not exist: ${APP_LINK}/storage"
  [[ ! -e "${PERSISTENT_STORAGE}" ]] \
    || fail "persistent storage already exists while ${APP_LINK} is still a real directory; manual inspection is required"
fi

if [[ -L "${APP_LINK}" && "$(readlink -f "${APP_LINK}")" == "$(readlink -m "${NEW_RELEASE}")" ]]; then
  log "release ${RELEASE_ID} is already active; nothing to deploy"
  SUCCESS=1
  exit 0
fi

if tar -tzf "${ARTIFACT}" | grep -Eq '^/|(^|/)\.\.(/|$)'; then
  fail "release archive contains an unsafe path"
fi

if tar -tzf "${ARTIFACT}" | grep -Eq '^(\./)?storage(/|$)'; then
  fail "release archive must never contain storage"
fi

rm -rf "${STAGING_RELEASE}"
mkdir -p "${STAGING_RELEASE}"
tar -xzf "${ARTIFACT}" -C "${STAGING_RELEASE}"
[[ -f "${STAGING_RELEASE}/server.mjs" ]] || fail "release does not contain server.mjs"
[[ -f "${STAGING_RELEASE}/dist/index.html" ]] || fail "release does not contain dist/index.html"

rm -rf "${NEW_RELEASE}"
mv "${STAGING_RELEASE}" "${NEW_RELEASE}"

USER_COUNT_BEFORE=0
if [[ -L "${APP_LINK}" ]]; then
  USER_COUNT_BEFORE="$(count_user_records "${PERSISTENT_STORAGE}")"
else
  USER_COUNT_BEFORE="$(count_user_records "${APP_LINK}/storage")"
fi

log "stopping ${SERVICE_NAME} for a consistent storage snapshot and release switch"
systemctl stop "${SERVICE_NAME}"
SERVICE_STOPPED=1

if [[ -L "${APP_LINK}" ]]; then
  backup_storage "${PERSISTENT_STORAGE}" "${USER_COUNT_BEFORE}"
else
  backup_storage "${APP_LINK}/storage" "${USER_COUNT_BEFORE}"

  LEGACY_RELEASE="${RELEASES_DIR}/legacy-${TIMESTAMP}"
  [[ ! -e "${LEGACY_RELEASE}" ]] || fail "legacy release path already exists: ${LEGACY_RELEASE}"

  log "migrating the existing installation into the managed release layout"
  mv "${APP_LINK}" "${LEGACY_RELEASE}"
  PREVIOUS_TARGET="${LEGACY_RELEASE}"

  mv "${LEGACY_RELEASE}/storage" "${PERSISTENT_STORAGE}"
  ln -s "${PERSISTENT_STORAGE}" "${LEGACY_RELEASE}/storage"
fi

USER_COUNT_AFTER_MIGRATION="$(count_user_records "${PERSISTENT_STORAGE}")"
[[ "${USER_COUNT_AFTER_MIGRATION}" == "${USER_COUNT_BEFORE}" ]] \
  || fail "storage record count changed during migration (${USER_COUNT_BEFORE} -> ${USER_COUNT_AFTER_MIGRATION})"

ln -s "${PERSISTENT_STORAGE}" "${NEW_RELEASE}/storage"
[[ "$(readlink -f "${NEW_RELEASE}/storage")" == "$(readlink -f "${PERSISTENT_STORAGE}")" ]] \
  || fail "new release storage link validation failed"

log "switching application to release ${RELEASE_ID}"
switch_app_link "${NEW_RELEASE}"

systemctl start "${SERVICE_NAME}"

healthy=0
for _ in $(seq 1 30); do
  if systemctl is-active --quiet "${SERVICE_NAME}" && curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 1
done

if [[ "${healthy}" -ne 1 ]]; then
  journalctl -u "${SERVICE_NAME}" -n 80 --no-pager >&2 || true
  fail "health check failed: ${HEALTH_URL}"
fi

USER_COUNT_FINAL="$(count_user_records "${PERSISTENT_STORAGE}")"
[[ "${USER_COUNT_FINAL}" -ge "${USER_COUNT_BEFORE}" ]] \
  || fail "storage record count decreased after deployment (${USER_COUNT_BEFORE} -> ${USER_COUNT_FINAL})"

[[ "$(readlink -f "${APP_LINK}/storage")" == "$(readlink -f "${PERSISTENT_STORAGE}")" ]] \
  || fail "active release lost the persistent storage link"

SUCCESS=1
SERVICE_STOPPED=0
prune_old_files

log "deployment successful"
log "release: ${RELEASE_ID}"
log "service: ${SERVICE_NAME}"
log "storage: ${PERSISTENT_STORAGE}"
log "user record files preserved: ${USER_COUNT_FINAL}"
