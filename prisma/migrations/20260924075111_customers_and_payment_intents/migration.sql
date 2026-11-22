-- CreateEnum
CREATE TYPE "PaymentChannel" AS ENUM ('ONLINE', 'PAY_AT_TABLE', 'WAITER_ASSISTED');

-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('PAYMENT_PENDING', 'PAYMENT_SUCCESS', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CollectionMethod" AS ENUM ('CASH', 'CARD', 'UPI');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('NONE', 'PARTIAL', 'FULL');

-- CreateEnum
CREATE TYPE "CancelSource" AS ENUM ('CUSTOMER', 'STAFF');

-- AlterTable
ALTER TABLE "dining_sessions" ADD COLUMN     "customerId" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "cancelSource" "CancelSource",
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "refundStatus" "RefundStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "refundedAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "refundPercent" DECIMAL(5,2),
ADD COLUMN     "refundedAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "refundedAt" TIMESTAMP(3),
ADD COLUMN     "refundedByUserId" TEXT;

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" TEXT NOT NULL,
    "diningSessionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "collectorWaiterId" TEXT,
    "orderId" TEXT,
    "channel" "PaymentChannel" NOT NULL,
    "collectionMethod" "CollectionMethod",
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'PAYMENT_PENDING',
    "provider" TEXT,
    "providerReference" TEXT,
    "cartSnapshot" JSONB NOT NULL,
    "subtotalAmount" DECIMAL(10,2) NOT NULL,
    "taxPercentage" DECIMAL(5,2) NOT NULL,
    "taxAmount" DECIMAL(10,2) NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "customers_email_key" ON "customers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_orderId_key" ON "payment_intents"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_providerReference_key" ON "payment_intents"("providerReference");

-- CreateIndex
CREATE INDEX "payment_intents_diningSessionId_status_idx" ON "payment_intents"("diningSessionId", "status");

-- CreateIndex
CREATE INDEX "payment_intents_collectorWaiterId_status_idx" ON "payment_intents"("collectorWaiterId", "status");

-- CreateIndex
CREATE INDEX "dining_sessions_customerId_idx" ON "dining_sessions"("customerId");

-- CreateIndex
CREATE INDEX "orders_customerId_idx" ON "orders"("customerId");

-- AddForeignKey
ALTER TABLE "dining_sessions" ADD CONSTRAINT "dining_sessions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_diningSessionId_fkey" FOREIGN KEY ("diningSessionId") REFERENCES "dining_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_collectorWaiterId_fkey" FOREIGN KEY ("collectorWaiterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_refundedByUserId_fkey" FOREIGN KEY ("refundedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
