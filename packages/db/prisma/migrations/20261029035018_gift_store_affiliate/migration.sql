-- AlterEnum
ALTER TYPE "GiftKind" ADD VALUE 'STORE';

-- AlterTable
ALTER TABLE "GiftItem" ADD COLUMN     "clickCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Wedding" ADD COLUMN     "amazonAffiliateTag" TEXT;
