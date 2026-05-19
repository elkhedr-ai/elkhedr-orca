/**
 * Local Model Support
 * Integration with Ollama and LM Studio for local model inference.
 */

const axios = require('axios');
const { logger } = require('../utils/logger.js');

const OLLAMA_DEFAULT_URL = 'http://localhost:11434';
const LMSTUDIO_DEFAULT_URL = 'http://localhost:1234';

function getLocalConfig() {
  try {
    const { getConfig } = require('../config/index.js');
    return getConfig();
  } catch {
    return {};
  }
}

class LocalModelClient {
  constructor(options = {}) {
    const config = getLocalConfig();
    this.ollamaUrl = options.ollamaUrl || config.OLLAMA_URL || process.env.OLLAMA_URL || OLLAMA_DEFAULT_URL;
    this.lmStudioUrl = options.lmStudioUrl || config.LMSTUDIO_URL || process.env.LMSTUDIO_URL;
    this.timeout = options.timeout || 60000;
    this._availability = { ollama: null, lmstudio: null, lastCheck: 0 };
  }

  /**
   * Check if Ollama is available
   */
  async checkOllama() {
    try {
      const response = await axios.get(`${this.ollamaUrl}/api/tags`, { timeout: 5000 });
      return {
        available: true,
        models: response.data.models || []
      };
    } catch (error) {
      return { available: false, error: error.message };
    }
  }

  /**
   * Check if LM Studio is available
   */
  async checkLmStudio() {
    if (!this.lmStudioUrl) return { available: false, error: 'LMSTUDIO_URL not configured' };
    try {
      const response = await axios.get(`${this.lmStudioUrl}/v1/models`, { timeout: 5000 });
      return {
        available: true,
        models: response.data.data || []
      };
    } catch (error) {
      return { available: false, error: error.message };
    }
  }

  /**
   * Check availability of all local providers
   */
  async isAvailable() {
    const now = Date.now();
    // Cache availability for 30 seconds
    if (now - this._availability.lastCheck < 30000 && this._availability.ollama !== null) {
      return this._availability;
    }

    const ollama = await this.checkOllama();
    const lmstudio = await this.checkLmStudio();

    this._availability = {
      ollama: ollama.available,
      lmstudio: lmstudio.available,
      any: ollama.available || lmstudio.available,
      lastCheck: now
    };

    return this._availability;
  }

  /**
   * List available local models
   */
  async listModels() {
    const ollama = await this.checkOllama();
    const models = [];

    if (ollama.available) {
      for (const model of ollama.models) {
        models.push({
          id: `ollama-${model.name}`,
          name: model.name,
          provider: 'local',
          type: 'ollama',
          size: model.size,
          modified_at: model.modified_at,
          endpoint: `${this.ollamaUrl}/api/generate`,
          chatEndpoint: `${this.ollamaUrl}/api/chat`
        });
      }
    }

    if (this.lmStudioUrl) {
      try {
        const response = await axios.get(`${this.lmStudioUrl}/v1/models`, { timeout: 5000 });
        for (const model of response.data.data || []) {
          models.push({
            id: `lmstudio-${model.id}`,
            name: model.id,
            provider: 'local',
            type: 'lmstudio',
            endpoint: `${this.lmStudioUrl}/v1/chat/completions`
          });
        }
      } catch (error) {
        logger.warn({ error: error.message }, 'LM Studio not available');
      }
    }

    return models;
  }

  /**
   * Generate completion via Ollama (prompt-based)
   */
  async generateOllama(modelName, prompt, options = {}) {
    const response = await axios.post(
      `${this.ollamaUrl}/api/generate`,
      {
        model: modelName,
        prompt,
        stream: false,
        options: {
          temperature: options.temperature || 0.7,
          num_predict: options.maxTokens || 2048
        }
      },
      { timeout: this.timeout }
    );

    return {
      text: response.data.response,
      done: response.data.done,
      total_duration: response.data.total_duration,
      load_duration: response.data.load_duration,
      prompt_eval_count: response.data.prompt_eval_count,
      eval_count: response.data.eval_count
    };
  }

  /**
   * Chat completion via Ollama (OpenAI-compatible messages)
   */
  async chatOllama(modelName, messages, options = {}) {
    const response = await axios.post(
      `${this.ollamaUrl}/api/chat`,
      {
        model: modelName,
        messages,
        stream: false,
        options: {
          temperature: options.temperature || 0.7,
          num_predict: options.maxTokens || 2048
        }
      },
      { timeout: this.timeout }
    );

    return {
      text: response.data.message?.content || '',
      done: response.data.done,
      total_duration: response.data.total_duration,
      prompt_eval_count: response.data.prompt_eval_count,
      eval_count: response.data.eval_count
    };
  }

  /**
   * Chat completion via LM Studio
   */
  async chatLmStudio(modelName, messages, options = {}) {
    const response = await axios.post(
      `${this.lmStudioUrl}/v1/chat/completions`,
      {
        model: modelName,
        messages,
        temperature: options.temperature || 0.7,
        max_tokens: options.maxTokens || 2048
      },
      { timeout: this.timeout }
    );

    return {
      text: response.data.choices[0].message.content,
      usage: response.data.usage
    };
  }

  /**
   * Unified generate method — dispatches to the correct backend
   */
  async generate(modelConfig, promptOrMessages, options = {}) {
    const messages = typeof promptOrMessages === 'string'
      ? [{ role: 'user', content: promptOrMessages }]
      : promptOrMessages;

    if (modelConfig.type === 'ollama') {
      return this.chatOllama(modelConfig.name, messages, options);
    } else if (modelConfig.type === 'lmstudio') {
      return this.chatLmStudio(modelConfig.name, messages, options);
    }
    throw new Error(`Unknown local model type: ${modelConfig.type}`);
  }

  /**
   * Compare local vs cloud latency
   */
  async benchmark(prompt = 'Hello, how are you?') {
    const results = {
      local: null,
      cloud: null
    };

    // Test local
    const ollama = await this.checkOllama();
    if (ollama.available && ollama.models.length > 0) {
      const start = Date.now();
      try {
        await this.generateOllama(ollama.models[0].name, prompt);
        results.local = { latency: Date.now() - start, available: true };
      } catch (error) {
        results.local = { error: error.message, available: false };
      }
    }

    // Test cloud (simple ping to OpenRouter)
    const start = Date.now();
    try {
      await axios.get('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
        timeout: 10000
      });
      results.cloud = { latency: Date.now() - start, available: true };
    } catch (error) {
      results.cloud = { error: error.message, available: false };
    }

    return results;
  }
}

let _instance = null;

function getLocalModelClient(options = {}) {
  if (!_instance || options.reset) {
    _instance = new LocalModelClient(options);
  }
  return _instance;
}

module.exports = {
  LocalModelClient,
  OLLAMA_DEFAULT_URL,
  LMSTUDIO_DEFAULT_URL,
  getLocalModelClient
};
