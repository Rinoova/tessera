# Tessera

[English](README.md) · [Italiano](README.it.md) · [Español](README.es.md) · [Français](README.fr.md) · **Deutsch** · [Português](README.pt.md) · [简体中文](README.zh-Hans.md) · [日本語](README.ja.md)

**Hardwarenahe, abhängigkeitsfreie Koordination für mehrere lokale KI-Coding-Agenten, die in denselben Ordnern arbeiten.**

Wenn du mehrere [Claude Code](https://docs.claude.com/en/docs/claude-code)-Agenten gleichzeitig auf demselben Repo laufen lässt, können zwei davon gleichzeitig dieselbe Datei bearbeiten und sich dabei stillschweigend gegenseitig die Arbeit überschreiben. Tessera ermöglicht es unvorhersehbar gestarteten Agenten, **einander in Echtzeit zu entdecken** und **sich nicht länger gegenseitig in die Quere zu kommen** — pro Ordner, ohne Daemon, absturzsicher, in jedem Projekt (Polyrepo, Monorepo, einzelnes Repo, jede Sprache).

> **Warum „Tessera"?** Eine *Tessera* ist ein einzelnes Steinchen in einem Mosaik. In einer *Tessellierung* (Parkettierung) bedecken die Steinchen die Fläche **ohne Lücken und ohne Überlappungen** — genau das Ziel hier: viele Agenten, die die Arbeit wie Kacheln aufteilen, ohne sich je zu überlappen. Jeder Agent ist eine Tessera; der gemeinsame Bus ist das Mosaik.

## Die Idee in einer Zeile

Konflikte zwischen Agenten gibt es in drei Klassen, und für jede existiert bereits das passende Werkzeug — Tessera baut deshalb nur den dünnen Kitt plus das eine wirklich fehlende Stück:

| Klasse | Passendes Werkzeug | Tessera |
|---|---|---|
| **Versionierte Dateien** (in git) | `git worktree`-Isolation + echtes `git merge` | **übernimmt** es (`up --isolated`) |
| **Awareness** — wer ist hier, was bearbeiten sie, hat gerade jemand gestartet | ein per-Scope angehängter (append-only) **NDJSON-Bus** + Claude-**hooks** + `fs.watch` | **baut** es (dünn) — die Voreinstellung |
| **Wirklich geteilte Dateien, die git nicht mergen kann** (gitignorierte env-Dateien, generierte Singletons) | `flock(2)`-Lock + atomares Schreiben | **geplant** (optionaler flock-Modus — nicht in diesem Release) |

Keine Vector Clocks (auf einem einzelnen Host ist der **Byte-Offset einer einzigen append-only-Datei bereits eine totale Ordnung**). Kein Daemon. Keine Kosten im Leerlauf. Nichts auf Primitiv-Ebene neu erfunden — es kombiniert `git`, `flock`, `inotify` (über `fs.watch`), `tmux` und NDJSON.

## Warum Scoping pro Ordner automatisch erfolgt

Das Koordinationsmedium (`<scope>/.tessera/`) liegt *innerhalb* des Projekts, sodass sich zwei Agenten ein Medium **nur dann** teilen, wenn die Pfade, die sie berühren, in denselben Scope auflösen. Agenten in verschiedenen Projekten teilen nichts und sind füreinander unsichtbar — ganz von selbst. (Das ist die „local laws, global effect"-Eigenschaft des Linda-Tuple-Space.) `scope` = der nächstgelegene übergeordnete Ordner mit einem Marker (`.tessera-scope`, `.git`, `package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`, …), Distanz zuerst, sodass Monorepo-Teilbäume unabhängig bleiben.

## Installation

```bash
git clone <repo-url> tessera && cd tessera
node bin/tessera.mjs install --global      # merge hooks into ~/.claude/settings.json (auto-backed-up); fires everywhere
# dormant (~ms sh pre-filter) in every project until one opts in:
node bin/tessera.mjs install --scope .      # opt THIS project in (creates .tessera/, gitignores it)
node bin/tessera.mjs install --uninstall    # remove the hooks (the skill dir and per-scope .tessera/ are left in place)
```
**Voraussetzungen:** Linux, **node ≥18**, die [Claude Code](https://docs.claude.com/en/docs/claude-code)-CLI und `git`; `tmux` ist optional (der Launcher weicht ohne es auf einen abgekoppelten Spawn aus). Um `tessera` direkt zu nutzen, führe `npm link` (oder `npm install -g .`) im Repo aus — das `bin`-Feld ist bereits gesetzt — oder verlinke `bin/tessera.mjs` per Symlink in deinen `PATH`. Es gibt keine npm-Abhängigkeiten zu installieren.

## Verwendung — viele Agenten starten und beobachten

```bash
tessera up --task "split the API module" -n 3      # 3 agents, SHARED checkout, awareness + overlap warnings
tessera up --task "migrate to v2" -n 5 --isolated   # 5 agents, each in its own git worktree+branch
tessera up --task "..." -n 3 --dry-run              # preview predicted collisions, don't launch
tessera ps --follow                                 # real-time dashboard: who's live, what they touch, overlaps
tessera ps --all                                    # every participating scope under cwd
tessera kill wave1.2                                # safe teardown (tmux window / process group)
tessera doctor                                      # health check
```

## Was du automatisch bekommst (über Claude-hooks — keine Kooperation der Agenten nötig)

- **SessionStart** → jeder Agent meldet sich an und erhält die Auskunft *„N andere Agenten sind hier aktiv und berühren X, Y."*
- **PreToolUse(Edit/Write/NotebookEdit)** → erfasst, was jeder Agent bearbeitet; wenn ein aktiver Peer dieselbe **Datei** berührt, erhält der bearbeitende Agent eine Koordinationswarnung (oder eine harte Blockierung unter `TESSERA_GUARD=1`).
- **Stop / SessionEnd** → Heartbeat / Freigabe.

Die Koordinationseinheit ist die **Agenten-Session** (ein separater `claude`-Aufruf). Der Bus ist append-only, absturzsicher (die Rahmung mit führendem `\n` heilt zerrissene Schreibvorgänge selbst), schützt vor Prototype-Pollution und ist dedupliziert. Die Identität ist die session id; die Lebendigkeit ergibt sich aus dem Heartbeat + (sofern bekannt) `/proc`.

## Umfang der Garantien

Ein einzelner Linux-Host, eine uid, lokales Dateisystem (advisory locks und inotify sind auf NFS unzuverlässig). Tessera verteidigt **Datenintegrität** und **korrektes Zielen beim Teardown**; es schützt **nicht** vor einem böswilligen Prozess mit derselben uid und schützt auch keine geheimen *Werte* — klar gesagt, nicht vorgetäuscht. Die Koordination von Agenten über *verschiedene Maschinen* hinweg ist eine geplante optionale Schicht (ein Netzwerktransport über ein Mesh-VPN); heute ist der lokale Datei-Bus bewusst die ganze Geschichte.

## Aufbau

```
lib/      scope · identity · bus · proc · coord · config · args
hooks/    tessera-hook.sh (fast pre-filter) → tessera-hook.mjs (handler)
cmd/      install · up · ps · kill · doctor
bin/      tessera.mjs
test/     selftest.mjs · dummy-agent.mjs
docs/     DESIGN.md
```

## Lizenz

MIT. Beiträge sind willkommen.
