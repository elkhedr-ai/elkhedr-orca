/**
 * Knowledge Base skill – exposes a tool for agents to store and retrieve knowledge.
 */

const { addFact, updateFact, findFacts, getFact } = require('../kb/manager');

module.exports = {
  name: 'knowledge_base',
  description: 'Store and retrieve knowledge items (markdown or code).',
  permissions: ['read', 'write'],
  // Define the tool schema for OpenRouter function calling
  toolDefinition: {
    type: 'function',
    function: {
      name: 'knowledge_base',
      description: 'Add, update, search or get knowledge entries.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'update', 'search', 'get'], description: 'Operation to perform' },
          title: { type: 'string', description: 'Title of the entry (required for add)' },
          content: { type: 'string', description: 'Content body (required for add/update)' },
          type: { type: 'string', enum: ['markdown', 'code'], description: 'Content type' },
          entryId: { type: 'integer', description: 'ID of entry to update/get' },
          query: { type: 'string', description: 'Search query (required for search)' },
          limit: { type: 'integer', default: 5, description: 'Maximum results to return' }
        },
        required: ['action']
      }
    }
  },
  async execute(args) {
    const { action, title, content, type, entryId, query, limit } = args;
    switch (action) {
      case 'add':
        if (!title || !content) throw new Error('title and content are required for add');
        const newId = await addFact(this.agentId || 'unknown', null, title, content, type || 'markdown');
        return `Knowledge entry added with ID ${newId}.`;
      case 'update':
        if (!entryId || !content) throw new Error('entryId and content required for update');
        await updateFact(entryId, content);
        return `Knowledge entry ${entryId} updated.`;
      case 'search':
        if (!query) throw new Error('query required for search');
        const results = await findFacts(this.agentId || 'unknown', query, limit || 5);
        return JSON.stringify(results);
      case 'get':
        if (!entryId) throw new Error('entryId required for get');
        const entry = await getFact(entryId);
        return JSON.stringify(entry);
      default:
        throw new Error(`Unsupported action: ${action}`);
    }
  }
};
