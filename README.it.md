# Tessera

[English](README.md) · **Italiano** · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português](README.pt.md) · [简体中文](README.zh-Hans.md) · [日本語](README.ja.md)

<p align="center"><img src="docs/img/hero.png" alt="Tessera — molti agenti, una cartella condivisa, nessuna collisione" width="840"></p>

Tessera ti permette di eseguire **diversi agenti di coding AI locali nella stessa cartella contemporaneamente** senza che si sovrascrivano a vicenda il lavoro in silenzio. È minuscolo (zero dipendenze), gira su qualsiasi progetto e non richiede alcun servizio in background — la coordinazione viaggia su un file condiviso più gli hooks di [Claude Code](https://docs.claude.com/en/docs/claude-code).

> **Una skill che installi una volta sola, poi dimentichi.** Tessera si integra in Claude Code come skill + hooks. In un progetto che non la usa, è un controllo shell di ~millisecondi che non fa nulla; in uno che la usa, non aggiunge alcun lavoro a cui i tuoi agenti debbano pensare — non hanno neppure bisogno di sapere che c'è.

> **Il nome.** Una *tessera* è un singolo tassello in un mosaico. In una *tassellatura*, i tasselli ricoprono una superficie **senza spazi vuoti e senza sovrapposizioni** — esattamente ciò che vuoi da molti agenti che condividono un'unica codebase.

---

## Il problema

Avvia due o tre agenti sullo stesso repo e incontri, in quest'ordine:

1. **Sovrascrittura silenziosa.** Due agenti modificano lo stesso file nello stesso istante. Vince il secondo salvataggio; il lavoro del primo agente sparisce — senza alcun errore.
2. **Nessuna consapevolezza.** Non puoi vedere chi sta toccando cosa. Scopri la collisione più tardi — a un conflitto di merge o a una build rotta.
3. **Spawn imprevedibili.** Gli agenti vengono lanciati all'occorrenza (da te, o da altri agenti). Nulla avverte gli agenti già al lavoro che è appena arrivato un nuovo venuto.
4. **Gli strumenti esistenti lo schivano.** La maggior parte dei runner multi-agente dà a ciascun agente il proprio *git worktree* e lascia che sia poi `git merge` a sistemare le cose. Ottimo per lavoro del tutto indipendente — ma inutile quando gli agenti devono collaborare **in un unico checkout condiviso**.

<img src="docs/img/problem.png" alt="Due agenti modificano lo stesso file contemporaneamente e uno sovrascrive l'altro in silenzio" width="840">

<p align="center"><sub><i>Due agenti salvano <code>src/api.js</code> nello stesso istante — vince la seconda scrittura, il lavoro del primo agente è perduto e nulla ti avverte.</i></sub></p>

---

## L'idea: una lavagna condivisa

Immagina un team che lavora in un'unica stanza. Alla parete è appesa una lavagna. Ogni volta che qualcuno inizia un task lo scrive — *"Sto su `api.js`"* — e ognuno dà un'occhiata alla lavagna prima di prendere un file.

**Tessera è quella lavagna per i tuoi agenti.** Vive *dentro* il progetto (`<project>/.tessera/`) come un semplice log in sola aggiunta. Ogni agente si annuncia e annota cosa sta modificando; ogni altro agente lo legge in tempo reale. Quando due puntano allo stesso file, quello che sta per scrivere riceve un avviso preventivo.

<img src="docs/img/blackboard.png" alt="Una lavagna condivisa dove ogni agente scrive cosa sta modificando e i pari lo leggono in tempo reale" width="840">

<p align="center"><sub><i>Ogni agente pubblica cosa sta modificando. Quando il nuovo venuto D punta al file di A, la lavagna mostra subito il conflitto — così si coordinano invece di collidere.</i></sub></p>

Nessun agente deve *sapere di* Tessera o cooperare di proposito — è cablato attraverso gli hooks di Claude Code (vedi **Come funziona**, più sotto).

---

## Ambito per-cartella — nessun rumore tra progetti

La lavagna vive *nel* progetto, quindi collega soltanto gli agenti che condividono davvero quel progetto. Due agenti in due repo diversi scrivono su due lavagne diverse e sono **reciprocamente invisibili**. Anche i sotto-progetti di un monorepo restano indipendenti.

<img src="docs/img/scopes.png" alt="Due progetti, ciascuno con la propria lavagna; gli agenti in progetti diversi sono reciprocamente invisibili" width="840">

<p align="center"><sub><i>Due progetti, due lavagne. Gli agenti in cartelle diverse non condividono nulla e non si vedono mai — nessun rumore, nessun falso allarme.</i></sub></p>

Uno *scope* è la cartella più vicina risalendo l'albero che porta un marcatore (`.git`, `package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`, …, o un esplicito `.tessera-scope`). Gli agenti si coordinano solo dove i path che toccano cadono nello **stesso** scope.

---

## Come funziona (sotto il cofano)

Tessera è volutamente piccolo. Si fonda su un'osservazione: **i conflitti sono di tre tipi, e due di essi hanno già ottimi strumenti.**

| Tipo di file | Lo strumento giusto | Il compito di Tessera |
|---|---|---|
| **File tracciati** (in git) | isolamento con `git worktree` + vero `git merge` | **adottarlo** — `tessera up --isolated` dà a ogni agente il proprio worktree + branch |
| **Consapevolezza** (chi c'è, cosa tocca) | *non esisteva nulla di leggero* | **costruirla** — la lavagna condivisa (la modalità di default) |
| **File condivisi che git non sa fare merge** (env ignorati da git, singleton generati) | un `flock` + scrittura atomica | **pianificato** (modalità flock opt-in), non in questa release |

Così Tessera costruisce solo il sottile pezzo mancante — la *consapevolezza* — e riutilizza `git`, `flock`, `inotify` (via `fs.watch` di Node), `tmux` e NDJSON per il resto. Non ci sono **vector clock** (su una sola macchina un unico file in sola aggiunta è già un ordine totale), **nessun daemon** e **nessun costo a riposo**.

<img src="docs/img/flow.png" alt="Ciclo di vita: un agente si annuncia all'avvio, controlla la lavagna prima di modificare, poi si coordina" width="840">

<p align="center"><sub><i>L'intero ciclo è automatico: annuncio all'avvio, controllo della lavagna prima di modificare, coordinamento in caso di conflitto — tutto guidato dagli hooks, invisibile all'agente.</i></sub></p>

Qualche dettaglio per i curiosi:

- **La lavagna è la fonte di verità.** NDJSON in sola aggiunta; una scrittura troncata si auto-ripara (ogni record è incorniciato da un newline iniziale), e il lettore è deduplicato e a prova di prototype pollution. `fs.watch` è solo un *campanello* — gli agenti si riconciliano sempre con il log.
- **Identità = la sessione.** Una esecuzione `claude` separata è un agente; i suoi sub-agenti sono quella singola unità di lavoro (Claude già separa i loro file). La vitalità è un heartbeat più, quando noto, `/proc`.
- **Il gate è un hook.** `PreToolUse` può avvisare — o bloccare in modo deciso sotto `TESSERA_GUARD=1` — *prima* che una scrittura vada a buon fine, interamente in userspace (nessun privilegio, nessun `fanotify`).

📖 **Per approfondire:** l'intero ragionamento dietro ogni scelta — cosa abbiamo provato e scartato, e perché resta veloce e leggero — è in **[docs/RATIONALE.md](docs/RATIONALE.md)**.

---

## Installazione

```bash
git clone <repo-url> tessera && cd tessera
node bin/tessera.mjs install --global      # add the hooks to ~/.claude/settings.json (auto-backed-up); fires everywhere
# dormant (~ms shell pre-filter) in every project until one opts in:
node bin/tessera.mjs install --scope .      # opt THIS project in (creates .tessera/, gitignores it)
node bin/tessera.mjs install --uninstall    # remove the hooks (the skill dir and per-scope .tessera/ are left in place)
```

**Requisiti:** Linux, **node ≥18**, la CLI di [Claude Code](https://docs.claude.com/en/docs/claude-code) e `git`; `tmux` è opzionale (in sua assenza il launcher ripiega su uno spawn distaccato). Per usare `tessera` direttamente, esegui `npm link` (oppure `npm install -g .`) nel repo, o crea un symlink di `bin/tessera.mjs` nel tuo `PATH`. Non ci sono **dipendenze npm** da installare.

## Uso

```bash
tessera up --task "split the API module" -n 3      # 3 agents, SHARED checkout: awareness board + overlap warnings
tessera up --task "migrate to v2" -n 5 --isolated   # 5 agents, each in its own git worktree + branch
tessera up --task "..." -n 3 --dry-run              # preview the predicted collisions, don't launch
tessera ps --follow                                 # live dashboard: who's active, what they touch, overlaps
tessera ps --all                                    # every participating scope under the current folder
tessera kill wave1.2                                # safe teardown (tmux window / process group)
tessera doctor                                      # health check
```

## Cosa ottieni automaticamente

Una volta installato, ogni agente — comunque venga lanciato — partecipa senza alcuno sforzo aggiuntivo:

- **All'avvio** → si annuncia e gli viene comunicato *"N altri agenti sono attivi qui, stanno toccando X, Y."*
- **Prima di ogni modifica** (`Edit` / `Write` / `NotebookEdit`) → registra cosa sta toccando; se un pari attivo è sullo **stesso file**, riceve un avviso di coordinamento (o un blocco deciso sotto `TESSERA_GUARD=1`).
- **All'arresto / alla fine** → heartbeat e rilascio.

## Garanzie e limiti

Singolo host Linux, un solo utente, filesystem locale (i lock advisory e inotify sono inaffidabili su NFS). Tessera difende l'**integrità dei dati** e il **targeting corretto del teardown**; **non** difende da un processo malevolo dello stesso utente, né protegge i *valori* dei segreti — detto chiaramente, senza far finta. Coordinare agenti su *macchine diverse* è uno strato opzionale pianificato (un trasporto di rete su una mesh VPN); oggi la lavagna locale è tutta la storia, deliberatamente. Vedi [`docs/ROADMAP.md`](docs/ROADMAP.md) e [`docs/DESIGN.md`](docs/DESIGN.md).

## Lavori correlati

I runner improntati all'isolamento — **uzi**, **claude-squad**, **vibe-kanban**, **Conductor** — danno a ciascun agente il proprio worktree/workspace e rimandano i conflitti a `git merge`; **claude-flow** coordina i sub-agenti che *esso stesso* orchestra attraverso una pesante lavagna SQLite condivisa. Tessera è lo strato sottile, a zero dipendenze, di consapevolezza tra pari per un *checkout condiviso* — e poiché quegli strumenti eseguono tutti il vero Claude Code, gli hooks di Tessera scattano anche al loro interno, così Tessera **si compone** con essi invece di competere.

## Licenza

MIT. Contributi benvenuti.
