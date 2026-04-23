ALTER TABLE profiles ADD COLUMN IF NOT EXISTS briefing_scope text NOT NULL DEFAULT 'today_new';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS calendar_send_invites boolean NOT NULL DEFAULT true;;
