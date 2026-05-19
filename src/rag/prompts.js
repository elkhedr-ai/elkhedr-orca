/**
 * Retrieval-Augmented Generation (RAG)
 * Enhances agent prompts with retrieved context from knowledge base.
 */

const { getVectorStore } = require('./vector.js');
const { initializeDatabaseInstance } = require('../db');
const { logger } = require('../utils/logger.js');

const RAG_PROMPT_TEMPLATE = `You are an AI assistant with access to a knowledge base.
Answer the user's question using the provided context. If the context doesn't contain the answer, say so clearly.
Always cite your sources using [Source: N] format.

Context:
{context}

User Question: {question}

Instructions:
- Base your answer primarily on the provided context
- If multiple sources are relevant, cite them all
- Be concise but complete
- If the context is insufficient, say "I don't have enough information to answer this question."

Answer:`;

/**
 * Retrieve relevant context and build RAG prompt
 * @param {string} query - User query
 * @param {Object} options - Retrieval options
 * @returns {Promise<Object>} { prompt, sources, confidence }
 */
async function buildRagPrompt(query, options = {}) {
  const store = getVectorStore();
  const results = await store.hybridSearch(query, {
    limit: options.limit || Number.parseInt(process.env.ORCA_RAG_LIMIT || '3', 10),
    threshold: options.threshold ?? Number.parseFloat(process.env.ORCA_RAG_THRESHOLD || '0.15'),
    agentId: options.agentId,
    userId: options.userId,
    metadata: options.metadata,
    sourceType: options.sourceType
  });

  if (results.length === 0) {
    return {
      prompt: query,
      sources: [],
      confidence: 0
    };
  }

  const context = results.map((r, i) =>
    `[Source: ${i + 1}] ${r.text}${r.metadata?.title ? ` (from: ${r.metadata.title})` : ''}`
  ).join('\n\n');

  const avgSimilarity = results.reduce((sum, r) => sum + (r.similarity || 0), 0) / results.length;
  const confidence = Math.min(avgSimilarity * 2, 1); // Scale to 0-1

  const prompt = RAG_PROMPT_TEMPLATE
    .replace('{context}', context)
    .replace('{question}', query);

  return {
    prompt,
    sources: results.map((r, i) => ({
      index: i + 1,
      documentId: r.documentId,
      text: r.text,
      similarity: r.similarity,
      source: r.source,
      metadata: r.metadata
    })),
    confidence
  };
}

/**
 * Process agent response to extract citations
 * @param {string} response - Raw agent response
 * @returns {Object} { text, citations }
 */
function extractCitations(response) {
  const citationRegex = /\[Source:?\s*(\d+)\]/gi;
  const citations = [];
  let match;
  while ((match = citationRegex.exec(response)) !== null) {
    citations.push(parseInt(match[1]));
  }

  // Clean response
  const cleanText = response.replace(/\[Source:?\s*\d+\]/gi, '').trim();

  return {
    text: cleanText,
    citations: [...new Set(citations)]
  };
}

/**
 * RAG-enabled agent query
 * Retrieves context, sends to agent, extracts citations
 * @param {string} query - User question
 * @param {Object} agentConfig - Agent configuration
 * @returns {Promise<Object>} { answer, sources, confidence }
 */
async function queryWithRag(query, agentConfig = {}) {
  const startTime = Date.now();

  try {
    const { prompt, sources, confidence } = await buildRagPrompt(query, {
      limit: agentConfig.ragLimit || 3,
      threshold: agentConfig.ragThreshold ?? 0.15,
      agentId: agentConfig.agentId,
      userId: agentConfig.userId,
      metadata: agentConfig.ragMetadata,
      sourceType: agentConfig.sourceType
    });

    // If no relevant context found, return direct answer
    if (sources.length === 0 || confidence < (agentConfig.minConfidence ?? 0.2)) {
      logger.info({ query, confidence }, 'RAG: insufficient context, using direct query');
      return {
        answer: null, // Signal to use normal agent query
        sources: [],
        confidence: 0,
        usedRag: false
      };
    }

    logger.info({ query, sources: sources.length, confidence }, 'RAG: context retrieved');

    return {
      prompt, // This is the enhanced prompt to send to agent
      sources,
      confidence,
      usedRag: true,
      retrievalTime: Date.now() - startTime
    };
  } catch (error) {
    logger.error({ error: error.message }, 'RAG query failed');
    return {
      answer: null,
      sources: [],
      confidence: 0,
      usedRag: false,
      error: error.message
    };
  }
}

/**
 * Store knowledge base entry with vector embeddings
 * @param {string} title - Document title
 * @param {string} content - Document content
 * @param {Object} metadata - Additional metadata
 */
async function indexKnowledgeEntry(title, content, metadata = {}) {
  const db = await initializeDatabaseInstance();
  const agentId = metadata.agentId || 'rag-system';
  const sessionId = metadata.sessionId || null;
  const userId = metadata.userId || null;
  const type = metadata.type || metadata.contentType || 'markdown';
  const entryId = await db.createKnowledgeEntry({
    agentId,
    sessionId,
    userId,
    title,
    content,
    type
  });

  const documentId = `knowledge-${entryId}`;
  const store = getVectorStore();
  const chunks = await store.storeDocument(documentId, content, {
    ...metadata,
    sourceType: 'knowledge_entry',
    knowledgeEntryId: entryId,
    documentId,
    title,
    agentId,
    sessionId,
    userId,
    contentType: type,
    indexedAt: new Date().toISOString()
  });

  logger.info({ documentId, entryId, title, chunks }, 'Knowledge entry indexed');
  return { documentId, entryId, chunks };
}

module.exports = {
  buildRagPrompt,
  extractCitations,
  queryWithRag,
  indexKnowledgeEntry
};
