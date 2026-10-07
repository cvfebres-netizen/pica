# Sistema de Picagem de Ponto — Centro Veterinario de Febres

> Documento de entrega. Gerado a partir do codigo: os numeros aqui
> presentes sao os que estao no codigo. Nao editar numeros a mao.

Versao em producao: **1.2.0** (`APP.VERSAO` em `Config.gs`).

---

## 1. O que e

Aplicacao web para registo e controlo das picagens de ponto do pessoal do
Centro Veterinario de Febres. Corre como Web App do Google Apps Script,
com os dados numa Google Sheet.

**Funcoes principais**

- Picagem de entrada/saida (manual e por dispositivo)
- Calculo automatico de horas normais, horas extra e horas extra aprovadas
- Rotacao de sabados por equipa, com dia normal completo
- Justificacoes, correccoes de picagem e horas extra com aprovacao
- **Pedido de correccao pelo utilizador, a partir dos relatorios** (ver 3.1)
- Painel administrativo com o estado de todas as pessoas no dia
- Exportacao CSV e PDF
- Auditoria de todas as accoes sensiveis
- Sessoes com validade e politica de bloqueio progressivo

---

## 2. Ficheiros do projecto

Ficheiros que vao para o Google Apps Script:

| Ficheiro | Funcao |
|---|---|
| `Config.gs` | Constantes, versao, credenciais iniciais, politica de seguranca |
| `Setup.gs` | Instalador: cria e popula as folhas |
| `WebApp.gs` | Ponto de entrada HTTP (`doGet`) e painel administrativo |
| `Seguranca.gs` | Login, sessoes, tokens, bloqueio de tentativas |
| `Gestao.gs` | Utilizadores, picagens, aprovacoes, sabados |
| `Motor.gs` | Calculo do dia (normais, extras, estado operacional) |
| `Calendario.gs` | Feriados, rotacao de sabados (calculo e escrita) |
| `RotacaoLeitura.gs` | Leitura dos grupos de sabado e dos 4 proximos sabados |
| `Consultas.gs` | Consultas de leitura (picagens, auditoria) |
| `Relatorios.gs` | Exportacao CSV e PDF |
| `ResumosBackups.gs` | Backups e resumo |
| `Persistencia.gs` | Leitura/escrita de dados em cache |
| `Utilitarios.gs` | Funcoes utilitarias (cache, datas, colunas) |
| `index.html` | Interface completa (HTML/CSS/JS num ficheiro so) |
| `appsscript.json` | Manifesto do Apps Script |

Ficheiros de teste (nao vao para o Apps Script):

| Ficheiro | O que verifica |
|---|---|
| `_check_sintaxe.js` | Todos os `.gs` carregam sem erro de sintaxe |
| `_check_duplicados.js` | Nao ha IDs nem funcoes duplicados |
| `_check_frontend.js` | Estrutura do `index.html` |
| `_check_frontend_responsivo.js` | Alvos de toque, campos e texto em varios ecras |
| `_check_interface.js` | Todo o botao visivel tem handler |
| `_check_geral.js` | Regras transversais (datas, colunas, cache) |
| `_check_documentacao.js` | A documentacao diz o mesmo que o codigo |
| `_check_referencias.js` | Nao ha chamadas a funcoes que nao existem |
| `_check_hardening.js` | Campanha de 6 escaloes: invariantes, superficie exposta, entradas hostis, terminacao de lacos, limites do Google, disciplina de lock |
| `_check_horas.js` | A regra da contagem de horas: so os pares entrada/saida contam, a pausa nao conta, separacao por dia e por semana, sabado de escala (10-13 + 14:30-19, depois extra) e sabado fora de escala |
| `_simular.js` | 20 cenarios ponta a ponta sobre um simulador de Sheets |
| `_harness.js` | Mocks de Sheets/Apps Script com os limites REAIS (10 000 000 x 18 278 celulas); usado pelo `_check_hardening.js` |

Ferramentas de sincronizacao e verificacao (tambem nao vao para o Apps Script):

