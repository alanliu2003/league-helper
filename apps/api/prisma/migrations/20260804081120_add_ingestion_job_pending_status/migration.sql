-- AlterEnum
-- PostgreSQL requires new enum values to be committed before use as column defaults.
ALTER TYPE "IngestionJobStatus" ADD VALUE 'PENDING';
