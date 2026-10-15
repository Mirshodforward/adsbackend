-- Optimizator (tavsiyalar) olib tashlandi: e'lonlar admin panelida to'g'ridan-to'g'ri boshqariladi.

-- DropForeignKey
ALTER TABLE "Recommendation" DROP CONSTRAINT "Recommendation_adId_fkey";

-- DropTable
DROP TABLE "Recommendation";

-- DropEnum
DROP TYPE "RecommendationKind";

-- DropEnum
DROP TYPE "RecommendationStatus";
