
ALTER TABLE t_p9659791_online_messenger_pro.users
  ADD COLUMN avatar_url TEXT,
  ADD COLUMN is_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN is_admin BOOLEAN DEFAULT FALSE;

ALTER TABLE t_p9659791_online_messenger_pro.messages
  ADD COLUMN msg_type VARCHAR(20) DEFAULT 'text',
  ADD COLUMN file_url TEXT,
  ADD COLUMN is_removed BOOLEAN DEFAULT FALSE;
