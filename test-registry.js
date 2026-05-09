const fs = require('fs');
const path = require('path');

function testRegistry() {
    const agentsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'src/agents.json'), 'utf8'));
    console.log(`Orchestrator: ${agentsData.orchestrator.role}`);
    console.log(`Total Agents: ${agentsData.agents.length}`);
    
    if (agentsData.agents.length === 100) {
        console.log("✅ Registry contains 100 agents.");
    } else {
        console.log(`❌ Registry contains ${agentsData.agents.length} agents. Expected 100.`);
    }

    const missingModels = agentsData.agents.filter(a => !a.model);
    if (missingModels.length === 0) {
        console.log("✅ All agents have assigned models.");
    } else {
        console.log(`❌ ${missingModels.length} agents are missing models.`);
    }
}

testRegistry();
