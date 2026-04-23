ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS use_count integer NOT NULL DEFAULT 0;
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS importance text NOT NULL DEFAULT 'normal';
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS last_used_at timestamptz;;
