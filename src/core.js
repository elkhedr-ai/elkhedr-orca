const axios = require('axios');
const fs = require('fs');
const path = require('path');
// Ensure we load .env from the actual project directory, not the user's CWD
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const agentsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'agents.json'), 'utf8'));

// Universal fallback to a highly available free model if primary and secondary fail
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
        
        if (!data.agentUsage[agentRole]) {
            data.agentUsage[agentRole] = { calls: 0, tokens: 0, cost: 0 };
        }
        data.agentUsage[agentRole].calls += 1;
        data.agentUsage[agentRole].tokens += tokens;
        data.agentUsage[agentRole].cost += cost;
        
        fs.writeFileSync(analyticsPath, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Failed to update global analytics:", e.message);
    }
}

async function callOpenRouter(model, messages, fallbackModel = null, sandbox = false, agentRole = "Orchestrator") {
    if (!OPENROUTER_API_KEY) {
        throw new Error("OPENROUTER_API_KEY is missing. Please check your .env file or environment variables.");
    }

    // Inject Sandbox constraints if active
    if (sandbox) {
        const sandboxPrompt = `SECURITY OVERRIDE: You are operating in a restricted Sandbox. You may ONLY propose, read, or write files within the absolute path: ~/elkhedr-orca-sandbox/. Any attempt to access paths outside this directory must be blocked.`;
        messages.unshift({ role: 'system', content: sandboxPrompt });
    }

    const tryCall = async (targetModel) => {
        try {
            const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
                model: targetModel,
                messages: messages
            }, {
                headers: {
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'HTTP-Referer': 'https://github.com/ekagent/elkhedr-orca',
                    'X-Title': 'Elkhedr Orca'
                }
            });
            
            if (response.data && response.data.choices && response.data.choices[0]) {
                const usage = response.data.usage || { total_tokens: 0 };
                const cost = (usage.total_tokens / 1000000) * 0.50; // Dynamic estimation
                updateAnalytics(agentRole, usage.total_tokens, cost);

                return {
                    content: response.data.choices[0].message.content,
                    usage: usage
                };
            }
            return null;
        } catch (error) {
            console.error(`⚠️  Model failed (${targetModel}): ${error.message}`);
            return null;
        }
    };

    // 1. Try Primary
    let result = await tryCall(model);
    if (result) return result;

    // 2. Try Secondary (Fallback)
    if (fallbackModel && fallbackModel !== model) {
        console.log(`🔄 Routing to secondary fallback: ${fallbackModel}...`);
        result = await tryCall(fallbackModel);
        if (result) return result;
    }

    // 3. Try Universal Fallback
    if (UNIVERSAL_FALLBACK !== model && UNIVERSAL_FALLBACK !== fallbackModel) {
        console.log(`🚨 Routing to universal fallback: ${UNIVERSAL_FALLBACK}...`);
        result = await tryCall(UNIVERSAL_FALLBACK);
        return result;
    }

    return null;
}

async function runSingleAgent(agentId, prompt, onEvent = null, sessionStats = {}) {
    const agent = agentsData.agents.find(a => a.id === agentId);
    if (!agent) throw new Error(`Agent with ID ${agentId} not found.`);

    if (onEvent) onEvent({ type: 'agent_start', agent: agent.role, task: prompt, activeCount: 1 });
    
    const result = await callOpenRouter(agent.model, [
        { role: 'system', content: `You are the ${agent.role} in the ${agent.department} department.` },
        { role: 'user', content: prompt }
    ], agent.fallbackModel, sessionStats.sandbox, agent.role);

    if (result && onEvent && result.usage) {
        onEvent({ type: 'usage', usage: result.usage });
    }

    return result ? result.content : "Agent failed to respond.";
}

