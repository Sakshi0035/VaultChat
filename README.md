# VaultChat — Private Username & Password Real-Time Messaging

VaultChat is a production-ready, zero-email real-time chat application backed exclusively by **Neon PostgreSQL** and styled in a **Dark Pinked Rich Red & Crisp White** aesthetic.

## Core Architecture

```
USER (Browser)
  ↓  HTTPS + WebSocket (/ws) + HTTP-Only Session Cookie
APPLICATION SERVER / API (Express + ws on Node.js)
  ↓  Server-Side Parameterized SQL Pool
NEON POSTGRESQL (Single Source of Truth + 'chats' Storage Bucket)
```

- **Username & Password Only**: No email address, no phone number, no OTP, no social OAuth, no Firebase, and no Supabase.
- **No Password Recovery**: By design, there is no "Forgot Password" or recovery flow. Users are warned during account creation to keep their credentials safe.
- **Cryptographic Password Hashing**: Passwords are hashed server-side using `crypto.scrypt` with 32-byte random salts (`N=16384, r=8, p=1`) and verified in constant time using `crypto.timingSafeEqual`.
- **Server-Side Sessions**: Authenticated via `user_sessions` stored in Neon PostgreSQL with SHA-256 HMAC token hashing, `HttpOnly` cookies, CSRF protection (`X-CSRF-Token`), session expiration, single-device logout, and "Log out of all devices".
- **`chats` Storage Bucket**: Image and file attachments are stored in the `chats` bucket (`chat_attachments` table with `bucket_name = 'chats'`) in Neon PostgreSQL and served through authenticated endpoints (`/api/storage/chats/:attachmentId`).
- **Automatic 9-Month Inactivity Deletion**: Accounts where `last_login_at < NOW() - INTERVAL '9 months'` are permanently deleted along with their sessions, conversations, messages, `chats` bucket attachments, read receipts, blocks, reports, and notifications.

---

## Required Environment Variable

VaultChat requires **only 1 external environment variable**:

| Variable Name | What the Value Represents | Where to Find It in Neon |
| :--- | :--- | :--- |
| `DATABASE_URL` | Your Neon PostgreSQL connection string (`postgresql://...`) | **Neon Dashboard** → Select your Project → Click **Connect** on the Project Dashboard → Copy the **Connection string** |

> **Auto-Generated Server Secrets**: `SESSION_SECRET` and `CLEANUP_CRON_SECRET` are automatically generated using `crypto.randomBytes` and persisted server-side inside the `server_secrets` table in Neon PostgreSQL (or can optionally be overridden via server environment variables). Database credentials and secrets never appear in source code or frontend bundles.

---

## Database Schema & Migrations

SQL migrations are located in [`migrations/001_initial_schema.sql`](migrations/001_initial_schema.sql) and are automatically applied on server startup:

- `server_secrets` (`key_name`, `secret_value`, `created_at`)
- `users` (`id`, `username`, `username_normalized`, `password_hash`, `avatar_color`, `bio`, `created_at`, `last_login_at`, `last_active_at`, `updated_at`, `deleted_at`)
- `user_sessions` (`id`, `token_hash`, `csrf_token`, `user_id`, `user_agent`, `ip_address`, `created_at`, `last_used_at`, `expires_at`, `revoked_at`)
- `conversations` (`id`, `status`, `initiated_by`, `created_at`, `updated_at`)
- `conversation_members` (`conversation_id`, `user_id`, `joined_at`, `last_read_at`)
- `messages` (`id`, `conversation_id`, `sender_id`, `reply_to_id`, `body`, `created_at`, `edited_at`, `deleted_at`)
- `chat_attachments` (`id`, `bucket_name` = `'chats'`, `conversation_id`, `message_id`, `uploader_id`, `file_name`, `mime_type`, `size_bytes`, `data_base64`, `created_at`)
- `message_reads` (`message_id`, `user_id`, `read_at`)
- `user_blocks` (`id`, `blocker_id`, `blocked_id`, `created_at`)
- `reports` (`id`, `reporter_id`, `reported_user_id`, `message_id`, `reason`, `status`, `created_at`)
- `notifications` (`id`, `recipient_id`, `actor_id`, `conversation_id`, `type`, `title`, `body`, `is_read`, `created_at`)
