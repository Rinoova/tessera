# Activation model: per-project opt-in + auto-opt-in on collision

> How Tessera decides *where* it coordinates once its hooks are installed globally.

## The problem

Installing Tessera's hooks is global (one entry in `~/.claude/settings.json`, fires in
every project). But **coordination itself is per-scope opt-in**: a scope participates only
if it has a `.tessera/` directory (or `TESSERA_TOUCHES` / `TESSERA_AUTO=1`). A "scope" is
the nearest project root, resolved **distance-first** (the closest `.git`/`package.json`
marker wins).

That default is lean — solo work in a non-opted-in project costs almost nothing (a shell
fast-filter exits before Node ever starts). But it has a sharp edge that bit us in
practice:

- **Silent no-op where you forgot to opt in.** Two agents edited the same Architecture
  Decision Record in a repo that was never opted-in. The global hook resolved that repo as
  the scope, saw no `.tessera/`, and did nothing — no announce, no overlap warning. One
  agent clobbered the other's ADR.
- **Wrong-scope foot-gun.** A fix opted-in the *parent* poly-root. But because scope is
  distance-first, an edit inside a child repo (its own `.git`) resolves to the **child**,
  not the parent — so the opt-in never covered the files that were colliding.

The expectation is reasonable: *"I installed it globally, so it should protect me
everywhere."* Pure per-project opt-in quietly violates that.

## The choice: keep opt-in as the default, add an auto-opting safety net

Tessera keeps shipping exactly as before (opt-in per scope; non-participating scopes stay
on the cheap fast-filter), and adds **one** behavior at `SessionStart`:

> When a session starts, Tessera records itself in a small global session registry and
> checks for **other live sessions in the same scope**. If it finds one — i.e. a real
> collision is now possible in a project that isn't opted-in — it **auto-creates
> `.tessera/` in that one repo** (auto-opt-in) and prints a one-time, self-explaining
> notice naming `tessera install --scope .` (to keep it) and `tessera clean` (to undo it).

From that moment the normal per-scope mechanism takes over for *both* agents: their edits
land on the shared awareness bus and overlap warnings fire.

**Why auto-opt-in and not just a warning?** A warning scrolls past; the user keeps editing;
the second collision lands exactly like the first. To be genuinely fail-safe the tool has
to *act* on the detected collision, not merely mention it. The action is defensible because
it is (a) triggered only by a real, observed second live session, (b) confined to the one
offending repo, (c) self-announcing, and (d) reversible in one command.

### Why this shape

- **Fail-safe coverage where it's actually needed.** The net is cast exactly where two
  agents meet — the only place coverage was ever missing — and per nearest-root scope, so
  the wrong-scope foot-gun disappears.
- **Still lean and non-invasive.** Solo work never leaves the fast-filter floor; no repo is
  touched and no activity bus exists until a collision is genuinely possible. The cost and
  the single `.tessera/` write are paid only in the colliding repo, only when needed.
- **Best-effort, not load-bearing.** If detection ever misses an edge case, Tessera simply
  degrades to the old opt-in behavior (silent, safe) — never a correctness bug. So the
  safety net adds no machinery that has to be perfect.

This mirrors how comparable tools work: per-project opt-in is the norm (the marker file is
the consent, as with pre-commit / Husky / Lefthook; `direnv` auto-activates only after an
explicit allow), and a globally-installed tool that stays dormant until a project actually
needs it is the **Watchman** model (one daemon, watches nothing until a client asks).

## Controls

- `TESSERA_NUDGE=0` — disable the safety net entirely (pure opt-in, option A).
- `tessera install --scope .` — make a project's opt-in explicit and committable.
- `tessera install --global --auto` (`TESSERA_AUTO=1`) — opt *everything* in eagerly
  (maximum coverage, at a cost everywhere and a footprint in every repo). Not the default.
- `tessera clean` — undo every `.tessera/` the safety net auto-created (tracked in a global
  inventory).
- `tessera doctor` — shows the current scope, whether it's opted-in, whether the safety net
  is armed, and live peers detected in this scope.

## What it does *not* do

It does not promise to catch a collision in the sub-second window where two agents start at
the same instant before either has registered, and it does not retroactively coordinate
edits made before the second session appeared. That residual window is bounded and far
smaller than the permanent gap of pure opt-in — it is the deliberate lean trade-off against
activating Node on every edit in every project.
