# Tessera

[English](README.md) · [Italiano](README.it.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · **Português** · [简体中文](README.zh-Hans.md) · [日本語](README.ja.md)

**Coordenação de baixo nível e sem dependências para múltiplos agentes locais de programação com IA trabalhando nas mesmas pastas.**

Quando você executa vários agentes [Claude Code](https://docs.claude.com/en/docs/claude-code) de uma vez no mesmo repositório, dois deles podem editar o mesmo arquivo ao mesmo tempo e sobrescrever silenciosamente o trabalho um do outro. O Tessera permite que agentes criados de forma imprevisível **descubram uns aos outros em tempo real** e **parem de pisar no pé um do outro** — por pasta, sem daemon, resistente a falhas, em qualquer projeto (polyrepo, monorepo, repositório único, qualquer linguagem).

> **Por que "Tessera"?** Uma *tessera* é uma única peça de um mosaico. Em uma *tesselação*, as peças cobrem a superfície **sem lacunas e sem sobreposições** — exatamente o objetivo aqui: muitos agentes ladrilhando o trabalho, sem nunca se sobrepor. Cada agente é uma tessera; o barramento compartilhado é o mosaico.

## A ideia em uma linha

O conflito entre agentes tem três classes, e cada uma já tem a ferramenta certa — então o Tessera constrói apenas a fina camada de cola mais a única peça genuinamente ausente:

| Classe | Ferramenta certa | Tessera |
|---|---|---|
| **Arquivos rastreados** (no git) | isolamento com `git worktree` + `git merge` de verdade | **adota** isso (`up --isolated`) |
| **Percepção** — quem está aqui, no que estão mexendo, alguém acabou de surgir | um **barramento NDJSON** append-only por escopo + **hooks** do Claude + `fs.watch` | **constrói** (fino) — o padrão |
| **Arquivos genuinamente compartilhados que o git não consegue mesclar** (env no gitignore, singletons gerados) | bloqueio com `flock(2)` + escrita atômica | **planejado** (modo flock opcional — não nesta versão) |

Sem relógios vetoriais (em um único host, o **deslocamento em bytes de um único arquivo append-only já é uma ordem total**). Sem daemon. Sem custo em ocioso. Nada inventado no nível primitivo — ele compõe `git`, `flock`, `inotify` (via `fs.watch`), `tmux` e NDJSON.

## Por que o escopo por pasta é automático

O meio de coordenação (`<scope>/.tessera/`) vive *dentro* do projeto, então dois agentes compartilham um meio **apenas se** os caminhos que eles tocam resolverem no mesmo escopo. Agentes em projetos diferentes não compartilham nada e são mutuamente invisíveis — de graça. (Esta é a propriedade "leis locais, efeito global" do espaço de tuplas de Linda.) `scope` = o ancestral mais próximo que carrega um marcador (`.tessera-scope`, `.git`, `package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`, …), priorizando a distância, para que subárvores de monorepo permaneçam independentes.

## Instalação

```bash
git clone <repo-url> tessera && cd tessera
node bin/tessera.mjs install --global      # merge hooks into ~/.claude/settings.json (auto-backed-up); fires everywhere
# dormant (~ms sh pre-filter) in every project until one opts in:
node bin/tessera.mjs install --scope .      # opt THIS project in (creates .tessera/, gitignores it)
node bin/tessera.mjs install --uninstall    # remove the hooks (the skill dir and per-scope .tessera/ are left in place)
```
**Requisitos:** Linux, **node ≥18**, a CLI do [Claude Code](https://docs.claude.com/en/docs/claude-code) e `git`; o `tmux` é opcional (o lançador recorre a um spawn desacoplado sem ele). Para usar o `tessera` diretamente, execute `npm link` (ou `npm install -g .`) no repositório — o campo `bin` já está configurado — ou crie um symlink de `bin/tessera.mjs` no seu `PATH`. Não há dependências npm a instalar.

## Uso — lançar e observar muitos agentes

```bash
tessera up --task "split the API module" -n 3      # 3 agents, SHARED checkout, awareness + overlap warnings
tessera up --task "migrate to v2" -n 5 --isolated   # 5 agents, each in its own git worktree+branch
tessera up --task "..." -n 3 --dry-run              # preview predicted collisions, don't launch
tessera ps --follow                                 # real-time dashboard: who's live, what they touch, overlaps
tessera ps --all                                    # every participating scope under cwd
tessera kill wave1.2                                # safe teardown (tmux window / process group)
tessera doctor                                      # health check
```

## O que você obtém automaticamente (via hooks do Claude — sem necessidade de cooperação dos agentes)

- **SessionStart** → cada agente anuncia a si mesmo e é informado de que *"N outros agentes estão ativos aqui, mexendo em X, Y."*
- **PreToolUse(Edit/Write/NotebookEdit)** → registra o que cada agente edita; se um par ativo estiver mexendo no **mesmo arquivo**, o agente que está editando recebe um aviso de coordenação (ou um bloqueio rígido sob `TESSERA_GUARD=1`).
- **Stop / SessionEnd** → heartbeat / liberação.

A unidade de coordenação é a **sessão do agente** (uma invocação `claude` separada). O barramento é append-only, resistente a falhas (o enquadramento com `\n` à frente se autorrecupera de escritas interrompidas), seguro contra prototype-pollution e deduplicado. A identidade é a session id; a vivacidade é heartbeat + (quando conhecido) `/proc`.

## Escopo das garantias

Host Linux único, um uid, sistema de arquivos local (bloqueios advisory e inotify são não confiáveis em NFS). O Tessera defende a **integridade dos dados** e o **direcionamento correto do teardown**; ele **não** defende contra um processo malicioso de mesmo uid nem protege *valores* secretos — declarado de forma clara, sem fingimentos. Coordenar agentes entre *máquinas diferentes* é uma camada opcional planejada (um transporte de rede sobre uma VPN em malha); hoje o barramento de arquivos local é toda a história, deliberadamente.

## Estrutura

```
lib/      scope · identity · bus · proc · coord · config · args
hooks/    tessera-hook.sh (fast pre-filter) → tessera-hook.mjs (handler)
cmd/      install · up · ps · kill · doctor
bin/      tessera.mjs
test/     selftest.mjs · dummy-agent.mjs
docs/     DESIGN.md
```

## Licença

MIT. Contribuições são bem-vindas.
