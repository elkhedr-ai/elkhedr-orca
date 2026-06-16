# Elkhedr Studio Integration

This standalone application is also integrated as a **Git Submodule** within [Elkhedr Studio](https://github.com/elkhedr-ai/elkhedr-studio) under the **Enterprise Section**.

## How the Integration Works
- **Deduplication:** The code exists in its own repository and is linked inside Studio. This prevents duplication and ensures a "single source of truth."
- **Enterprise Section:** Inside Elkhedr Studio, the Enterprise features leverage Orca's 100-agent swarm for high-level corporate tasks.

## Managing Updates
To keep both apps synced across devices:
1. **Pushing Changes:** If you modify Orca inside Studio, commit and push from the `src/enterprise/elkhedr-orca` directory to update the standalone repo.
2. **Pulling Changes:** In the Studio root, run `./update-orca.sh` to pull the latest standalone Orca improvements.

## Setup on New Devices
When cloning Elkhedr Studio on a new machine, use:
```bash
git clone --recurse-submodules https://github.com/elkhedr-ai/elkhedr-studio.git
```
This will automatically download the correct version of Orca.
