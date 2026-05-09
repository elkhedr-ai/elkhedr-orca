#!/usr/bin/env node
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const agentsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'agents.json'), 'utf8'));

async function callOpenRouter(model, messages, fallbackModel = null) {
    try {
        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: model,
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
        throw new Error("Empty or malformed response from OpenRouter");
    } catch (error) {
        console.error(`⚠️  Primary model failed (${model}): ${error.message}`);
        
        if (fallbackModel) {
            console.log(`🔄 Routing to fallback model: ${fallbackModel}...`);
            try {
                const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
                    model: fallbackModel,
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
                throw new Error("Empty or malformed response from OpenRouter (Fallback)");
            } catch (fallbackError) {
                console.error(`❌ Fallback model also failed (${fallbackModel}): ${fallbackError.message}`);
                return null;
            }
        }
        return null;
    }
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

    let tasks;
    try {
        tasks = JSON.parse(decomposition);
    } catch (e) {
        if (onEvent) onEvent({ type: 'error', message: "Failed to parse decomposition JSON." });
        return decomposition;
    }

    const results = [];
    for (const task of tasks) {
        const agent = agentsData.agents.find(a => a.id === task.agentId);
        if (agent) {
            if (onEvent) onEvent({ type: 'agent_start', agent: agent.role, task: task.subtask });
            else console.log(`[${agent.role}] Executing: ${task.subtask}...`);
            
            const result = await callOpenRouter(agent.model, [
                { role: 'system', content: `You are the ${agent.role} in the ${agent.department} department.` },
                { role: 'user', content: task.subtask }
            ], agent.fallbackModel);
            
            if (result) {
                results.push({ role: agent.role, output: result });
            } else {
                if (onEvent) onEvent({ type: 'error', message: `Agent ${agent.role} failed to respond.` });
            }
        }
    }

    if (onEvent) onEvent({ type: 'status', message: `CEO Synthesizing final report...` });
    else console.log(`[CEO] Synthesizing final report...`);

    const finalReport = await callOpenRouter(orchestrator.model, [
        { role: 'system', content: orchestrator.prompt },
        { role: 'user', content: `Synthesize the following subtask results into a final response for the user: ${JSON.stringify(results)}` }
    ], orchestrator.fallbackModel);

    return finalReport;
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
