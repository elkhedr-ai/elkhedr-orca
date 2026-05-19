/**
 * Vector Database
 * Persistent vector store with deterministic local embeddings.
 * The local embedding backend is intentionally dependency-free and can be
 * replaced by OpenAI, ChromaDB, or Pinecone without changing callers.
 */

const { getDatabaseInstance, initializeDatabaseInstance } = require('../db');
const { logger } = require('../utils/logger.js');

const DEFAULT_EMBEDDING_DIMENSIONS = 256;
const DEFAULT_EMBEDDING_MODEL = 'local-hashing-v1';
const DEFAULT_SEARCH_THRESHOLD = 0.15;

class VectorStore {
  constructor(options = {}) {
    this.dimensions = Number.parseInt(
      options.dimensions || process.env.ORCA_VECTOR_DIMENSIONS || DEFAULT_EMBEDDING_DIMENSIONS,
      10
    );
    if (!Number.isInteger(this.dimensions) || this.dimensions <= 0) {
      this.dimensions = DEFAULT_EMBEDDING_DIMENSIONS;
    }

    this.embeddingModel = options.embeddingModel || process.env.ORCA_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
    this.initialized = false;
  }

  /**
   * Initialize vector store and create table
   */
  async initialize() {
    if (this.initialized) return;
    const db = await initializeDatabaseInstance();
    const adapter = db.getAdapter();

    if (adapter.getType() === 'postgresql') {
      await this.initializePostgreSQL(adapter);
    } else {
      await this.initializeSQLite(adapter);
    }

    this.initialized = true;
    logger.info({ dimensions: this.dimensions, embeddingModel: this.embeddingModel }, 'Vector store initialized');
  }

