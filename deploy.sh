#!/usr/bin/env bash
# ─── Serverda backendni yangilash (pm2 + nginx) ──────────────────────────────
# Ishlatish (appuser sifatida, repo papkasida):
#
#   ./deploy.sh           # git pull → npm ci → build → migratsiya → pm2 reload → health check
#   ./deploy.sh --force   # yangi commit bo'lmasa ham (masalan, birinchi deploy)
#
# Migratsiya yoki health check yiqilsa — kod oldingi commitga qaytadi va qayta
# build qilinadi. Migratsiyalar QAYTARILMAYDI: ular faqat qo'shuvchi bo'lsin.
set -euo pipefail

BRANCH="${BRANCH:-main}"
HEALTH_RETRIES=20
HEALTH_DELAY=3

FORCE=false
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
    *) echo "Noma'lum argument: $arg (--force)"; exit 2 ;;
  esac
done

cd "$(dirname "$0")"

log() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()  { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
err() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; }

[[ -f .env ]] || { err ".env topilmadi — .env.production.example dan nusxa oling"; exit 1; }
PORT="$(grep -E '^PORT=' .env | cut -d= -f2)"
PORT="${PORT:-4000}"

# Server kichik va boshqa ilovalar bilan umumiy: build ularni bo'g'ib
# qo'ymasligi uchun past ustuvorlikda va V8 heap chegarasi bilan.
build() {
  nice -n 10 npm ci --no-audit --no-fund
  NODE_OPTIONS=--max-old-space-size=512 nice -n 10 npm run build
}

start() {
  pm2 startOrReload ecosystem.config.cjs --update-env
  pm2 save >/dev/null
}

health_check() {
  for i in $(seq 1 "$HEALTH_RETRIES"); do
    if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
      ok "Health OK (${i}-urinish)"
      return 0
    fi
    sleep "$HEALTH_DELAY"
  done
  return 1
}

rollback() {
  err "$1 — ${PREV_COMMIT:0:7} ga qaytilmoqda"
  git reset --hard "$PREV_COMMIT"
  build
  start
  exit 1
}

# ─── 1. Kod ──────────────────────────────────────────────────────────────────
log "Kod yangilanmoqda ($BRANCH)"
PREV_COMMIT="$(git rev-parse HEAD)"
git fetch --prune origin "$BRANCH"
NEW_COMMIT="$(git rev-parse "origin/$BRANCH")"

if [[ "$PREV_COMMIT" == "$NEW_COMMIT" && "$FORCE" != true ]]; then
  ok "Allaqachon eng so'nggi versiya ($(git log -1 --format='%h %s'))"
  exit 0
fi
git merge --ff-only "origin/$BRANCH"

# ─── 2. Build va migratsiya ──────────────────────────────────────────────────
log "Build"
build

log "Migratsiya"
npx prisma migrate deploy || rollback "Migratsiya yiqildi"

# ─── 3. Ishga tushirish va tekshiruv ─────────────────────────────────────────
log "pm2 reload"
start

log "Health check"
health_check || rollback "Health check yiqildi"

ok "Deploy tugadi: $(git log -1 --format='%h %s')"