async function orchestrate(userPrompt, onEvent = null, sessionStats = {}) {
    const level = sessionStats.level || 'Instant';
    const orchestrator = agentsData.orchestrator;

    if (level === 'Instant') {
        if (onEvent) onEvent({ type: 'status', message: `⚡ Instant Level: Consulting Gemma 4...` });
        const result = await callOpenRouter("google/gemma-4-26b-a4b-it", [
            { role: 'system', content: "You are the Instant Response module of Elkhedr Orca. Provide a fast, concise, and professional answer." },
            { role: 'user', content: userPrompt }
        ], "google/gemma-4-31b-it", sessionStats.sandbox, "Gemma 4 (Instant)");
        
        if (result && onEvent && result.usage) onEvent({ type: 'usage', usage: result.usage });
        return result ? result.content : "Instant response failed.";
    }

    if (level === 'Thinking') {
        if (onEvent) onEvent({ type: 'status', message: `🧠 Thinking Level: Consulting Gemma, Mistral, and Kimi...` });
        
        // Parallel Thinking
        const models = [
            { id: "google/gemma-4-31b-it", role: "Reasoning Expert (Gemma)" },
            { id: "mistralai/mistral-small-2603", role: "Efficiency Specialist (Mistral)" },
            { id: "~moonshotai/kimi-latest", role: "Intelligence Lead (Kimi)" }
        ];

        const thoughts = await Promise.all(models.map(m => {
            if (onEvent) onEvent({ type: 'agent_start', agent: m.role, task: "Analyzing prompt deep context..." });
            return callOpenRouter(m.id, [
                { role: 'system', content: `Analyze the user prompt deeply and provide your expert perspective. Focus on thoroughness.` },
                { role: 'user', content: userPrompt }
            ], null, sessionStats.sandbox, m.role);
        }));

        if (onEvent) onEvent({ type: 'status', message: `CEO Synthesizing deep thoughts...` });

        const validThoughts = thoughts.filter(t => t !== null);
        const synthesis = await callOpenRouter(orchestrator.model, [
            { role: 'system', content: orchestrator.prompt },
            { role: 'user', content: `Synthesize the following expert thoughts into a master response for the user: ${JSON.stringify(validThoughts.map(t => t.content))}` }
        ], orchestrator.fallbackModel, sessionStats.sandbox, "CEO Synthesizer");

        if (synthesis && onEvent && synthesis.usage) onEvent({ type: 'usage', usage: synthesis.usage });
        return synthesis ? synthesis.content : "Deep thinking synthesis failed.";
    }

    // Default: Fallback to existing Full Orchestration if level is not defined or 'Full'
    if (onEvent) onEvent({ type: 'status', message: `🏢 Full Orchestration: CEO Analyzing task...` });
    
    const decompositionPrompt = `
    User Prompt: ${userPrompt}
    Available Agents: ${agentsData.agents.map(a => `${a.id}: ${a.role} (${a.department})`).join(', ')}
    
    Task: Break down the user prompt into subtasks and assign each subtask to the most relevant Agent ID.
    Return the response in JSON format: [{"agentId": number, "subtask": "description"}]
    `;

    const decompResult = await callOpenRouter(orchestrator.model, [
        { role: 'system', content: orchestrator.prompt },
        { role: 'user', content: decompositionPrompt }
    ], orchestrator.fallbackModel, sessionStats.sandbox, "CEO Orchestrator");

    if (!decompResult) {
        const errorMsg = "Critical failure: CEO could not decompose the task even with fallbacks.";
        if (onEvent) onEvent({ type: 'error', message: errorMsg });
        return errorMsg;
    }

    const { content: decomposition, usage: decompUsage } = decompResult;
    if (onEvent && decompUsage) onEvent({ type: 'usage', usage: decompUsage });

    let tasks;
    try {
        const jsonMatch = decomposition.match(/\[\s*\{.*\}\s*\]/s);
        tasks = JSON.parse(jsonMatch ? jsonMatch[0] : decomposition);
    } catch (e) {
        if (onEvent) onEvent({ type: 'error', message: "Failed to parse decomposition JSON." });
        return decomposition;
    }

    if (!Array.isArray(tasks)) {
        return "CEO returned a non-iterable response. Aborting.";
    }

    let activeCount = 0;
    const results = [];
    for (const task of tasks) {
        const agent = agentsData.agents.find(a => a.id === task.agentId);
        if (agent) {
            activeCount++;
            if (onEvent) onEvent({ type: 'agent_start', agent: agent.role, task: task.subtask, activeCount });
            
            const agentResult = await callOpenRouter(agent.model, [
                { role: 'system', content: `You are the ${agent.role} in the ${agent.department} department.` },
                { role: 'user', content: task.subtask }
            ], agent.fallbackModel, sessionStats.sandbox, agent.role);
            
            activeCount--;
            if (agentResult) {
                const { content: resContent, usage: agentUsage } = agentResult;
                if (onEvent && agentUsage) onEvent({ type: 'usage', usage: agentUsage });
                results.push({ role: agent.role, output: resContent });
            } else {
                if (onEvent) onEvent({ type: 'error', message: `Agent ${agent.role} failed to respond after all fallbacks.`, activeCount });
            }
        }
    }

    if (onEvent) onEvent({ type: 'status', message: `CEO Synthesizing final report...` });

    const finalResult = await callOpenRouter(orchestrator.model, [
        { role: 'system', content: orchestrator.prompt },
        { role: 'user', content: `Synthesize the following subtask results into a final response for the user: ${JSON.stringify(results)}` }
    ], orchestrator.fallbackModel, sessionStats.sandbox, "CEO Synthesizer");

    if (finalResult && onEvent && finalResult.usage) onEvent({ type: 'usage', usage: finalResult.usage });

    return (finalResult ? finalResult.content : null) || "System synthesis failed. Please try again.";
}

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length > 0) {
        orchestrate(args.join(' ')).then(console.log);
    } else {
        const { interactiveSession } = require('./tui.js');
        interactiveSession().catch(console.error);
    }
}

module.exports = { orchestrate, runSingleAgent };
