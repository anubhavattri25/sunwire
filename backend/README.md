# Sunwire Backend

## Setup
1. Copy `.env.example` to `.env`
2. Set `DATABASE_URL`, `REDIS_URL`, and admin/auth/image-upload environment variables
3. Run `npm install`
4. Run `npx prisma generate`
5. Run `npx prisma migrate deploy`
6. Start with `npm start`

## Manual Newsroom
- Sunwire now runs in manual-only mode.
- News is published from `/admin/news` after Google sign-in and server-side admin verification.
- Only the configured admin email can open the dashboard or publish/remove stories.
- Uploaded stories are stored in the `articles` table with `manual_upload=true`.
- Automated scraping, rewriting, and scheduled ingestion are disabled.

## Endpoints
- `GET /healthz`
- `GET /api/news?page=1&category=AI`
- `POST /api/view`
- `GET /api/system-status`
- `GET|POST|DELETE /api/admin/session`
- `GET|POST|DELETE /api/admin/news`
- `POST /api/admin/upload-image`

## Notes
- `GET /api/ingest` is intentionally disabled and returns a manual-only message.
- Homepage and article listings read directly from the database-backed manual newsroom flow.
