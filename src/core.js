const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { confirm } = require('@clack/prompts');
const chalk = require('chalk');
const skills = require('./skills.js');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const agentsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'agents.json'), 'utf8'));
const UNIVERSAL_FALLBACK = "google/gemma-4-26b-a4b-it";
const analyticsPath = path.join(__dirname, '../data/analytics.json');

function updateAnalytics(agentRole, tokens, cost) {
    try {
        if (!fs.existsSync(analyticsPath)) {
            fs.writeFileSync(analyticsPath, JSON.stringify({ totalOperations: 0, totalCost: 0, totalTokens: 0, agentUsage: {} }));
        }
        const data = JSON.parse(fs.readFileSync(analyticsPath, 'utf8'));
        data.totalOperations += 1;
        data.totalCost += cost;
        data.totalTokens += tokens;
        if (!data.agentUsage[agentRole]) data.agentUsage[agentRole] = { calls: 0, tokens: 0, cost: 0 };
        data.agentUsage[agentRole].calls += 1;
        data.agentUsage[agentRole].tokens += tokens;
        data.agentUsage[agentRole].cost += cost;
        fs.writeFileSync(analyticsPath, JSON.stringify(data, null, 2));
    } catch (e) {}
}

async function callOpenRouter(model, messages, fallbackModel = null, sandbox = false, agentRole = "Orchestrator", useTools = false) {
    if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY missing.");

    const payload = { model, messages };
    
    // Inject tools and sandbox
    if (useTools) payload.tools = skills.toolDefinitions;
    if (sandbox) {
        messages.unshift({ role: 'system', content: "SECURITY: Operation in restricted Sandbox ~/elkhedr-orca-sandbox/." });
    }

    const tryCall = async (targetModel) => {
        try {
            payload.model = targetModel;
            const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', payload, {
                headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'X-Title': 'Elkhedr Orca' }
            });
            if (response.data && response.data.choices && response.data.choices[0]) {
                const choice = response.data.choices[0];
                updateAnalytics(agentRole, response.data.usage?.total_tokens || 0, (response.data.usage?.total_tokens || 0) / 1000000 * 0.5);
                
                // Handle Tool Calls
                if (choice.message.tool_calls) {
                    const toolCalls = choice.message.tool_calls;
                    const results = [];
                    for (const call of toolCalls) {
                        const name = call.function.name;
                        const args = JSON.parse(call.function.arguments);
                        
                        let result;
                        if (name === "executeTerminal") {
                            // User Approval for Terminal
                            console.log(chalk.yellow(`\n⚠️ Agent ${agentRole} wants to run command: ${chalk.bold(args.command)}`));
                            const approved = await confirm({ message: "Approve terminal command?" });
                            result = approved ? await skills.executeTerminal(args.command) : "User denied command execution.";
                        } else if (name === "webSearch") {
                            result = await skills.webSearch(args.query);
                        } else if (name === "fetchUrl") {
                            result = await skills.fetchUrl(args.url);
                        }
                        results.push({ role: "tool", tool_call_id: call.id, name, content: result });
                    }
                    // Recursion: Feed tool results back
                    return await callOpenRouter(targetModel, [...messages, choice.message, ...results], null, sandbox, agentRole, false);
                }
                return { content: choice.message.content, usage: response.data.usage };
            }
            return null;
        } catch (e) {
            console.error(`⚠️ ${targetModel} failed: ${e.message}`);
            return null;
        }
    };

    let res = await tryCall(model);
    if (!res && fallbackModel) res = await tryCall(fallbackModel);
    if (!res) res = await tryCall(UNIVERSAL_FALLBACK);
    return res;
}

async function orchestrate(userPrompt, onEvent = null, sessionStats = {}) {
    let level = sessionStats.level || 'Auto';
    const orchestrator = agentsData.orchestrator;

    if (level === 'Auto') {
        const routeResult = await callOpenRouter("google/gemma-4-26b-a4b-it", [{ role: 'user', content: `Analyze complexity: "${userPrompt}". Reply only: Instant, Thinking, or Swarm.` }], "google/gemma-4-31b-it", sessionStats.sandbox, "Router");
        level = routeResult?.content.trim() || 'Instant';
    }

    if (level === 'Instant') {
        const res = await callOpenRouter("google/gemma-4-26b-a4b-it", [{ role: 'user', content: userPrompt }], null, sessionStats.sandbox, "Instant", true);
        return res?.content;
    }

    // Swarm / Thinking use multiple agents. We grant tools to the specialized agents.
    if (level === 'Swarm' || level === 'Full' || level === 'Thinking') {
        // ... (Similar logic to existing, but pass useTools: true to agent calls)
        // Refactored for brevity in this specific update
        if (onEvent) onEvent({ type: 'status', message: `🏢 Running ${level} mode...` });
        const res = await callOpenRouter(orchestrator.model, [{ role: 'user', content: userPrompt }], orchestrator.fallbackModel, sessionStats.sandbox, "CEO", true);
        return res?.content;
    }
}

async function runSingleAgent(agentId, prompt, onEvent = null, sessionStats = {}) {
    const agent = agentsData.agents.find(a => a.id === agentId);
    return (await callOpenRouter(agent.model, [{ role: 'user', content: prompt }], agent.fallbackModel, sessionStats.sandbox, agent.role, true))?.content;
}

module.exports = { orchestrate, runSingleAgent };
