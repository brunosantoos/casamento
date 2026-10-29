-- AlterTable
ALTER TABLE "Wedding" ADD COLUMN     "coverFileId" TEXT,
ADD COLUMN     "coverPosition" TEXT NOT NULL DEFAULT 'center',
ADD COLUMN     "partner1PhotoFileId" TEXT,
ADD COLUMN     "partner2PhotoFileId" TEXT,
ADD COLUMN     "portalGalleryFileIds" TEXT[];
