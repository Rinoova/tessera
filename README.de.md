# Tessera

[English](README.md) · [Italiano](README.it.md) · [Español](README.es.md) · [Français](README.fr.md) · **Deutsch** · [Português](README.pt.md) · [简体中文](README.zh-Hans.md) · [日本語](README.ja.md)

<p align="center"><img src="docs/img/hero.png" alt="Tessera — viele Agenten, ein gemeinsamer Ordner, keine Kollisionen" width="840"></p>

Mit Tessera kannst du **mehrere lokale KI-Coding-Agenten gleichzeitig im selben Ordner** laufen lassen, ohne dass sie sich gegenseitig still die Arbeit überschreiben. Es ist winzig (null Abhängigkeiten), läuft in jedem Projekt und benötigt keinen Hintergrunddienst — die Koordination läuft über eine gemeinsame Datei plus die Hooks von [Claude Code](https://docs.claude.com/en/docs/claude-code).

> **Eine Skill, die du einmal installierst und dann vergisst.** Tessera klinkt sich als Skill + Hooks in Claude Code ein. In einem Projekt, das sie nicht nutzt, ist sie eine Shell-Prüfung im Millisekundenbereich, die nichts tut; in einem, das sie nutzt, verursacht sie keine Arbeit, über die deine Agenten nachdenken müssten — sie müssen nicht einmal wissen, dass sie da ist.

> **Der Name.** Eine *Tessera* ist ein einzelnes Steinchen in einem Mosaik. In einer *Parkettierung* bedecken die Steine eine Fläche **ohne Lücken und ohne Überlappungen** — genau das, was du von vielen Agenten willst, die sich eine Codebasis teilen.

---

## Das Problem

Starte zwei oder drei Agenten am selben Repo, und du stößt, in dieser Reihenfolge, auf Folgendes:

1. **Stilles Überschreiben.** Zwei Agenten bearbeiten im selben Moment dieselbe Datei. Der zweite Speichervorgang gewinnt; die Arbeit des ersten Agenten verschwindet — ohne Fehlermeldung.
2. **Keine Wahrnehmung.** Du kannst nicht sehen, wer was anfasst. Du erfährst von der Kollision erst später — bei einem Merge-Konflikt oder einem kaputten Build.
3. **Unvorhersehbare Starts.** Agenten werden ad hoc gestartet (von dir oder von anderen Agenten). Nichts teilt den bereits arbeitenden Agenten mit, dass gerade ein Neuankömmling eingetroffen ist.
4. **Bestehende Tools weichen dem aus.** Die meisten Multi-Agenten-Runner geben jedem Agenten sein eigenes *git worktree* und überlassen es `git merge`, die Sache hinterher zu regeln. Großartig für völlig unabhängige Arbeit — aber keine Hilfe, wenn Agenten **in einem gemeinsamen Checkout** zusammenarbeiten müssen.

<img src="docs/img/problem.png" alt="Zwei Agenten bearbeiten gleichzeitig dieselbe Datei und einer überschreibt den anderen still" width="840">

<p align="center"><sub><i>Zwei Agenten speichern im selben Moment <code>src/api.js</code> — der zweite Schreibvorgang gewinnt, die Arbeit des ersten Agenten ist weg, und nichts warnt dich.</i></sub></p>

---

## Die Idee: ein gemeinsames Board

Stell dir ein Team vor, das in einem Raum arbeitet. An der Wand hängt ein Board. Immer wenn jemand eine Aufgabe beginnt, schreibt er sie auf — *„Ich arbeite an `api.js`"* — und jeder wirft einen Blick auf das Board, bevor er sich eine Datei schnappt.

**Tessera ist dieses Board für deine Agenten.** Es lebt *innerhalb* des Projekts (`<project>/.tessera/`) als ein einfaches Append-only-Log. Jeder Agent meldet sich an und schreibt auf, was er gerade bearbeitet; jeder andere Agent liest es in Echtzeit. Wenn zwei nach derselben Datei greifen, bekommt derjenige, der gleich schreiben will, einen Hinweis.

<img src="docs/img/blackboard.png" alt="Ein gemeinsames Board, auf dem jeder Agent schreibt, was er bearbeitet, und die anderen es in Echtzeit lesen" width="840">

<p align="center"><sub><i>Jeder Agent trägt ein, was er bearbeitet. Wenn der Neuankömmling D nach As Datei greift, zeigt das Board den Konflikt sofort an — so koordinieren sie sich, statt zu kollidieren.</i></sub></p>

Kein Agent muss *von* Tessera wissen oder absichtlich kooperieren — es ist über die Hooks von Claude Code verdrahtet (siehe **So funktioniert es**, unten).

---

## Geltungsbereich pro Ordner — kein projektübergreifendes Rauschen

Das Board lebt *im* Projekt, also verbindet es nur Agenten, die sich dieses Projekt tatsächlich teilen. Zwei Agenten in zwei verschiedenen Repos schreiben auf zwei verschiedene Boards und sind **füreinander unsichtbar**. Auch die Teilprojekte eines Monorepos bleiben unabhängig.

<img src="docs/img/scopes.png" alt="Zwei Projekte, jedes mit seinem eigenen Board; Agenten in verschiedenen Projekten sind füreinander unsichtbar" width="840">

<p align="center"><sub><i>Zwei Projekte, zwei Boards. Agenten in verschiedenen Ordnern teilen nichts und sehen einander nie — kein Rauschen, keine Fehlalarme.</i></sub></p>

Ein *Scope* ist der nächstgelegene Ordner aufwärts im Baum, der einen Marker trägt (`.git`, `package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`, …, oder ein explizites `.tessera-scope`). Agenten koordinieren sich nur dort, wo die Pfade, die sie anfassen, im **selben** Scope landen.

---

## So funktioniert es (unter der Haube)

Tessera ist bewusst klein. Es beruht auf einer Beobachtung: **Konflikte gibt es in drei Arten, und für zwei davon existieren bereits großartige Werkzeuge.**

| Art der Datei | Das richtige Werkzeug | Tesseras Aufgabe |
|---|---|---|
| **Versionierte Dateien** (in git) | `git worktree`-Isolierung + echtes `git merge` | **es übernehmen** — `tessera up --isolated` gibt jedem Agenten sein eigenes worktree + branch |
| **Wahrnehmung** (wer ist da, was fassen sie an) | *nichts Leichtgewichtiges existierte* | **es bauen** — das gemeinsame Board (der Standardmodus) |
| **Gemeinsame Dateien, die git nicht mergen kann** (gitignorierte env-Dateien, generierte Singletons) | ein `flock` + atomares Schreiben | **geplant** (optionaler flock-Modus), nicht in diesem Release |

Tessera baut also nur das fehlende dünne Stück — die *Wahrnehmung* — und nutzt `git`, `flock`, `inotify` (über Nodes `fs.watch`), `tmux` und NDJSON für den Rest. Es gibt **keine Vektoruhren** (auf einer einzelnen Maschine ist eine einzelne Append-only-Datei bereits eine totale Ordnung), **keinen Daemon** und **keine Leerlaufkosten**.

<img src="docs/img/flow.png" alt="Lebenszyklus: ein Agent meldet sich beim Start an, prüft das Board vor dem Bearbeiten und koordiniert sich dann" width="840">

<p align="center"><sub><i>Die ganze Schleife läuft automatisch: beim Start anmelden, vor dem Bearbeiten das Board prüfen, bei einem Konflikt koordinieren — alles von Hooks gesteuert, unsichtbar für den Agenten.</i></sub></p>

Ein paar Details für die Neugierigen:

- **Das Board ist die Quelle der Wahrheit.** Append-only-NDJSON; ein abgerissener Schreibvorgang heilt sich selbst (jeder Datensatz ist mit einem führenden Zeilenumbruch eingerahmt), und der Leser ist dedupliziert und gegen Prototype-Pollution geschützt. `fs.watch` ist nur eine *Türklingel* — Agenten gleichen sich immer mit dem Log ab.
- **Identität = die Session.** Ein separater `claude`-Lauf ist ein Agent; seine eigenen Sub-Agenten sind diese eine Arbeitseinheit (Claude teilt ihre Dateien bereits auf). Lebendigkeit ist ein Heartbeat plus, wenn bekannt, `/proc`.
- **Das Gate ist ein Hook.** `PreToolUse` kann warnen — oder unter `TESSERA_GUARD=1` hart blockieren — *bevor* ein Schreibvorgang landet, vollständig im Userspace (keine Privilegien, kein `fanotify`).

📖 **Tiefer einsteigen:** die vollständige Begründung hinter jeder Entscheidung — was wir ausprobiert und verworfen haben, und warum es schnell und leichtgewichtig bleibt — steht in **[docs/RATIONALE.md](docs/RATIONALE.md)**.

---

## Installation

```bash
git clone <repo-url> tessera && cd tessera
node bin/tessera.mjs install --global      # add the hooks to ~/.claude/settings.json (auto-backed-up); fires everywhere
# dormant (~ms shell pre-filter) in every project until one opts in:
node bin/tessera.mjs install --scope .      # opt THIS project in (creates .tessera/, gitignores it)
node bin/tessera.mjs install --uninstall    # remove the hooks (the skill dir and per-scope .tessera/ are left in place)
```

**Voraussetzungen:** Linux, **node ≥18**, die [Claude Code](https://docs.claude.com/en/docs/claude-code) CLI und `git`; `tmux` ist optional (der Launcher fällt ohne es auf einen abgekoppelten Spawn zurück). Um `tessera` direkt zu verwenden, führe `npm link` (oder `npm install -g .`) im Repo aus, oder verlinke `bin/tessera.mjs` per Symlink auf deinen `PATH`. Es gibt **keine npm-Abhängigkeiten** zu installieren.

## Verwendung

```bash
tessera up --task "split the API module" -n 3      # 3 agents, SHARED checkout: awareness board + overlap warnings
tessera up --task "migrate to v2" -n 5 --isolated   # 5 agents, each in its own git worktree + branch
tessera up --task "..." -n 3 --dry-run              # preview the predicted collisions, don't launch
tessera ps --follow                                 # live dashboard: who's active, what they touch, overlaps
tessera ps --all                                    # every participating scope under the current folder
tessera kill wave1.2                                # safe teardown (tmux window / process group)
tessera doctor                                      # health check
```

## Was du automatisch bekommst

Einmal installiert, nimmt jeder Agent — wie auch immer er gestartet wird — ohne zusätzlichen Aufwand teil:

- **Beim Start** → er meldet sich an und bekommt mitgeteilt: *„N andere Agenten sind hier aktiv und fassen X, Y an."*
- **Vor jeder Bearbeitung** (`Edit` / `Write` / `NotebookEdit`) → er notiert, was er anfasst; wenn ein aktiver Peer an **derselben Datei** ist, bekommt er eine Koordinationswarnung (oder eine harte Blockade unter `TESSERA_GUARD=1`).
- **Beim Stoppen / Beenden** → Heartbeat und Freigabe.

## Garantien & Grenzen

Einzelner Linux-Host, ein Benutzer, lokales Dateisystem (Advisory Locks und inotify sind auf NFS unzuverlässig). Tessera schützt die **Datenintegrität** und die **korrekte Zielsetzung beim Teardown**; es schützt **nicht** vor einem bösartigen Prozess desselben Benutzers und schützt auch keine geheimen *Werte* — klar gesagt, nicht vorgetäuscht. Das Koordinieren von Agenten über *verschiedene Maschinen* hinweg ist eine geplante optionale Schicht (ein Netzwerktransport über ein Mesh-VPN); heute ist das lokale Board bewusst die ganze Geschichte. Siehe [`docs/ROADMAP.md`](docs/ROADMAP.md) und [`docs/DESIGN.md`](docs/DESIGN.md).

## Verwandte Arbeiten

Isolierung-zuerst-Runner — **uzi**, **claude-squad**, **vibe-kanban**, **Conductor** — geben jedem Agenten sein eigenes worktree/Workspace und verschieben Konflikte auf `git merge`; **claude-flow** koordiniert die Sub-Agenten, die *es* selbst orchestriert, über ein schwergewichtiges gemeinsames SQLite-Blackboard. Tessera ist die dünne, abhängigkeitsfreie Peer-Awareness-Schicht für einen *gemeinsamen Checkout* — und da all diese Tools echtes Claude Code ausführen, feuern Tesseras Hooks auch in ihnen, sodass es mit ihnen **zusammenspielt**, statt zu konkurrieren.

## Lizenz

MIT. Beiträge willkommen.