| Ficheiro | O que faz |
|---|---|
| `_sincronizar.js` | Espelha os ficheiros de producao desta pasta em `picadeploy`, que e a pasta de upload |
| `_comparar_pasta.js` | Compara byte a byte `pica` = `picadeploy`; sai com codigo 1 se divergirem |
| `_verificacao_final.js` | Corre as 11 suites e as 2 auditorias de interligacao, repete a simulacao e confirma que a pasta de upload esta a par do codigo |
| `_layout_probe.js` | Mede o layout real do `index.html` em varios ecras |
| `_auditoria_interligacoes.js` | Inventaria as funcoes publicas e as guardas de autorizacao de cada uma |
| `_auditoria_prova_execucao.js` | PROVA por execucao que `calcularDia_` e' interno: chama-o sem sessao e confirma que ja nao devolve o dia de um `userId` arbitrario sem tocar numa guarda |
| `_auditoria_lixo.js` | Inspeccao: funcoes que ninguem chama, variaveis por usar, marcadores de trabalho, `console.log` em producao e blocos de codigo comentado. Imprime, nao falha — cada achado e' julgado antes de mexer |
| `_auditoria_lacos.js` | Inspeccao de lacos e recursao: inventaria os 36 lacos e monta o grafo de chamadas para achar recursao directa e indirecta. Nao e' uma contagem de `while` — uma funcao que chama a si propria nao e' um laco e nao aparece em contagem nenhuma |

**So se corrige uma vez.** Ha duas copias do mesmo codigo (esta pasta, a de
trabalho, e `picadeploy`, a que se carrega) e ja divergiram: o `picadeploy`
ficou com a versao antiga, com defeitos de cache e de bloqueio, e nenhuma
verificacao apanhou. Por isso esta pasta e a **fonte** e o `picadeploy` e
gerado. Depois de mexer em qualquer `.gs` ou no `index.html`:

```
node _sincronizar.js        # copia os 15 ficheiros para picadeploy
node _verificacao_final.js  # suites + simulacao + coerencia da pasta
```

`node _verificacao_final.js` sai com codigo 1 se algo estiver fora de sincronia.
Por omissao repete a simulacao 3 vezes para detetar nao-determinismo; com
`REPETICOES=20 node _verificacao_final.js` faz mais.

### Limites do Apps Script (auditoria de 24/09/2026)

A aplicacao foi auditada contra os limites de execucao e quota do Apps
Script. Resumo: **pronta a publicar dentro dos limites, com um unico ponto
de crescimento a vigiar.**

**6 minutos por execucao — CONFORME.** Nenhuma funcao faz trabalho nao
proporcional ao pedido. O caminho mais pesado, `obterDashboardAdministrativo`,
foi medido no CENARIO 20 do simulador encolhendo a folha PICAGENS:

| Historico PICAGENS | Celulas lidas por painel | Resposta |
|---|---|---|
| 1 ano (5 841 linhas) | ~129 000 | ~3 KB |
| 2 anos (11 681 linhas) | ~258 000 | ~3 KB |
| 5 anos (estimado) | ~644 000 | ~3 KB |

O custo cresce em linha recta com o historico (~1,99x para o dobro), nao
com o numero de pessoas. Mesmo a 5 anos sao ~644 000 celulas lidas — muito
abaixo do limite pratico. Em `_simular.js` o teste mede isto em vez de
assumir: se a razao deixar de ser ~2, o teste falha.

**Por que e tao barato:** o painel pede **um dia**, e a folha e lida por
intervalo de datas (`dadosFolhaIntervalo_`). Uma escrita no meio invalida a
cache de folhas, mas o indice de datas sobrevive a escritas noutras folhas,
por isso o dia pedido e relido pequeno, nao a folha toda.

**Cache e memoria — CONFORME.** `CACHE_FOLHAS_` e `CACHE_INDICE_DATAS_` sao
limpas a cada escrita nas folhas que mudam. A memoria local nunca guarda mais
que o intervalo pedido. Nao ha `while (true)`, nao ha leitura celula-a-celula
(`getValue()` em laco — 0 ocorrencias no codigo). Todas as leituras sao
`getValues()` sobre intervalos ja calculados.

**Propriedades do script — CONFORME.** So se guarda o ID da Spreadsheet
(`SPREADSHEET_ID`), ~45 bytes. Nada de progresso de execucao em Properties,
porque nao ha trigger chaining: o trigger diario e uma limpeza de sessoes.

**Triggers — CONFORME.** **Um** trigger, `manutencaoDiaria`, uma vez por
dia as 3h, e `garantirTriggerManutencao_()` e' idempotente (verifica
`getProjectTriggers` antes de criar). E' a propria **instalacao** que o
cria, no unico ponto por onde passam os dois caminhos de instalacao
(`setupSistema`, que `instalarSistemaComCredenciais` chama) — por isso nao
ha forma de instalar o sistema sem ele.

