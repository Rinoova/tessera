# Tessera

[English](README.md) · [Italiano](README.it.md) · [Español](README.es.md) · **Français** · [Deutsch](README.de.md) · [Português](README.pt.md) · [简体中文](README.zh-Hans.md) · [日本語](README.ja.md)

**Coordination bas niveau, sans dépendances, pour plusieurs agents de codage IA locaux travaillant dans les mêmes dossiers.**

Lorsque vous exécutez plusieurs agents [Claude Code](https://docs.claude.com/en/docs/claude-code) en même temps sur le même dépôt, deux d'entre eux peuvent éditer le même fichier au même moment et écraser silencieusement le travail de l'autre. Tessera permet à des agents lancés de façon imprévisible de **se découvrir mutuellement en temps réel** et de **cesser de se marcher sur les pieds** — par dossier, sans démon, résistant aux plantages, sur n'importe quel projet (polyrepo, monorepo, dépôt unique, n'importe quel langage).

> **Pourquoi « Tessera » ?** Une *tessera* est une seule tuile dans une mosaïque. Dans une *tessellation*, les tuiles recouvrent la surface **sans aucun vide ni aucun chevauchement** — exactement l'objectif ici : de nombreux agents pavant le travail, sans jamais se chevaucher. Chaque agent est une tessera ; le bus partagé est la mosaïque.

## L'idée en une ligne

Le conflit entre agents se décline en trois classes, et chacune dispose déjà du bon outil — Tessera ne construit donc que la fine glu, plus la seule pièce réellement manquante :

| Classe | Bon outil | Tessera |
|---|---|---|
| **Fichiers suivis** (dans git) | isolation par `git worktree` + véritable `git merge` | l'**adopte** (`up --isolated`) |
| **Conscience mutuelle** — qui est là, que touchent-ils, quelqu'un vient-il d'être lancé | un **bus NDJSON** en ajout seul par portée + **hooks** Claude + `fs.watch` | le **construit** (fin) — par défaut |
| **Fichiers réellement partagés que git ne peut pas fusionner** (env gitignoré, singletons générés) | verrou `flock(2)` + écriture atomique | **prévu** (mode flock optionnel — pas dans cette version) |

Pas d'horloges vectorielles (sur un seul hôte, le **décalage en octets** d'un unique fichier en ajout seul constitue déjà un ordre total). Pas de démon. Aucun coût à l'inactivité. Rien d'inventé au niveau des primitives — il compose `git`, `flock`, `inotify` (via `fs.watch`), `tmux` et NDJSON.

## Pourquoi le cloisonnement par dossier est automatique

Le support de coordination (`<scope>/.tessera/`) réside *à l'intérieur* du projet, de sorte que deux agents partagent un support **uniquement si** les chemins qu'ils touchent se résolvent dans la même portée. Les agents de projets différents ne partagent rien et sont mutuellement invisibles — gratuitement. (C'est la propriété « lois locales, effet global » de l'espace de tuples Linda.) `scope` = le plus proche ancêtre portant un marqueur (`.tessera-scope`, `.git`, `package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`, …), distance d'abord, afin que les sous-arbres d'un monorepo restent indépendants.

## Installation

```bash
git clone <repo-url> tessera && cd tessera
node bin/tessera.mjs install --global      # merge hooks into ~/.claude/settings.json (auto-backed-up); fires everywhere
# dormant (~ms sh pre-filter) in every project until one opts in:
node bin/tessera.mjs install --scope .      # opt THIS project in (creates .tessera/, gitignores it)
node bin/tessera.mjs install --uninstall    # remove the hooks (the skill dir and per-scope .tessera/ are left in place)
```
**Prérequis :** Linux, **node ≥18**, la CLI [Claude Code](https://docs.claude.com/en/docs/claude-code) et `git` ; `tmux` est optionnel (à défaut, le lanceur se rabat sur un lancement détaché). Pour utiliser `tessera` directement, exécutez `npm link` (ou `npm install -g .`) dans le dépôt — le champ `bin` est déjà configuré — ou créez un lien symbolique de `bin/tessera.mjs` dans votre `PATH`. Il n'y a aucune dépendance npm à installer.

## Utilisation — lancer et surveiller de nombreux agents

```bash
tessera up --task "split the API module" -n 3      # 3 agents, SHARED checkout, awareness + overlap warnings
tessera up --task "migrate to v2" -n 5 --isolated   # 5 agents, each in its own git worktree+branch
tessera up --task "..." -n 3 --dry-run              # preview predicted collisions, don't launch
tessera ps --follow                                 # real-time dashboard: who's live, what they touch, overlaps
tessera ps --all                                    # every participating scope under cwd
tessera kill wave1.2                                # safe teardown (tmux window / process group)
tessera doctor                                      # health check
```

## Ce que vous obtenez automatiquement (via les hooks Claude — sans coopération des agents)

- **SessionStart** → chaque agent s'annonce et reçoit le message *« N autres agents sont actifs ici, touchant X, Y. »*
- **PreToolUse(Edit/Write/NotebookEdit)** → enregistre ce que chaque agent édite ; si un pair actif touche le **même fichier**, l'agent qui édite reçoit un avertissement de coordination (ou un blocage strict sous `TESSERA_GUARD=1`).
- **Stop / SessionEnd** → battement de cœur / libération.

L'unité de coordination est la **session d'agent** (une invocation `claude` distincte). Le bus est en ajout seul, résistant aux plantages (l'encadrement par `\n` en tête répare automatiquement les écritures interrompues), protégé contre la pollution de prototype et dédupliqué. L'identité est l'identifiant de session ; la vivacité repose sur le battement de cœur et (lorsqu'il est connu) `/proc`.

## Portée des garanties

Hôte Linux unique, un seul uid, système de fichiers local (les verrous consultatifs et inotify ne sont pas fiables sur NFS). Tessera défend l'**intégrité des données** et le **ciblage correct de la fermeture** ; il ne défend **pas** contre un processus malveillant du même uid et ne protège pas les *valeurs* secrètes — dit clairement, sans faire semblant. Coordonner des agents sur *différentes machines* est une couche optionnelle prévue (un transport réseau sur un VPN maillé) ; aujourd'hui, le bus de fichiers local est toute l'histoire, délibérément.

## Disposition

```
lib/      scope · identity · bus · proc · coord · config · args
hooks/    tessera-hook.sh (fast pre-filter) → tessera-hook.mjs (handler)
cmd/      install · up · ps · kill · doctor
bin/      tessera.mjs
test/     selftest.mjs · dummy-agent.mjs
docs/     DESIGN.md
```

## Licence

MIT. Les contributions sont les bienvenues.
