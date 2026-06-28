---
name: agentsync
description: Use to launch and coordinate MULTIPLE concurrent local Claude Code agents on shared folders/repos without conflicts — spawn many jobs at once, see who else is working where in real time, and avoid two agents clobbering the same files. Activate when the user wants to run several agents in parallel, "launch N agents", parallelize work across a codebase, set up multi-agent coordination, or check which agents are active in a project. Per-scope: agents on different projects stay mutually invisible.
---

# AgentSync — coordinate concurrent local agents

AgentSync lets many Claude Code agents work in the same project at once without stepping on each other. Coordination is **per-scope** (nearest project root): agents in different projects never see each other; agents in the same scope discover each other in real time via an append-only bus and Claude hooks.

## When to use
- The user wants to **launch several agents in parallel** ("run 3 agents", "parallelize this", "spin up a wave of agents").
- The user asks **who is working on what** / wants a live view of active agents.
- Multiple agents will touch the **same folder** and must not clobber each other.

## Mental model (3 modes, pick by what's being edited)
- **Awareness (default, `--shared`)**: agents share one checkout, announce themselves, and get warned when a peer is editing the same file. Best for collaborative/coupled work.
- **Isolated (`--isolated`)**: each agent gets its own `git worktree` + branch; `git merge` resolves conflicts. Best for independent parallel work on tracked files.
- **Flock (opt-in)**: for genuinely-shared, non-git-mergeable files (gitignored env/secrets), declare them in `.agentsync/config.json` `tier1` globs; writes are serialized through `agentsync put`.

## Commands
```bash
agentsync install --global            # once: wire hooks into ~/.claude (dormant until a project opts in)
agentsync install --scope .           # opt the current project in
agentsync up --task "DESC" -n K        # launch K agents (default --shared). Add --isolated / --dry-run / --print
agentsync ps [--follow] [--all]        # live status: who's active, what they touch, overlaps. --follow = real-time
agentsync kill <label>                 # safe teardown (e.g. wave1.2)
agentsync doctor                       # health check
```

## How to drive it
1. If not installed: `agentsync install --global` then `agentsync install --scope .` in the target project.
2. Launch a wave: `agentsync up --task "<clear task>" -n <K>` (use `--isolated` if the agents will heavily edit the same tracked files; `--dry-run` first to preview collisions).
3. Monitor: `agentsync ps --follow`. Each row shows a ready `agentsync kill <label>`.
4. As an agent yourself, before rewriting a hot/shared file, run `agentsync ps` to see if a peer is already on it; coordinate (pick a different file, or wait) rather than overwrite.

## Coordination etiquette for agents
- The SessionStart hook injects "N other agents active here, touching X" — heed it.
- If a PreToolUse warning says a peer is editing your target file, prefer a different file or a different region, or wait and re-read first.
- Treat `deploy/`, shared config, and generated singletons as high-collision; coordinate explicitly there.

Per-scope means: only worry about agents whose paths overlap yours. Two agents in unrelated repos are correctly invisible to each other.
