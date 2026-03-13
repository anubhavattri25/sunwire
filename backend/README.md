# Sunwire Backend

## Setup
1. Copy `.env.example` to `.env`
2. Set `DATABASE_URL`, `REDIS_URL`, and optional API keys
3. Run `npm install`
4. Run `npx prisma generate`
5. Run `npx prisma migrate deploy`
6. Start with `npm start`

## Endpoints
- `GET /healthz`
- `GET /api/news?page=1&category=AI`
- `GET /api/trending`
- `GET /api/breaking-news`
- `POST /api/view`
- `GET /api/system-status`

## Jobs
- fetch news every 5 minutes
- process articles every 10 minutes
- update trending every 15 minutes
