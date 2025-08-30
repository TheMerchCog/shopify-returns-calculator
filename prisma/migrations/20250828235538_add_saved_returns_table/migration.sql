-- CreateTable
CREATE TABLE "public"."SavedReturn" (
    "id" SERIAL NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyOrderName" TEXT NOT NULL,
    "netProfitChange" DOUBLE PRECISION NOT NULL,
    "totalRevenueLost" DOUBLE PRECISION NOT NULL,
    "returnCosts" DOUBLE PRECISION NOT NULL,
    "inventoryValue" DOUBLE PRECISION NOT NULL,
    "isResellable" BOOLEAN NOT NULL,
    "suggestion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedReturn_pkey" PRIMARY KEY ("id")
);
