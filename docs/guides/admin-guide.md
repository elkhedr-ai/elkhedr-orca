# Admin Guide

Deployment, configuration, and operational management for Orca.

## Deployment

### System Requirements

- Node.js >= 18.0.0
- 512MB RAM minimum (2GB+ recommended for Swarm mode)
- SQLite (default) or PostgreSQL 14+
- Redis (optional, for caching)

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENROUTER_API_KEY` | Yes | — | OpenRouter API key |
| `DB_TYPE` | No | `sqlite` | `sqlite` or `postgres` |
| `DATABASE_URL` | No | — | PostgreSQL connection string |
| `JWT_SECRET` | Yes (prod) | auto-generated | JWT signing secret |
| `JWT_EXPIRES_IN` | No | `24h` | Token expiration |
| `ORCA_REDIS_URL` | No | — | Redis URL for caching |
| `ORCA_RATE_LIMIT_MAX` | No | `100` | Requests per minute per key |
| `ORCA_PORT` | No | `3000` | REST API port |
| `ORCA_LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, `error` |
| `ORCA_MODEL_STRATEGY` | No | `balanced` | `balanced`, `cost`, `quality`, `latency` |

### Docker

```bash
docker build -t orca .
docker run -p 3000:3000 -e OPENROUTER_API_KEY=sk-or-xxxx orca
```

### Systemd Service

```ini
[Unit]
Description=Orca API Server
After=network.target

[Service]
Type=simple
User=orca
WorkingDirectory=/opt/elkhedr-orca
ExecStart=/usr/bin/node src/server/index.js
Restart=always
Environment=OPENROUTER_API_KEY=sk-or-xxxx
Environment=JWT_SECRET=your-secret
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

## Authentication

### JWT Tokens

```bash
# Register admin user
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","email":"admin@org.com","password":"secure123","role":"admin"}'

# Login
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"usernameOrEmail":"admin","password":"secure123"}'
```

### API Keys

```bash
# Generate API key (requires auth)
curl -X POST http://localhost:3000/api/v1/auth/api-keys \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"CI/CD Key","scopes":["read","write"]}'
```

### Roles

| Role | Permissions |
|------|-------------|
| `viewer` | Read-only access |
| `user` | Read/write sessions, view analytics |
| `admin` | Full access including user management |

## Monitoring

### Health Endpoints

```bash
# Liveness probe (always 200 if process running)
curl http://localhost:3000/health

# Readiness probe (checks DB, memory, event loop)
curl http://localhost:3000/ready

# Prometheus metrics
curl http://localhost:3000/metrics
```

### Key Metrics

| Metric | Alert Threshold |
|--------|----------------|
| `orca_http_request_duration_seconds` P95 | > 1s |
| `orca_http_errors_total` rate | > 1% |
| `orca_queue_depth` | > 100 |
| `orca_memory_usage_bytes` (heap) | > 512MB |
| `orca_cache_hit_rate` | < 50% |

### Alerting

Default alerts are configured in `src/alerts/rules.js`:

- High error rate (> 5% in 5 min)
- Cost spike (> $10/hour)
- Queue backlog (> 100 tasks)
- Model failures (unhealthy models)
- Low cache hit rate (< 50%)

Configure notification channels:

```bash
# Webhook alerts
export ALERT_WEBHOOK_URL=https://hooks.slack.com/xxxx

# Email alerts (requires SMTP)
export SMTP_HOST=smtp.gmail.com
export SMTP_PORT=587
export SMTP_USER=alerts@org.com
export SMTP_PASS=app-password
```

## Backups

```bash
# Create backup
npm run db:backup

# List backups
npm run db:backup:list

# Restore from backup
npm run db:backup:restore -- --file backups/db/orca-backup-2026-05-20.db.gz

# Automated daily backups (cron)
0 2 * * * cd /opt/elkhedr-orca && npm run db:backup
```

## Performance Tuning

### Connection Pooling

```bash
# PostgreSQL pool size
export PG_POOL_SIZE=20

# SQLite WAL mode (enabled by default)
export SQLITE_JOURNAL_MODE=WAL
```

### Rate Limiting

```bash
# Adjust per-key rate limit
export ORCA_RATE_LIMIT_MAX=200

# Disable rate limiting (not recommended)
export ORCA_RATE_LIMIT_ENABLED=false
```

### Cache

```bash
# Enable Redis cache
export ORCA_REDIS_URL=redis://localhost:6379

# Adjust TTL (default 300s)
export ORCA_REDIS_TTL=600
```

## Troubleshooting

### Server won't start

```bash
# Check for port conflicts
lsof -i :3000

# Check logs
NODE_ENV=development npm start
```

### Database errors

```bash
# Run migrations
npm run db:migrate

# Check database integrity (SQLite)
sqlite3 data/orca.db "PRAGMA integrity_check;"
```

### High memory usage

```bash
# Check metrics
curl http://localhost:3000/metrics | grep memory

# Restart with increased heap
node --max-old-space-size=4096 src/server/index.js
```