> **Isto foi corrigido.** O `instalarTriggers()` nao era chamado por lado
> nenhum do codigo de producao: o trigger das 3h nunca chegava a ser
> criado numa instalacao normal e, com ele, caia tudo o que esta seccao
> promete — as sessoes expiradas nunca eram marcadas em lote e a folha
> SESSOES continuava a crescer sem tecto. A suite `_simular.js` passava
> porque chamava o `instalarTriggers()` a mao; o que nao se via era que
> ninguem o fazia. Ha agora um teste que falha se a instalacao nao deixar
> o trigger criado, e a idempotencia tambem e' verificada.

O handler `manutencaoDiaria` faz duas coisas na folha
SESSOES, e as duas sao medidas:

1. **Marca as expiradas** — reescreve a coluna `Estado` de uma so vez com
   `setValues`, em vez de um `setValue` por linha. Antes eram N chamadas ao
   servidor; a folha SESSOES cresce sem limite, e aos 20 000 registos isso
   dava para varios minutos, acima do limite de 6 min por execucao.
2. **Poda as antigas** — apaga as sessoes `TERMINADA`/`EXPIRADA` com mais de
   `APP.SEGURANCA.SESSOES_RETENCAO_DIAS` (90 por omissao; `0` desliga).
   Sem isto a folha nao tinha tecto: cada login acrescentava uma linha e
   `obterSessaoPorToken_()` le a folha INTEIRA em cada pedido autenticado
   (aos 20 000 registos, ~140 000 celulas por "picar").

A poda **nunca apaga uma sessao ATIVA**, mesmo que antiga, e nunca toca em
PICAGENS, JUSTIFICACOES, CORRECOES, DIAS_TRABALHO ou AUDITORIA — a AUDITORIA
e' a prova do que aconteceu e nao tem prazo de validade. Apaga em blocos
contiguos (um `deleteRows` por bloco) para nao deslocar indices a cada linha.
O comportamento e' provado por EXECUCAO na suite de hardening (escalao 1.6),
com uma folha semeada de casos: 3 sessoes ativas (nova, de 400 dias e de 13
anos) sobrevivem todas, e saem exactamente as 3 fora da janela.

**UrlFetch / email / documentos — NAO USADOS.** Zero ocorrencias de
`UrlFetchApp`, `MailApp`, `sendEmail`, `GmailApp`, `DriveApp`. Nao ha
cota de 20 000/dia, nem 100 000/dia, nem 1 500 destinatarios. Nao ha
limite de 50 MB a respeitar porque nao ha fetching externo.

**Criacao de documentos — CONFORME.** `SpreadsheetApp.create` aparece so
em `exportarTabelaParaSheets` (exportacao manual, ~1 por semana) e em
`resolverSpreadsheet_` (uma vez na instalacao). 250/dia ou 1 500/dia nao sao
um risco para uma app com 4 utilizadores.

**30 execucoes simultaneas — CONFORME.** 4 utilizadores * 1 accao = 4. O
`LockService.getScriptLock()` serializa `setupSistema` e o bootstrap.

**Funcao custom 30 s — NAO APLICAVEL.** Nenhuma formula `=GOOGLE(...)` ou
`=PICA(...)` no sistema. A logica vive em `.gs`, nao em celulas.

**Sem acesso directo a base de dados, sem integracao local, sem Git — por
desenho.** Nao ha base de dados corporate nem ficheiros locais: tudo e
Sheets. O Git e externo (o `clasp` e `pica` sao locais, nao publicados).
Nada disto viola um limite; sao opcoes de arquitectura.

**Veredicto: PRONTO A PUBLICAR.** O unico numero a reavaliar com o tempo e
a projecao de 5 anos (~644 000 celulas). O CENARIO 20 mede-o sempre; se
algum dia a razao deixar de ser ~2, o teste avisa antes de a producao
sofrer.



---

## 3. Separadores da aplicacao

24 separadores. Os 17 primeiros so para ADMIN; os 7 seguintes para qualquer
colaborador.

**ADMIN:** Hoje, Extras, Justificacoes, Correcoes, Excecoes, Ausencias,
Feriados, Sabados, Utilizadores, Sessoes, Relatorios, Auditoria, Erros,
Configuracao, Backups, Testes, Resumos.

