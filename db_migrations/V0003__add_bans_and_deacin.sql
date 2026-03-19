
CREATE TABLE t_p9659791_online_messenger_pro.user_bans (
  id SERIAL PRIMARY KEY,
  banner_id INTEGER REFERENCES t_p9659791_online_messenger_pro.users(id),
  target_id INTEGER REFERENCES t_p9659791_online_messenger_pro.users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(banner_id, target_id)
);

INSERT INTO t_p9659791_online_messenger_pro.users (username, display_name, is_verified, is_admin)
VALUES ('deacin', 'Deacin', TRUE, TRUE)
ON CONFLICT (username) DO UPDATE SET is_verified = TRUE, is_admin = TRUE;
