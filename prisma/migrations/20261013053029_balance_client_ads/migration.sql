-- CreateEnum
CREATE TYPE "BalanceEntryType" AS ENUM ('TOPUP', 'AD_FUNDING', 'AD_REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "FundingKind" AS ENUM ('CREATE_AD', 'ADD_BUDGET', 'CLOSE_AD');

-- CreateEnum
CREATE TYPE "FundingStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "balanceUzs" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "clientId" INTEGER NOT NULL DEFAULT (floor(random() * 90000000) + 10000000)::int;

-- CreateTable
CREATE TABLE "BalanceEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "BalanceEntryType" NOT NULL,
    "amountUzs" DECIMAL(14,2) NOT NULL,
    "balanceAfterUzs" DECIMAL(14,2) NOT NULL,
    "adId" INTEGER,
    "operationId" TEXT,
    "source" TEXT,
    "externalId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingOperation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "FundingKind" NOT NULL,
    "status" "FundingStatus" NOT NULL DEFAULT 'PENDING',
    "adId" INTEGER,
    "amountUzs" DECIMAL(14,2) NOT NULL,
    "amountTon" DECIMAL(18,5) NOT NULL,
    "request" JSONB NOT NULL,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "notBefore" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundingOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientAd" (
    "adId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "fundedUzs" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "fundedTon" DECIMAL(18,5) NOT NULL DEFAULT 0,
    "spentUzs" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "refundedUzs" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientAd_pkey" PRIMARY KEY ("adId")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "BalanceEntry_userId_createdAt_idx" ON "BalanceEntry"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BalanceEntry_source_externalId_key" ON "BalanceEntry"("source", "externalId");

-- CreateIndex
CREATE INDEX "FundingOperation_status_idx" ON "FundingOperation"("status");

-- CreateIndex
CREATE INDEX "FundingOperation_userId_idx" ON "FundingOperation"("userId");

-- CreateIndex
CREATE INDEX "ClientAd_userId_idx" ON "ClientAd"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_clientId_key" ON "User"("clientId");

-- AddForeignKey
ALTER TABLE "BalanceEntry" ADD CONSTRAINT "BalanceEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingOperation" ADD CONSTRAINT "FundingOperation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAd" ADD CONSTRAINT "ClientAd_adId_fkey" FOREIGN KEY ("adId") REFERENCES "Ad"("adId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAd" ADD CONSTRAINT "ClientAd_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Bo'sh balans hech qachon manfiy bo'lmaydi — kod xato qilsa ham baza rad etadi.
ALTER TABLE "User" ADD CONSTRAINT "User_balanceUzs_nonnegative" CHECK ("balanceUzs" >= 0);
