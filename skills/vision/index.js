const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { logger } = require('../../src/utils/logger.js');

const VISION_MODELS = [
  'meta-llama/llama-3.2-11b-vision-instruct',
  'google/gemini-3.1-flash-image-preview',
  'openai/gpt-4o-mini'
];

const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];

function getConfigValue(key, fallback) {
  try {
    const { getConfig } = require('../../src/config/index.js');
    const value = getConfig()[key];
    return value === undefined || value === null || value === '' ? fallback : value;
  } catch {
    return process.env[key] === undefined || process.env[key] === '' ? fallback : process.env[key];
  }
}

function validateImagePath(imagePath) {
  if (!imagePath || typeof imagePath !== 'string') {
    throw new Error('image_path is required and must be a string');
  }
  if (imagePath.includes('..')) {
    throw new Error('Path traversal not allowed');
  }
  const resolved = path.resolve(imagePath);
  const ext = path.extname(resolved).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported image format: ${ext}. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`);
  }
  return resolved;
}

function imageToBase64DataUri(imagePath) {
  const ext = path.extname(imagePath).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml'
  };
  const mime = mimeTypes[ext] || 'image/jpeg';
  const buffer = fs.readFileSync(imagePath);
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

/**
 * Analyze an image using a vision-capable model via OpenRouter
 */
async function execute(args) {
  const { image_path, image_url, prompt } = args;

  if (!prompt || typeof prompt !== 'string') {
    throw new Error('prompt is required');
  }
  if (!image_path && !image_url) {
    throw new Error('Either image_path or image_url is required');
  }

  let imageSource;
  if (image_path) {
    const resolvedPath = validateImagePath(image_path);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Image file not found: ${resolvedPath}`);
    }
    imageSource = imageToBase64DataUri(resolvedPath);
    logger.info({ path: resolvedPath }, 'Analyzing local image');
  } else {
    if (!image_url.startsWith('http://') && !image_url.startsWith('https://')) {
      throw new Error('image_url must be a valid HTTP/HTTPS URL');
    }
    imageSource = image_url;
    logger.info({ url: image_url }, 'Analyzing image from URL');
  }

  const apiKey = getConfigValue('OPENROUTER_API_KEY');
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY not configured');
  }

  const baseUrl = getConfigValue('ORCA_OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1');

  // Try vision models in order
  let lastError = null;
  for (const model of VISION_MODELS) {
    try {
      logger.info({ model }, 'Trying vision model');
      const response = await axios.post(
        `${baseUrl}/chat/completions`,
        {
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: { url: imageSource }
                }
              ]
            }
          ],
          max_tokens: 2048
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'X-Title': 'Elkhedr Orca Vision',
            'HTTP-Referer': 'https://github.com/ekagent/elkhedr-orca'
          },
          timeout: 60000
        }
      );

      const content = response.data?.choices?.[0]?.message?.content;
      if (content) {
        logger.info({ model, length: content.length }, 'Vision analysis complete');
        return content;
      }
    } catch (error) {
      lastError = error;
      logger.warn({ model, error: error.message }, 'Vision model failed, trying next');
    }
  }

  throw new Error(`All vision models failed. Last error: ${lastError?.message || 'Unknown'}`);
}

const toolDefinition = {
  type: "function",
  function: {
    name: "vision",
    description: "Analyze an image and describe its contents. Supports local files (jpg, png, gif, webp) and URLs. Returns a text description of what the image shows.",
    parameters: {
      type: "object",
      properties: {
        image_path: {
          type: "string",
          description: "Local file path to the image (e.g., /path/to/image.jpg)"
        },
        image_url: {
          type: "string",
          description: "URL of the image to analyze (http/https)"
        },
        prompt: {
          type: "string",
          description: "What to analyze or describe about the image (e.g., 'Describe what you see', 'Extract all text from this image')"
        }
      },
      required: ["prompt"]
    }
  }
};

module.exports = { execute, toolDefinition };
