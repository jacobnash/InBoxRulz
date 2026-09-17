-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('gmail', 'outlook', 'icloud', 'fastmail', 'zoho', 'imap');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('pending', 'active', 'needs_reauth', 'disabled');

-- CreateEnum
CREATE TYPE "RuleType" AS ENUM ('promo_archive', 'receipts_file', 'delivered_trash', 'retention_purge', 'rescue');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('running', 'succeeded', 'failed', 'partial');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('archive', 'trash', 'label', 'unlabel', 'restore_to_inbox', 'mark_read');

-- CreateTable
CREATE TABLE "connected_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "display_name" TEXT NOT NULL,
    "encrypted_credentials" TEXT NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'pending',
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connected_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" TEXT NOT NULL,
    "connected_account_id" TEXT NOT NULL,
    "type" "RuleType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runs" (
    "id" TEXT NOT NULL,
    "connected_account_id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'scheduled',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "status" "RunStatus" NOT NULL DEFAULT 'running',
    "error" TEXT,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_actions" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "action" "ActionType" NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "connected_accounts_user_id_idx" ON "connected_accounts"("user_id");

-- CreateIndex
CREATE INDEX "rules_connected_account_id_idx" ON "rules"("connected_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "rules_connected_account_id_type_key" ON "rules"("connected_account_id", "type");

-- CreateIndex
CREATE INDEX "runs_connected_account_id_started_at_idx" ON "runs"("connected_account_id", "started_at");

-- CreateIndex
CREATE INDEX "run_actions_run_id_idx" ON "run_actions"("run_id");

-- CreateIndex
CREATE INDEX "run_actions_thread_id_idx" ON "run_actions"("thread_id");

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_connected_account_id_fkey" FOREIGN KEY ("connected_account_id") REFERENCES "connected_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_connected_account_id_fkey" FOREIGN KEY ("connected_account_id") REFERENCES "connected_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_actions" ADD CONSTRAINT "run_actions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_actions" ADD CONSTRAINT "run_actions_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
