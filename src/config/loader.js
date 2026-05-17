/**
 * Hot config reload with file watching
 * Watches .env and JSON config files, notifies subscribers on change
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger.js');

let chokidar;
try {
  chokidar = require('chokidar');
} catch {
  // Graceful degradation if chokidar not installed
}

const subscribers = new Set();
let watcher = null;
let isWatching = false;

/**
 * Compute simple diff between two config objects
 * @returns {Array<{key: string, old: any, new: any}>}
 */
function diffConfig(oldConfig, newConfig) {
  const changes = [];
  const allKeys = new Set([...Object.keys(oldConfig || {}), ...Object.keys(newConfig || {})]);
  
  for (const key of allKeys) {
    if (JSON.stringify(oldConfig?.[key]) !== JSON.stringify(newConfig?.[key])) {
      changes.push({ key, old: oldConfig?.[key], new: newConfig?.[key] });
    }
  }
  
  return changes;
}

/**
 * Register a callback to be notified on config changes
 * Callback receives: (newConfig, oldConfig, changes)
 */
function subscribe(callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('Subscriber must be a function');
  }
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

/**
 * Remove a subscriber
 */
function unsubscribe(callback) {
  subscribers.delete(callback);
}

/**
 * Notify all subscribers of config change
 */
function notify(newConfig, oldConfig, changes) {
  for (const callback of subscribers) {
    try {
      callback(newConfig, oldConfig, changes);
    } catch (error) {
      logger.error({ error: error.message }, 'Config subscriber error');
    }
  }
}

/**
 * Start watching config files for changes
 * @param {Object} options
 * @param {string} options.envPath - Path to .env file
 * @param {string[]} options.configPaths - Additional JSON config files to watch
 * @param {Function} options.reloadFn - Function to call to reload config
 * @param {Function} options.getConfigFn - Function to get current config
 */
function startWatching(options = {}) {
  if (!chokidar) {
    logger.warn('chokidar not installed, hot reload disabled');
    return { stop: () => {} };
  }
  
  if (isWatching) {
    logger.warn('Config watcher already running');
    return { stop: () => {} };
  }
  
  const envPath = options.envPath || path.join(process.cwd(), '.env');
  const configPaths = options.configPaths || [];
  const reloadFn = options.reloadFn;
  const getConfigFn = options.getConfigFn;
  
  if (!reloadFn || !getConfigFn) {
    throw new Error('reloadFn and getConfigFn are required');
  }
  
  const watchPaths = [envPath, ...configPaths].filter(p => fs.existsSync(p));
  
  if (watchPaths.length === 0) {
    logger.warn('No config files found to watch');
    return { stop: () => {} };
  }
  
  watcher = chokidar.watch(watchPaths, {
    persistent: false,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100
    }
  });
  
  watcher.on('change', async (filePath) => {
    logger.info({ file: filePath }, 'Config file changed, reloading');
    
    try {
      const oldConfig = getConfigFn();
      
      // For .env files, we need to reload dotenv with override
      if (filePath.endsWith('.env')) {
        require('dotenv').config({ path: filePath, override: true });
      }
      
      const newConfig = reloadFn();
      const changes = diffConfig(oldConfig, newConfig);
      
      if (changes.length > 0) {
        logger.info(
          { changes: changes.map(c => ({ key: c.key, old: c.old, new: c.new })) },
          'Configuration reloaded'
        );
        notify(newConfig, oldConfig, changes);
      } else {
        logger.info('Config file changed but no values modified');
      }
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to reload config');
    }
  });
  
  watcher.on('error', (error) => {
    logger.error({ error: error.message }, 'Config watcher error');
  });
  
  isWatching = true;
  logger.info({ files: watchPaths }, 'Config hot reload watching');
  
  return {
    stop: () => {
      if (watcher) {
        watcher.close();
        watcher = null;
        isWatching = false;
        logger.info('Config watcher stopped');
      }
    }
  };
}

/**
 * Manually trigger a config reload
 */
function reload(options = {}) {
  const reloadFn = options.reloadFn;
  const getConfigFn = options.getConfigFn;
  
  if (!reloadFn || !getConfigFn) {
    throw new Error('reloadFn and getConfigFn are required');
  }
  
  const oldConfig = getConfigFn();
  const newConfig = reloadFn();
  const changes = diffConfig(oldConfig, newConfig);
  
  if (changes.length > 0) {
    notify(newConfig, oldConfig, changes);
  }
  
  return { newConfig, oldConfig, changes };
}

/**
 * Get current subscriber count
 */
function getSubscriberCount() {
  return subscribers.size;
}

/**
 * Check if watcher is active
 */
function isWatchingActive() {
  return isWatching;
}

module.exports = {
  subscribe,
  unsubscribe,
  startWatching,
  reload,
  diffConfig,
  getSubscriberCount,
  isWatchingActive
};
