
CREATE TABLE t_p9659791_online_messenger_pro.users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE t_p9659791_online_messenger_pro.chats (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE t_p9659791_online_messenger_pro.chat_members (
  id SERIAL PRIMARY KEY,
  chat_id INTEGER REFERENCES t_p9659791_online_messenger_pro.chats(id),
  user_id INTEGER REFERENCES t_p9659791_online_messenger_pro.users(id),
  joined_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(chat_id, user_id)
);

CREATE TABLE t_p9659791_online_messenger_pro.messages (
  id SERIAL PRIMARY KEY,
  chat_id INTEGER REFERENCES t_p9659791_online_messenger_pro.chats(id),
  sender_id INTEGER REFERENCES t_p9659791_online_messenger_pro.users(id),
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_messages_chat_id ON t_p9659791_online_messenger_pro.messages(chat_id);
CREATE INDEX idx_chat_members_user_id ON t_p9659791_online_messenger_pro.chat_members(user_id);