**Colaborador:** A minha semana, O meu mes, O meu relatorio, As minhas extras,
As minhas ausencias, Nova justificacao, Alterar password.

### 3.1 Pedir correccao a partir do relatorio

No separador **O meu relatorio**, cada dia tem um botao **Pedir correccao**.
O colaborador escreve o que esta errado (a hora certa, o que aconteceu) e o
pedido fica `PEDIDO`, a espera de resposta do gestor.

O que o pedido **nao** faz: nao altera hora nenhuma. E' uma mencao, nao uma
correccao — quem muda o registo continua a ser o gestor, em **Correcoes**.
Sem esta separacao, um pedido passava a ser uma alteracao feita pelo proprio
interessado, que e' exactamente o que um registo de horas nao deve permitir.

Regras:
- so sobre o **proprio** dia — o `userId` vem sempre da sessao, nunca do pedido;
- **um** pedido em aberto por dia (o botao desaparece ate haver resposta);
- o motivo e' obrigatorio (5 a 300 caracteres);
- quando ha pedidos por decidir, o relatorio mostra o numero no topo e o
  motivo na linha do dia, com o estado (`PEDIDO`, `APROVADA`, `REJEITADA`).

### 3.2 Quando o dia e' gravado, e o que isso decide

Cada vez que o dia muda de factos — uma picagem, uma correcao aprovada, uma
justificacao aprovada — o dia e' recalculado e gravado em tres folhas ao
mesmo tempo: `DIAS_TRABALHO` (o retrato do dia), `HORAS_EXTRA` (os segmentos
a aprovar) e `EXCECOES` (o que o gestor tem de ver).

E' por aqui que nascem as horas extra a aprovar: quando o calculo produz um
segmento de horas extra, sai uma linha `PENDENTE` em `HORAS_EXTRA`, e e'
essa linha que **Extras > Aprovar / Rejeitar** vai buscar. Sem esta
gravacao o fluxo de aprovacao nao tinha nada para decidir.

**As excecoes fecham-se sozinhas quando deixam de valer.** Uma saida as
19:30 abre uma excecao "saida depois das 19:00". Se o gestor corrigir a
picagem para as 19:00, a condicao deixa de se aplicar e a excecao fecha
sozinha (`RESOLVIDA`, com `ResolvidoPor` = `SISTEMA`). Sem isto, o mesmo
alerta ficava pendente para sempre e o gestor via um falso positivo todos
os dias.

Duas garantias: so uma excecao **PENDENTE** e' fechada por este caminho —
uma decisao do gestor nunca e' desfeita — e so o dia que acabou de ser
recalculado e' tocado.

---

## 4. Instalacao e publicacao

### Que ficheiros carregar

A pasta **`picadeploy`** contem **exactamente os 15 ficheiros** que vao para
o Apps Script: 13 `.gs`, `index.html` e `appsscript.json`. E a unica pasta a
carregar. Os ficheiros de teste (`_check_*.js`, `_simular.js`) e esta
documentacao vivem em `pica` e **nao** sao para carregar.

Ja foi publicado por esta via: `clasp push` a partir de `picadeploy` e depois
`clasp deploy`. O `.clasp.json` dessa pasta guarda o `scriptId`, por isso a
pasta tem de ser conservada para futuros deploys.

O `index.html` tem de entrar com o nome em minusculas. O Apps Script so
reconhece `index.html` (minusculas) como ficheiro de interface; `Index.html`
ou `INDEX.HTML` resulta numa pagina vazia.

### Passos

Ha dois caminhos. O **A (`clasp`)** envia a pasta tal e qual; o **B** e para
quando nao houver `clasp` na maquina.

> **O editor do Apps Script nao aceita uma pasta.** Em *Arquivo > Importar /
> fazer upload* a caixa de ficheiros so aceita `.zip`. Por isso a pasta
> `picadeploy` nao se arrasta para o editor: usa-se o `clasp` (caminho A) ou
> colam-se os ficheiros a mao (caminho B).

#### A. Com o `clasp` (recomendado)

A pasta `picadeploy` esta pronta: contem os 15 ficheiros de producao
**na raiz**, sem subpastas, sem testes e sem ferramentas, que e o que o
`clasp` envia. O `.clasp.json` que la esta guarda o `scriptId` do projecto —
e a ligacao entre esta pasta e o projecto no Google.

