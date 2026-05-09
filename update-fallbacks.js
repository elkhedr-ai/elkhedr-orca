const fs = require('fs');
const path = require('path');

const agentsPath = path.join(__dirname, 'src/agents.json');
const agentsData = JSON.parse(fs.readFileSync(agentsPath, 'utf8'));

// Add fallback to Orchestrator - use :free version
agentsData.orchestrator.fallbackModel = "google/gemma-4-31b-it:free";

// Add fallbacks to all agents based on department - prioritize :free versions
agentsData.agents = agentsData.agents.map(agent => {
    let fallback = "google/gemma-4-26b-a4b-it:free"; // Default general fallback
    
    switch(agent.department) {
        case "Engineering":
            fallback = "qwen/qwen3-coder:free";
            break;
        case "Creative":
            fallback = "meta-llama/llama-3.3-70b-instruct:free";
            break;
        case "Marketing":
            fallback = "google/gemma-4-31b-it:free";
            break;
        case "Sales":
            fallback = "z-ai/glm-4.5-air:free";
            break;
        case "Operations":
            fallback = "google/gemma-4-26b-a4b-it:free";
            break;
    }
    
    // Ensure we don't set the fallback to the same as the primary model
    if (fallback === agent.model) {
        fallback = "google/gemma-4-26b-a4b-it:free";
    }
    
    return { ...agent, fallbackModel: fallback };
});

fs.writeFileSync(agentsPath, JSON.stringify(agentsData, null, 2));
console.log("Updated agents.json with FREE fallback models.");
