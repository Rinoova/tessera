# Tessera

[English](README.md) · [Italiano](README.it.md) · [Español](README.es.md) · **Français** · [Deutsch](README.de.md) · [Português](README.pt.md) · [简体中文](README.zh-Hans.md) · [日本語](README.ja.md)

<p align="center"><img src="docs/img/hero.png" alt="Tessera — plusieurs agents, un dossier partagé, aucune collision" width="840"></p>

Tessera vous permet d'exécuter **plusieurs agents de codage IA locaux dans le même dossier en même temps** sans qu'ils n'écrasent silencieusement le travail des uns et des autres. Il est minuscule (zéro dépendance), fonctionne sur n'importe quel projet et ne nécessite aucun service en arrière-plan — la coordination repose sur un fichier partagé et les hooks de [Claude Code](https://docs.claude.com/en/docs/claude-code).

> **Une skill que vous installez une fois, puis oubliez.** Tessera se branche sur Claude Code en tant que skill + hooks. Dans un projet qui ne l'utilise pas, c'est une vérification shell d'une milliseconde environ qui ne fait rien ; dans un projet qui l'utilise, il n'ajoute aucune charge à laquelle vos agents doivent penser — ils n'ont même pas besoin de savoir qu'il est là.

> **Le nom.** Une *tessera* est un unique carreau d'une mosaïque. Dans une *tessellation* (un pavage), les carreaux recouvrent une surface **sans interstices ni chevauchements** — exactement ce que vous attendez de plusieurs agents partageant une même base de code.

---

## Le problème

Lancez deux ou trois agents sur le même dépôt et vous vous heurterez, dans cet ordre, à :

1. **L'écrasement silencieux.** Deux agents modifient le même fichier au même instant. La seconde sauvegarde l'emporte ; le travail du premier agent disparaît — sans aucune erreur.
2. **L'absence de visibilité.** Vous ne pouvez pas voir qui touche à quoi. Vous découvrez la collision plus tard — lors d'un conflit de fusion ou d'un build cassé.
3. **Les apparitions imprévisibles.** Les agents sont lancés de manière ad hoc (par vous, ou par d'autres agents). Rien ne signale aux agents déjà au travail qu'un nouveau venu vient d'arriver.
4. **Les outils existants l'esquivent.** La plupart des orchestrateurs multi-agents donnent à chaque agent son propre *git worktree* et laissent `git merge` faire le tri ensuite. Parfait pour du travail totalement indépendant — mais d'aucune aide lorsque les agents doivent collaborer **dans un seul checkout partagé**.

<img src="docs/img/problem.png" alt="Deux agents modifient le même fichier en même temps et l'un écrase silencieusement l'autre" width="840">

<p align="center"><sub><i>Deux agents enregistrent <code>src/api.js</code> au même instant — la seconde écriture l'emporte, le travail du premier agent est perdu, et rien ne vous avertit.</i></sub></p>

---

## L'idée : un tableau partagé

Imaginez une équipe travaillant dans une même pièce. Au mur est accroché un tableau. Chaque fois que quelqu'un commence une tâche, il l'y inscrit — *« Je suis sur `api.js` »* — et chacun jette un coup d'œil au tableau avant de s'emparer d'un fichier.

**Tessera, c'est ce tableau pour vos agents.** Il vit *à l'intérieur* du projet (`<project>/.tessera/`) sous la forme d'un simple journal en ajout-seul. Chaque agent s'y annonce et y inscrit ce qu'il est en train de modifier ; tous les autres agents le lisent en temps réel. Quand deux d'entre eux convoitent le même fichier, celui qui s'apprête à écrire reçoit un avertissement.

<img src="docs/img/blackboard.png" alt="Un tableau partagé où chaque agent inscrit ce qu'il modifie et où ses pairs le lisent en temps réel" width="840">

<p align="center"><sub><i>Chaque agent publie ce qu'il est en train de modifier. Quand le nouveau venu D convoite le fichier de A, le tableau révèle aussitôt le conflit — afin qu'ils se coordonnent au lieu d'entrer en collision.</i></sub></p>

Aucun agent n'a besoin de *connaître* Tessera ni de coopérer délibérément — tout passe par les hooks de Claude Code (voir **Comment ça marche**, ci-dessous).

---

## Portée par dossier — aucun bruit inter-projets

Le tableau vit *dans* le projet, il ne relie donc que les agents qui partagent réellement ce projet. Deux agents dans deux dépôts différents écrivent sur deux tableaux différents et sont **mutuellement invisibles**. Les sous-projets d'un monorepo restent eux aussi indépendants.

<img src="docs/img/scopes.png" alt="Deux projets, chacun avec son propre tableau ; les agents de projets différents sont mutuellement invisibles" width="840">

<p align="center"><sub><i>Deux projets, deux tableaux. Les agents de dossiers différents ne partagent rien et ne se voient jamais — aucun bruit, aucune fausse alerte.</i></sub></p>

Une *portée* (scope) est le dossier le plus proche en remontant l'arborescence qui porte un marqueur (`.git`, `package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`, …, ou un `.tessera-scope` explicite). Les agents ne se coordonnent que là où les chemins qu'ils touchent tombent dans la **même** portée.

---

## Comment ça marche (sous le capot)

Tessera est délibérément petit. Il repose sur une seule observation : **les conflits sont de trois sortes, et deux d'entre elles disposent déjà d'excellents outils.**

| Type de fichier | Le bon outil | Le rôle de Tessera |
|---|---|---|
| **Fichiers suivis** (dans git) | isolation `git worktree` + vrai `git merge` | **l'adopter** — `tessera up --isolated` donne à chaque agent son propre worktree + branche |
| **Visibilité** (qui est là, à quoi il touche) | *rien de léger n'existait* | **le construire** — le tableau partagé (le mode par défaut) |
| **Fichiers partagés que git ne peut pas fusionner** (env gitignoré, singletons générés) | un `flock` + écriture atomique | **prévu** (mode flock opt-in), pas dans cette version |

Tessera ne construit donc que la fine pièce manquante — la *visibilité* — et réutilise `git`, `flock`, `inotify` (via `fs.watch` de Node), `tmux` et NDJSON pour le reste. Il n'y a **aucune horloge vectorielle** (sur une seule machine, un unique fichier en ajout-seul constitue déjà un ordre total), **aucun démon** et **aucun coût à vide**.

<img src="docs/img/flow.png" alt="Cycle de vie : un agent s'annonce au démarrage, consulte le tableau avant de modifier, puis se coordonne" width="840">

<p align="center"><sub><i>Toute la boucle est automatique : s'annoncer au démarrage, consulter le tableau avant de modifier, se coordonner en cas de conflit — le tout piloté par des hooks, invisible pour l'agent.</i></sub></p>

Quelques précisions pour les curieux :

- **Le tableau est la source de vérité.** NDJSON en ajout-seul ; une écriture interrompue se répare d'elle-même (chaque enregistrement est encadré par un saut de ligne initial), et le lecteur est dédupliqué et protégé contre la pollution de prototype. `fs.watch` n'est qu'une *sonnette* — les agents se réconcilient toujours avec le journal.
- **L'identité = la session.** Une exécution `claude` distincte est un agent ; ses propres sous-agents constituent cette unique unité de travail (Claude répartit déjà leurs fichiers). La présence vivante est un battement de cœur, complété, lorsqu'il est connu, par `/proc`.
- **Le garde-fou est un hook.** `PreToolUse` peut avertir — ou bloquer fermement sous `TESSERA_GUARD=1` — *avant* qu'une écriture n'aboutisse, entièrement en espace utilisateur (aucun privilège, aucun `fanotify`).

📖 **Pour aller plus loin :** tout le raisonnement derrière chaque choix — ce que nous avons essayé et rejeté, et pourquoi il reste rapide et léger — se trouve dans **[docs/RATIONALE.md](docs/RATIONALE.md)**.

---

## Installation

```bash
git clone <repo-url> tessera && cd tessera
node bin/tessera.mjs install --global      # add the hooks to ~/.claude/settings.json (auto-backed-up); fires everywhere
# dormant (~ms shell pre-filter) in every project until one opts in:
node bin/tessera.mjs install --scope .      # opt THIS project in (creates .tessera/, gitignores it)
node bin/tessera.mjs install --uninstall    # remove the hooks (the skill dir and per-scope .tessera/ are left in place)
```

**Prérequis :** Linux, **node ≥18**, la CLI [Claude Code](https://docs.claude.com/en/docs/claude-code) et `git` ; `tmux` est optionnel (le lanceur se rabat sur un spawn détaché en son absence). Pour utiliser `tessera` directement, exécutez `npm link` (ou `npm install -g .`) dans le dépôt, ou créez un lien symbolique de `bin/tessera.mjs` sur votre `PATH`. Il n'y a **aucune dépendance npm** à installer.

## Utilisation

```bash
tessera up --task "split the API module" -n 3      # 3 agents, SHARED checkout: awareness board + overlap warnings
tessera up --task "migrate to v2" -n 5 --isolated   # 5 agents, each in its own git worktree + branch
tessera up --task "..." -n 3 --dry-run              # preview the predicted collisions, don't launch
tessera ps --follow                                 # live dashboard: who's active, what they touch, overlaps
tessera ps --all                                    # every participating scope under the current folder
tessera kill wave1.2                                # safe teardown (tmux window / process group)
tessera doctor                                      # health check
```

## Ce que vous obtenez automatiquement

Une fois installé, chaque agent — quelle que soit la façon dont il est lancé — participe sans effort supplémentaire :

- **Au démarrage** → il s'annonce et se voit signaler *« N autres agents sont actifs ici, touchant à X, Y. »*
- **Avant chaque modification** (`Edit` / `Write` / `NotebookEdit`) → il consigne ce à quoi il touche ; si un pair vivant est sur le **même fichier**, il reçoit un avertissement de coordination (ou un blocage ferme sous `TESSERA_GUARD=1`).
- **À l'arrêt / à la fin** → battement de cœur et libération.

## Garanties et limites

Un seul hôte Linux, un seul utilisateur, système de fichiers local (les verrous consultatifs et inotify ne sont pas fiables sur NFS). Tessera défend l'**intégrité des données** et le **ciblage correct des arrêts** ; il ne défend **pas** contre un processus malveillant du même utilisateur, ni ne protège les *valeurs* secrètes — dit clairement, sans faire semblant. Coordonner des agents entre *machines différentes* est une couche optionnelle prévue (un transport réseau sur un VPN maillé) ; aujourd'hui, le tableau local est toute l'histoire, délibérément. Voir [`docs/ROADMAP.md`](docs/ROADMAP.md) et [`docs/DESIGN.md`](docs/DESIGN.md).

## Travaux connexes

Les orchestrateurs axés sur l'isolation — **uzi**, **claude-squad**, **vibe-kanban**, **Conductor** — donnent à chaque agent son propre worktree/espace de travail et reportent les conflits à `git merge` ; **claude-flow** coordonne les sous-agents qu'*il* orchestre via un lourd tableau noir SQLite partagé. Tessera est la fine couche de visibilité entre pairs, à zéro dépendance, pour un *checkout partagé* — et puisque ces outils exécutent tous le vrai Claude Code, les hooks de Tessera se déclenchent aussi à l'intérieur d'eux, de sorte qu'il **se compose** avec eux plutôt que de les concurrencer.

## Licence

MIT. Les contributions sont les bienvenues.
