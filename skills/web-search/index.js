const axios = require('axios');
const cheerio = require('cheerio');
const { logger } = require('../../src/utils/logger.js');

/**
 * Search the web via Google scraper
 */
async function execute(args) {
  const { query } = args;
  
  logger.info({ query }, 'Performing web search');
  
  try {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    const { data } = await axios.get(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    const $ = cheerio.load(data);
    const results = [];
    
    $('h3').each((i, el) => {
      if (i < 5) results.push($(el).text());
    });

    return results.length > 0 
      ? `Top results for "${query}":\n- ` + results.join('\n- ')
      : "No search results found.";
  } catch (e) {
    logger.error({ error: e.message }, 'Web search failed');
    return `Web search failed: ${e.message}`;
  }
}

const toolDefinition = {
  type: "function",
  function: {
    name: "web-search",
    description: "Search the internet for real-time information or news.",
    parameters: {
      type: "object",
      properties: {
        query: { 
          type: "string", 
          description: "The search query." 
        }
      },
      required: ["query"]
    }
  }
};

module.exports = {
  execute,
  toolDefinition
};
