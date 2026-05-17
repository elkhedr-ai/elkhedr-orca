-- Drop tables if they exist (for development, in production we would use migrations)
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS agents;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS costs;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS skills;
DROP TABLE IF EXISTS input_history;

-- Users table (for authentication in later phases)
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Sessions table (replaces sessions/history.json)
CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,  -- nullable, foreign key to users (to be added later when users exist)
    prompt TEXT NOT NULL,
    mode TEXT NOT NULL,
    agent TEXT NOT NULL,
    result TEXT NOT NULL,
    tokens INTEGER NOT NULL,
    traceId TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Agents table (replaces src/agents.json for dynamic agent management)
CREATE TABLE agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    model TEXT NOT NULL,
    fallbackModel TEXT NOT NULL,
    department TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tasks table (each orchestration task)
CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,  -- nullable, foreign key to users (to be added later)
    agent_role TEXT NOT NULL,  -- the role of the agent (e.g., "Orchestrator", "Developer")
    prompt TEXT NOT NULL,
    result TEXT,
    tokens INTEGER DEFAULT 0,
    cost REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Costs table (for detailed analytics, replaces data/analytics.json)
CREATE TABLE costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,  -- foreign key to tasks
    tokens INTEGER NOT NULL,
    cost REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Events table (for event bus persistence, replaces data/events.jsonl)
CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    data TEXT,  -- JSON string
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Skills table (for skill management, replaces skills/registry.json)
CREATE TABLE skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    version TEXT NOT NULL,
    description TEXT,
    permissions TEXT,  -- JSON string representing permissions
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Input history table (for CLI up/down arrow support)
CREATE TABLE input_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    value TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Analytics aggregates table (materialized views for performance)
CREATE TABLE analytics_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,  -- YYYY-MM-DD format
    total_operations INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    total_cost REAL DEFAULT 0.0,
    agent_usage TEXT,  -- JSON string of agent usage for the day
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE analytics_weekly (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year INTEGER NOT NULL,  -- ISO year
    week INTEGER NOT NULL,  -- ISO week (1-53)
    total_operations INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    total_cost REAL DEFAULT 0.0,
    agent_usage TEXT,  -- JSON string of agent usage for the week
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE analytics_monthly (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year INTEGER NOT NULL,  -- Year (YYYY)
    month INTEGER NOT NULL,  -- Month (1-12)
    total_operations INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    total_cost REAL DEFAULT 0.0,
    agent_usage TEXT,  -- JSON string of agent usage for the month
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_created_at ON sessions(created_at);
CREATE INDEX idx_tasks_user_id ON tasks(user_id);
CREATE INDEX idx_tasks_agent_role ON tasks(agent_role);
CREATE INDEX idx_tasks_created_at ON tasks(created_at);
CREATE INDEX idx_costs_task_id ON costs(task_id);
CREATE INDEX idx_costs_created_at ON costs(created_at);
CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_events_created_at ON events(created_at);
CREATE INDEX idx_skills_name ON skills(name);
CREATE INDEX idx_input_history_created_at ON input_history(created_at);

-- Indexes for analytics aggregates (unique constraints)
CREATE UNIQUE INDEX idx_analytics_daily_date ON analytics_daily(date);
CREATE UNIQUE INDEX idx_analytics_weekly_year_week ON analytics_weekly(year, week);
CREATE UNIQUE INDEX idx_analytics_monthly_year_month ON analytics_monthly(year, month);
