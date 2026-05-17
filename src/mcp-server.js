#!/usr/bin/env node
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const { orchestrate, runSingleAgent } = require("./core.js");
const { logger } = require("./utils/logger.js");
const fs = require('fs');
const path = require('path');

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

// Load agents data for tool responses
const agentsDataPath = path.join(__dirname, 'agents.json');
const agentsData = JSON.parse(fs.readFileSync(agentsDataPath, 'utf8'));

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "orca_execute",
        description: "Execute a complex task using the Elkhedr Orca 100-agent corporate system. Supports Auto-routing, Instant, Thinking, and Swarm modes.",
        inputSchema: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "The task or prompt to execute.",
            },
            level: {
              type: "string",
              enum: ["Auto", "Instant", "Thinking", "Swarm"],
              description: "Intelligence level (default: Auto)",
              default: "Auto"
            },
            sandbox: {
              type: "boolean",
              description: "Enable sandbox mode (default: true)",
              default: true
            }
          },
          required: ["prompt"],
        },
      },
      {
        name: "orca_list_agents",
        description: "List all 100 specialized agents with their roles, departments, and model assignments.",
        inputSchema: {
          type: "object",
          properties: {
            department: {
              type: "string",
              enum: ["Engineering", "Creative", "Marketing", "Sales", "Operations"],
              description: "Filter by department (optional)",
            }
          }
        },
      },
      {
        name: "orca_agent_status",
        description: "Get detailed information about a specific agent by ID or role name.",
        inputSchema: {
          type: "object",
          properties: {
            agentId: {
              type: "number",
              description: "Agent ID (2-101)",
            },
            role: {
              type: "string",
              description: "Agent role name (e.g., 'Frontend React Expert')",
            }
          },
          oneOf: [
            { required: ["agentId"] },
            { required: ["role"] }
          ]
        },
      },
      {
        name: "orca_assign_task",
        description: "Assign a specific task directly to a specialized agent.",
        inputSchema: {
          type: "object",
          properties: {
            agentId: {
              type: "number",
              description: "Agent ID (2-101)",
            },
            prompt: {
              type: "string",
              description: "Task prompt for the agent",
            },
            sandbox: {
              type: "boolean",
              description: "Enable sandbox mode",
              default: true
            }
          },
          required: ["agentId", "prompt"],
        },
      },
      {
        name: "orca_get_analytics",
        description: "Get usage analytics including costs, token usage, and agent activity.",
        inputSchema: {
          type: "object",
          properties: {
            period: {
              type: "string",
              enum: ["all", "today", "week", "month"],
              description: "Time period for analytics",
              default: "all"
            }
          }
        },
      },
      {
        name: "orca_get_health",
        description: "Get system health status including API connectivity and configuration.",
        inputSchema: {
          type: "object",
          properties: {}
        },
      }
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const args = request.params.arguments || {};
  
  logger.info({ tool: toolName, args }, 'MCP tool called');

  try {
    switch (toolName) {
      case "orca_execute": {
        const { prompt, level = 'Auto', sandbox = true } = args;
        const result = await orchestrate(prompt, null, { level, sandbox });
        return {
          content: [{ type: "text", text: result }],
        };
      }
      
      case "orca_list_agents": {
        const { department } = args;
        let agents = agentsData.agents;
        
        if (department) {
          agents = agents.filter(a => a.department === department);
        }
        
        const agentList = agents.map(a => ({
          id: a.id,
          role: a.role,
          department: a.department,
          model: a.model,
          fallbackModel: a.fallbackModel
        }));
        
        return {
          content: [{ 
            type: "text", 
            text: `Available Agents (${agentList.length}):\n\n${agentList.map(a => 
              `ID: ${a.id}\nRole: ${a.role}\nDepartment: ${a.department}\nModel: ${a.model}\nFallback: ${a.fallbackModel}\n---`
            ).join('\n')}` 
          }],
        };
      }
      
      case "orca_agent_status": {
        const { agentId, role } = args;
        let agent;
        
        if (agentId) {
          agent = agentsData.agents.find(a => a.id === agentId);
        } else if (role) {
          agent = agentsData.agents.find(a => a.role.toLowerCase().includes(role.toLowerCase()));
        }
        
        if (!agent) {
          return {
            content: [{ type: "text", text: "Agent not found." }],
            isError: true,
          };
        }
        
        return {
          content: [{ 
            type: "text", 
            text: `Agent Details:\nID: ${agent.id}\nRole: ${agent.role}\nDepartment: ${agent.department}\nPrimary Model: ${agent.model}\nFallback Model: ${agent.fallbackModel}` 
          }],
        };
      }
      
      case "orca_assign_task": {
        const { agentId, prompt: taskPrompt, sandbox = true } = args;
        const result = await runSingleAgent(agentId, taskPrompt, null, { sandbox });
        return {
          content: [{ type: "text", text: result }],
        };
      }
      
      case "orca_get_analytics": {
        const analyticsPath = path.join(__dirname, '../data/analytics.json');
        let analyticsText = "No analytics data available.";
        
        if (fs.existsSync(analyticsPath)) {
          const data = JSON.parse(fs.readFileSync(analyticsPath, 'utf8'));
          analyticsText = `Analytics Overview:\nTotal Operations: ${data.totalOperations}\nTotal Tokens: ${data.totalTokens.toLocaleString()}\nTotal Cost: $${data.totalCost.toFixed(4)}\n\nAgent Usage:\n${Object.entries(data.agentUsage)
            .sort((a, b) => b[1].cost - a[1].cost)
            .map(([role, stats]) => `${role}: ${stats.calls} calls, ${stats.tokens.toLocaleString()} tokens, $${stats.cost.toFixed(4)}`)
            .join('\n')}`;
        }
        
        return {
          content: [{ type: "text", text: analyticsText }],
        };
      }
      
      case "orca_get_health": {
        const { getConfig } = require('./config/index.js');
        let apiKey;
        try {
          apiKey = getConfig().OPENROUTER_API_KEY;
        } catch {
          apiKey = null;
        }
        const health = {
          status: apiKey ? "healthy" : "unhealthy",
          apiKey: apiKey ? "configured" : "missing",
          timestamp: new Date().toISOString(),
          version: "1.0.0",
          agents: agentsData.agents.length,
          models: [...new Set(agentsData.agents.map(a => a.model))].length
        };
        
        return {
          content: [{ type: "text", text: JSON.stringify(health, null, 2) }],
        };
      }
      
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
          isError: true,
        };
    }
  } catch (error) {
    logger.error({ tool: toolName, error: error.message }, 'MCP tool error');
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('MCP server started');
}

main().catch((error) => {
  logger.error({ error: error.message }, 'MCP server error');
  console.error("Server error:", error);
  process.exit(1);
});
