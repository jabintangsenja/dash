# OpenClaw Command Center (UI + API)

This project now runs as a single deployable service:

- React dashboard frontend (7 screens)
- Express backend API
- Live updates via SSE (`/api/stream`)
- OpenClaw integration with gateway/session/log discovery

## Screens

- Dashboard
- Command Center
- Kanban
- Artifacts
- Workspaces
- Activity Logs
- Settings

## Local Development

```bash
npm install
npm run dev
```

Frontend dev URL: `http://localhost:5173`

## Production (Single Service)

```bash
npm install
npm run build
npm start
```

Service URL: `http://localhost:7070`

## Docker Deploy (VPS)

```bash
docker compose up -d --build
```

Service URL: `http://<VPS-IP>:7070`

## Required Runtime Paths on VPS

The compose file mounts these host paths into the container:

- `/root/.openclaw` -> read OpenClaw workspace/status
- `/tmp/openclaw` -> read runtime logs
- `./data` -> persist app tasks/settings

## API Endpoints

- `GET /api/health`
- `GET /api/overview`
- `GET /api/stream` (SSE)
- `GET /api/tasks`
- `POST /api/tasks`
- `PATCH /api/tasks/:id`
- `GET /api/settings`
- `PATCH /api/settings`
- `POST /api/command`

## Notes

- Gateway status path is auto-discovered if `OPENCLAW_STATUS_PATH` is not set.
- Command runner is intentionally restricted to a safe command allowlist.
