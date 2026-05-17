const axios = require('axios');
const cheerio = require('cheerio');
const { logger } = require('../../src/utils/logger.js');

/**
 * Fetch and read content from a URL
 */
async function execute(args) {
  const { url } = args;
  
  logger.info({ url }, 'Fetching URL');
  
  try {
    const { data } = await axios.get(url, { timeout: 5000 });
    const $ = cheerio.load(data);
    const text = $('body').text().replace(/\s\s+/g, ' ').substring(0, 2000);
    return text || "No text content found at URL.";
  } catch (e) {
    logger.error({ error: e.message, url }, 'Failed to fetch URL');
    return `Failed to fetch URL: ${e.message}`;
  }
}

const toolDefinition = {
  type: "function",
  function: {
    name: "url-fetch",
    description: "Retrieve and read the text content of a specific website URL.",
    parameters: {
      type: "object",
      properties: {
        url: { 
          type: "string", 
          description: "The URL to fetch." 
        }
      },
      required: ["url"]
    }
  }
};

module.exports = {
  execute,
  toolDefinition
};
