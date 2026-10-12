#!/usr/bin/env bash
# ─── Serverda backendni yangilash ────────────────────────────────────────────
# Ishlatish (server ichida, repo'ning backend/ papkasida):
#
#   ./deploy.sh           # git pull → build → migratsiya → restart → health check
#   ./deploy.sh --force   # yangi commit bo'lmasa ham (masalan, birinchi deploy)
#
# Health check yiqilsa — kod oldingi commitga qaytadi. Migratsiyalar
# QAYTARILMAYDI: shuning uchun ular faqat qo'shuvchi bo'lsin (ustun o'chirish
# alohida, keyingi relizda).
set -euo pipefail

BRANCH="${BRANCH:-main}"
COMPOSE=(docker compose -f docker-compose.prod.yml)
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

health_check() {
  for i in $(seq 1 "$HEALTH_RETRIES"); do
    if "${COMPOSE[@]}" exec -T backend node -e "
      fetch('http://127.0.0.1:4000/api/health')
        .then(r => process.exit(r.ok ? 0 : 1))
        .catch(() => process.exit(1))
    " >/dev/null 2>&1; then
      ok "Health OK (${i}-urinish)"
      return 0
    fi
    sleep "$HEALTH_DELAY"
  done
  return 1
}

release() {
  "${COMPOSE[@]}" build backend
  # Migratsiya eski konteyner hali ishlab turganda bajariladi: yiqilsa,
  # ishlayotgan versiyaga tegilmaydi.
  "${COMPOSE[@]}" run --rm backend npx prisma migrate deploy
  "${COMPOSE[@]}" up -d
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

# ─── 2. Build, migratsiya, ishga tushirish ───────────────────────────────────
log "Build va migratsiya"
release

# ─── 3. Tekshiruv / rollback ─────────────────────────────────────────────────
log "Health check"
if ! health_check; then
  err "Health check yiqildi — ${PREV_COMMIT:0:7} ga qaytilmoqda"
  "${COMPOSE[@]}" logs --tail=50 backend || true
  git reset --hard "$PREV_COMMIT"
  "${COMPOSE[@]}" up -d --build backend
  exit 1
fi

ok "Deploy tugadi: $(git log -1 --format='%h %s')"
