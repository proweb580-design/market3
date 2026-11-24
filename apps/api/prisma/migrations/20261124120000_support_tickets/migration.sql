-- CreateEnum
CREATE TYPE "app"."SupportTicketStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'RESOLVED');

-- CreateTable
CREATE TABLE "app"."support_tickets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "order_number" TEXT,
    "topic" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "app"."SupportTicketStatus" NOT NULL DEFAULT 'NEW',
    "assignee" TEXT,
    "telegram_chat_id" BIGINT,
    "telegram_message_id" INTEGER,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_tickets_organization_id_status_created_at_idx" ON "app"."support_tickets"("organization_id", "status", "created_at");

-- AddForeignKey
ALTER TABLE "app"."support_tickets" ADD CONSTRAINT "support_tickets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
