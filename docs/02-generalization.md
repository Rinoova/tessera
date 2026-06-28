# 02 — Scope generalization (user clarification)

> "La tua ricerca non riguarda solo il progetto attuale, ma in generale un modus operandi che verrà portato in OGNI progetto di lavoro."

## Reframing: deliverable = a PORTABLE, PROJECT-AGNOSTIC framework
The rinoova polyrepo is just the FIRST install target / test bed. The real output is a reusable "modus operandi" installable into any project, like `anti-drift-init` scaffolds portable docs tooling across 12 stacks.

### Consequences for the design
1. **Packaging = framework + installer**, not bespoke wiring. Ship as:
   - User-level **skill** (`~/.claude/skills/agentsync/`) usable in every project.
   - User-level **hooks** in `~/.claude/settings.json` (apply everywhere) — but each hook must be a CHEAP no-op when a project hasn't opted in / has no `.agentsync/`.
   - A **zero-dep installer / launcher CLI** that works regardless of language or repo layout.
2. **Generic scope detection** (was ".git only"): discover scope root via an ORDERED list of configurable markers — explicit `.agentsync-scope` file > `.git` > language manifest (`package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`, `pom.xml`, …) > fallback cwd. Support **nested scopes**: an agent belongs to the NEAREST marker.
3. **Visibility = PATH-OVERLAP, not just same-scope membership.** Two agents coordinate iff the paths they actually touch/claim overlap. This generalizes cleanly to:
   - polyrepo (16 separate repos): no overlap ⇒ invisible. ✓ (already)
   - monorepo (one `.git`, many sub-projects): agents in disjoint subtrees stay invisible; agents touching shared/ overlap ⇒ coordinate. ✓ (NEW — pure ".git scope" would wrongly couple them)
   - cross-repo edits (agent in repo A edits deploy/ touching all): overlap detected on the touched path's scope. ✓
4. **Zero per-repo setup ideally**: presence/coordination should bootstrap lazily on first agent entry (create `.agentsync/` on demand), and auto-gitignore itself. Opt-out per project via config.
5. **Cross-language**: nothing in the core may assume Node/Python/etc. Core primitives are OS-level (append log, flock, inotify, vector clocks). The CLI can be a single static binary OR a zero-dep script with a runtime that's near-universal — decide in synthesis (candidates: POSIX sh + tiny C/Go helper for inotify/flock; or Node .mjs since both ecosystems here have it; portability favors a small compiled helper).

## Inject into FINAL synthesis round
- Add requirement: "Must be a portable, project-agnostic, language-agnostic framework installed once at user level and working in ANY project with zero/low per-project setup."
- Re-evaluate scope model: replace 'scope = .git' with 'configurable markers + nested scopes + visibility-by-path-overlap'.
- Re-evaluate the CLI runtime choice for maximum portability (avoid hard Node-only dependency if the framework targets arbitrary stacks).
