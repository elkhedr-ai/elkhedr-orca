/**
 * T67: Agent Performance Metrics
 * Add latency, success, model_used, and error_type columns to tasks table
 * for per-agent performance tracking.
 */

exports.up = async function(knex) {
  // Add performance columns to tasks table
  const hasLatency = await knex.schema.hasColumn('tasks', 'latency_ms');
  if (!hasLatency) {
    await knex.schema.table('tasks', (table) => {
      table.integer('latency_ms').nullable().comment('API call latency in milliseconds');
      table.boolean('success').defaultTo(true).comment('Whether the agent call succeeded');
      table.string('model_used', 255).nullable().comment('Model that served the response');
      table.string('error_type', 100).nullable().comment('Error category if failed');
    });
  }

  // Create agent_metrics table for pre-aggregated per-agent performance data
  const hasMetrics = await knex.schema.hasTable('agent_metrics');
  if (!hasMetrics) {
    await knex.schema.createTable('agent_metrics', (table) => {
      table.increments('id').primary();
      table.string('agent_role', 255).notNullable();
      table.integer('total_calls').defaultTo(0);
      table.integer('successful_calls').defaultTo(0);
      table.integer('failed_calls').defaultTo(0);
      table.integer('total_tokens').defaultTo(0);
      table.decimal('total_cost', 12, 6).defaultTo(0.0);
      table.integer('total_latency_ms').defaultTo(0);
      table.integer('min_latency_ms').nullable();
      table.integer('max_latency_ms').nullable();
      table.timestamp('last_call_at').nullable();
      table.timestamp('updated_at').defaultTo(knex.fn.now());

      table.unique('agent_role', { indexName: 'idx_agent_metrics_role' });
    });
  }

  // Add indexes for the new columns
  await knex.schema.table('tasks', (table) => {
    table.index('success', 'idx_tasks_success');
    table.index('model_used', 'idx_tasks_model_used');
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('agent_metrics');

  const hasLatency = await knex.schema.hasColumn('tasks', 'latency_ms');
  if (hasLatency) {
    await knex.schema.table('tasks', (table) => {
      table.dropColumn('latency_ms');
      table.dropColumn('success');
      table.dropColumn('model_used');
      table.dropColumn('error_type');
    });
  }
};
