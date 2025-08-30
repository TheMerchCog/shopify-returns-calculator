/*
  Warnings:

  - You are about to drop the column `returnCosts` on the `SavedReturn` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."SavedReturn" DROP COLUMN "returnCosts",
ADD COLUMN     "handlingFee" DOUBLE PRECISION,
ADD COLUMN     "returnShippingCost" DOUBLE PRECISION;
