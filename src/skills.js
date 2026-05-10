const { exec } = require('child_process');
const axios = require('axios');
const cheerio = require('cheerio');
const chalk = require('chalk');

/**
 * Skill: Terminal Execution
 * Runs a bash command on the host Mac.
 */
async function executeTerminal(command) {
    return new Promise((resolve) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                resolve(`Error: ${error.message}\nStderr: ${stderr}`);
            } else {
                resolve(stdout || "Command executed successfully (no output).");
            }
        });
    });
}

/**
 * Skill: Web Search (via Google Scraper)
 * Fetches basic search results for a query.
 */
async function webSearch(query) {
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
        return `Web search failed: ${e.message}`;
    }
}

/**
 * Skill: URL Fetch
 * Scrapes text content from a specific URL.
 */
async function fetchUrl(url) {
    try {
        const { data } = await axios.get(url, { timeout: 5000 });
        const $ = cheerio.load(data);
        const text = $('body').text().replace(/\s\s+/g, ' ').substring(0, 2000);
        return text || "No text content found at URL.";
    } catch (e) {
        return `Failed to fetch URL: ${e.message}`;
    }
}

const toolDefinitions = [
    {
        type: "function",
        function: {
            name: "executeTerminal",
            description: "Run a bash command on the user's Mac terminal. Use this for file operations, system checks, or code execution.",
            parameters: {
                type: "object",
                properties: {
                    command: { type: "string", description: "The bash command to run." }
                },
                required: ["command"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "webSearch",
            description: "Search the internet for real-time information or news.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "The search query." }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "fetchUrl",
            description: "Retrieve and read the text content of a specific website URL.",
            parameters: {
                type: "object",
                properties: {
                    url: { type: "string", description: "The URL to fetch." }
                },
                required: ["url"]
            }
        }
    }
];

module.exports = {
    executeTerminal,
    webSearch,
    fetchUrl,
    toolDefinitions
};
