-- ============================================================
-- Task 7 DocumentModule schema 调整
--   1. enum DocumentStatus 新增 ARCHIVED
--   2. model Document 新增 processedAt DateTime?
-- ============================================================

-- ============================================================
-- ⚠️ PostgreSQL 限制:ALTER TYPE ... ADD VALUE 不能在事务内执行。
-- Prisma migrate deploy 会把整个 migration.sql 包成一个事务,
-- 因此本文件只提交 ALTER TABLE,ALTER TYPE 留给运维手动跑一次。
-- ============================================================
-- 部署步骤:
--   1. 单独跑(autocommit 模式):
--        ALTER TYPE "DocumentStatus" ADD VALUE 'ARCHIVED';
--   2. 再跑本迁移:
--        pnpm --filter backend prisma migrate deploy
-- 备注:PostgreSQL 12+ 的 ADD VALUE 可以 IF NOT EXISTS,但仍需 autocommit。
-- ============================================================

-- AlterEnum(运维手动,不在事务)
-- ALTER TYPE "DocumentStatus" ADD VALUE 'ARCHIVED';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN "processedAt" TIMESTAMP(3);