1. Abrir um terminal **dentro de `picadeploy`**.
2. `clasp login` (uma vez) e a seguir `clasp push`. O `push` envia os 15
   ficheiros para o projecto do `scriptId`; nao ha nada para escolher.
3. Abrir <https://script.google.com> e entrar no projecto. No editor,
   escolher a conta Google do gestor e correr, uma vez:
   - `instalarSistemaComCredenciais()` (recomendado: cria a Spreadsheet,
     as folhas e aplica os logins da empresa), ou
   - `setupSistema()` se ainda quiser os utilizadores de exemplo.
4. **Deploy > New deployment > Web app**:
   - Execute as: **Me**
   - Who has access: **Qualquer pessoa com conta Google** (ou so o dominio)
5. Guardar o URL `/exec`. E o link para distribuir.

**Onde ficam os dados.** A Sheet criada pelo passo 3 chama-se
`PICA — Centro Veterinario de Febres` e fica na conta que fez a instalacao.
O editor devolve o link no fim de `instalarSistemaComCredenciais()`.

Para usar uma Sheet que ja exista (migrar dados antigos), preencher
`SPREADSHEET_ID` em `Config.gs` com o ID — a parte da URL entre `/d/` e
`/edit` — **antes** do passo 3. A constante vem vazia de origem.

**O `clasp push` nao publica nada.** So envia o codigo. O passo 4 e
obrigatorio e manual: o bloco `webapp` do manifesto e uma Definicao inicial,
mas o deployment so existe depois de o fazeres no editor. O editor pode
ainda ignorar `executeAs`/`access` do manifesto — confirmar sempre no ecra do
passo 4.

#### B. Colar ficheiro a ficheiro (alternativa)

1. Abrir <https://script.google.com> e criar um projeto novo.
2. Criar um script, colar cada `.gs` no ficheiro com o mesmo nome e criar
   `index.html` como ficheiro HTML.
3. Em **Project Settings**, mostrar o manifesto e substituir por
   `appsscript.json` (ja tem `oauthScopes` e `timeZone: Europe/Lisbon`).
4. No editor, escolher a conta Google do gestor e correr, uma vez:
   - `instalarSistemaComCredenciais()` (cria a Spreadsheet, as folhas e
     aplica os logins da empresa), ou
   - `setupSistema()` se ainda quiser os utilizadores de exemplo.
5. **Deploy > New deployment > Web app**:
   - Execute as: **Me**
   - Who has access: **Qualquer pessoa com conta Google** (ou so o dominio)
6. Guardar o URL `/exec`. E o link para distribuir.

Tal como no caminho A, **nao e preciso criar uma Google Sheet** — o passo 4
cria-a.

So se carrega **um** ficheiro de cada vez, com o mesmo nome. Se aparecer
`Identifier 'APP' has already been declared`, ha duas copias do codigo no
projeto: apagar a que nao pertenca. `diagnosticoCompleto()` confirma que
ficou bem.

> `testeCredenciaisSimples()` foi aqui indicado em versoes anteriores e
> ja nao existe: foi removido por ser codigo morto. O que o substitui e'
> entrar pela aplicacao com uma das quatro contas da seccao 5.

O `timeZone` do projeto tem de ser `Europe/Lisbon`. Sem isso as datas de
feriados e de rotacao de sabados podem deslocar-se um dia.

### Rever depois de instalar

1. Entrar com `pedromds84@gmail.com` / `pedromds84`.
2. Abrir **Testes** e correr a suite de cobertura.
3. Abrir **Sabados** e confirmar que os dois grupos tem data de inicio (um
   sabado). Sem data de inicio a rotacao fica inativa e as horas de sabado
   contam todas como extra.
4. Fazer uma picagem de teste e confirmar que aparece em **Hoje**.

---

## 5. Credenciais

Estao em `Config.gs`, na constante `CREDENCIAIS_INICIAIS`. Sao as definitivas
da empresa e nao devem ser mudadas.

| Pessoa | Email | Password | Perfil |
|---|---|---|---|
| Pedro Silva | `pedromds84@gmail.com` | `pedromds84` | ADMIN |
| Hugo Silva | `hugofds@outlook.com` | `6y6na6cu` | ADMIN |
| Celina Relva | `celinarelva@gmail.com` | `celinarelva` | COLABORADOR |
| Rita Reis | `aror.arita8@hotmail.com` | `ritareis` | COLABORADOR |

