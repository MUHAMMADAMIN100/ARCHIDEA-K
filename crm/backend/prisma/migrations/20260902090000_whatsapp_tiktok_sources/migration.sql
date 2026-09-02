-- Новые источники обращения: WhatsApp и TikTok (просьба владельца).
-- Только добавление значений перечисления — существующие данные не меняются.
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'WHATSAPP';
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'TIKTOK';
