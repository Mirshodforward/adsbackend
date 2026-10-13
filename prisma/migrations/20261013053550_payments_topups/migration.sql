-- CreateEnum
CREATE TYPE "TopupMethod" AS ENUM ('CLICK', 'PAYME', 'UZUM', 'PAYNET', 'CARD', 'STARS', 'SBP');

-- CreateEnum
CREATE TYPE "TopupStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'CANCELLED', 'FAILED', 'REFUNDED');

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "clientId" SET DEFAULT (floor(random() * 90000000) + 10000000)::int;

-- CreateTable
CREATE TABLE "Topup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" "TopupMethod" NOT NULL,
    "creditUzs" DECIMAL(14,2) NOT NULL,
    "payUzs" DECIMAL(14,2) NOT NULL,
    "status" "TopupStatus" NOT NULL DEFAULT 'PENDING',
    "paylinkerInvoiceId" TEXT,
    "accountNumber" TEXT,
    "payUrl" TEXT,
    "cardLast4" TEXT,
    "error" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Topup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Topup_paylinkerInvoiceId_key" ON "Topup"("paylinkerInvoiceId");

-- CreateIndex
CREATE INDEX "Topup_userId_createdAt_idx" ON "Topup"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Topup_status_expiresAt_idx" ON "Topup"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Topup_method_status_payUzs_idx" ON "Topup"("method", "status", "payUzs");

-- AddForeignKey
ALTER TABLE "Topup" ADD CONSTRAINT "Topup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
