# Skills instalados neste workspace

Instalados a partir de `superpowers/skills` (Superpowers v6.4.1) para o Cline.
O Cline **nao** e' um harness oficialmente suportado pelo Superpowers (a lista
oficial e' Claude Code, Codex, Cursor, Devin, Gemini, Copilot CLI, OpenCode,
Pi, Kimi, Hermes, Muse, Qwen, Droid, Grok). Nao ha instalador oficial para
aqui, por isso a instalacao e' portavel: os `SKILL.md` foram copiados para
`.clinerules/skills/`, que e' a pasta de regras que o Cline le automaticamente.

## Activas (copiadas para `.clinerules/skills/`)

| Skill | Quando usar |
|---|---|
| `verification-before-completion.md` | Antes de dizer "feito", "passa", "corrigido" |
| `systematic-debugging.md` | Quando ha bug ou resultado inesperado: causa raiz antes do arranjo |
| `test-driven-development.md` | Red-green de verdade antes de dizer que ha teste |
| `finishing-a-development-branch.md` | Na hora de fechar/entregar |

## Disponiveis mas nao copiadas

Ficam em `superpowers/skills/` e leem-se quando forem precisas:
`using-superpowers`, `brainstorming`, `writing-plans`, `executing-plans`,
`subagent-driven-development`, `dispatching-parallel-agents`,
`requesting-code-review`, `receiving-code-review`, `writing-skills`,
`using-git-worktrees`, `diagnosing-superpowers`.

## `skills/` (github.com/google/skills)

Clonado, com 155 skills. **Nenhuma serve para este projecto**: sao de Google
Cloud (GKE, BigQuery, Spanner, IAM, SecOps), Google Ads e Analytics. Nao ha
nada de Apps Script, `clasp`, Google Sheets ou web apps. Nao foram para as
regras de proposito — 155 ficheiros irrelevantes carregam-se em cada sessao e
tornam as regras que interessam invisiveis. O repo fica clonado para consulta.

## Regras que governam o trabalho no `pica`

O `pica` ja traz uma regra propria que manda acima de qualquer skill:

1. `pica` e' a **fonte**; `picadeploy` e' **gerado**. Depois de mexer em
   qualquer `.gs` ou no `index.html`:
   ```
   node _sincronizar.js
   node _verificacao_final.js
   ```
2. `_verificacao_final.js` corre 13 suites + 3 repeticoes da simulacao e
   demora ~5 minutos. Para uma passagem rapida usar `REPETICOES=1`, que
   cabe no limite de execucao do terminal.
3. Nao dizer que algo esta corrigido sem mostrar a verificacao a correr.