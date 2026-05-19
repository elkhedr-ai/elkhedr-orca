/**
 * Vector embeddings schema
 * Stores document chunks and local or hosted embedding vectors for RAG.
 */

exports.up = async function(knex) {
  const hasTable = await knex.schema.hasTable('vector_embeddings');

  if (!hasTable) {
    await knex.schema.createTable('vector_embeddings', (table) => {
      table.increments('id').primary();
      table.string('document_id', 255).notNullable();
      table.integer('chunk_index').notNullable();
      table.text('text').notNullable();
      table.text('embedding').notNullable();
      table.string('embedding_model', 100).notNullable().defaultTo('local-hashing-v1');
      table.integer('dimensions').notNullable().defaultTo(256);
      table.text('metadata').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.unique(['document_id', 'chunk_index']);
    });
  }

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_vector_document ON vector_embeddings(document_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_vector_created_at ON vector_embeddings(created_at)');
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('vector_embeddings');
};
