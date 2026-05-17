# T21: PostgreSQL Support - Implementation Plan

## Overview
Add PostgreSQL support to Orca using Knex.js as the query builder, maintaining backward compatibility with SQLite while enabling production-ready deployments with connection pooling and proper schema management.

## Architecture Decision: Knex.js

**Selected**: Knex.js for PostgreSQL adapter
**Rationale**:
- Maintains SQL-like patterns similar to current `better-sqlite3` implementation
- Easier migration path from raw SQL prepared statements
- Lightweight and flexible
- Built-in connection pooling
- Supports both SQLite and PostgreSQL with same API
- Lower learning curve for team

## Database Adapter Abstraction Layer

### Interface Design

```javascript
// src/db/adapters/base.js
class DatabaseAdapter {
  async connect(config) {}
  async disconnect() {}
  async query(sql, params) {}
  async execute(sql, params) {}
  async transaction(callback) {}
  prepare(sql) {} // Returns prepared statement interface
  getClient() {} // Returns underlying client for advanced usage
}
```

### Adapter Implementations

1. **SQLiteAdapter** (`src/db/adapters/sqlite.js`)
   - Wraps `better-sqlite3`
   - Maintains current synchronous API
   - No connection pooling needed

2. **PostgreSQLAdapter** (`src/db/adapters/postgresql.js`)
   - Uses Knex.js with `pg` driver
   - Async API with connection pooling
   - Transaction support
   - Query builder methods

### Factory Pattern

```javascript
// src/db/adapters/factory.js
function createAdapter(type, config) {
  switch(type) {
    case 'sqlite':
      return new SQLiteAdapter(config);
    case 'postgresql':
      return new PostgreSQLAdapter(config);
    default:
      throw new Error(`Unknown adapter type: ${type}`);
  }
}
```

## Schema Migration Strategy

### PostgreSQL Schema Differences

**SQLite → PostgreSQL Mappings**:
- `INTEGER PRIMARY KEY AUTOINCREMENT` → `SERIAL PRIMARY KEY`
- `DATETIME DEFAULT CURRENT_TIMESTAMP` → `TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
- `TEXT` → `TEXT` (same)
- `REAL` → `NUMERIC` or `DOUBLE PRECISION`

### Migration Files Structure

```
src/db/migrations/
├── 001_initial_schema.js
├── 002_add_indexes.js
└── README.md
```

Each migration file exports:
```javascript
exports.up = function(knex) {
  // Create tables/modify schema
};

exports.down = function(knex) {
  // Rollback changes
};
```

## Connection Configuration

### Environment Variables

```bash
# Database selection
ORCA_DB_TYPE=postgresql  # or 'sqlite' (default)

# PostgreSQL connection
ORCA_DB_URL=postgresql://user:password@localhost:5432/orca

# Or individual components
ORCA_DB_HOST=localhost
ORCA_DB_PORT=5432
ORCA_DB_NAME=orca
ORCA_DB_USER=orca_user
ORCA_DB_PASSWORD=secure_password

