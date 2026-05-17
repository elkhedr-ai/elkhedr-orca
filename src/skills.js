/**
 * Skills Module - Backward-compatible wrapper around plugin system
 * 
 * New code should use the plugin registry directly:
 *   const { registry } = require('./plugins/registry.js');
 *   registry.execute('terminal', { command: 'ls' });
 */

const { loadSkills } = require('./plugins/loader.js');
const { registry } = require('./plugins/registry.js');

// Initialize plugin system on first require
let initialized = false;

function init() {
  if (!initialized) {
    loadSkills();
    initialized = true;
  }
}

// Backward-compatible exports
async function executeTerminal(command) {
  init();
  return registry.execute('terminal', { command });
}

async function webSearch(query) {
  init();
  return registry.execute('web-search', { query });
}

async function fetchUrl(url) {
  init();
  return registry.execute('url-fetch', { url });
}

// Tool definitions for OpenRouter
function getToolDefinitions() {
  init();
  return registry.getToolDefinitions();
}

// Expose registry for advanced usage
module.exports = {
  // Legacy API (backward compatible)
  executeTerminal,
  webSearch,
  fetchUrl,
  get toolDefinitions() {
    return getToolDefinitions();
  },
  
  // New API
  registry,
  init,
  loadSkills
};
