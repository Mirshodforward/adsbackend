-- CreateEnum
CREATE TYPE "RecommendationKind" AS ENUM ('ADD_BUDGET', 'PAUSE', 'RAISE_CPM');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('PENDING', 'APPLIED', 'DISMISSED', 'EXPIRED', 'FAILED');

-- CreateTable
CREATE TABLE "Ad" (
    "adId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "promoteUrl" TEXT NOT NULL,
    "placement" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "isPaused" BOOLEAN NOT NULL,
    "actionType" TEXT,
    "currency" TEXT NOT NULL,
    "cpm" DECIMAL(18,5) NOT NULL,
    "dailyBudgetLimit" DECIMAL(18,5),
    "spentBudget" DECIMAL(18,5) NOT NULL,
    "remainingBudget" DECIMAL(18,5) NOT NULL,
    "views" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "actions" INTEGER NOT NULL,
    "declineReason" TEXT,
    "raw" JSONB NOT NULL,
    "createdDate" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ad_pkey" PRIMARY KEY ("adId")
);

-- CreateTable
CREATE TABLE "AdStat" (
    "adId" INTEGER NOT NULL,
    "fromTime" TIMESTAMP(3) NOT NULL,
    "views" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "actions" INTEGER NOT NULL,
    "spent" DECIMAL(18,5) NOT NULL,

    CONSTRAINT "AdStat_pkey" PRIMARY KEY ("adId","fromTime")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "adId" INTEGER NOT NULL,
    "kind" "RecommendationKind" NOT NULL,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "change" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Recommendation_status_idx" ON "Recommendation"("status");

-- CreateIndex
CREATE INDEX "Recommendation_adId_kind_status_idx" ON "Recommendation"("adId", "kind", "status");

-- AddForeignKey
ALTER TABLE "AdStat" ADD CONSTRAINT "AdStat_adId_fkey" FOREIGN KEY ("adId") REFERENCES "Ad"("adId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_adId_fkey" FOREIGN KEY ("adId") REFERENCES "Ad"("adId") ON DELETE CASCADE ON UPDATE CASCADE;
