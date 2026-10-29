-- CreateEnum
CREATE TYPE "TableShape" AS ENUM ('ROUND', 'RECT', 'LONG');

-- CreateEnum
CREATE TYPE "GiftKind" AS ENUM ('ITEM', 'QUOTA', 'FREE');

-- CreateEnum
CREATE TYPE "GiftStatus" AS ENUM ('PLEDGED', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ThankYouStatus" AS ENUM ('PENDING', 'SENT', 'NOT_NEEDED');

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Guest" ADD COLUMN     "seatOrder" INTEGER,
ADD COLUMN     "tableId" TEXT;

-- AlterTable
ALTER TABLE "Wedding" ADD COLUMN     "giftsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "giftsWalletId" TEXT,
ADD COLUMN     "guestPhotosEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "guestPhotosMaxPerFamily" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "pixCity" TEXT,
ADD COLUMN     "pixKey" TEXT,
ADD COLUMN     "pixKeyType" TEXT,
ADD COLUMN     "pixReceiverName" TEXT;

-- CreateTable
CREATE TABLE "SeatingTable" (
    "id" TEXT NOT NULL,
    "weddingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shape" "TableShape" NOT NULL DEFAULT 'ROUND',
    "capacity" INTEGER NOT NULL DEFAULT 8,
    "x" INTEGER NOT NULL DEFAULT 100,
    "y" INTEGER NOT NULL DEFAULT 100,
    "rotation" INTEGER NOT NULL DEFAULT 0,
    "zone" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "SeatingTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftItem" (
    "id" TEXT NOT NULL,
    "weddingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imageFileId" TEXT,
    "kind" "GiftKind" NOT NULL DEFAULT 'ITEM',
    "priceCents" INTEGER,
    "quotaCount" INTEGER,
    "externalUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "GiftItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftContribution" (
    "id" TEXT NOT NULL,
    "weddingId" TEXT NOT NULL,
    "giftItemId" TEXT,
    "groupId" TEXT,
    "guestId" TEXT,
    "giverName" TEXT NOT NULL,
    "message" TEXT,
    "physicalDescription" TEXT,
    "amountCents" INTEGER,
    "quotas" INTEGER,
    "method" "PaymentMethod",
    "status" "GiftStatus" NOT NULL DEFAULT 'PLEDGED',
    "source" TEXT NOT NULL DEFAULT 'PORTAL',
    "incomeId" TEXT,
    "thankYouStatus" "ThankYouStatus" NOT NULL DEFAULT 'PENDING',
    "thankYouSentAt" TIMESTAMPTZ,
    "thankYouNote" TEXT,
    "submissionKey" TEXT,
    "ip" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "GiftContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestPhoto" (
    "id" TEXT NOT NULL,
    "weddingId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "groupId" TEXT,
    "uploaderName" TEXT NOT NULL,
    "caption" TEXT,
    "status" "ModerationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMPTZ,
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "lastUsedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSecret" (
    "key" TEXT NOT NULL,
    "valueEnc" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "SystemSecret_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "weddingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "url" TEXT,
    "readAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SeatingTable_weddingId_idx" ON "SeatingTable"("weddingId");

-- CreateIndex
CREATE INDEX "GiftItem_weddingId_idx" ON "GiftItem"("weddingId");

-- CreateIndex
CREATE UNIQUE INDEX "GiftContribution_incomeId_key" ON "GiftContribution"("incomeId");

-- CreateIndex
CREATE UNIQUE INDEX "GiftContribution_submissionKey_key" ON "GiftContribution"("submissionKey");

-- CreateIndex
CREATE INDEX "GiftContribution_weddingId_status_idx" ON "GiftContribution"("weddingId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GuestPhoto_fileId_key" ON "GuestPhoto"("fileId");

-- CreateIndex
CREATE INDEX "GuestPhoto_weddingId_status_idx" ON "GuestPhoto"("weddingId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "NotificationLog_userId_createdAt_idx" ON "NotificationLog"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationLog_userId_dedupeKey_key" ON "NotificationLog"("userId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "SeatingTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatingTable" ADD CONSTRAINT "SeatingTable_weddingId_fkey" FOREIGN KEY ("weddingId") REFERENCES "Wedding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftItem" ADD CONSTRAINT "GiftItem_weddingId_fkey" FOREIGN KEY ("weddingId") REFERENCES "Wedding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftContribution" ADD CONSTRAINT "GiftContribution_weddingId_fkey" FOREIGN KEY ("weddingId") REFERENCES "Wedding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftContribution" ADD CONSTRAINT "GiftContribution_giftItemId_fkey" FOREIGN KEY ("giftItemId") REFERENCES "GiftItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftContribution" ADD CONSTRAINT "GiftContribution_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "GuestGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftContribution" ADD CONSTRAINT "GiftContribution_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftContribution" ADD CONSTRAINT "GiftContribution_incomeId_fkey" FOREIGN KEY ("incomeId") REFERENCES "Income"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestPhoto" ADD CONSTRAINT "GuestPhoto_weddingId_fkey" FOREIGN KEY ("weddingId") REFERENCES "Wedding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestPhoto" ADD CONSTRAINT "GuestPhoto_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "GuestGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
