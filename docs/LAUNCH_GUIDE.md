# Elkhedr Orca — First Production Launch Guide

A step-by-step checklist for going from local development to a live production deployment.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Server Setup](#2-server-setup)
3. [Environment Configuration](#3-environment-configuration)
4. [TLS Certificates](#4-tls-certificates)
5. [Database Setup](#5-database-setup)
6. [Deploy with Docker](#6-deploy-with-docker)
7. [Register Admin User](#7-register-admin-user)
8. [Verify Deployment](#8-verify-deployment)
9. [Automated Backups](#9-automated-backups)
10. [Monitoring & Alerts](#10-monitoring--alerts)
11. [Security Hardening](#11-security-hardening)
12. [Go-Live Checklist](#12-go-live-checklist)

---

## 1. Prerequisites

### Server Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 cores | 4 cores |
| RAM | 2 GB | 4 GB |
| Disk | 20 GB | 50 GB SSD |
| OS | Ubuntu 22.04+ / Debian 12+ | Ubuntu 24.04 LTS |

### Software Requirements

```bash
# Docker & Docker Compose (v2)
docker --version        # >= 24.0
docker compose version  # >= 2.20

# Certbot for Let's Encrypt TLS
sudo apt install certbot

# sqlite3 CLI (for backup scripts, if using SQLite)
sudo apt install sqlite3
```

### Domain

- Point your domain (e.g., `orca.example.com`) to your server's public IP via DNS A record.

---

## 2. Server Setup

### 2.1 — Create a dedicated user

```bash
sudo useradd -m -s /bin/bash orca
sudo usermod -aG docker orca
```

### 2.2 — Clone the repository

```bash
sudo -u orca -i
git clone https://github.com/YOUR_ORG/elkhedr-orca.git
cd elkhedr-orca
```

### 2.3 — Create required directories

```bash
mkdir -p logs backups/db certs
```

---

## 3. Environment Configuration

### 3.1 — Generate secrets

```bash
# Generate all required secrets
echo "ORCA_JWT_SECRET=$(openssl rand -hex 32)"
echo "ORCA_JWT_REFRESH_SECRET=$(openssl rand -hex 32)"
echo "MASTER_KEY=$(openssl rand -hex 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24)"
```

**Save these values.** You will need them in the next step.

### 3.2 — Create `.env.production`

```bash
cp .env.example .env.production
nano .env.production
```

Fill in **every** required value:

```bash
# === REQUIRED ===
OPENROUTER_API_KEY=sk-or-v1-YOUR_REAL_KEY
ORCA_JWT_SECRET=PASTE_GENERATED_SECRET_HERE
ORCA_JWT_REFRESH_SECRET=PASTE_GENERATED_REFRESH_SECRET_HERE
ORCA_MASTER_KEY=PASTE_GENERATED_MASTER_KEY_HERE
POSTGRES_PASSWORD=PASTE_GENERATED_PG_PASSWORD_HERE

# === NODE ===
NODE_ENV=production

# === SERVER ===
ORCA_PORT=3000
ORCA_HOST=0.0.0.0
ORCA_CORS_ORIGIN=https://orca.example.com

# === DATABASE ===
ORCA_DB_TYPE=postgresql
ORCA_DB_HOST=postgres
ORCA_DB_PORT=5432
ORCA_DB_NAME=orca
ORCA_DB_USER=orca
ORCA_DB_PASSWORD=PASTE_GENERATED_PG_PASSWORD_HERE
ORCA_DB_SSL=false
ORCA_DB_POOL_MIN=2
ORCA_DB_POOL_MAX=10

# === REDIS ===
ORCA_REDIS_URL=redis://:PASTE_GENERATED_PG_PASSWORD_HERE@redis:6379
ORCA_REDIS_TTL=300

# === SECURITY ===
ORCA_SANDBOX=true
ORCA_RATE_LIMIT_MAX=100
ORCA_LOG_LEVEL=warn

# === MODEL ROUTING ===
ORCA_MODEL_ROUTING_STRATEGY=balanced
ORCA_MODEL_FAILURE_THRESHOLD=1

# === ANALYTICS ===
ORCA_ANALYTICS_ENABLED=true
ORCA_ANALYTICS_RETENTION_DAYS=90

# === FEATURES ===
ORCA_MCP_ENABLED=true
ORCA_SWARM_ENABLED=true

# === BACKUPS ===
ORCA_BACKUP_RETENTION_DAYS=30

# === TLS (handled by nginx, leave disabled in app) ===
ORCA_TLS_ENABLED=false
```

### 3.3 — Lock down file permissions

```bash
chmod 600 .env.production
```

---

## 4. TLS Certificates

### Option A — Let's Encrypt (recommended)

```bash
# On the host (not in Docker)
sudo certbot certonly --standalone -d orca.example.com

# Copy certs to project
sudo cp /etc/letsencrypt/live/orca.example.com/fullchain.pem certs/server.crt
sudo cp /etc/letsencrypt/live/orca.example.com/privkey.pem certs/server.key
sudo chown orca:orca certs/server.*
chmod 600 certs/server.key
```

### Option B — Self-signed (development/testing only)

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout certs/server.key \
  -out certs/server.crt \
  -subj "/CN=orca.example.com"
```

### Certificate Renewal (Let's Encrypt)

Add a cron job on the host:

```bash
sudo crontab -e
# Add:
0 3 * * 1 certbot renew --quiet && cp /etc/letsencrypt/live/orca.example.com/fullchain.pem /home/orca/elkhedr-orca/certs/server.crt && cp /etc/letsencrypt/live/orca.example.com/privkey.pem /home/orca/elkhedr-orca/certs/server.key && docker compose -f /home/orca/elkhedr-orca/docker-compose.prod.yml restart nginx
```

---

## 5. Database Setup

The PostgreSQL container initializes automatically on first run. Migrations run on app startup via Knex.

### Verify migrations

```bash
docker compose -f docker-compose.prod.yml exec app node -e "
  require('./src/db/init.js').runMigrations('status')
    .then(s => console.log(JSON.stringify(s, null, 2)))
    .catch(console.error)
"
```

---

## 6. Deploy with Docker

### 6.1 — Build and start

```bash
# Build images
docker compose -f docker-compose.prod.yml build

# Start all services (2 app replicas, postgres, redis, nginx)
docker compose -f docker-compose.prod.yml up -d
```

### 6.2 — Check service status

```bash
docker compose -f docker-compose.prod.yml ps
```

Expected output: all services `Up`, nginx on `0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp`.

### 6.3 — View logs

```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Just the app
docker compose -f docker-compose.prod.yml logs -f app

# Just nginx
docker compose -f docker-compose.prod.yml logs -f nginx
```

---

## 7. Register Admin User

Once the app is running, create your first admin:

### Option A — Interactive prompt

```bash
docker compose -f docker-compose.prod.yml exec app node scripts/register-admin.js
```

### Option B — From environment variables

```bash
docker compose -f docker-compose.prod.yml exec -e ORCA_ADMIN_USER=admin -e ORCA_ADMIN_EMAIL=admin@example.com -e ORCA_ADMIN_PASS='YourStr0ngP@ss!' app node scripts/register-admin.js
```

**Store these credentials in a password manager.** The access and refresh tokens are printed once.

---

## 8. Verify Deployment

### 8.1 — Health checks

```bash
# Liveness (should return 200)
curl -s https://orca.example.com/health | jq .

# Readiness (should return 200 with ready: true)
curl -s https://orca.example.com/ready | jq .
```

### 8.2 — API docs

Open in browser: `https://orca.example.com/docs`

### 8.3 — Login test

```bash
curl -s -X POST https://orca.example.com/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"usernameOrEmail":"admin","password":"YourStr0ngP@ss!"}' | jq .
```

You should receive `accessToken` and `refreshToken`.

### 8.4 — Authenticated request

```bash
TOKEN="PASTE_ACCESS_TOKEN_HERE"

curl -s https://orca.example.com/api/v1/agents \
  -H "Authorization: Bearer $TOKEN" | jq .
```

---

## 9. Automated Backups

### 9.1 — Install backup cron (inside the app container)

```bash
docker compose -f docker-compose.prod.yml exec app bash scripts/setup-backup-cron.sh
```

This creates a daily backup at 3 AM (configurable via `--schedule`).

### 9.2 — Manual backup

```bash
docker compose -f docker-compose.prod.yml exec app bash scripts/backup.sh
```

### 9.3 — Restore from backup

```bash
docker compose -f docker-compose.prod.yml exec app bash scripts/restore.sh backups/db/orca-pgsql-YYYYMMDD_HHMMSS.sql.gz
```

### 9.4 — Verify backups

```bash
docker compose -f docker-compose.prod.yml exec app ls -lh backups/db/
```

---

## 10. Monitoring & Alerts

### 10.1 — Prometheus metrics

The app exposes Prometheus metrics. Configure your Prometheus server to scrape:

```
https://orca.example.com/api/v1/metrics
```

### 10.2 — Health endpoint for uptime monitoring

Configure your uptime monitor (UptimeRobot, Better Stack, etc.) to ping:

```
https://orca.example.com/health
```

### 10.3 — Log aggregation

Logs are written to `logs/` in JSON format (Pino). Ship them to your preferred aggregator:

```bash
# Example: tail logs for shipping
docker compose -f docker-compose.prod.yml logs -f app | your-log-shipper
```

---

## 11. Security Hardening

### 11.1 — Firewall

```bash
# Allow only SSH, HTTP, HTTPS
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 11.2 — SSH hardening

```bash
sudo nano /etc/ssh/sshd_config
# Set:
#   PasswordAuthentication no
#   PermitRootLogin no
sudo systemctl restart sshd
```

### 11.3 — Docker security

- The Dockerfile already runs as non-root user `orca` (UID 1001).
- The compose file sets CPU/memory limits on app containers.
- Postgres and Redis ports are **not** exposed to the host in production compose.

### 11.4 — Rate limiting

Default: 100 requests per minute per user/IP. Adjust in `src/server/index.js` if needed.

### 11.5 — CORS

Set `ORCA_CORS_ORIGIN` to your exact domain. Do **not** use `*` in production.

### 11.6 — Secret rotation

- Rotate `ORCA_JWT_SECRET` and `ORCA_JWT_REFRESH_SECRET` periodically (every 90 days).
- After rotation, all existing tokens are invalidated — users must re-login.
- Rotate `OPENROUTER_API_KEY` if compromised.

---

## 12. Go-Live Checklist

Run through this before announcing:

- [ ] `.env.production` has all required values filled in
- [ ] `NODE_ENV=production` is set
- [ ] `ORCA_JWT_SECRET` is a random 64-char hex string (not the default)
- [ ] `ORCA_JWT_REFRESH_SECRET` is set and different from `ORCA_JWT_SECRET`
- [ ] `ORCA_MASTER_KEY` is set
- [ ] `ORCA_CORS_ORIGIN` is set to your exact domain
- [ ] TLS certificate is valid and not expired
- [ ] `docker compose ps` shows all services Up
- [ ] `curl https://YOUR_DOMAIN/health` returns `{"status":"ok"}`
- [ ] `curl https://YOUR_DOMAIN/ready` returns `{"ready":true}`
- [ ] Admin user registered and can log in
- [ ] API docs accessible at `https://YOUR_DOMAIN/docs`
- [ ] Firewall allows only 80, 443, 22
- [ ] Backup cron is installed and first backup exists
- [ ] Uptime monitor configured
- [ ] DNS A record points to server IP
- [ ] No secrets committed to git (`git log --all -p | grep -i "sk-or-v1\|ORCA_JWT_SECRET\|ORCA_MASTER_KEY"` should return nothing)

---

## Quick Reference

| Action | Command |
|--------|---------|
| Start production | `docker compose -f docker-compose.prod.yml up -d` |
| Stop production | `docker compose -f docker-compose.prod.yml down` |
| View logs | `docker compose -f docker-compose.prod.yml logs -f` |
| Restart app | `docker compose -f docker-compose.prod.yml restart app` |
| Run backup | `docker compose -f docker-compose.prod.yml exec app bash scripts/backup.sh` |
| Register admin | `docker compose -f docker-compose.prod.yml exec app node scripts/register-admin.js` |
| Check health | `curl -s https://YOUR_DOMAIN/health \| jq .` |
| DB migration status | `docker compose -f docker-compose.prod.yml exec app node -e "require('./src/db/init.js').runMigrations('status').then(console.log)"` |
| Shell into app | `docker compose -f docker-compose.prod.yml exec app sh` |

---

## Troubleshooting

### App won't start

```bash
docker compose -f docker-compose.prod.yml logs app | tail -50
```

Common causes:
- Missing required env var (check `.env.production`)
- Database not reachable (check postgres container is Up)
- Port conflict (something else on 80/443)

### JWT errors

Check that `ORCA_JWT_SECRET` and `ORCA_JWT_REFRESH_SECRET` are set. The app falls back to an insecure default if missing.

### Database connection refused

```bash
docker compose -f docker-compose.prod.yml logs postgres
```

Ensure `POSTGRES_PASSWORD` matches in both `.env.production` and the postgres service config.

### Backup fails

Ensure `sqlite3` or `pg_dump` is available in the container:

```bash
docker compose -f docker-compose.prod.yml exec app which sqlite3
docker compose -f docker-compose.prod.yml exec app which pg_dump
```

---

*Last updated: 2026-05-20*
