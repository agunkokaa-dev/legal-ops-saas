-- Migration 008: Add currency column to contracts
-- Description: Adds a currency column to store ISO 4217 codes (e.g., USD, IDR)
-- Date: 2026-03-18

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS currency text DEFAULT 'USD';

-- Update existing records: if title contains 'SOW_Aplikasi_Kasir' or value is large, maybe it's IDR
-- But for safety, we'll just set a default and let the AI re-extract if needed.
-- For the specific request: 
UPDATE contracts SET currency = 'IDR' WHERE title ILIKE '%SOW_Aplikasi_Kasir%';

NOTIFY pgrst, 'reload schema';
