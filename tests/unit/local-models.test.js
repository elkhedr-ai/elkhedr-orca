/**
 * Tests for T44: Local Model Support
 * Tests LocalModelClient, config integration, and hybrid routing.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

// Mock axios before importing modules
const mockAxios = {
  get: async () => ({ data: { models: [{ name: 'llama3', size: 4000000000, modified_at: '2024-01-01' }] } }),
  post: async () => ({ data: { response: 'Hello!', done: true, total_duration: 1000000, prompt_eval_count: 10, eval_count: 5 } })
};

// Intercept require for axios
const originalRequire = require;
const Module = require('module');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent) {
  if (request === 'axios') return 'axios';
  return originalResolve.call(this, request, parent);
};
const originalLoad = Module._cache;
require.cache['axios'] = { id: 'axios', exports: mockAxios, loaded: true, filename: 'axios' };

const { LocalModelClient, getLocalModelClient } = require('../../src/models/local.js');

describe('T44: LocalModelClient', () => {
  let client;

  beforeEach(() => {
    client = new LocalModelClient({
      ollamaUrl: 'http://localhost:11434',
      lmStudioUrl: 'http://localhost:1234'
    });
  });

  it('should initialize with default Ollama URL', () => {
    const c = new LocalModelClient();
    assert.strictEqual(c.ollamaUrl, 'http://localhost:11434');
  });

  it('should initialize with custom URLs', () => {
    assert.strictEqual(client.ollamaUrl, 'http://localhost:11434');
    assert.strictEqual(client.lmStudioUrl, 'http://localhost:1234');
  });

  it('should check Ollama availability', async () => {
    const result = await client.checkOllama();
    assert.strictEqual(result.available, true);
    assert.ok(Array.isArray(result.models));
    assert.strictEqual(result.models[0].name, 'llama3');
  });

  it('should list models from Ollama', async () => {
    const models = await client.listModels();
    assert.ok(Array.isArray(models));
    assert.ok(models.length > 0);
    assert.strictEqual(models[0].provider, 'local');
    assert.strictEqual(models[0].type, 'ollama');
    assert.strictEqual(models[0].id, 'ollama-llama3');
  });

  it('should generate via Ollama', async () => {
    // Mock the generate endpoint
    const origPost = mockAxios.post;
    mockAxios.post = async (url) => {
      if (url.includes('/api/generate')) {
        return { data: { response: 'Hello!', done: true, total_duration: 1000, prompt_eval_count: 10, eval_count: 5 } };
      }
      if (url.includes('/api/chat')) {
        return { data: { message: { content: 'Hello!' }, done: true, prompt_eval_count: 10, eval_count: 5 } };
      }
      return { data: {} };
    };

    const result = await client.generateOllama('llama3', 'Hello');
    assert.strictEqual(result.text, 'Hello!');
    assert.strictEqual(result.done, true);

    mockAxios.post = origPost;
  });

  it('should chat via Ollama', async () => {
    const origPost = mockAxios.post;
    mockAxios.post = async (url) => {
      if (url.includes('/api/chat')) {
        return { data: { message: { content: 'Hi there!' }, done: true, prompt_eval_count: 10, eval_count: 5 } };
      }
      return { data: {} };
    };

    const result = await client.chatOllama('llama3', [{ role: 'user', content: 'Hello' }]);
    assert.strictEqual(result.text, 'Hi there!');

    mockAxios.post = origPost;
  });

  it('should dispatch generate() to correct backend', async () => {
    const origPost = mockAxios.post;
    mockAxios.post = async (url) => {
      if (url.includes('/api/chat')) {
        return { data: { message: { content: 'Ollama response' }, done: true, prompt_eval_count: 10, eval_count: 5 } };
      }
      return { data: {} };
    };

    const result = await client.generate(
      { type: 'ollama', name: 'llama3' },
      'Hello'
    );
    assert.strictEqual(result.text, 'Ollama response');

    mockAxios.post = origPost;
  });

  it('should throw for unknown model type in generate()', async () => {
    await assert.rejects(
      () => client.generate({ type: 'unknown', name: 'test' }, 'Hello'),
      { message: /Unknown local model type/ }
    );
  });

  it('should handle Ollama unavailable', async () => {
    const origGet = mockAxios.get;
    mockAxios.get = async () => { throw new Error('Connection refused'); };

    const result = await client.checkOllama();
    assert.strictEqual(result.available, false);
    assert.ok(result.error);

    mockAxios.get = origGet;
  });

  it('should cache availability for 30 seconds', async () => {
    const availability1 = await client.isAvailable();
    assert.strictEqual(availability1.any, true);

    // Second call should use cache
    const availability2 = await client.isAvailable();
    assert.strictEqual(availability2.any, true);
    assert.strictEqual(availability1.lastCheck, availability2.lastCheck);
  });

  it('should return singleton via getLocalModelClient()', () => {
    const c1 = getLocalModelClient();
    const c2 = getLocalModelClient();
    assert.strictEqual(c1, c2);
  });

  it('should reset singleton with reset option', () => {
    const c1 = getLocalModelClient();
    const c2 = getLocalModelClient({ reset: true });
    assert.notStrictEqual(c1, c2);
  });
});

describe('T44: Hybrid Routing Config', () => {
  it('should read ORCA_LOCAL_MODEL_PRIORITY from config', () => {
    // Config validation test — schema accepts valid values
    const { envSchema } = require('../../src/config/schema.js');

    const result1 = envSchema.safeParse({
      OPENROUTER_API_KEY: 'sk-test',
      ORCA_LOCAL_MODEL_PRIORITY: 'local-first'
    });
    assert.ok(result1.success);

    const result2 = envSchema.safeParse({
      OPENROUTER_API_KEY: 'sk-test',
      ORCA_LOCAL_MODEL_PRIORITY: 'cloud-first'
    });
    assert.ok(result2.success);

    const result3 = envSchema.safeParse({
      OPENROUTER_API_KEY: 'sk-test',
      ORCA_LOCAL_MODEL_PRIORITY: 'cost-optimal'
    });
    assert.ok(result3.success);
  });

  it('should reject invalid ORCA_LOCAL_MODEL_PRIORITY', () => {
    const { envSchema } = require('../../src/config/schema.js');

    const result = envSchema.safeParse({
      OPENROUTER_API_KEY: 'sk-test',
      ORCA_LOCAL_MODEL_PRIORITY: 'invalid'
    });
    assert.ok(!result.success);
  });

  it('should default ORCA_LOCAL_MODEL_ENABLED to false', () => {
    const { envSchema } = require('../../src/config/schema.js');

    const result = envSchema.safeParse({
      OPENROUTER_API_KEY: 'sk-test'
    });
    assert.ok(result.success);
    assert.strictEqual(result.data.ORCA_LOCAL_MODEL_ENABLED, 'false');
  });

  it('should accept optional OLLAMA_URL', () => {
    const { envSchema } = require('../../src/config/schema.js');

    const result = envSchema.safeParse({
      OPENROUTER_API_KEY: 'sk-test',
      OLLAMA_URL: 'http://my-host:11434'
    });
    assert.ok(result.success);
    assert.strictEqual(result.data.OLLAMA_URL, 'http://my-host:11434');
  });

  it('should accept optional LMSTUDIO_URL', () => {
    const { envSchema } = require('../../src/config/schema.js');

    const result = envSchema.safeParse({
      OPENROUTER_API_KEY: 'sk-test',
      LMSTUDIO_URL: 'http://my-host:1234'
    });
    assert.ok(result.success);
    assert.strictEqual(result.data.LMSTUDIO_URL, 'http://my-host:1234');
  });
});
