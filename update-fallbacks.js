const fs = require('fs');
const path = require('path');

const agentsPath = path.join(__dirname, 'src/agents.json');
const agentsData = JSON.parse(fs.readFileSync(agentsPath, 'utf8'));

// Add fallback to Orchestrator - use  version
agentsData.orchestrator.fallbackModel = "google/gemma-4-31b-it";

// Add fallbacks to all agents based on department - prioritize  versions
agentsData.agents = agentsData.agents.map(agent => {
    let fallback = "google/gemma-4-26b-a4b-it"; // Default general fallback
    
    switch(agent.department) {
        case "Engineering":
            fallback = "qwen/qwen3-coder";
            break;
        case "Creative":
            fallback = "meta-llama/llama-3.3-70b-instruct";
            break;
        case "Marketing":
            fallback = "google/gemma-4-31b-it";
            break;
        case "Sales":
            fallback = "z-ai/glm-4.5-air";
            break;
        case "Operations":
            fallback = "google/gemma-4-26b-a4b-it";
            break;
    }
    
    // Ensure we don't set the fallback to the same as the primary model
    if (fallback === agent.model) {
        fallback = "google/gemma-4-26b-a4b-it";
    }
    
    return { ...agent, fallbackModel: fallback };
});

fs.writeFileSync(agentsPath, JSON.stringify(agentsData, null, 2));
console.log("Updated agents.json with FREE fallback models.");
