const { initializeDatabaseInstance } = require('../db');
const { getVectorStore } = require('../rag/vector');
const { logger } = require('../utils/logger.js');

/**
 * Add a new knowledge fact.
 */
async function addFact(agentId, sessionId, title, content, type = 'markdown', userId = null) {
  const db = await initializeDatabaseInstance();
  const entryId = await db.createKnowledgeEntry({ agentId, sessionId, userId, title, content, type });
  await indexFact(entryId);
  return entryId;
}

/**
 * Update an existing fact (creates a version).
 */
async function updateFact(entryId, content, userId = null) {
  const db = await initializeDatabaseInstance();
  await db.updateKnowledgeEntry(entryId, { content, userId });
  await indexFact(entryId, userId);
}

/**
 * Search knowledge for an agent.
 */
async function findFacts(agentId, query, limit = 5, userId = null) {
  const db = await initializeDatabaseInstance();
  const lexicalResults = await db.searchKnowledge(agentId, query, userId, limit);
  const resultsById = new Map(lexicalResults.map(result => [result.id, result]));

  try {
    const store = getVectorStore();
    const semanticResults = await store.hybridSearch(query, {
      limit,
      agentId,
      userId,
      sourceType: 'knowledge_entry'
    });

    for (const result of semanticResults) {
      const entryId = result.metadata?.knowledgeEntryId;
      if (!entryId || resultsById.has(entryId)) {
        continue;
      }

      const entry = await db.getKnowledgeEntryById(entryId, userId);
      if (entry && entry.agent_id === agentId) {
        resultsById.set(entryId, {
          id: entry.id,
          title: entry.title,
          content_type: entry.content_type,
          created_at: entry.created_at,
          similarity: result.similarity
        });
      }
    }
  } catch (error) {
    logger.warn({ error: error.message }, 'Semantic knowledge search failed');
  }

  return Array.from(resultsById.values()).slice(0, limit);
}

/**
 * Retrieve a specific entry.
 */
async function getFact(entryId) {
  const db = await initializeDatabaseInstance();
  return await db.getKnowledgeEntryById(entryId);
}

async function indexFact(entryId, userId = null) {
  const db = await initializeDatabaseInstance();
  const entry = await db.getKnowledgeEntryById(entryId, userId);
  if (!entry) {
    return;
  }

  try {
    const store = getVectorStore();
    await store.storeDocument(`knowledge-${entry.id}`, entry.content, {
      sourceType: 'knowledge_entry',
      knowledgeEntryId: entry.id,
      title: entry.title,
      agentId: entry.agent_id,
      sessionId: entry.session_id,
      userId: entry.user_id,
      contentType: entry.content_type,
      indexedAt: new Date().toISOString()
    });
  } catch (error) {
    logger.warn({ entryId, error: error.message }, 'Knowledge entry vector indexing failed');
  }
}

module.exports = { addFact, updateFact, findFacts, getFact, indexFact };