  async initializeSQLite(adapter) {
    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS vector_embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        embedding TEXT NOT NULL,
        embedding_model TEXT NOT NULL DEFAULT '${DEFAULT_EMBEDDING_MODEL}',
        dimensions INTEGER NOT NULL DEFAULT ${DEFAULT_EMBEDDING_DIMENSIONS},
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(document_id, chunk_index)
      )
    `);

    await this.ensureSQLiteColumn(adapter, 'embedding_model', `TEXT NOT NULL DEFAULT '${DEFAULT_EMBEDDING_MODEL}'`);
    await this.ensureSQLiteColumn(adapter, 'dimensions', `INTEGER NOT NULL DEFAULT ${DEFAULT_EMBEDDING_DIMENSIONS}`);
    await this.ensureSQLiteColumn(adapter, 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');

    await adapter.execute(`
      CREATE INDEX IF NOT EXISTS idx_vector_document ON vector_embeddings(document_id)
    `);
    await adapter.execute(`
      CREATE INDEX IF NOT EXISTS idx_vector_created_at ON vector_embeddings(created_at)
    `);
  }

  async ensureSQLiteColumn(adapter, columnName, definition) {
    const columns = await adapter.query('PRAGMA table_info(vector_embeddings)');
    if (!columns.some(column => column.name === columnName)) {
      await adapter.execute(`ALTER TABLE vector_embeddings ADD COLUMN ${columnName} ${definition}`);
    }
  }

  async initializePostgreSQL(adapter) {
    const knex = adapter.getClient();
    const hasTable = await knex.schema.hasTable('vector_embeddings');

    if (!hasTable) {
      await knex.schema.createTable('vector_embeddings', (table) => {
        table.increments('id').primary();
        table.string('document_id', 255).notNullable();
        table.integer('chunk_index').notNullable();
        table.text('text').notNullable();
        table.text('embedding').notNullable();
        table.string('embedding_model', 100).notNullable().defaultTo(DEFAULT_EMBEDDING_MODEL);
        table.integer('dimensions').notNullable().defaultTo(DEFAULT_EMBEDDING_DIMENSIONS);
        table.text('metadata').nullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());
        table.unique(['document_id', 'chunk_index']);
      });
    } else {
      await this.ensurePostgreSQLColumn(knex, 'embedding_model', table => {
        table.string('embedding_model', 100).notNullable().defaultTo(DEFAULT_EMBEDDING_MODEL);
      });
      await this.ensurePostgreSQLColumn(knex, 'dimensions', table => {
        table.integer('dimensions').notNullable().defaultTo(DEFAULT_EMBEDDING_DIMENSIONS);
      });
      await this.ensurePostgreSQLColumn(knex, 'updated_at', table => {
        table.timestamp('updated_at').defaultTo(knex.fn.now());
      });
    }

    await adapter.raw('CREATE INDEX IF NOT EXISTS idx_vector_document ON vector_embeddings(document_id)');
    await adapter.raw('CREATE INDEX IF NOT EXISTS idx_vector_created_at ON vector_embeddings(created_at)');
  }

  async ensurePostgreSQLColumn(knex, columnName, addColumn) {
    const hasColumn = await knex.schema.hasColumn('vector_embeddings', columnName);
    if (!hasColumn) {
      await knex.schema.alterTable('vector_embeddings', addColumn);
    }
  }

  /**
   * Tokenize text into stable search terms.
   */
  tokenize(text) {
    return String(text || '')
      .toLowerCase()
      .match(/[a-z0-9]+/g) || [];
  }

  /**
   * Deterministic non-cryptographic hash for local embeddings.
   */
  hashTerm(term) {
    let hash = 2166136261;
    for (let i = 0; i < term.length; i++) {
      hash ^= term.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  /**
   * Simple embedding function (fallback without hosted embedding APIs).
   * Uses feature hashing over tokens and bigrams so every text maps into the
   * same vector space.
   */
  async embed(text) {
    const tokens = this.tokenize(text);
    const vector = new Array(this.dimensions).fill(0);

    if (tokens.length === 0) {
      return vector;
    }

    for (const token of tokens) {
      vector[this.hashTerm(`token:${token}`) % this.dimensions] += 1;
    }

    for (let i = 0; i < tokens.length - 1; i++) {
      const bigram = `${tokens[i]} ${tokens[i + 1]}`;
      vector[this.hashTerm(`bigram:${bigram}`) % this.dimensions] += 0.5;
    }

    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return magnitude > 0 ? vector.map(v => v / magnitude) : vector;
  }

  /**
   * Cosine similarity between two vectors
   */
  cosineSimilarity(a, b) {
    if (a.length !== b.length) {
      // Pad shorter vector
      const max = Math.max(a.length, b.length);
      const pa = [...a, ...new Array(max - a.length).fill(0)];
      const pb = [...b, ...new Array(max - b.length).fill(0)];
      a = pa;
      b = pb;
    }
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  /**
   * Chunk text into smaller pieces
   */
  chunkText(text, chunkSize = 500, overlap = 50) {
    const normalized = String(text || '').trim();
    if (!normalized) {
      return [];
    }

    const safeChunkSize = Math.max(1, Number.parseInt(chunkSize, 10) || 500);
    const safeOverlap = Math.min(
      Math.max(0, Number.parseInt(overlap, 10) || 0),
      Math.max(0, safeChunkSize - 1)
    );
    const step = Math.max(1, safeChunkSize - safeOverlap);
    const words = normalized.split(/\s+/);
    const chunks = [];

    for (let i = 0; i < words.length; i += step) {
      chunks.push(words.slice(i, i + safeChunkSize).join(' '));
    }

    return chunks;
  }

  /**
   * Store document chunks with embeddings
   */
  async storeDocument(documentId, text, metadata = {}) {
    if (!documentId) {
      throw new Error('documentId is required');
    }

    await this.initialize();
    const chunks = this.chunkText(text);
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    await adapter.execute(
      'DELETE FROM vector_embeddings WHERE document_id = ?',
      [documentId]
    );

    for (let i = 0; i < chunks.length; i++) {
      const embedding = await this.embed(chunks[i]);
      await adapter.execute(
        `INSERT INTO vector_embeddings
           (document_id, chunk_index, text, embedding, embedding_model, dimensions, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          documentId,
          i,
          chunks[i],
          JSON.stringify(embedding),
          this.embeddingModel,
          this.dimensions,
          JSON.stringify(metadata)
        ]
      );
    }

    logger.info({ documentId, chunks: chunks.length }, 'Document stored in vector DB');
    return chunks.length;
  }

  /**
   * Semantic search: find most similar chunks to query
   */
  async search(query, options = {}) {
    await this.initialize();
    const limit = Math.max(1, Number.parseInt(options.limit, 10) || 5);
    const threshold = options.threshold ?? DEFAULT_SEARCH_THRESHOLD;
    const queryEmbedding = await this.embed(query);
    const db = await getDatabaseInstance();

    const rows = await db.getAdapter().query(
      'SELECT id, document_id, chunk_index, text, embedding, metadata FROM vector_embeddings'
    );

    const metadataFilter = this.buildMetadataFilter(options);
    const scored = rows
      .map(row => this.formatRow(row, queryEmbedding))
      .filter(row => this.metadataMatches(row.metadata, metadataFilter));

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.filter(r => r.similarity >= threshold).slice(0, limit);
  }

  /**
   * Hybrid search: semantic + full-text (LIKE fallback)
   */
  async hybridSearch(query, options = {}) {
    const semantic = await this.search(query, options);
    const db = await getDatabaseInstance();
    const terms = this.tokenize(query).slice(0, 8);
    const limit = Math.max(1, Number.parseInt(options.limit, 10) || 5);
    const metadataFilter = this.buildMetadataFilter(options);

    if (terms.length === 0) {
      return semantic.slice(0, limit);
    }

    const where = terms.map(() => 'LOWER(text) LIKE ?').join(' OR ');
    const params = terms.map(term => `%${term}%`);
    params.push(limit * 3);

    const textRows = await db.getAdapter().query(
      `SELECT id, document_id, chunk_index, text, metadata FROM vector_embeddings WHERE ${where} LIMIT ?`,
      params
    );

    const textResults = textRows
      .map(row => {
        const metadata = this.parseMetadata(row.metadata);
        const text = String(row.text || '').toLowerCase();
        const matchedTerms = terms.filter(term => text.includes(term)).length;
        return {
          id: row.id,
          documentId: row.document_id,
          chunkIndex: row.chunk_index,
          text: row.text,
          metadata,
          similarity: matchedTerms / terms.length,
          source: 'full-text'
        };
      })
      .filter(row => this.metadataMatches(row.metadata, metadataFilter));

    const combined = new Map();
    for (const result of semantic) {
      combined.set(result.id, result);
    }

    for (const result of textResults) {
      if (combined.has(result.id)) {
        const existing = combined.get(result.id);
        existing.source = 'hybrid';
        existing.similarity = Math.max(existing.similarity || 0, result.similarity || 0);
      } else {
        combined.set(result.id, result);
      }
    }

    return Array.from(combined.values())
      .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
      .slice(0, limit);
  }

  /**
   * Delete document embeddings
   */
  async deleteDocument(documentId) {
    await this.initialize();
    const db = await getDatabaseInstance();
    await db.getAdapter().execute(
      'DELETE FROM vector_embeddings WHERE document_id = ?',
      [documentId]
    );
  }

  /**
   * Get stats
   */
  async getStats() {
    await this.initialize();
    const db = await getDatabaseInstance();
    const rows = await db.getAdapter().query(
      'SELECT COUNT(*) as count, COUNT(DISTINCT document_id) as documents FROM vector_embeddings'
    );
    return {
      totalChunks: Number(rows[0].count || 0),
      totalDocuments: Number(rows[0].documents || 0),
      dimensions: this.dimensions,
      embeddingModel: this.embeddingModel
    };
  }

  formatRow(row, queryEmbedding) {
    const embedding = JSON.parse(row.embedding);
    return {
      id: row.id,
      documentId: row.document_id,
      chunkIndex: row.chunk_index,
      text: row.text,
      metadata: this.parseMetadata(row.metadata),
      similarity: this.cosineSimilarity(queryEmbedding, embedding),
      source: 'semantic'
    };
  }

  parseMetadata(metadata) {
    if (!metadata) {
      return {};
    }

    try {
      return JSON.parse(metadata);
    } catch (error) {
      logger.warn({ error: error.message }, 'Failed to parse vector metadata');
      return {};
    }
  }

  buildMetadataFilter(options = {}) {
    const filter = { ...(options.metadata || {}) };
    if (options.agentId !== undefined && options.agentId !== null) {
      filter.agentId = options.agentId;
    }
    if (options.userId !== undefined && options.userId !== null) {
      filter.userId = options.userId;
    }
    if (options.sourceType !== undefined && options.sourceType !== null) {
      filter.sourceType = options.sourceType;
    }
    return filter;
  }

  metadataMatches(metadata, filter) {
    return Object.entries(filter).every(([key, value]) => {
      if (key === 'userId') {
        return metadata.userId === value || metadata.userId === null || metadata.userId === undefined;
      }
      return metadata[key] === value;
    });
  }
}

// Singleton
let instance = null;
function getVectorStore() {
  if (!instance) {
    instance = new VectorStore();
  }
  return instance;
}

module.exports = {
  VectorStore,
  getVectorStore,
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_SEARCH_THRESHOLD
};
