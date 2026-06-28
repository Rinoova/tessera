# Tessera

[English](README.md) · **Italiano** · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português](README.pt.md) · [简体中文](README.zh-Hans.md) · [日本語](README.ja.md)

**Coordinamento di basso livello e a zero dipendenze per più agenti AI di coding locali che lavorano nelle stesse cartelle.**

Quando esegui contemporaneamente più agenti [Claude Code](https://docs.claude.com/en/docs/claude-code) sullo stesso repo, due di essi possono modificare lo stesso file nello stesso momento e sovrascrivere silenziosamente il lavoro l'uno dell'altro. Tessera permette ad agenti generati in modo imprevedibile di **scoprirsi a vicenda in tempo reale** e di **smettere di pestarsi i piedi** — per cartella, senza daemon, resistente ai crash, su qualsiasi progetto (polyrepo, monorepo, singolo repo, qualsiasi linguaggio).

> **Perché "Tessera"?** Una *tessera* è un singolo tassello di un mosaico. In una *tassellatura*, le tessere coprono la superficie **senza spazi vuoti e senza sovrapposizioni** — esattamente l'obiettivo qui: molti agenti che tassellano il lavoro, senza mai sovrapporsi. Ogni agente è una tessera; il bus condiviso è il mosaico.

## L'idea in una riga

Il conflitto tra agenti ha tre classi, e ognuna dispone già dello strumento giusto — perciò Tessera costruisce solo il sottile collante più l'unico pezzo davvero mancante:

| Classe | Strumento giusto | Tessera |
|---|---|---|
| **File tracciati** (in git) | isolamento con `git worktree` + vero `git merge` | lo **adotta** (`up --isolated`) |
| **Consapevolezza** — chi c'è, cosa sta toccando, qualcuno è appena stato generato | un **bus NDJSON** append-only per scope + **hooks** di Claude + `fs.watch` | lo **costruisce** (sottile) — l'impostazione predefinita |
| **File realmente condivisi che git non può fondere** (env in gitignore, singleton generati) | lock `flock(2)` + scrittura atomica | **pianificato** (modalità flock opt-in — non in questa release) |

Niente vector clock (su un singolo host il **byte offset di un singolo file append-only è già un ordine totale**). Nessun daemon. Nessun costo a riposo. Nulla inventato a livello di primitiva — compone `git`, `flock`, `inotify` (tramite `fs.watch`), `tmux` e NDJSON.

## Perché lo scoping per cartella è automatico

Il medium di coordinamento (`<scope>/.tessera/`) vive *all'interno* del progetto, quindi due agenti condividono un medium **solo se** i percorsi che toccano si risolvono nello stesso scope. Agenti in progetti diversi non condividono nulla e sono reciprocamente invisibili — gratuitamente. (È la proprietà "leggi locali, effetto globale" del tuple-space di Linda.) `scope` = l'antenato più vicino che porta un marcatore (`.tessera-scope`, `.git`, `package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`, …), con priorità alla distanza, così i sottoalberi di un monorepo restano indipendenti.

## Installazione

```bash
git clone <repo-url> tessera && cd tessera
node bin/tessera.mjs install --global      # merge hooks into ~/.claude/settings.json (auto-backed-up); fires everywhere
# dormant (~ms sh pre-filter) in every project until one opts in:
node bin/tessera.mjs install --scope .      # opt THIS project in (creates .tessera/, gitignores it)
node bin/tessera.mjs install --uninstall    # remove the hooks (the skill dir and per-scope .tessera/ are left in place)
```
**Requisiti:** Linux, **node ≥18**, la CLI [Claude Code](https://docs.claude.com/en/docs/claude-code) e `git`; `tmux` è opzionale (in sua assenza il launcher ricade su uno spawn detached). Per usare `tessera` direttamente, esegui `npm link` (oppure `npm install -g .`) nel repo — il campo `bin` è già impostato — o crea un symlink di `bin/tessera.mjs` nel tuo `PATH`. Non ci sono dipendenze npm da installare.

## Uso — avvia e osserva molti agenti

```bash
tessera up --task "split the API module" -n 3      # 3 agents, SHARED checkout, awareness + overlap warnings
tessera up --task "migrate to v2" -n 5 --isolated   # 5 agents, each in its own git worktree+branch
tessera up --task "..." -n 3 --dry-run              # preview predicted collisions, don't launch
tessera ps --follow                                 # real-time dashboard: who's live, what they touch, overlaps
tessera ps --all                                    # every participating scope under cwd
tessera kill wave1.2                                # safe teardown (tmux window / process group)
tessera doctor                                      # health check
```

## Cosa ottieni automaticamente (tramite gli hooks di Claude — nessuna cooperazione degli agenti necessaria)

- **SessionStart** → ogni agente si annuncia e gli viene comunicato *"N altri agenti sono attivi qui, stanno toccando X, Y."*
- **PreToolUse(Edit/Write/NotebookEdit)** → registra cosa modifica ciascun agente; se un peer attivo sta toccando lo **stesso file**, l'agente che sta modificando riceve un avviso di coordinamento (o un blocco rigido con `TESSERA_GUARD=1`).
- **Stop / SessionEnd** → heartbeat / rilascio.

L'unità di coordinamento è la **sessione dell'agente** (una invocazione `claude` separata). Il bus è append-only, resistente ai crash (il framing con `\n` iniziale auto-ripara le scritture troncate), protetto da prototype-pollution e deduplicato. L'identità è il session id; la liveness è heartbeat + (quando noto) `/proc`.

## Ambito delle garanzie

Singolo host Linux, un solo uid, filesystem locale (i lock advisory e inotify sono inaffidabili su NFS). Tessera difende l'**integrità dei dati** e la **corretta individuazione dei target di teardown**; **non** difende da un processo malevolo con lo stesso uid né protegge i *valori* segreti — dichiarato apertamente, senza fingere. Coordinare agenti tra *macchine diverse* è un livello opzionale pianificato (un trasporto di rete su una mesh VPN); oggi il bus di file locale è l'intera storia, deliberatamente.

## Struttura

```
lib/      scope · identity · bus · proc · coord · config · args
hooks/    tessera-hook.sh (fast pre-filter) → tessera-hook.mjs (handler)
cmd/      install · up · ps · kill · doctor
bin/      tessera.mjs
test/     selftest.mjs · dummy-agent.mjs
docs/     DESIGN.md
```

## Licenza

MIT. Contributi benvenuti.
