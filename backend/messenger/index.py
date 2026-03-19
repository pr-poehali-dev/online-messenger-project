"""
Основной API мессенджера: авторизация, чаты, сообщения, медиа, баны, удаление.
"""
import json
import os
import base64
import mimetypes
import psycopg2
import boto3

SCHEMA = "t_p9659791_online_messenger_pro"

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-User-Id",
    "Content-Type": "application/json",
}


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def get_s3():
    return boto3.client(
        "s3",
        endpoint_url="https://bucket.poehali.dev",
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
    )


def cdn_url(key: str) -> str:
    return f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"


def resp(status, data):
    return {"statusCode": status, "headers": CORS_HEADERS, "body": json.dumps(data, default=str)}


def handler(event: dict, context) -> dict:
    """Обрабатывает все запросы мессенджера."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    method = event.get("httpMethod", "GET")
    params = event.get("queryStringParameters") or {}
    action = params.get("action", "")
    path = "/" + action if action else event.get("path", "/")
    body = {}
    if event.get("body"):
        body = json.loads(event["body"])
    print(f"[ROUTE] method={method} path={path}")

    user_id = event.get("headers", {}).get("X-User-Id") or params.get("user_id")

    conn = get_conn()
    cur = conn.cursor()

    try:
        # POST /login
        if method == "POST" and path.endswith("/login"):
            username = body.get("username", "").strip().lower()
            display_name = body.get("display_name", "").strip()
            if not username or not display_name:
                return resp(400, {"error": "Укажи username и display_name"})
            cur.execute(
                f"INSERT INTO {SCHEMA}.users (username, display_name) VALUES (%s, %s) "
                f"ON CONFLICT (username) DO UPDATE SET display_name = "
                f"CASE WHEN {SCHEMA}.users.is_admin THEN {SCHEMA}.users.display_name ELSE EXCLUDED.display_name END "
                f"RETURNING id, username, display_name, avatar_url, is_verified, is_admin",
                (username, display_name),
            )
            row = cur.fetchone()
            conn.commit()
            return resp(200, {
                "id": row[0], "username": row[1], "display_name": row[2],
                "avatar_url": row[3], "is_verified": row[4], "is_admin": row[5]
            })

        # POST /upload-avatar
        if method == "POST" and path.endswith("/upload-avatar"):
            if not user_id:
                return resp(401, {"error": "Требуется авторизация"})
            file_data = body.get("file_data", "")
            mime = body.get("mime", "image/jpeg")
            if not file_data:
                return resp(400, {"error": "Нет файла"})
            raw = base64.b64decode(file_data)
            ext = mimetypes.guess_extension(mime) or ".jpg"
            key = f"messenger/avatars/{user_id}{ext}"
            s3 = get_s3()
            s3.put_object(Bucket="files", Key=key, Body=raw, ContentType=mime)
            url = cdn_url(key)
            cur.execute(f"UPDATE {SCHEMA}.users SET avatar_url = %s WHERE id = %s", (url, user_id))
            conn.commit()
            return resp(200, {"avatar_url": url})

        # POST /upload-file
        if method == "POST" and path.endswith("/upload-file"):
            if not user_id:
                return resp(401, {"error": "Требуется авторизация"})
            file_data = body.get("file_data", "")
            mime = body.get("mime", "image/jpeg")
            filename = body.get("filename", "file")
            if not file_data:
                return resp(400, {"error": "Нет файла"})
            raw = base64.b64decode(file_data)
            import time
            ts = int(time.time())
            ext = mimetypes.guess_extension(mime) or ""
            key = f"messenger/files/{user_id}_{ts}{ext}"
            s3 = get_s3()
            s3.put_object(Bucket="files", Key=key, Body=raw, ContentType=mime)
            url = cdn_url(key)
            return resp(200, {"file_url": url, "mime": mime})

        # GET /users
        if method == "GET" and path.endswith("/users"):
            q = params.get("q", "").strip().lower()
            cur.execute(
                f"SELECT id, username, display_name, avatar_url, is_verified FROM {SCHEMA}.users "
                f"WHERE username LIKE %s AND id != %s LIMIT 20",
                (f"%{q}%", user_id or 0),
            )
            rows = cur.fetchall()
            return resp(200, [
                {"id": r[0], "username": r[1], "display_name": r[2], "avatar_url": r[3], "is_verified": r[4]}
                for r in rows
            ])

        # GET /chats
        if method == "GET" and path.endswith("/chats"):
            if not user_id:
                return resp(401, {"error": "Требуется авторизация"})
            cur.execute(
                f"""
                SELECT c.id,
                       u.id, u.username, u.display_name, u.avatar_url, u.is_verified,
                       (SELECT content FROM {SCHEMA}.messages m WHERE m.chat_id = c.id AND m.is_removed = FALSE ORDER BY m.created_at DESC LIMIT 1) as last_msg,
                       (SELECT created_at FROM {SCHEMA}.messages m WHERE m.chat_id = c.id AND m.is_removed = FALSE ORDER BY m.created_at DESC LIMIT 1) as last_at
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
                 "partner_display_name": r[3], "partner_avatar_url": r[4], "partner_verified": r[5],
                 "last_message": r[6], "last_at": r[7]}
                for r in rows
            ])

        # POST /chats
        if method == "POST" and path.endswith("/chats"):
            if not user_id:
                return resp(401, {"error": "Требуется авторизация"})
            partner_id = body.get("partner_id")
            if not partner_id:
                return resp(400, {"error": "Укажи partner_id"})
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

        # GET /messages
        if method == "GET" and path.endswith("/messages"):
            chat_id = params.get("chat_id")
            after_id = params.get("after_id", 0)
            if not chat_id:
                return resp(400, {"error": "Укажи chat_id"})
            cur.execute(
                f"""
                SELECT m.id, m.content, m.created_at, u.id, u.display_name,
                       m.msg_type, m.file_url, m.is_removed
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
                 "sender_id": r[3], "sender_name": r[4],
                 "msg_type": r[5] or "text", "file_url": r[6], "is_removed": r[7]}
                for r in rows
            ])

        # POST /messages
        if method == "POST" and path.endswith("/messages"):
            if not user_id:
                return resp(401, {"error": "Требуется авторизация"})
            chat_id = body.get("chat_id")
            content = body.get("content", "").strip()
            msg_type = body.get("msg_type", "text")
            file_url = body.get("file_url", None)
            if not chat_id:
                return resp(400, {"error": "Укажи chat_id"})
            if not content and not file_url:
                return resp(400, {"error": "Нет содержимого"})
            cur.execute(
                f"INSERT INTO {SCHEMA}.messages (chat_id, sender_id, content, msg_type, file_url) "
                f"VALUES (%s, %s, %s, %s, %s) RETURNING id, created_at",
                (chat_id, user_id, content or "", msg_type, file_url),
            )
            row = cur.fetchone()
            conn.commit()
            return resp(200, {"id": row[0], "created_at": row[1]})

        # POST /delete-message
        if method == "POST" and path.endswith("/delete-message"):
            if not user_id:
                return resp(401, {"error": "Требуется авторизация"})
            msg_id = body.get("msg_id")
            if not msg_id:
                return resp(400, {"error": "Укажи msg_id"})
            # Проверяем: своё сообщение или admin
            cur.execute(f"SELECT sender_id FROM {SCHEMA}.messages WHERE id = %s", (msg_id,))
            row = cur.fetchone()
            if not row:
                return resp(404, {"error": "Сообщение не найдено"})
            cur.execute(f"SELECT is_admin FROM {SCHEMA}.users WHERE id = %s", (user_id,))
            u = cur.fetchone()
            is_admin = u and u[0]
            if str(row[0]) != str(user_id) and not is_admin:
                return resp(403, {"error": "Нельзя удалить чужое сообщение"})
            cur.execute(f"UPDATE {SCHEMA}.messages SET is_removed = TRUE WHERE id = %s", (msg_id,))
            conn.commit()
            return resp(200, {"ok": True})

        # POST /ban
        if method == "POST" and path.endswith("/ban"):
            if not user_id:
                return resp(401, {"error": "Требуется авторизация"})
            cur.execute(f"SELECT is_admin FROM {SCHEMA}.users WHERE id = %s", (user_id,))
            u = cur.fetchone()
            if not u or not u[0]:
                return resp(403, {"error": "Только администратор может банить"})
            target_id = body.get("target_id")
            if not target_id:
                return resp(400, {"error": "Укажи target_id"})
            cur.execute(
                f"INSERT INTO {SCHEMA}.user_bans (banner_id, target_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (user_id, target_id),
            )
            conn.commit()
            return resp(200, {"ok": True})

        # POST /unban
        if method == "POST" and path.endswith("/unban"):
            if not user_id:
                return resp(401, {"error": "Требуется авторизация"})
            cur.execute(f"SELECT is_admin FROM {SCHEMA}.users WHERE id = %s", (user_id,))
            u = cur.fetchone()
            if not u or not u[0]:
                return resp(403, {"error": "Только администратор"})
            target_id = body.get("target_id")
            cur.execute(
                f"UPDATE {SCHEMA}.user_bans SET banner_id = banner_id WHERE banner_id = %s AND target_id = %s",
                (user_id, target_id),
            )
            # Мягкое удаление через пометку — просто убираем запись через доп. поле
            cur.execute(
                f"ALTER TABLE {SCHEMA}.user_bans ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE",
            )
            cur.execute(
                f"UPDATE {SCHEMA}.user_bans SET is_active = FALSE WHERE banner_id = %s AND target_id = %s",
                (user_id, target_id),
            )
            conn.commit()
            return resp(200, {"ok": True})

        # GET /ban-check
        if method == "GET" and path.endswith("/ban-check"):
            target_id = params.get("target_id")
            cur.execute(
                f"SELECT 1 FROM {SCHEMA}.user_bans WHERE target_id = %s AND is_active = TRUE LIMIT 1",
                (target_id,),
            )
            row = cur.fetchone()
            return resp(200, {"banned": bool(row)})

        # GET /bans — список забаненных (для admin)
        if method == "GET" and path.endswith("/bans"):
            if not user_id:
                return resp(401, {"error": "Нет доступа"})
            cur.execute(f"SELECT is_admin FROM {SCHEMA}.users WHERE id = %s", (user_id,))
            u = cur.fetchone()
            if not u or not u[0]:
                return resp(403, {"error": "Только администратор"})
            cur.execute(
                f"""SELECT ub.target_id, u.username, u.display_name
                    FROM {SCHEMA}.user_bans ub
                    JOIN {SCHEMA}.users u ON u.id = ub.target_id
                    WHERE ub.is_active = TRUE"""
            )
            rows = cur.fetchall()
            return resp(200, [{"id": r[0], "username": r[1], "display_name": r[2]} for r in rows])

        return resp(404, {"error": "Маршрут не найден"})

    finally:
        cur.close()
        conn.close()
