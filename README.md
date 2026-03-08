# OpenClaw UI (gpt5.4-inv)

Production-ready frontend for the OpenClaw Command Center screens:

- Dashboard
- Command Center
- Kanban
- Artifacts
- Workspaces
- Activity Logs
- Settings

## Local Run

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Production Build

```bash
npm install
npm run build
npm run preview
```

## Deploy To VPS With Docker

1. Install Docker + Compose plugin on VPS.
2. Clone this repo.
3. Run:

```bash
docker compose up -d --build
```

App will be available at `http://<VPS-IP>:8080`.

## Nginx Reverse Proxy + Domain

If you already use host-level Nginx, proxy your domain to `127.0.0.1:8080`.

Example:

```nginx
server {
  listen 80;
  server_name your-domain.com;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Then issue TLS cert:

```bash
sudo certbot --nginx -d your-domain.com
```
