"""
Основной API мессенджера: авторизация, чаты, сообщения.
"""
import json
import os
import psycopg2

SCHEMA = "t_p9659791_online_messenger_pro"

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-User-Id",
    "Content-Type": "application/json",
}


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def resp(status, data):
    return {"statusCode": status, "headers": CORS_HEADERS, "body": json.dumps(data, default=str)}


def handler(event: dict, context) -> dict:
    """Обрабатывает все запросы мессенджера."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    method = event.get("httpMethod", "GET")
    path = event.get("path", "/")
    params = event.get("queryStringParameters") or {}
    body = {}
    if event.get("body"):
        body = json.loads(event["body"])

    user_id = event.get("headers", {}).get("X-User-Id") or params.get("user_id")

    conn = get_conn()
    cur = conn.cursor()

    try:
        # POST /login — регистрация или вход
        if method == "POST" and path.endswith("/login"):
            username = body.get("username", "").strip().lower()
            display_name = body.get("display_name", "").strip()
            if not username or not display_name:
                return resp(400, {"error": "Укажи username и display_name"})

            cur.execute(
                f"INSERT INTO {SCHEMA}.users (username, display_name) VALUES (%s, %s) "
                f"ON CONFLICT (username) DO UPDATE SET display_name = EXCLUDED.display_name "
                f"RETURNING id, username, display_name",
                (username, display_name),
            )
            row = cur.fetchone()
            conn.commit()
            return resp(200, {"id": row[0], "username": row[1], "display_name": row[2]})

        # GET /users — поиск пользователей
        if method == "GET" and path.endswith("/users"):
            q = params.get("q", "").strip().lower()
            cur.execute(
                f"SELECT id, username, display_name FROM {SCHEMA}.users "
                f"WHERE username LIKE %s AND id != %s LIMIT 20",
                (f"%{q}%", user_id or 0),
            )
            rows = cur.fetchall()
            return resp(200, [{"id": r[0], "username": r[1], "display_name": r[2]} for r in rows])

        # GET /chats — список чатов пользователя
        if method == "GET" and path.endswith("/chats"):
            if not user_id:
                return resp(401, {"error": "Требуется авторизация"})
            cur.execute(
                f"""
                SELECT c.id,
                       u.id as partner_id, u.username, u.display_name,
                       (SELECT content FROM {SCHEMA}.messages m WHERE m.chat_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_msg,
                       (SELECT created_at FROM {SCHEMA}.messages m WHERE m.chat_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_at
                FROM {SCHEMA}.chats c
                JOIN {SCHEMA}.chat_members cm ON cm.chat_id = c.id AND cm.user_id = %s
                JOIN {SCHEMA}.chat_members cm2 ON cm2.chat_id = c.id AND cm2.user_id != %s
                JOIN {SCHEMA}.users u ON u.id = cm2.user_id
                ORDER BY last_at DESC NULLS LAST
                """,
                (user_id, user_id),
            )
            rows = cur.fetchall()
            return resp(200, [
                {"chat_id": r[0], "partner_id": r[1], "partner_username": r[2],
                 "partner_display_name": r[3], "last_message": r[4], "last_at": r[5]}
                for r in rows
            ])

        # POST /chats — создать или найти чат с пользователем
        if method == "POST" and path.endswith("/chats"):
            if not user_id:
                return resp(401, {"error": "Требуется авторизация"})
            partner_id = body.get("partner_id")
            if not partner_id:
                return resp(400, {"error": "Укажи partner_id"})

            # Ищем существующий чат между двумя пользователями
            cur.execute(
                f"""
                SELECT c.id FROM {SCHEMA}.chats c
                JOIN {SCHEMA}.chat_members cm1 ON cm1.chat_id = c.id AND cm1.user_id = %s
                JOIN {SCHEMA}.chat_members cm2 ON cm2.chat_id = c.id AND cm2.user_id = %s
                LIMIT 1
                """,
                (user_id, partner_id),
            )
            row = cur.fetchone()
            if row:
                return resp(200, {"chat_id": row[0], "created": False})

            cur.execute(f"INSERT INTO {SCHEMA}.chats DEFAULT VALUES RETURNING id")
            chat_id = cur.fetchone()[0]
            cur.execute(f"INSERT INTO {SCHEMA}.chat_members (chat_id, user_id) VALUES (%s, %s)", (chat_id, user_id))
            cur.execute(f"INSERT INTO {SCHEMA}.chat_members (chat_id, user_id) VALUES (%s, %s)", (chat_id, partner_id))
            conn.commit()
            return resp(200, {"chat_id": chat_id, "created": True})

        # GET /messages — сообщения чата
        if method == "GET" and path.endswith("/messages"):
            chat_id = params.get("chat_id")
            after_id = params.get("after_id", 0)
            if not chat_id:
                return resp(400, {"error": "Укажи chat_id"})
            cur.execute(
                f"""
                SELECT m.id, m.content, m.created_at, u.id, u.display_name
                FROM {SCHEMA}.messages m
                JOIN {SCHEMA}.users u ON u.id = m.sender_id
                WHERE m.chat_id = %s AND m.id > %s
                ORDER BY m.created_at ASC
                LIMIT 100
                """,
                (chat_id, after_id),
            )
            rows = cur.fetchall()
            return resp(200, [
                {"id": r[0], "content": r[1], "created_at": r[2],
                 "sender_id": r[3], "sender_name": r[4]}
                for r in rows
            ])

        # POST /messages — отправить сообщение
        if method == "POST" and path.endswith("/messages"):
            if not user_id:
                return resp(401, {"error": "Требуется авторизация"})
            chat_id = body.get("chat_id")
            content = body.get("content", "").strip()
            if not chat_id or not content:
                return resp(400, {"error": "Укажи chat_id и content"})
            cur.execute(
                f"INSERT INTO {SCHEMA}.messages (chat_id, sender_id, content) VALUES (%s, %s, %s) "
                f"RETURNING id, created_at",
                (chat_id, user_id, content),
            )
            row = cur.fetchone()
            conn.commit()
            return resp(200, {"id": row[0], "created_at": row[1]})

        return resp(404, {"error": "Маршрут не найден"})

    finally:
        cur.close()
        conn.close()
