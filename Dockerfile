# ─── Build ────────────────────────────────────────────────────────────────────
FROM node:24-slim AS builder
WORKDIR /app

# Prisma schema-engine (migratsiyalar) uchun openssl
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# `postinstall: prisma generate` sxema hali yo'qligida yiqiladi — skriptlarsiz
# o'rnatib, generate'ni pastda qo'lda chaqiramiz.
RUN npm ci --ignore-scripts

COPY . .

# prisma.config.ts DATABASE_URL'siz yuklanmaydi; generate va diff bazaga ulanmaydi.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
# Kichik serverda (1 GB RAM) build V8 heap chegarasiga urilmasin.
ENV NODE_OPTIONS=--max-old-space-size=896
RUN npx prisma generate
RUN npx nest build
# Schema-engine'ni hozir yuklab olamiz (bazasiz diff uni talab qiladi). Aks holda
# har `migrate deploy` konteyneri uni internetdan qaytadan yuklardi.
RUN npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > /dev/null

# ─── Runtime ──────────────────────────────────────────────────────────────────
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# Biznes vaqti — Toshkent. Sozlanmasa "bugun" va oy chegaralari 5 soat siljiydi.
ENV TZ=Asia/Tashkent

RUN apt-get update -y && apt-get install -y openssl tzdata && rm -rf /var/lib/apt/lists/*

# node_modules to'liq: prisma CLI (migratsiya) va tsx (`npm run ads:check`)
# serverda ham kerak. src — diagnostika skriptlari undan import qiladi.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts /app/tsconfig.json /app/package.json ./

EXPOSE 4000
CMD ["node", "dist/main.js"]
