#!/usr/bin/env node
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const { orchestrate } = require("./core.js");

const server = new Server(
  {
    name: "elkhedr-orca",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "orca_execute",
        description: "Execute a complex task using the Elkhedr Orca 100-agent corporate system.",
        inputSchema: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "The task or prompt to execute.",
            },
          },
          required: ["prompt"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "orca_execute") {
    const prompt = request.params.arguments.prompt;
    const result = await orchestrate(prompt);
    return {
      content: [
        {
          type: "text",
          text: result,
        },
      ],
    };
  }
  throw new Error("Tool not found");
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
