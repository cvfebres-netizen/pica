# Simulacao da base de dados vetmanag (backup 2026-10-14)

Pasta local de exploracao do dump MySQL que veio no ZIP
`wetransfer_backup-febres_2026-10-14_1651.zip`, pasta `base-de-dados`.

## Conteudo

| Ficheiro | O que e |
|---|---|
| `base-de-dados/vetmanag_...sql.zst` | Dump original comprimido (5 MB, do ZIP) |
| `base-de-dados/vetmanag_...sql.zst.sha256` | Hash de integridade (do ZIP) |
| `base-de-dados/vetmanag_...sql` | Dump descomprimido (68 MB, gerado) |
| `base-de-dados/README.txt` | Instrucoes de restauro (do ZIP) |
| `_sim_bd_parse.js` | Parser streaming do SQL (tuplos com `\'`, `''`, virgulas) |
| `_sim_bd_load.js` | Carrega o dump em memoria (tabelas -> linhas) |
| `_simular_bd.js` | 8 cenarios sobre os dados reais |

## Correr

```
cd simulacao-bd-febres
node _simular_bd.js
```

Sem MySQL, sem internet. O `.sql` descomprimido e gerado com o zstd
nativo do Node (`zlib.zstdDecompressSync`).

## Resultado (2026-10-14)

- 119 tabelas, 376 255 linhas
- Clinica: CV Febres (1 subclinica)
- Tutores: 2 559 | Animais: 3 126 (100% com tutor valido)
- Visitas: 23 462 | Consultas: 12 287
- Equipa: 3 utilizadores

## Servidor local (novo)

```
cd simulacao-bd-febres
node _servidor.js 4100
```

Abre **http://127.0.0.1:4100/** — página com pesquisa de tutores,
animais, ficha de animal e consulta de tabelas.

API (JSON): `/api/estado` · `/api/tabelas` ·
`/api/tabela/NOME?limite=20&inicio=0` ·
`/api/pesquisar?tipo=tutor&q=silva` ·
`/api/pesquisar?tipo=animal&q=puppy` · `/api/animal/1`

## Busca inteligente (novo)

Uma caixa na pagina para qualquer pista: `GET /api/busca?q=...`

- Nome ou partes por qualquer ordem: `silva`, `silva costa`
- Telefone/telemovel/NIF: `932290927`
- Microchip: `620098100757015`
- N. exato de tutor/animal/visita/consulta/fatura: `545`
- Data: `2024-05`
- Sem acentos nem maiusculas a condizer: `rececao` encontra `Receção`

Devolve grupos (tutor, animal, equipa, visita, consulta, fatura,
venda) com total + top resultados; o tutor mostra os animais,
o animal mostra o tutor, visitas/consultas mostram o animal.

## Historico geral (novo)

- `GET /api/historico?limite=50&antes=2026-10-14 16:38&grupo=todos`
  (98 135 registos com data, do mais recente para o mais antigo;
  `grupo`: todos, tutores, animais, visitas, consultas, faturas,
  vendas; pagina com `antes`)
- `GET /api/historico/resumo?meses=12` (contagens por mes e grupo)

Na pagina: botao "Ver historico geral" mostra tabela mensal +
tabela de registos com botao "Ver mais antigos".

## Explorador completo (novo)

Recarrega **http://127.0.0.1:4100/** (servidor reiniciado):

- **Busca global** cobre tutores, animais, equipa, visitas,
  consultas, **exames** (animal + bioquimica + hemograma +
  complementares + fisicos), receitas, contactos CRM, faturas,
  vendas, produtos e **todas as outras tabelas com texto**
  (grupo `registo`). Ex: `vacina` encontra consultas, vendas,
  produtos e registos.
- **Fichas navegaveis**: `/api/ficha/tutor/545`,
  `/api/ficha/animal/3`, `/api/ficha/visita/1`,
  `/api/ficha/consulta/N` — cada bloco tem linhas clicaveis:
  tutor→animais→visitas→consultas→exames/produtos/receitas→faturas.
- **Qualquer registo**: `/api/registo?tab=animal_exams&id=1`
  mostra todos os campos com as FKs reais do DDL como links
  (ex: exame → animal → tutor) e caminho de volta (migas).
- **Historico** com grupos novos: exames (112 485!) e contactos,
  alem de tutores, animais, visitas, consultas, faturas, vendas.

Sem MySQL, sem npm: só Node. A BD carrega em ~10 s para memória.

## Regra do repo

Esta pasta e independente: **nao** e tocada por `pica/_sincronizar.js`,
`pica/_comparar_pasta.js` nem `pica/_verificacao_final.js` (so olham
para `pica/` <-> `picadeploy/`).
