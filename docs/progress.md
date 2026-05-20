# Progress Log — elkhedr-orca

## 2026-05-20 — Production Readiness Hardening

### Security & Secrets
- **`.gitignore` hardened** — Added `.env.production`, `.env.staging`, `data/orca.db`, `data/orca.db-shm`, `data/orca.db-wal`, `backups/` to prevent accidental secret/data leaks
- **`data/orca.db` untracked** — Removed from git index (was previously committed); local copy preserved
- **`.env.production` never committed** — Verified not in git tracking; contains JWT_SECRET, MASTER_KEY, OPENROUTER_API_KEY
- **`.env.example` updated** — Added `ORCA_MASTER_KEY` placeholder for encryption key

### Production Config
- **`.env.production` finalized** — Added `NODE_ENV=production`, `ORCA_MASTER_KEY` (generated via `openssl rand -hex 32`)

### Admin Registration
- **`scripts/register-admin.js`** — CLI script to register first admin user
  - Reads credentials from env vars (`ORCA_ADMIN_USER`, `ORCA_ADMIN_EMAIL`, `ORCA_ADMIN_PASS`) or prompts interactively
  - Password input is masked in terminal
  - Uses existing `registerUser()` from `src/auth/index.js`
  - npm script: `npm run admin:register`

### Automated Backups
- **`scripts/setup-backup-cron.sh`** — Installs daily backup cron job
  - Default: 3 AM daily, configurable via `--schedule`
  - Loads `.env.production` in cron context
  - Logs to `logs/backup.log`
  - Uninstall: `--uninstall` flag
  - npm script: `npm run db:backup:cron`
- Existing `scripts/backup.sh` and `scripts/restore.sh` unchanged (already complete)

### Files Changed
- `.gitignore` — Security hardening
- `.env.example` — Added ORCA_MASTER_KEY
- `.env.production` — Added NODE_ENV, ORCA_MASTER_KEY
- `package.json` — Added `admin:register`, `db:backup:cron` scripts
- `scripts/register-admin.js` — New: admin registration CLI
- `scripts/setup-backup-cron.sh` — New: cron installer

### Launch Guide
- **`docs/LAUNCH_GUIDE.md`** — 12-step production launch guide covering server setup, env config, TLS, Docker deploy, admin registration, backups, monitoring, security hardening, and go-live checklist

---

## 2026-05-19 — T44 Local Model Support & T45 Image & Audio Processing

### T44: Local Model Support (Completed)
- **LocalModelClient** class in `src/models/local.js` — Ollama and LM Studio integration with availability caching
- **Hybrid routing** in `src/core.js` — `tryCall()` function routes between local and cloud models based on `ORCA_LOCAL_MODEL_PRIORITY` (local-first, cloud-first, cost-optimal)
- **ModelRegistry** extended with `discoverLocalModels()`, `getLocalModels()`, `recordModelSuccess()`
- **Command system** — `/models` command with `manageLocalModels()` for listing availability, starting/stopping providers
- **Config schema** — `ORCA_LOCAL_MODEL_ENABLED`, `ORCA_LOCAL_MODEL_PRIORITY`, `OLLAMA_URL`, `LMSTUDIO_URL` env vars
- **TUI status bar** — Shows current provider (local/cloud) indicator
- **Tests** — 17 unit tests covering LocalModelClient, hybrid routing config, availability caching

### T45: Image & Audio Processing (Completed)
- **Vision skill** (`skills/vision/index.js`) — Image analysis via vision-capable models with multi-model fallback chain (Llama 3.2 Vision, Gemini Flash, GPT-4o Mini). Supports local files and URLs.
- **Audio skill** (`skills/audio/index.js`) — Audio transcription via OpenRouter Whisper endpoint. Supports local files and URLs with temp file cleanup.
- **Schemas** — `imageAnalysisSchema` and `audioTranscribeSchema` Zod validation in `src/schemas/index.js`
- **Plugin schema** — Added `media` category to skill manifest schema
- **Skills registration** — Both skills auto-loaded via `DEFAULT_DIRECTORY_SKILLS` in `src/skills.js`
- **Tests** — 25 unit tests covering vision skill, audio skill, input validation schemas, plugin schema media category

### GitNexus
- Indexed elkhedr-orca as "elkhedr-orca" (3,774 symbols, 7,148 relationships, 300 execution flows)

### Files Changed
- `src/core.js` — `tryCall()`, `getLocalClient()`, local model hybrid routing
- `src/models/local.js` — New: `LocalModelClient` class
- `src/models/registry.js` — `discoverLocalModels()`, `getLocalModels()`, `recordModelSuccess()`
- `src/commands.js` — `manageLocalModels()` command
- `src/tui.js` — Provider indicator in status bar
- `src/config/schema.js` — Local model env vars
- `src/schemas/index.js` — `imageAnalysisSchema`, `audioTranscribeSchema`
- `src/plugins/schema.js` — `media` category
- `src/skills.js` — `vision`, `audio` in DEFAULT_DIRECTORY_SKILLS
- `skills/vision/index.js` — New: vision skill
- `skills/vision/manifest.json` — New: vision manifest
- `skills/audio/index.js` — New: audio skill
- `skills/audio/manifest.json` — New: audio manifest
- `tests/unit/local-models.test.js` — New: T44 tests
- `tests/unit/multimedia-skills.test.js` — New: T45 tests
- `ORCA_PRODUCTION_ROADMAP.csv` — T44, T45 marked Done

### Test Results
- T44: 17/17 pass
- T45: 25/25 pass
- Health check: all 5 skills registered (terminal, url-fetch, web-search, vision, audio)
