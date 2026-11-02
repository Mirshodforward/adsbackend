-- CreateEnum
CREATE TYPE "ShopProduct" AS ENUM ('STARS', 'PREMIUM', 'GIFT');

-- CreateEnum
CREATE TYPE "ShopOrderStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BalanceEntryType" ADD VALUE 'SHOP_PURCHASE';
ALTER TYPE "BalanceEntryType" ADD VALUE 'SHOP_REFUND';

-- CreateTable
CREATE TABLE "ShopOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "product" "ShopProduct" NOT NULL,
    "recipient" TEXT NOT NULL,
    "recipientName" TEXT,
    "quantity" INTEGER NOT NULL,
    "giftId" TEXT,
    "giftEmoji" TEXT,
    "giftStars" INTEGER,
    "message" TEXT,
    "hideName" BOOLEAN NOT NULL DEFAULT false,
    "priceUzs" DECIMAL(14,2) NOT NULL,
    "costUsdt" DECIMAL(18,6),
    "status" "ShopOrderStatus" NOT NULL DEFAULT 'PROCESSING',
    "partnerOrderId" INTEGER,
    "transactionId" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "attemptedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShopOrder_userId_createdAt_idx" ON "ShopOrder"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ShopOrder_status_attemptedAt_idx" ON "ShopOrder"("status", "attemptedAt");

-- AddForeignKey
ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
