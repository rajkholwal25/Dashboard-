# Machine Live Dashboard

Factory floor web dashboard showing live machine status and completed job history from SAP Business One, with optional MySQL enrichment.

Runs independently on **port 3002** (separate from DPS_SENDER_NEW on 3001).

## Features

- Home page: grid of 21 production machine cards (running / idle)
- Machine detail: currently running job + full completed batch history (no deduplication)
- Auto-refresh every 30–60 seconds (configurable via `.env`)
- SAP batch data with Production Order and Job enrichment
- MySQL `production_records` supplement for makeready/running time
- All times displayed in IST (`Asia/Kolkata`)

## Setup

```bash
cd Machine-Live-Dashboard
npm install
cp .env.example .env
# Edit .env with your SAP and MySQL credentials
npm start
```

Open [http://127.0.0.1:3002](http://127.0.0.1:3002)

## Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP port | `3002` |
| `HOST` | Bind address | `127.0.0.1` |
| `SAP_URL` | SAP Service Layer URL | — |
| `SAP_COMPANY` | Company DB | — |
| `SAP_USERNAME` | SAP user | — |
| `SAP_PASSWORD` | SAP password | — |
| `DB_HOST` | MySQL host | — |
| `DB_PORT` | MySQL port | `3306` |
| `DB_USER` | MySQL user | — |
| `DB_PASSWORD` | MySQL password | — |
| `DB_NAME` | MySQL database | `sap` |
| `REPORT_TIMEZONE` | Display timezone | `Asia/Kolkata` |
| `DASHBOARD_REFRESH_MS` | API cache + UI refresh interval | `30000` |
| `COMPLETED_JOBS_LIMIT` | Max completed rows per machine (`0` = unlimited) | `0` |
| `BATCH_LOOKBACK_DAYS` | SAP batch admission lookback | `7` |

## Docker deployment (server / Bitvise)

Container name: **Dashboard** · Port: **3002**

### On the server (Linux with Docker)

1. Copy this folder to the server (e.g. via Bitvise SFTP).
2. Create `.env` from `.env.example` and set SAP + MySQL credentials.
3. Build and run:

```bash
docker compose build
docker compose up -d
```

4. Open `http://<server-ip>:3002`

### Useful commands

```bash
docker compose ps              # check status
docker compose logs -f dashboard
docker compose restart dashboard
docker compose down            # stop
```

Or via npm scripts:

```bash
npm run docker:build
npm run docker:up
npm run docker:logs
```

**Note:** Docker sets `HOST=0.0.0.0` so the app is reachable from other machines on the network. Ensure firewall allows port **3002**.

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/machines` | All machines with summary status |
| `GET /api/machines/:machineId` | Running job + completed history |
| `GET /api/machines/:machineId/refresh` | Force cache refresh |
| `GET /` | Dashboard home |
| `GET /machine/:id` | Machine detail page |

Add `?refresh=1` to API calls to bypass cache.

## Project structure

```
Machine-Live-Dashboard/
├── config/
│   ├── db.js
│   └── machines.js
├── services/
│   ├── sapService.js
│   └── machineJobService.js
├── public/
│   ├── index.html
│   ├── machine.html
│   ├── app.js
│   └── styles.css
├── server.js
├── Dockerfile
├── docker-compose.yml
├── package.json
├── .env.example
└── README.md
```

## Data logic

- **Running**: batch with `U_BatchDt2` set and `U_BatchDt3` empty — most recent start wins
- **Completed**: batch with `U_BatchDt3` set — every batch is a separate row, sorted by end time descending
- **Enrichment**: OIGN → Production Order → OMJD job number; DIE jobs use sheet conversion via positive Item base ratio

## Requirements

- Node.js 18+
- Network access to SAP Service Layer and MySQL