# Connection pooling
ORCA_DB_POOL_MIN=2
ORCA_DB_POOL_MAX=10
ORCA_DB_POOL_IDLE_TIMEOUT=30000
```

### Configuration Schema Updates

Add to [`src/config/schema.js`](src/config/schema.js):
```javascript
ORCA_DB_TYPE: z.enum(['sqlite', 'postgresql']).default('sqlite'),
ORCA_DB_HOST: z.string().optional(),
ORCA_DB_PORT: z.string().optional(),
ORCA_DB_NAME: z.string().optional(),
ORCA_DB_USER: z.string().optional(),
ORCA_DB_PASSWORD: z.string().optional(),
ORCA_DB_POOL_MIN: z.string().default('2'),
ORCA_DB_POOL_MAX: z.string().default('10'),
ORCA_DB_POOL_IDLE_TIMEOUT: z.string().default('30000'),
```

## Implementation Steps

### Phase 1: Foundation (Steps 1-5)

1. **Install Dependencies**
   ```bash
   npm install knex pg
   ```

2. **Create Adapter Interface**
   - Create `src/db/adapters/base.js` with abstract interface
   - Define standard methods all adapters must implement

3. **Implement SQLite Adapter**
   - Create `src/db/adapters/sqlite.js`
   - Wrap existing `better-sqlite3` code
   - Maintain synchronous API for backward compatibility

4. **Implement PostgreSQL Adapter**
   - Create `src/db/adapters/postgresql.js`
   - Use Knex.js for query building
   - Implement connection pooling
   - Handle async operations

5. **Create Adapter Factory**
   - Create `src/db/adapters/factory.js`
   - Auto-detect database type from config
   - Return appropriate adapter instance

### Phase 2: Schema & Migrations (Steps 6-8)

6. **Create PostgreSQL Schema**
   - Create `src/db/migrations/001_initial_schema.js`
   - Convert SQLite schema to PostgreSQL-compatible version
   - Use Knex schema builder API

7. **Add Migration Runner**
   - Create `src/db/migrate.js` script
   - Support `up`, `down`, `latest`, `rollback` commands
   - Add to package.json scripts

8. **Create Initialization Script**
   - Create `src/db/init.js`
   - Auto-detect database type
   - Run migrations on first startup
   - Handle both SQLite and PostgreSQL

### Phase 3: Integration (Steps 9-12)

9. **Update DatabaseManager**
   - Modify [`src/db/index.js`](src/db/index.js:1-220)
   - Use adapter factory instead of direct `better-sqlite3`
   - Make methods async-compatible
   - Maintain backward compatibility

10. **Update Configuration**
    - Modify [`src/config/schema.js`](src/config/schema.js:1-42)
    - Add PostgreSQL connection validation
    - Parse connection strings
    - Validate pool settings

11. **Update Core Integration**
    - Modify [`src/core.js`](src/core.js:1-50) database calls
    - Handle async database operations
    - Update analytics tracking
    - Ensure error handling works with both adapters

12. **Update Commands**
    - Modify [`src/commands.js`](src/commands.js) database operations
    - Make analytics commands async-compatible
    - Update session management

### Phase 4: Testing & Documentation (Steps 13-16)

13. **Unit Tests**
    - Test SQLite adapter maintains compatibility
    - Test PostgreSQL adapter functionality
    - Test adapter factory selection logic
    - Test connection pooling

14. **Integration Tests**
    - Test with real PostgreSQL instance
    - Test migrations up/down
    - Test concurrent connections
    - Test connection pool exhaustion

15. **Documentation**
    - Update README with PostgreSQL setup
    - Create migration guide from SQLite
    - Document connection string formats
    - Add troubleshooting section

16. **Environment Examples**
    - Update [`.env.example`](.env.example:1-52)
    - Add PostgreSQL connection examples
    - Document pool configuration
    - Add Docker Compose example

## File Structure

```
src/db/
├── index.js                    # DatabaseManager (updated)
├── schema.sql                  # SQLite schema (kept for reference)
├── init.js                     # NEW: Database initialization
├── migrate.js                  # NEW: Migration runner
├── adapters/
│   ├── base.js                # NEW: Abstract adapter interface
│   ├── factory.js             # NEW: Adapter factory
│   ├── sqlite.js              # NEW: SQLite adapter wrapper
│   └── postgresql.js          # NEW: PostgreSQL adapter
└── migrations/
    ├── 001_initial_schema.js  # NEW: Initial PostgreSQL schema
    └── README.md              # NEW: Migration guide
