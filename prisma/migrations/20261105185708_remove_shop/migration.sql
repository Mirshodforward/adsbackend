-- AlterEnum
BEGIN;
CREATE TYPE "BalanceEntryType_new" AS ENUM ('TOPUP', 'AD_FUNDING', 'AD_REFUND', 'ADJUSTMENT');
ALTER TABLE "BalanceEntry" ALTER COLUMN "type" TYPE "BalanceEntryType_new" USING ("type"::text::"BalanceEntryType_new");
ALTER TYPE "BalanceEntryType" RENAME TO "BalanceEntryType_old";
ALTER TYPE "BalanceEntryType_new" RENAME TO "BalanceEntryType";
DROP TYPE "public"."BalanceEntryType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "ShopOrder" DROP CONSTRAINT "ShopOrder_userId_fkey";

-- DropTable
DROP TABLE "ShopOrder";

-- DropEnum
DROP TYPE "ShopOrderStatus";

-- DropEnum
DROP TYPE "ShopProduct";

