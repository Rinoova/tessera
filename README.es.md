# Tessera

[English](README.md) · [Italiano](README.it.md) · **Español** · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português](README.pt.md) · [简体中文](README.zh-Hans.md) · [日本語](README.ja.md)

**Coordinación de bajo nivel y sin dependencias para múltiples agentes locales de codificación con IA que trabajan en las mismas carpetas.**

Cuando ejecutas varios agentes de [Claude Code](https://docs.claude.com/en/docs/claude-code) a la vez sobre el mismo repositorio, dos de ellos pueden editar el mismo archivo al mismo tiempo y pisarse el trabajo mutuamente de forma silenciosa. Tessera permite que agentes lanzados de forma impredecible **se descubran entre sí en tiempo real** y **dejen de estorbarse unos a otros** — por carpeta, sin demonios, a prueba de fallos, en cualquier proyecto (polyrepo, monorepo, repositorio único, cualquier lenguaje).

> **¿Por qué "Tessera"?** Una *tessera* es una sola pieza de un mosaico. En una *teselación*, las piezas cubren la superficie **sin huecos ni superposiciones** — exactamente el objetivo aquí: muchos agentes teselando el trabajo, sin solaparse nunca. Cada agente es una tessera; el bus compartido es el mosaico.

## La idea en una línea

El conflicto entre agentes tiene tres clases, y cada una ya cuenta con la herramienta adecuada — así que Tessera construye solo el fino pegamento más la única pieza que realmente falta:

| Clase | Herramienta adecuada | Tessera |
|---|---|---|
| **Archivos rastreados** (en git) | aislamiento con `git worktree` + `git merge` real | lo **adopta** (`up --isolated`) |
| **Conciencia** — quién está aquí, qué están tocando, si alguien acaba de aparecer | un **bus NDJSON** de solo-anexado por ámbito + **hooks** de Claude + `fs.watch` | lo **construye** (fino) — el comportamiento por defecto |
| **Archivos genuinamente compartidos que git no puede fusionar** (entornos en gitignore, singletons generados) | bloqueo `flock(2)` + escritura atómica | **planificado** (modo flock opcional — no en esta versión) |

Sin relojes vectoriales (en un solo host, el **desplazamiento en bytes de un único archivo de solo-anexado ya es un orden total**). Sin demonio. Sin coste en reposo. Nada inventado a nivel de primitiva — compone `git`, `flock`, `inotify` (vía `fs.watch`), `tmux` y NDJSON.

## Por qué el ámbito por carpeta es automático

El medio de coordinación (`<scope>/.tessera/`) vive *dentro* del proyecto, por lo que dos agentes comparten un medio **solo si** las rutas que tocan se resuelven dentro del mismo ámbito. Los agentes en proyectos distintos no comparten nada y son mutuamente invisibles — de forma gratuita. (Esta es la propiedad de "leyes locales, efecto global" del espacio de tuplas de Linda.) `scope` = el ancestro más cercano que porta un marcador (`.tessera-scope`, `.git`, `package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`, …), priorizando la distancia, de modo que los subárboles de un monorepo permanecen independientes.

## Instalación

```bash
git clone <repo-url> tessera && cd tessera
node bin/tessera.mjs install --global      # merge hooks into ~/.claude/settings.json (auto-backed-up); fires everywhere
# dormant (~ms sh pre-filter) in every project until one opts in:
node bin/tessera.mjs install --scope .      # opt THIS project in (creates .tessera/, gitignores it)
node bin/tessera.mjs install --uninstall    # remove the hooks (the skill dir and per-scope .tessera/ are left in place)
```
**Requisitos:** Linux, **node ≥18**, la CLI de [Claude Code](https://docs.claude.com/en/docs/claude-code) y `git`; `tmux` es opcional (el lanzador recurre a un spawn desacoplado si no está). Para usar `tessera` directamente, ejecuta `npm link` (o `npm install -g .`) en el repositorio — el campo `bin` ya está configurado — o crea un enlace simbólico de `bin/tessera.mjs` en tu `PATH`. No hay dependencias de npm que instalar.

## Uso — lanzar y observar muchos agentes

```bash
tessera up --task "split the API module" -n 3      # 3 agents, SHARED checkout, awareness + overlap warnings
tessera up --task "migrate to v2" -n 5 --isolated   # 5 agents, each in its own git worktree+branch
tessera up --task "..." -n 3 --dry-run              # preview predicted collisions, don't launch
tessera ps --follow                                 # real-time dashboard: who's live, what they touch, overlaps
tessera ps --all                                    # every participating scope under cwd
tessera kill wave1.2                                # safe teardown (tmux window / process group)
tessera doctor                                      # health check
```

## Lo que obtienes automáticamente (vía hooks de Claude — sin necesidad de cooperación entre agentes)

- **SessionStart** → cada agente se anuncia a sí mismo y se le informa de que *"hay N otros agentes activos aquí, tocando X, Y."*
- **PreToolUse(Edit/Write/NotebookEdit)** → registra qué edita cada agente; si un par activo está tocando el **mismo archivo**, el agente que edita recibe una advertencia de coordinación (o un bloqueo estricto bajo `TESSERA_GUARD=1`).
- **Stop / SessionEnd** → latido / liberación.

La unidad de coordinación es la **sesión de agente** (una invocación de `claude` separada). El bus es de solo-anexado, a prueba de fallos (el encuadre con `\n` inicial se autorrepara ante escrituras truncadas), a prueba de contaminación de prototipos y deduplicado. La identidad es el session id; la vitalidad es el latido + (cuando se conoce) `/proc`.

## Alcance de las garantías

Un único host Linux, un solo uid, sistema de archivos local (los bloqueos consultivos e inotify no son fiables en NFS). Tessera defiende la **integridad de los datos** y el **desmontaje correcto y bien dirigido**; **no** defiende contra un proceso malicioso del mismo uid ni protege los *valores* secretos — dicho claramente, sin pretender lo contrario. Coordinar agentes entre *máquinas distintas* es una capa opcional planificada (un transporte de red sobre una VPN en malla); hoy el bus de archivos local es toda la historia, deliberadamente.

## Estructura

```
lib/      scope · identity · bus · proc · coord · config · args
hooks/    tessera-hook.sh (fast pre-filter) → tessera-hook.mjs (handler)
cmd/      install · up · ps · kill · doctor
bin/      tessera.mjs
test/     selftest.mjs · dummy-agent.mjs
docs/     DESIGN.md
```

## Licencia

MIT. Las contribuciones son bienvenidas.
