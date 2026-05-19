const { getDatabaseInstance } = require('../db');
const { getUserContext } = require('../auth/context');

/**
 * Add a message to the conversation store.
 * @param {string} agentId
 * @param {string} sessionId
 * @param {'user'|'assistant'} role
 * @param {string} content
 * @param {number|null} userId - Optional user_id for isolation
 */
async function addMessage(agentId, sessionId, role, content, userId = null) {
  const db = await getDatabaseInstance();
  const ctxUserId = userId !== null ? userId : getUserContext().userId;
  await db.addConversationMessage({ agentId, sessionId, userId: ctxUserId, role, content });
}

/**
 * Retrieve recent messages for an agent/session.
 * Returns an array of {role, content} suitable for LLM payloads.
 * @param {string} agentId
 * @param {string} sessionId
 * @param {number} [windowSize=20]
 * @param {number|null} userId - Optional user_id for isolation
 */
async function getContext(agentId, sessionId, windowSize = 20, userId = null) {
  const db = await getDatabaseInstance();
  const ctxUserId = userId !== null ? userId : getUserContext().userId;
  const rows = await db.getRecentMessages({ agentId, sessionId, userId: ctxUserId, limit: windowSize });
  return rows.map(r => ({ role: r.role, content: r.content }));
}

module.exports = { addMessage, getContext };
