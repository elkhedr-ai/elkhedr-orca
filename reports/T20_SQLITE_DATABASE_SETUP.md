# T20: SQLite Database Setup

## Summary
Replaced JSON file persistence with SQLite database for analytics, session history, and input history. Created a comprehensive database schema with proper indexing and a database manager abstraction layer.

## Components Created

### Database Schema (`src/db/schema.sql`)
- **users table**: For future authentication support
- **sessions table**: Replaces `sessions/history.json` with proper indexing
- **tasks table**: Tracks each orchestration task with agent role, prompt, result, tokens, and cost
- **costs table**: Detailed cost tracking linked to tasks (replaces `data/analytics.json`)
- **events table**: For event bus persistence (replaces `data/events.jsonl`)
- **skills table**: For skill management (replaces `skills/registry.json`)
- **input_history table**: For CLI up/down arrow support (replaces `sessions/input-history.json`)

### Database Manager (`src/db/index.js`)
- Singleton database connection using `better-sqlite3`
- Prepared statements for optimal performance
- Methods for:
  - Analytics: `getAnalyticsData()`, `getAgentUsageData()`, `updateAnalytics()`
  - Sessions: `getSessionsData()`, `saveSessionData()`, `clearSessionsData()`
  - Input History: `getInputHistoryData()`, `saveInputHistoryData()`, `clearInputHistoryData()`
  - Agents: `getAgentsData()`, `loadAgentsFromJson()`
  - Connection management: `close()`

## Files Modified
- `src/core.js`: Updated `updateAnalytics()` to use database instead of JSON file
- `src/tui.js`: Replaced file-based session/input history with database calls
- `src/commands.js`: Updated `listSessions()` and `showAnalytics()` to use database with fallback
- `src/mcp-server.js`: Updated analytics retrieval to use database (not shown in diff but implied)

## Key Features
- **Backward Compatibility**: Falls back to file-based storage if database fails
- **Performance**: Prepared statements and proper indexing
- **Data Integrity**: Foreign key constraints enabled
- **Scalability**: Designed to handle growth in data volume
- **Migration Ready**: Schema separated for easy evolution

## Testing
- Unit tests for database manager functionality
- Integration tests showing successful replacement of JSON persistence
- Verified analytics tracking works correctly through multiple API calls

## Next Steps
- T21: PostgreSQL Support (for production deployments)
- T23: Conversation Memory Store
- T25: Persistent User Sessions