> **Decisao do cliente:** passwords simples, em texto simples, sem hash e sem
> salt. Nao introduzir hash: isso quebraria a tolerancia a Caps Lock e aos
> espacos colados, que e justamente o que evita bloqueios por engano.
> A protecao real sao as sessoes, a auditoria e o botao de desbloquear.

Se alguem esquecer a password: **Utilizadores > Repor password** (ou
`definirPasswordUtilizador` no editor). Isso limpa tambem o bloqueio.

---

## 6. Horas: dia normal e sabado

Horario normal (`APP.HORARIO`):

| Dia | Turnos | Total |
|---|---|---|
| Segunda a sexta | 10:00–13:00 e 14:30–19:00 | 7h30 |
| **Sabado de escala** | 10:00–13:00 e 14:30–19:00 | **7h30** |
| Domingo | — | 0 |

**O sabado de escala e um dia normal completo.** Quem esta de rotacao faz o
mesmo turno de um dia util e essas horas contam como **normais**. So o que
ultrapassar as 19:00 conta como hora extra. Antes o sabado so tinha a manha
definida, e o turno da tarde aparecia como 4h30 de horas extra indevidamente.

### Excedente: total, dias e horas extraordinarias

O relatorio semanal mostra, por colaborador: o **total trabalhado**, o
**contrato** (40 h, de `APP.HORAS_CONTRATO_SEMANA`) e o **excedente**, mais
**em que dias** esse excedente foi feito.

Sao **duas coisas diferentes**, e nao se podem baralhar:

| Conceito | O que e' | Para que serve |
|---|---|---|
| **Excedente diario** | Passou-se do horario **do dia** (7h30 num dia util) | Saber que houve pressa nesse dia |
| **Excedente semanal** | A semana passou das **40 h** de contrato | Sao as **HORAS EXTRAORDINARIAS**, para o **banco de horas** |

O excedente semanal **nao** se mede contra `minutosPlaneados`: esse da
7h30 x 5 = **37h30**, e uma semana normal daria sempre 37h30 de "excedente".
Mede-se contra as 40h do contrato. Por isso 5 dias de 7h30 dão
**excedente 0**, e 5 dias de 8h30 (42h30) dão **2h30 de horas
extraordinarias**, distribuidas pelos 5 dias.

Quem trabalha **menos** que o contrato nao fica a dever nada: o excedente e
sempre zero, nunca negativo.

**Atencao a uma diferenca de 2h30.** O horario de `Config.gs` da 7h30 por
dia = 37h30 em 5 dias uteis, mas o contrato sao 40 h. As 40 h sao o que se
paga; o horario e' a janela de picagem. Quem estender o horario para 8h/dia
passa imediatamente as 40h. Se o contrato real for 37h30, mude
`HORAS_CONTRATO_SEMANA` em `Config.gs` — e o unico sitio do sistema que diz
quantas horas uma semana vale.

---

## 7. Seguranca

Constantes em `APP.SEGURANCA` (`Config.gs`):

| Parametro | Valor | Motivo |
|---|---|---|
| Validade da sessao | 480 min (8 h) | Um turno de clinicia |
| Tentativas antes de bloquear | 8 | Teclado partilhado: quase sempre e um dedo, nao um ataque |
| Primeiro bloqueio | 15 min | Curto: com a password certa passa e o contador zera |
| Reincidencia | 60 min | So a partir do 2.º bloqueio — e o que trava um ataque a serio |
| Esquecer reincidencia | 24 h | Castiga o padrao, nao guarda rancor |
| Retencao de sessoes | 90 dias | So apaga sessoes TERMINADAS/EXPIRADAS mais velhas que isto; sessoes ATIVAS nunca |

**Primeiro dia da semana.** `APP.PRIMEIRO_DIA_SEMANA` (`Config.gs`) diz em que
dia a semana comeca — `0` domingo, `1` segunda (valor actual), ... `6` sabado.
Le-se em `inicioDaSemana_()`, que e' o que define as semanas de "A minha
semana", dos resumos e dos relatorios. O valor e' tambem entregue no login,
para a interface calcular o mesmo intervalo que o backend — as duas pontas
nao podem discordar sobre o que e' uma semana.

Este valor vivia em `Config.gs` mas **nao era lido por ninguem**: a
segunda-feira estava escrita a mao no codigo, e mudar a constante nao fazia
nada nem dava erro. Um valor fora de `0..6`, vazio ou nulo volta a
segunda-feira.

