/**
 * Initial database schema migration
 * Creates all tables with PostgreSQL-compatible types
 */

exports.up = async function(knex) {
  // Users table (for authentication in later phases)
  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.string('username', 255).notNullable().unique();
    table.string('email', 255).notNullable().unique();
    table.string('password_hash', 255).notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Sessions table (replaces sessions/history.json)
  await knex.schema.createTable('sessions', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().nullable();
    table.text('prompt').notNullable();
    table.string('mode', 50).notNullable();
    table.string('agent', 255).notNullable();
    table.text('result').notNullable();
    table.integer('tokens').notNullable();
    table.string('traceId', 255).nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    // Foreign key will be added when users table is populated
    // table.foreign('user_id').references('users.id').onDelete('SET NULL');
  });

  // Agents table (replaces src/agents.json for dynamic agent management)
  await knex.schema.createTable('agents', (table) => {
    table.increments('id').primary();
    table.string('name', 255).notNullable();
    table.string('role', 255).notNullable();
    table.string('model', 255).notNullable();
    table.string('fallbackModel', 255).notNullable();
    table.string('department', 100).nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Tasks table (each orchestration task)
  await knex.schema.createTable('tasks', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().nullable();
    table.string('agent_role', 255).notNullable();
    table.text('prompt').notNullable();
    table.text('result').nullable();
    table.integer('tokens').defaultTo(0);
    table.decimal('cost', 10, 6).defaultTo(0.0);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    // Foreign key will be added when users table is populated
    // table.foreign('user_id').references('users.id').onDelete('SET NULL');
  });

  // Costs table (for detailed analytics, replaces data/analytics.json)
  await knex.schema.createTable('costs', (table) => {
    table.increments('id').primary();
    table.integer('task_id').unsigned().nullable();
    table.integer('tokens').notNullable();
    table.decimal('cost', 10, 6).notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    // Foreign key to tasks
    table.foreign('task_id').references('tasks.id').onDelete('CASCADE');
  });

  // Events table (for event bus persistence, replaces data/events.jsonl)
  await knex.schema.createTable('events', (table) => {
    table.increments('id').primary();
    table.string('type', 100).notNullable();
    table.text('data').nullable(); // JSON string
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Skills table (for skill management, replaces skills/registry.json)
  await knex.schema.createTable('skills', (table) => {
    table.increments('id').primary();
    table.string('name', 255).notNullable().unique();
    table.string('version', 50).notNullable();
    table.text('description').nullable();
    table.text('permissions').nullable(); // JSON string
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Input history table (for CLI up/down arrow support)
  await knex.schema.createTable('input_history', (table) => {
    table.increments('id').primary();
    table.text('value').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Create indexes for performance
  await knex.schema.table('sessions', (table) => {
    table.index('user_id', 'idx_sessions_user_id');
    table.index('created_at', 'idx_sessions_created_at');
  });

  await knex.schema.table('tasks', (table) => {
    table.index('user_id', 'idx_tasks_user_id');
    table.index('agent_role', 'idx_tasks_agent_role');
    table.index('created_at', 'idx_tasks_created_at');
  });

  await knex.schema.table('costs', (table) => {
    table.index('task_id', 'idx_costs_task_id');
    table.index('created_at', 'idx_costs_created_at');
  });

  await knex.schema.table('events', (table) => {
    table.index('type', 'idx_events_type');
    table.index('created_at', 'idx_events_created_at');
  });

  await knex.schema.table('skills', (table) => {
    table.index('name', 'idx_skills_name');
  });

  await knex.schema.table('input_history', (table) => {
    table.index('created_at', 'idx_input_history_created_at');
  });
};

exports.down = async function(knex) {
  // Drop tables in reverse order to handle foreign keys
  await knex.schema.dropTableIfExists('input_history');
  await knex.schema.dropTableIfExists('skills');
  await knex.schema.dropTableIfExists('events');
  await knex.schema.dropTableIfExists('costs');
  await knex.schema.dropTableIfExists('tasks');
  await knex.schema.dropTableIfExists('agents');
  await knex.schema.dropTableIfExists('sessions');
  await knex.schema.dropTableIfExists('users');
};

// Made with Bob
