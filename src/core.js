const axios = require('axios');
const fs = require('fs');
const path = require('path');
// Ensure we load .env from the actual project directory, not the user's CWD
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const agentsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'agents.json'), 'utf8'));

// Universal fallback to a highly available free model if primary and secondary fail
const UNIVERSAL_FALLBACK = "google/gemma-4-26b-a4b-it";

async function callOpenRouter(model, messages, fallbackModel = null) {
    if (!OPENROUTER_API_KEY) {
        throw new Error("OPENROUTER_API_KEY is missing. Please check your .env file or environment variables.");
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
                return response.data.choices[0].message.content;
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

async function orchestrate(userPrompt, onEvent = null) {
    const orchestrator = agentsData.orchestrator;
    if (onEvent) onEvent({ type: 'status', message: `CEO Analyzing task: "${userPrompt}"...` });
    else console.log(`[CEO] Analyzing task: "${userPrompt}"...`);
    
    const decompositionPrompt = `
    User Prompt: ${userPrompt}
    Available Agents: ${agentsData.agents.map(a => `${a.id}: ${a.role} (${a.department})`).join(', ')}
    
    Task: Break down the user prompt into subtasks and assign each subtask to the most relevant Agent ID.
    Return the response in JSON format: [{"agentId": number, "subtask": "description"}]
    `;

    const decomposition = await callOpenRouter(orchestrator.model, [
        { role: 'system', content: orchestrator.prompt },
        { role: 'user', content: decompositionPrompt }
    ], orchestrator.fallbackModel);

    if (!decomposition) {
        const errorMsg = "Critical failure: CEO could not decompose the task even with fallbacks.";
        if (onEvent) onEvent({ type: 'error', message: errorMsg });
        return errorMsg;
    }

    let tasks;
    try {
        // Handle cases where the model returns text around the JSON
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
            else console.log(`[${agent.role}] Executing: ${task.subtask}...`);
            
            const result = await callOpenRouter(agent.model, [
                { role: 'system', content: `You are the ${agent.role} in the ${agent.department} department.` },
                { role: 'user', content: task.subtask }
            ], agent.fallbackModel);
            
            activeCount--;
            if (result) {
                results.push({ role: agent.role, output: result });
            } else {
                if (onEvent) onEvent({ type: 'error', message: `Agent ${agent.role} failed to respond after all fallbacks.`, activeCount });
            }
        }
    }

    if (onEvent) onEvent({ type: 'status', message: `CEO Synthesizing final report...` });
    else console.log(`[CEO] Synthesizing final report...`);

    const finalReport = await callOpenRouter(orchestrator.model, [
        { role: 'system', content: orchestrator.prompt },
        { role: 'user', content: `Synthesize the following subtask results into a final response for the user: ${JSON.stringify(results)}` }
    ], orchestrator.fallbackModel);

    return finalReport || "System synthesis failed. Please try again.";
}

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length > 0) {
        orchestrate(args.join(' ')).then(console.log);
    } else {
        // Dynamic import to avoid circular dependency if needed, 
        // but here we just require since tui.js requires index.js
        const { interactiveSession } = require('./tui.js');
        interactiveSession().catch(console.error);
    }
}

module.exports = { orchestrate };
