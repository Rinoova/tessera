# Tessera

[English](README.md) · [Italiano](README.it.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · **Português** · [简体中文](README.zh-Hans.md) · [日本語](README.ja.md)

<p align="center"><img src="docs/img/hero.png" alt="Tessera — muitos agentes, uma pasta compartilhada, sem colisões" width="840"></p>

Tessera permite que você execute **vários agentes de IA de programação locais na mesma pasta ao mesmo tempo** sem que eles sobrescrevam silenciosamente o trabalho uns dos outros. É minúsculo (zero dependências), roda em qualquer projeto e não precisa de serviço em segundo plano — a coordenação se apoia em um arquivo compartilhado mais os hooks do [Claude Code](https://docs.claude.com/en/docs/claude-code).

> **Uma skill que você instala uma vez e depois esquece.** Tessera se conecta ao Claude Code como uma skill + hooks. Em um projeto que não a usa, é uma verificação de shell de ~milissegundos que não faz nada; em um que a usa, não acrescenta nenhum trabalho com que seus agentes precisem se preocupar — eles nem precisam saber que ela está ali.

> **O nome.** Uma *tessera* é uma única peça de um mosaico. Em uma *tesselação*, as peças cobrem uma superfície **sem lacunas e sem sobreposições** — exatamente o que você quer de muitos agentes compartilhando um único código-base.

---

## O problema

Inicie dois ou três agentes no mesmo repositório e você esbarra, nesta ordem:

1. **Sobrescrita silenciosa.** Dois agentes editam o mesmo arquivo no mesmo instante. O segundo salvamento vence; o trabalho do primeiro agente desaparece — sem nenhum erro.
2. **Falta de consciência.** Você não consegue ver quem está mexendo no quê. Você descobre a colisão depois — em um conflito de merge ou em um build quebrado.
3. **Spawns imprevisíveis.** Os agentes são lançados de forma ad hoc (por você ou por outros agentes). Nada avisa aos agentes que já estão trabalhando que um recém-chegado acabou de aparecer.
4. **As ferramentas existentes desviam do problema.** A maioria dos executores multiagente dá a cada agente seu próprio *git worktree* e deixa o `git merge` resolver as coisas depois. Ótimo para trabalho totalmente independente — mas inútil quando os agentes precisam colaborar **em um único checkout compartilhado**.

<img src="docs/img/problem.png" alt="Dois agentes editam o mesmo arquivo ao mesmo tempo e um sobrescreve silenciosamente o outro" width="840">

<p align="center"><sub><i>Dois agentes salvam <code>src/api.js</code> no mesmo instante — o segundo write vence, o trabalho do primeiro agente se perde, e nada avisa você.</i></sub></p>

---

## A ideia: um quadro compartilhado

Imagine uma equipe trabalhando em uma única sala. Na parede há um quadro. Sempre que alguém começa uma tarefa, anota nele — *"Estou no `api.js`"* — e todos dão uma olhada no quadro antes de pegar um arquivo.

**Tessera é esse quadro para os seus agentes.** Ele vive *dentro* do projeto (`<project>/.tessera/`) como um simples log somente-anexação (append-only). Cada agente se anuncia e anota o que está editando; todos os outros agentes leem isso em tempo real. Quando dois alcançam o mesmo arquivo, aquele que está prestes a escrever recebe um aviso.

<img src="docs/img/blackboard.png" alt="Um quadro compartilhado onde cada agente escreve o que está editando e os colegas leem em tempo real" width="840">

<p align="center"><sub><i>Cada agente publica o que está editando. Quando o recém-chegado D alcança o arquivo de A, o quadro mostra o conflito na hora — então eles se coordenam em vez de colidir.</i></sub></p>

Nenhum agente precisa *saber sobre* a Tessera ou cooperar de propósito — tudo é ligado através dos hooks do Claude Code (veja **Como funciona**, abaixo).

---

## Escopo por pasta — sem ruído entre projetos

O quadro vive *dentro* do projeto, então ele só conecta agentes que de fato compartilham aquele projeto. Dois agentes em dois repositórios diferentes escrevem em dois quadros diferentes e são **mutuamente invisíveis**. Os subprojetos de um monorepo também permanecem independentes.

<img src="docs/img/scopes.png" alt="Dois projetos, cada um com seu próprio quadro; agentes em projetos diferentes são mutuamente invisíveis" width="840">

<p align="center"><sub><i>Dois projetos, dois quadros. Agentes em pastas diferentes não compartilham nada e nunca veem uns aos outros — sem ruído, sem alarmes falsos.</i></sub></p>

Um *escopo* é a pasta mais próxima subindo na árvore que carrega um marcador (`.git`, `package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`, …, ou um `.tessera-scope` explícito). Os agentes só se coordenam quando os caminhos que eles tocam caem no **mesmo** escopo.

---

## Como funciona (nos bastidores)

Tessera é deliberadamente pequena. Ela se apoia em uma observação: **os conflitos vêm em três tipos, e dois deles já têm ótimas ferramentas.**

| Tipo de arquivo | A ferramenta certa | A tarefa da Tessera |
|---|---|---|
| **Arquivos versionados** (no git) | isolamento com `git worktree` + `git merge` de verdade | **adotá-la** — `tessera up --isolated` dá a cada agente seu próprio worktree + branch |
| **Consciência** (quem está aqui, no que tocam) | *nada leve existia* | **construí-la** — o quadro compartilhado (o modo padrão) |
| **Arquivos compartilhados que o git não consegue mesclar** (env no gitignore, singletons gerados) | um `flock` + escrita atômica | **planejado** (modo flock opt-in), não nesta versão |

Então a Tessera constrói apenas a fina peça que faltava — *consciência* — e reutiliza `git`, `flock`, `inotify` (via o `fs.watch` do Node), `tmux` e NDJSON para o resto. Não há **relógios vetoriais** (em uma única máquina, um único arquivo append-only já é uma ordem total), **nenhum daemon** e **nenhum custo em ociosidade**.

<img src="docs/img/flow.png" alt="Ciclo de vida: um agente se anuncia ao iniciar, verifica o quadro antes de editar, depois se coordena" width="840">

<p align="center"><sub><i>O ciclo inteiro é automático: anunciar ao iniciar, verificar o quadro antes de editar, coordenar em um conflito — tudo movido por hooks, invisível ao agente.</i></sub></p>

Alguns detalhes para os curiosos:

- **O quadro é a fonte da verdade.** NDJSON append-only; um write rasgado se autocorrige (cada registro é emoldurado com uma quebra de linha inicial), e o leitor é deduplicado e seguro contra prototype-pollution. O `fs.watch` é apenas uma *campainha* — os agentes sempre reconciliam contra o log.
- **Identidade = a sessão.** Uma execução `claude` separada é um agente; seus próprios sub-agentes são essa única unidade de trabalho (o Claude já separa os arquivos deles). A vivacidade é um heartbeat mais, quando conhecido, `/proc`.
- **O portão é um hook.** `PreToolUse` pode avisar — ou bloquear de forma rígida sob `TESSERA_GUARD=1` — *antes* que um write se concretize, inteiramente em userspace (sem privilégios, sem `fanotify`).

📖 **Aprofundando:** todo o raciocínio por trás de cada escolha — o que tentamos e rejeitamos, e por que ela permanece rápida e leve — está em **[docs/RATIONALE.md](docs/RATIONALE.md)**.

---

## Instalação

```bash
git clone <repo-url> tessera && cd tessera
node bin/tessera.mjs install --global      # add the hooks to ~/.claude/settings.json (auto-backed-up); fires everywhere
# dormant (~ms shell pre-filter) in every project until one opts in:
node bin/tessera.mjs install --scope .      # opt THIS project in (creates .tessera/, gitignores it)
node bin/tessera.mjs install --uninstall    # remove the hooks (the skill dir and per-scope .tessera/ are left in place)
```

**Requisitos:** Linux, **node ≥18**, a CLI do [Claude Code](https://docs.claude.com/en/docs/claude-code) e `git`; `tmux` é opcional (o launcher recorre a um spawn desacoplado sem ele). Para usar `tessera` diretamente, execute `npm link` (ou `npm install -g .`) no repositório, ou crie um symlink de `bin/tessera.mjs` no seu `PATH`. Não há **nenhuma dependência npm** a instalar.

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

## O que você ganha automaticamente

Uma vez instalado, cada agente — seja como for que ele seja lançado — participa sem nenhum esforço extra:

- **Ao iniciar** → ele se anuncia e é informado *"N outros agentes estão ativos aqui, tocando em X, Y."*
- **Antes de cada edição** (`Edit` / `Write` / `NotebookEdit`) → ele registra no que está tocando; se um colega ativo estiver no **mesmo arquivo**, ele recebe um aviso de coordenação (ou um bloqueio rígido sob `TESSERA_GUARD=1`).
- **Ao parar / encerrar** → heartbeat e liberação.

## Garantias e limites

Um único host Linux, um único usuário, sistema de arquivos local (locks consultivos e inotify não são confiáveis em NFS). Tessera defende a **integridade dos dados** e a **mira correta no teardown**; ela **não** defende contra um processo malicioso do mesmo usuário, nem protege *valores* secretos — dito de forma clara, sem fingimento. Coordenar agentes entre *máquinas diferentes* é uma camada opcional planejada (um transporte de rede sobre uma VPN em malha); hoje o quadro local é a história toda, deliberadamente. Veja [`docs/ROADMAP.md`](docs/ROADMAP.md) e [`docs/DESIGN.md`](docs/DESIGN.md).

## Trabalhos relacionados

Executores que priorizam o isolamento — **uzi**, **claude-squad**, **vibe-kanban**, **Conductor** — dão a cada agente seu próprio worktree/workspace e adiam os conflitos para o `git merge`; **claude-flow** coordena os sub-agentes que *ele próprio* orquestra através de um pesado quadro-negro SQLite compartilhado. Tessera é a fina camada de consciência entre pares, com zero dependências, para um *checkout compartilhado* — e como todas essas ferramentas rodam o Claude Code de verdade, os hooks da Tessera disparam dentro delas também, de modo que ela **compõe** com elas em vez de competir.

## Licença

MIT. Contribuições são bem-vindas.
