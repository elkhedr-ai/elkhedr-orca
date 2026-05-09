#!/usr/bin/env node
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const agentsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'agents.json'), 'utf8'));

async function callOpenRouter(model, messages) {
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
        return response.data.choices[0].message.content;
    } catch (error) {
        console.error(`Error calling model ${model}:`, error.message);
        return null;
    }
}

async function orchestrate(userPrompt) {
    const orchestrator = agentsData.orchestrator;
    console.log(`[CEO] Analyzing task: "${userPrompt}"...`);

    const decompositionPrompt = `
    User Prompt: ${userPrompt}
    Available Agents: ${agentsData.agents.map(a => `${a.id}: ${a.role} (${a.department})`).join(', ')}
    
    Task: Break down the user prompt into subtasks and assign each subtask to the most relevant Agent ID.
    Return the response in JSON format: [{"agentId": number, "subtask": "description"}]
    `;

    const decomposition = await callOpenRouter(orchestrator.model, [
        { role: 'system', content: orchestrator.prompt },
        { role: 'user', content: decompositionPrompt }
    ]);

    let tasks;
    try {
        tasks = JSON.parse(decomposition);
    } catch (e) {
        console.error("Failed to parse decomposition JSON. Fallback to raw output.");
        return decomposition;
    }

    const results = [];
    for (const task of tasks) {
        const agent = agentsData.agents.find(a => a.id === task.agentId);
        if (agent) {
            console.log(`[${agent.role}] Executing: ${task.subtask}...`);
            const result = await callOpenRouter(agent.model, [
                { role: 'system', content: `You are the ${agent.role} in the ${agent.department} department.` },
                { role: 'user', content: task.subtask }
            ]);
            results.push({ role: agent.role, output: result });
        }
    }

    console.log(`[CEO] Synthesizing final report...`);
    const finalReport = await callOpenRouter(orchestrator.model, [
        { role: 'system', content: orchestrator.prompt },
        { role: 'user', content: `Synthesize the following subtask results into a final response for the user: ${JSON.stringify(results)}` }
    ]);

    return finalReport;
}

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length > 0) {
        orchestrate(args.join(' ')).then(console.log);
    } else {
        console.log("Please provide a prompt. Usage: node src/index.js \"Your task here\"");
    }
}

module.exports = { orchestrate };
