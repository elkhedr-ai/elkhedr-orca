# Elkhedr Orca Architecture Guide

## System Overview
Elkhedr Orca is a hierarchical multi-agent system designed to mirror a modern corporate structure. It leverages a "Super Orchestrator" (CEO) to manage 100 specialized subagents across five core departments.

## The Orchestration Loop
1. **Decomposition:** The Super Orchestrator (`nvidia/nemotron-3-super-120b-a12b:free`) receives a high-level user prompt and breaks it into discrete subtasks.
2. **Delegation:** Each subtask is assigned to a specialized agent based on its `role` and `department`.
3. **Execution:** Subagents execute their tasks using their specifically mapped OpenRouter models.
4. **Synthesis:** The Super Orchestrator collects all subagent outputs and generates a cohesive final report for the user.

## Departmental Structure
- **C-Suite:** Strategic leadership and orchestration.
- **Engineering:** Development, DevOps, Security, and Data Science.
- **Creative:** Design, Content, and Brand Storytelling.
- **Marketing:** SEO, Growth, Social Media, and PPC.
- **Sales:** Lead Gen, BDR, and Customer Success.
- **Operations:** PM, HR, Finance, and Legal.

## Model Routing Strategy
Orca uses a **"Cost-First Quality"** strategy:
- **Reasoning Heavy:** Nemotron Super 3 & Gemma 4.
- **Coding Heavy:** Qwen 3 Coder & Codestral.
- **Creative/Visual:** Llama 3.3, Flux, and Vision-VL models.
- **Utility:** Small, fast models (LFM, Nova) for data parsing.