O numero de bloqueios e um contador persistente (`Bloqueios` /
`UltimoBloqueioEm`) que sobrevive a desbloqueios, a mudancas de password e a
expiracao. Sem ele, a regra de 60 min nunca chegava a disparar.

**Nunca ha beco sem saida:** em **Utilizadores** ve-se o estado de bloqueio e
ha um botao **Desbloquear**.

### Sheets criadas (19)

`CONFIG`, `UTILIZADORES`, `SESSOES`, `PICAGENS`, `DIAS_TRABALHO`,
`CONFIG_SABADOS`, `FERIADOS`, `AUSENCIAS`, `JUSTIFICACOES`, `HORAS_EXTRA`,
`CORRECOES`, `AUDITORIA`, `EXCECOES`, `RESUMO_DIARIO`, `RESUMO_SEMANAL`,
`RESUMO_MENSAL`, `BACKUPS`, `TESTES`, `LOG_ERROS`.

---

## 8. Runbook do gestor

| Tarefa | Onde |
|---|---|
| Ver quem trabalha hoje | **Hoje** |
| Aprovar horas extra | **Extras** |
| Aprovar justificacoes e correcoes de picagem | **Justificacoes**, **Correcoes** |
| Desbloquear uma pessoa | **Utilizadores** > Desbloquear |
| Ver quem esta de sabado | **Sabados** |
| Marcar feriado | **Feriados** |
| Consultar acessos e alteracoes | **Auditoria** |
| Exportar CSV / PDF | **Relatorios** |
| Copiar os dados | **Backups** > Criar backup |

Funcoes uteis no editor, sem passar pela interface:

```
instalarSistemaComCredenciais()    instalar / reinstalar
definirPasswordUtilizador(id, nova) resetar password (limpa bloqueio)
criarBackup()                      copia de seguranca
gerarResumos(token)                recalcula os resumos
instalarTriggers()                 agenda as execucoes automaticas
```

---

## 9. Correcoes relevantes desta entrega

- **Sabado = dia normal completo.** Era a diferenca de fundo em relacao ao
  pedido original: o sabado de escala passou a contar 7h30 normais, nao turno
  de manha mais 4h30 de extra.
- **Rotacao de sabados com ancora de sabado e calculo O(1).** Antes, um
  `dataInicio` que nao fosse sabado saltava o primeiro sabado — ninguem ficava
  de escala, mas aparecia como previsto. Os testes fixam exatamente esse caso.
- **Contador de bloqueios persistente.** A regra de reincidencia de 60 min
  estava no codigo mas nunca podia disparar, porque todos os caminhos de
  recuperacao zeravam o contador de que ela dependia.
- **Migracao de colunas segura.** As colunas novas (`Bloqueios`,
  `UltimoBloqueioEm`) ja nao podem ser escritas por cima de dados existentes.
- **Um dia corrompido nao derruba o painel.** O dia fica `ERRO_CALCULO` com o
  motivo e o resto do painel continua a aparecer.
- **Cache de folhas invalidado automaticamente** em cada escrita, por proxy no
  objeto da sheet — nao ha forma de esquecer de invalidar.
- **Interface responsiva:** tabelas em lista no telemóvel, separadores com
  scroll, zonas seguras do notch, zoom nao bloqueado.
- **`consultarAuditoria` filtra sobre a linha crua** e so converte os registos
  que devolve, em vez de converter a auditoria inteira.

---

## 10. Correr os testes

Na pasta `pica`:

```
node _check_sintaxe.js
node _check_duplicados.js
node _check_frontend.js
node _check_frontend_responsivo.js
node _check_interface.js
node _check_geral.js
node _check_documentacao.js
node _check_referencias.js
node _check_hardening.js
node _simular.js
```

Todos devem terminar com codigo de saida **0**. O `_simular.js` corre 20
cenarios sobre um simulador de Google Sheets — nao precisa de conta, de Sheet
nem de internet. Para correr tudo de uma vez, incluindo a comparacao do
pacote de upload:

```
node _verificacao_final.js
```

---

## 11. Limitacoes conhecidas

- Nao ha envio de email. Um bloqueio tem de ser visto no painel.
- Nao ha exportacao para um sistema externo de folhas de ponto.
- O relatorio mensal em PDF pronto a entregar ainda nao foi feito.
- As passwords estao em texto simples na Sheet e no codigo. E uma decisao
  consciente do cliente, nao um esquecimento — ver seccao 5.

