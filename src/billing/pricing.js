/**
 * Per-model pricing for usage cost calculation.
 * Rates are USD per 1M tokens (input + output combined).
 */

// Default rate for unknown models
const DEFAULT_RATE = 0.50;

// Per-model pricing map — keys are OpenRouter model IDs
const MODEL_PRICING = {
  // GPT-4 family
  'openai/gpt-4o': 2.50,
  'openai/gpt-4o-mini': 0.15,
  'openai/gpt-4-turbo': 10.00,
  'openai/gpt-4': 30.00,
  'openai/gpt-3.5-turbo': 0.50,

  // Claude family
  'anthropic/claude-3.5-sonnet': 3.00,
  'anthropic/claude-3-opus': 15.00,
  'anthropic/claude-3-sonnet': 3.00,
  'anthropic/claude-3-haiku': 0.25,

  // Gemini
  'google/gemini-2.0-flash': 0.10,
  'google/gemini-2.5-pro-preview-05-06': 1.25,
  'google/gemini-2.5-flash-preview-05-20': 0.15,

  // Llama
  'meta-llama/llama-3.1-405b-instruct': 2.00,
  'meta-llama/llama-3.1-70b-instruct': 0.35,
  'meta-llama/llama-3.1-8b-instruct': 0.05,
  'meta-llama/llama-3.2-11b-vision-instruct': 0.10,
  'meta-llama/llama-3.3-70b-instruct': 0.35,

  // Mixtral
  'mistralai/mixtral-8x7b-instruct': 0.20,
  'mistralai/mixtral-8x22b-instruct': 0.60,
  'mistralai/mistral-large': 2.00,

  // Gemma
  'google/gemma-2-27b-it': 0.20,
  'google/gemma-2-9b-it': 0.05,

  // DeepSeek
  'deepseek/deepseek-chat': 0.14,
  'deepseek/deepseek-r1': 0.55,

  // Qwen
  'qwen/qwen-2.5-72b-instruct': 0.35,

  // Local models — zero cost
  'ollama/*': 0,
  'lmstudio/*': 0,
};

/**
 * Get the cost rate for a model (USD per 1M tokens)
 * @param {string} modelId - OpenRouter model ID
 * @returns {number} Cost per 1M tokens
 */
function getModelRate(modelId) {
  if (!modelId) return DEFAULT_RATE;

  // Exact match
  if (MODEL_PRICING[modelId] !== undefined) {
    return MODEL_PRICING[modelId];
  }

  // Prefix match for providers (e.g. "ollama/llama3" matches "ollama/*")
  const provider = modelId.split('/')[0];
  const wildcardKey = `${provider}/*`;
  if (MODEL_PRICING[wildcardKey] !== undefined) {
    return MODEL_PRICING[wildcardKey];
  }

  return DEFAULT_RATE;
}

/**
 * Calculate cost for a given number of tokens and model
 * @param {number} tokens - Total tokens (input + output)
 * @param {string} modelId - OpenRouter model ID
 * @returns {number} Cost in USD
 */
function calculateCost(tokens, modelId) {
  const rate = getModelRate(modelId);
  return (tokens / 1_000_000) * rate;
}

module.exports = {
  MODEL_PRICING,
  DEFAULT_RATE,
  getModelRate,
  calculateCost
};
