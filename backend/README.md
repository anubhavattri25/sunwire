# Sunwire Backend

## Setup
1. Copy `.env.example` to `.env`
2. Set `DATABASE_URL`, `REDIS_URL`, and optional API keys
3. Run `npm install`
4. Run `npx prisma generate`
5. Run `npx prisma migrate deploy`
6. Start with `npm start`

## Local AI Rewrite
- Install Ollama and run it locally.
- Pull the default model with `ollama pull llama3.1:8b`.
- Start Ollama before running ingestion so the app can reach `http://localhost:11434`.
- Configure `AI_PROVIDER=ollama`, `OLLAMA_BASE_URL=http://localhost:11434`, and `OLLAMA_MODEL=llama3.1:8b`.
- If Ollama is unavailable, the rewrite step falls back to cleaned source content instead of failing ingestion.

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
