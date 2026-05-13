# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

TVPlay Web is a professional broadcast playout system with real-time channel control, HLS transcoding, multi-output streaming, graphic overlays, and fallback handling for TV broadcast operations.

**Stack:** Fastify + Prisma + PostgreSQL + Redis + MinIO (backend) · React 18 + Vite + TailwindCSS + TanStack Query (frontend) · FFmpeg + yt-dlp (media) · BullMQ (job queue) · Docker Compose (infra)

## Commands

### Backend

```bash
cd backend
npm run dev          # tsx watch src/server.ts (port 3001)
npm run build        # tsc → dist/
npm start            # node dist/server.js

npm run db:push      # Push schema to DB (no migration file)
npm run db:migrate   # Create and apply migration
npm run db:generate  # Regenerate Prisma client after schema change
npm run db:seed      # Seed initial data (admin user, channels, clip types)
npm run db:studio    # Prisma Studio GUI
```

### Frontend

```bash
cd frontend
npm run dev          # Vite dev server (port 5173, proxies /api → localhost:3001)
npm run build        # tsc + vite build → dist/
npm run preview      # Preview production build
```

### Docker

```bash
docker-compose up -d --build        # Full stack rebuild
docker-compose up -d --build api    # Rebuild backend only
docker-compose up -d --build web    # Rebuild frontend only
docker-compose restart              # Restart without rebuild
docker logs tvplay_api -f
docker logs tvplay_web -f
```

Default credentials (after seed): `admin` / `admin123` · `operador` / `op123`

## Architecture

### Service Layer (backend/src/services/)

**playout.service.ts** — Core playout engine. Maintains in-memory channel state per channel in a `Map`. A `setInterval` of 1 second advances elapsed time and broadcasts `PlayoutState` to all WebSocket clients via `wsClients` Map. Handles playlist sequencing, break/block tracking, override cue points (per-item `cueIn`/`cueOut`), and fallback activation. `resolveInputUrl()` resolves YouTube/Twitch URLs via `yt-dlp` (Android client flag for reliability); passes RTMP/RTSP/SRT through directly.

**stream.service.ts** — FFmpeg process manager. Spawns/kills child processes per stream output. Builds filter graphs dynamically: `scale → overlay (logo) → drawtext (clock/lower-third)` composed into a single graph to avoid process respawns when graphics change. Supports RTMP, HLS_PUSH, SDI, SRT, UDP, RTP outputs; adds `-reconnect` for RTMP and `-rtsp_transport tcp` for RTSP.

**ffmpeg.service.ts** — Wraps FFmpeg for probe, thumbnail generation, and HLS transcoding.

**transcode.worker.ts** — BullMQ worker (concurrency: 2). Pipeline: probe → thumbnail → HLS transcode → upload to MinIO → update DB record.

**preview.service.ts** — Generates short HLS preview URLs for input sources. Applies extended timeouts: 15 s for RTMP/RTSP (FFmpeg needs time to fetch the first segment).

### API Routes (backend/src/routes/)

All routes require JWT except `GET /health` and `POST /api/auth/login`. Route files register directly on the Fastify instance with Zod validation on request bodies. Key playout endpoints:

| Method | Path | Action |
|--------|------|--------|
| POST | `/api/playout/:id/play` | Start playback |
| POST | `/api/playout/:id/pause` | Pause |
| POST | `/api/playout/:id/next` | Skip to next item |
| POST | `/api/playout/:id/jump` | Jump to index |
| POST | `/api/playout/:id/cut-to-input` | Switch live to input source |
| POST | `/api/playout/:id/set-fallback` | Configure fallback (black / bars / source) |
| GET  | `/api/playout/:id/state` (WS) | Real-time state stream |

### Frontend Data Flow

`api/*.api.ts` → Axios client (`api/client.ts`, JWT interceptor) → TanStack Query hooks → page components. Zustand stores handle auth state and UI globals. The playout page opens a WebSocket to `/api/playout/:channelId/state` and rebuilds display state from each `PlayoutState` message (no polling).

### Database (Prisma schema key models)

`Channel` → has many `Playlist` → has many `PlaylistItem` → references `Clip` → references `MediaFile`
`Channel` → has many `StreamOutput` (RTMP/HLS/SDI/SRT/UDP/RTP)
`Channel` → has many `InputSource` (IP/YOUTUBE/SRT/SDI/USB/LOCAL_DEVICE)
`Channel` → has many `Graphic` (logo, clock, lower-third overlays)

Clip modalities (enum used throughout UI and DB):
`BK` Bloco · `AR` Reprisa · `PT` Vinheta · `VH` VT Humorístico · `CP` Comercial · `CA` Campanha · `LV` Ao Vivo · `ID` ID de Canal · `MT` Material Teaser

### Storage

MinIO is the primary object store for HLS segments and thumbnails. `storage.service.ts` wraps MinIO SDK calls. In production, swap MinIO endpoint/credentials for any S3-compatible service (config via env vars).

## Environment

Backend config is centralised in `backend/src/config.ts` — reads all env vars from there, never directly from `process.env` elsewhere.

Key env vars:
```
DATABASE_URL        postgresql://tvplay:tvplay123@localhost:5432/tvplay
REDIS_URL           redis://localhost:6379
MINIO_ENDPOINT      localhost
MINIO_PORT          9000
MINIO_ACCESS_KEY    minioadmin
MINIO_SECRET_KEY    minioadmin123
JWT_SECRET          (change in production)
FFMPEG_PATH         /usr/bin/ffmpeg
YTDLP_PATH          /usr/local/bin/yt-dlp
```

## Non-Obvious Behaviours

- **yt-dlp Android flag**: YouTube/Twitch URLs are resolved with `--extractor-args youtube:player_client=android` to bypass throttling — required for stable live stream URL resolution.
- **RTMP/RTSP timeouts**: Preview and streaming services use 15 s timeouts because the first HLS segment takes longer to arrive on these protocols (default 8 s was insufficient).
- **Prisma singleton**: `backend/src/lib/prisma.ts` uses the global object to prevent multiple client instances during `tsx watch` hot reloads.
- **Playlist locking**: A locked playlist (`locked: true`) prevents item edits during live broadcast — check this flag before allowing modifications in route handlers.
- **Transcode concurrency**: Set to `2` in `transcode.worker.ts`. Each FFmpeg HLS transcode is CPU-heavy; increase cautiously.
- **WebSocket broadcasting**: The playout service sends the full `PlayoutState` object every second to every connected WS client per channel.
- **Schema changes**: After editing `prisma/schema.prisma`, always run `npm run db:generate` before `db:push` or `db:migrate`; otherwise the Prisma client is stale.
- **Column renames in Prisma**: Renaming a column without a migration causes `db push` to drop+recreate it (data loss). Use `ALTER TABLE` manually or write an explicit migration when renaming with existing data.
