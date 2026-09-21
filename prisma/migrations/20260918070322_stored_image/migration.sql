-- CreateTable
CREATE TABLE "StoredImage" (
    "key" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredImage_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "StoredImage_createdAt_idx" ON "StoredImage"("createdAt");