```

## Connection Pooling Configuration

### PostgreSQL Pool Settings

```javascript
{
  client: 'postgresql',
  connection: process.env.ORCA_DB_URL,
  pool: {
    min: parseInt(process.env.ORCA_DB_POOL_MIN || '2'),
    max: parseInt(process.env.ORCA_DB_POOL_MAX || '10'),
    idleTimeoutMillis: parseInt(process.env.ORCA_DB_POOL_IDLE_TIMEOUT || '30000'),
    acquireTimeoutMillis: 60000,
    createTimeoutMillis: 30000,
    destroyTimeoutMillis: 5000,
    reapIntervalMillis: 1000,
    createRetryIntervalMillis: 200,
  },
  acquireConnectionTimeout: 60000
}
```

### Pool Monitoring

Add health check endpoint:
```javascript
async function checkDatabaseHealth() {
  const adapter = getDatabaseAdapter();
  const pool = adapter.getPool();
  return {
    used: pool.numUsed(),
    free: pool.numFree(),
    pending: pool.numPendingAcquires(),
    max: pool.max
  };
}
```

## Backward Compatibility Strategy

1. **Default to SQLite**: If no `ORCA_DB_TYPE` specified, use SQLite
2. **Synchronous Wrapper**: Provide sync methods for SQLite adapter
3. **Graceful Degradation**: Fall back to file-based storage on database errors
4. **Migration Path**: Support running both databases during transition

## Error Handling

### Connection Errors
```javascript
try {
  await adapter.connect(config);
} catch (error) {
  if (error.code === 'ECONNREFUSED') {
    logger.error('PostgreSQL connection refused. Is the server running?');
  } else if (error.code === '28P01') {
    logger.error('PostgreSQL authentication failed. Check credentials.');
  }
  // Fall back to SQLite or exit
}
```

### Query Errors
- Wrap all queries in try-catch
- Log SQL errors with context
- Retry transient errors (connection drops)
- Circuit breaker for repeated failures

## Performance Considerations

1. **Prepared Statements**: Use Knex query builder for parameterized queries
2. **Connection Reuse**: Pool connections, don't create per-query
3. **Batch Operations**: Use transactions for multiple inserts
4. **Index Strategy**: Maintain same indexes as SQLite schema
5. **Query Optimization**: Use EXPLAIN ANALYZE for slow queries

## Security Considerations

1. **Connection Strings**: Never log full connection strings
2. **SSL/TLS**: Support `?sslmode=require` in connection string
3. **Credentials**: Use environment variables, never hardcode
4. **SQL Injection**: Always use parameterized queries via Knex
5. **Least Privilege**: Database user should have minimal permissions

## Testing Strategy

### Unit Tests
- Mock database adapters
- Test adapter factory logic
- Test configuration parsing
- Test error handling

### Integration Tests
- Require PostgreSQL instance (Docker)
- Test full CRUD operations
- Test connection pooling
- Test migration up/down
- Test concurrent access

### Performance Tests
- Benchmark SQLite vs PostgreSQL
- Test connection pool under load
- Measure query performance
- Test with large datasets

## Deployment Guide

### Docker Compose Example
```yaml
version: '3.8'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: orca
      POSTGRES_USER: orca_user
      POSTGRES_PASSWORD: secure_password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
  
  orca:
    build: .
    environment:
      ORCA_DB_TYPE: postgresql
      ORCA_DB_URL: postgresql://orca_user:secure_password@postgres:5432/orca
    depends_on:
      - postgres

volumes:
  postgres_data:
```

### Production Checklist
- [ ] Set up PostgreSQL server
- [ ] Create database and user
- [ ] Configure connection pooling
- [ ] Enable SSL/TLS
- [ ] Set up backups
- [ ] Configure monitoring
- [ ] Run migrations
- [ ] Test connection
- [ ] Update environment variables
- [ ] Deploy application

## Migration from SQLite

### Step-by-Step Guide

1. **Backup SQLite Database**
   ```bash
   cp data/orca.db data/orca.db.backup
   ```

2. **Set Up PostgreSQL**
   ```bash
   docker-compose up -d postgres
   ```

3. **Run Migrations**
   ```bash
   npm run db:migrate
   ```

4. **Export SQLite Data** (optional)
   ```bash
   npm run db:export -- --format=sql
   ```

5. **Import to PostgreSQL** (optional)
   ```bash
   npm run db:import -- --file=export.sql
   ```

6. **Update Environment**
   ```bash
   echo "ORCA_DB_TYPE=postgresql" >> .env
   echo "ORCA_DB_URL=postgresql://..." >> .env
   ```

7. **Test Application**
   ```bash
   npm start
   ```

## Success Criteria

- [ ] Application works with both SQLite and PostgreSQL
- [ ] Connection pooling configured and monitored
- [ ] Same schema maintained across both databases
- [ ] All existing tests pass with both adapters
- [ ] Migration path documented and tested
- [ ] Performance benchmarks show acceptable overhead
- [ ] Error handling covers connection failures
- [ ] Documentation updated with PostgreSQL setup

## Next Steps After T21

- **T22**: Redis Integration for caching
- **T23**: Conversation Memory Store (can use PostgreSQL)
- **T24**: Multi-tenancy Support (PostgreSQL schemas)
- **T25**: Persistent User Sessions (PostgreSQL)

## Mermaid Diagrams

### Database Adapter Architecture

```mermaid
graph TB
    App[Application Code] --> DBM[DatabaseManager]
    DBM --> Factory[Adapter Factory]
    Factory --> |ORCA_DB_TYPE=sqlite| SQLite[SQLite Adapter]
    Factory --> |ORCA_DB_TYPE=postgresql| PG[PostgreSQL Adapter]
    SQLite --> BS3[better-sqlite3]
    PG --> Knex[Knex.js]
    Knex --> PGDriver[pg driver]
    PGDriver --> Pool[Connection Pool]
    Pool --> PGDB[(PostgreSQL)]
    BS3 --> SQLDB[(SQLite)]
```

### Migration Flow

```mermaid
sequenceDiagram
    participant App
    participant Init as init.js
    participant Factory
    participant Adapter
    participant DB as Database
    
    App->>Init: Start application
    Init->>Factory: createAdapter(type, config)
    Factory->>Adapter: new Adapter(config)
    Adapter->>DB: connect()
    DB-->>Adapter: connection
    Init->>Adapter: runMigrations()
    Adapter->>DB: CREATE TABLE IF NOT EXISTS...
    DB-->>Adapter: success
    Adapter-->>Init: ready
    Init-->>App: database initialized
```

### Connection Pool Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Idle: Pool Created
    Idle --> Acquiring: Request Connection
    Acquiring --> Active: Connection Acquired
    Active --> Idle: Release Connection
    Active --> Destroyed: Connection Error
    Idle --> Destroyed: Idle Timeout
    Destroyed --> [*]: Pool Shutdown
    
    note right of Active
        Max connections: 10
        Min connections: 2
    end note
```

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking changes to existing code | High | Maintain backward compatibility, extensive testing |
| Connection pool exhaustion | Medium | Monitor pool metrics, configure timeouts |
| Migration failures | Medium | Test migrations thoroughly, provide rollback |
| Performance degradation | Low | Benchmark both databases, optimize queries |
| Configuration complexity | Low | Provide clear examples, validation |

## Estimated Effort

- **Phase 1 (Foundation)**: 4-6 hours
- **Phase 2 (Schema & Migrations)**: 3-4 hours
- **Phase 3 (Integration)**: 4-6 hours
- **Phase 4 (Testing & Docs)**: 3-4 hours

**Total**: 14-20 hours

## Dependencies

- `knex`: ^3.1.0 (query builder)
- `pg`: ^8.11.0 (PostgreSQL driver)

## References

- [Knex.js Documentation](https://knexjs.org/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Node.js pg Driver](https://node-postgres.com/)
- [Connection Pooling Best Practices](https://node-postgres.com/features/pooling)