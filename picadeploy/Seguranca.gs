/* ============================================================
   UTILIZADORES / SEGURANÇA
   ============================================================ */

/* ============================================================
   CACHE DE EXECUÇÃO (performance)

   Práticas oficiais do Apps Script:
   "Minimize calls to other services" e
   "read all data into an array with one command".

   Sem cache, calcularDia() relê PICAGENS, CORRECOES, AUSENCIAS,
   FERIADOS, CONFIG_SABADOS, HORAS_EXTRA e UTILIZADORES por cada
   utilizador. Num painel com 4 utilizadores eram ~28 leituras
   completas de folha numa única execução.

   O cache vive só dentro de uma execução (o Apps Script recria
   o âmbito global a cada chamada). É validado por getLastRow():
   se a folha crescer, a entrada é descartada automaticamente.
   Folhas de auditoria/log/sessões ficam de fora — não são
   caminho crítico e são escritas a cada ação.
   ============================================================ */

/**
 * Cache de folhas por nome. Uma folha lida duas vezes numa mesma execução
 * é a mesma folha: guarda-se a leitura em memória para não voltar à API.
 * A chave inclui o número de linhas de propósito: acrescentos invalidam
 * sozinhos, e alterações que não acrescentam linhas são tratadas por
 * folhaComEscritaDetectada_ (ver o comentário no topo de Utilitarios.gs).
 */
var CACHE_FOLHAS_ = {};

/* Índice de datas por folha: a coluna da data lida UMA vez por execução.
   Sem isto, um painel com 4 utilizadores lia a coluna da data 4 vezes
   (uma por cada obterPicagensDoDia_): o recorte poupava a folha inteira
   mas mantinha o custo linear nela — que era o objetivo do recorte.
   Tem de ser `var` e não `const`: o Apps Script divide o projeto em
   ficheiros e concatena-os; um `const` declarado noutro ficheiro pode não
   estar visível na ordem em que os ficheiros são carregados. */
var CACHE_INDICE_DATAS_ = {};
/* Cache separada dos recortes por intervalo. Nao pode sharing a mesma
   chave de CACHE_FOLHAS_: uma escrita invalida a folha inteira e todas as
   janelas guardadas dessa folha, sem tocar nas restantes folhas. */
var CACHE_INTERVALOS_ = {};

var FOLHAS_CACHEAVEIS_ = [
  SHEETS.UTILIZADORES,
  SHEETS.PICAGENS,
  SHEETS.CORRECOES,
  SHEETS.AUSENCIAS,
  SHEETS.FERIADOS,
  SHEETS.CONFIG_SABADOS,
  SHEETS.HORAS_EXTRA,
  SHEETS.EXCECOES,
  SHEETS.DIAS_TRABALHO
];

function limparCacheFolhas_() {
  CACHE_FOLHAS_ = {};
  CACHE_INTERVALOS_ = {};
  CACHE_INDICE_DATAS_ = {};
}

/* A cache é validada pelo número de linhas, portanto está ERRADA para
   alterações que não acrescentam linhas: aprovar uma excepção, corrigir
   uma justificação, repor uma password ou recalcular um dia não mudam
   o getLastRow() e a leitura seguinte devolvia o valor antigo — o gestor
   aprovava e via "PENDENTE" outra vez. Qualquer escrita tem de a
   invalidar. */
function marcarFolhasAlteradas_(nomeFolha) {
  const nome = String(nomeFolha || '').trim();
  if (!nome) {
    /* Chamadas internas que não conhecem a folha mantêm o comportamento
       conservador: invalidam tudo. O Proxy do código normal sempre passa
       o nome e usa a invalidação dirigida abaixo. */
    CACHE_FOLHAS_ = {};
    CACHE_INTERVALOS_ = {};
    CACHE_INDICE_DATAS_ = {};
    return;
  }

  delete CACHE_FOLHAS_[nome];
  delete CACHE_INTERVALOS_[nome];
  delete CACHE_INDICE_DATAS_[nome];
}

/**
 * Lê uma folha uma única vez por execução.
 * Devolve { sheet, valores, mapa, linhas } onde `valores` inclui
 * o cabeçalho e `linhas` já vem sem ele.
 */
function dadosFolha_(nome) {
  const sheet = getSpreadsheet_().getSheetByName(nome);

  if (!sheet) {
    return { sheet: null, valores: [], mapa: {}, linhas: [] };
  }

  if (FOLHAS_CACHEAVEIS_.indexOf(nome) < 0) {
    return construirEntradaFolha_(sheet, null);
  }

  let ultima = 0;
  try { ultima = sheet.getLastRow(); } catch (e) { ultima = -1; }

  const guardado = CACHE_FOLHAS_[nome];

  /* Cerca: se a folha não cresceu desde a última leitura,
     reaproveita os dados já em memória. */
  if (guardado && ultima >= 0 && guardado.ultima === ultima) {
    return guardado;
  }

  const entrada = construirEntradaFolha_(sheet, ultima);
  CACHE_FOLHAS_[nome] = entrada;
  return entrada;
}

function construirEntradaFolha_(sheet, ultima) {
  let valores = [];
  try { valores = sheet.getLastRow() > 0 ? sheet.getDataRange().getValues() : []; }
  catch (e) { valores = []; }

  const mapa = {};
  const cabecalhos = valores.length ? valores[0] : [];
  cabecalhos.forEach(function(h, i) { if (h) mapa[String(h)] = i; });

  return {
    sheet: sheet,
    valores: valores,
    mapa: mapa,
    linhas: valores.length > 1 ? valores.slice(1) : [],
    ultima: ultima
  };
}

/* ============================================================
   LEITURA ACOTADA POR INTERVALO DE DATAS
   ============================================================

   A cache acima resolve o problema dos "28 reads por painel", mas
   mantém outro: quando uma folha cresce para sempre, TODO o custo
   dessa folha passa a estar em TODAS as execuções.

   Medido no simulador (CENARIO 20), um painel do dia lia:
       1 ano  ->  129 168 células
       5 anos ->  643 088 células
   porque ler a folha inteira para mostrar UM dia. O custo cresce
   com o historico e é assim que uma web app com 6 meses de uso
   começa a aproximar-se do tecto de 6 minutos e dos 100 MB de heap.

   A PICAGENS é acrescentada por ordem cronológica, logo as linhas
   de uma data ocupam um intervalo contíguo. Em vez de ler tudo:

     1. lê SÓ a coluna da data (1 célula por linha, 11x menos)
     2. procura binariamente a primeira e a última linha da janela
     3. lê apenas esse intervalo, com todas as colunas

   Custo: proporcional ao conteúdo da janela, não ao historico.

   Se a folha NÃO estiver ordenada (uma CORREÇÃO pode ter mudado
   uma data para trás), a verificação dos extremos detecta-o e
   devolve null — o chamador volta a ler tudo, como antes. Perde-se
   a otimização, nunca a correcção. */

function indicePrimeiraDataGE_(datas, isoAlvo) {
  let lo = 0, hi = datas.length;
  while (lo < hi) {
    const meio = (lo + hi) >>> 1;
    if (String(datas[meio][0]) < isoAlvo) lo = meio + 1; else hi = meio;
  }
  return lo;
}

function indiceUltimaDataLE_(datas, isoAlvo, desde) {
  let lo = desde, hi = datas.length;
  while (lo < hi) {
    const meio = (lo + hi) >>> 1;
    if (String(datas[meio][0]) <= isoAlvo) lo = meio + 1; else hi = meio;
  }
  return lo;
}

/**
 * Lê apenas as linhas cujo valor em `colData` está no intervalo [isoInicio, isoFim].
 * Devolve a mesma forma que dadosFolha_ (valores, mapa, sheet) para que quem
 * chama não tenha de saber a diferença, ou null se não for seguro acotar.
 */
function dadosFolhaIntervalo_(nomeFolha, colData, isoInicio, isoFim) {
  const sheet = getSpreadsheet_().getSheetByName(nomeFolha);
  if (!sheet) return null;

  const ultimaLinha = sheet.getLastRow();
  if (ultimaLinha < 2) return { sheet: sheet, valores: [], mapa: {}, linhas: [] };

  const colunas = sheet.getLastColumn();
  const cabecalhos = sheet.getRange(1, 1, 1, colunas).getValues()[0] || [];
  const mapa = {};
  cabecalhos.forEach(function(h, i) { if (h) mapa[String(h)] = i; });
  if (mapa[colData] === undefined) return null;

  const nDados = ultimaLinha - 1;

  /* A coluna da data é lida UMA vez por execução e memorizada. Sem esta
     cache, um painel de 4 utilizadores lia-a 4 vezes (uma por cada
     obterPicagensDoDia_): o recorte poupava a folha inteira mas mantinha
     o custo linear nela — que era o objetivo do recorte. */
  let datas = null;
  const indice = CACHE_INDICE_DATAS_[nomeFolha];
  if (indice && indice.ultimaLinha === ultimaLinha && indice.coluna === mapa[colData]) {
    datas = indice.datas;
  } else {
    try { datas = sheet.getRange(2, mapa[colData] + 1, nDados, 1).getValues(); }
    catch (e) { return null; }
    CACHE_INDICE_DATAS_[nomeFolha] = { ultimaLinha: ultimaLinha, coluna: mapa[colData], datas: datas };
  }

  if (!datas.length) return { sheet: sheet, valores: [cabecalhos], mapa: mapa, linhas: [] };

  /* Pré-condição da busca binária: NÃO DECREMENTE por data.
     A busca assume ordenação; verificá-la só nos extremos não chega —
     uma folha pode ter uma data antiga no meio sem que as pontas denunciem.
     Percorrer as datas já lidas não acrescenta uma chamada ao servidor e
     impede que um recorte devolva picagens de outro dia. */
  for (let i = 1; i < datas.length; i++) {
    if (String(datas[i - 1][0]) > String(datas[i][0])) return null;
  }

  const inicio = indicePrimeiraDataGE_(datas, isoInicio);
  const fim = indiceUltimaDataLE_(datas, isoFim, inicio);
  if (fim <= inicio) return { sheet: sheet, valores: [cabecalhos], mapa: mapa, linhas: [] };

  /* Confirma os extremos: se não bater certo, a folha não está ordenada
     de forma consistente e a busca binária daria um resultado errado.
     Nesse caso desiste do recorte em vez de devolver dados trocados. */
  if (String(datas[inicio][0]) < isoInicio || String(datas[fim - 1][0]) > isoFim) return null;
  if (inicio > 0 && String(datas[inicio - 1][0]) >= isoInicio) return null;
  if (fim < datas.length && String(datas[fim][0]) <= isoFim) return null;

  /* O recorte também é cacheado: num painel com 4 utilizadores, sem isto
     a mesma janela de linhas era lida 4 vezes. A chave inclui a folha, a
     última linha e o intervalo — se qualquer um mudar, relê. */
  const chave = colData + '|' + isoInicio + '|' + isoFim + '|' + ultimaLinha;
  const intervalos = CACHE_INTERVALOS_[nomeFolha] || {};
  if (intervalos[chave]) return intervalos[chave];

  let recorte = [];
  try {
    recorte = sheet.getRange(inicio + 2, 1, fim - inicio, colunas).getValues();
  } catch (e) { return null; }

  const entrada = {
    sheet: sheet,
    valores: [cabecalhos].concat(recorte),
    mapa: mapa,
    linhas: recorte,
    ultima: ultimaLinha
  };
  CACHE_INTERVALOS_[nomeFolha] = intervalos;
  intervalos[chave] = entrada;
  return entrada;
}

function obterUtilizadores_() {
  const f = dadosFolha_(SHEETS.UTILIZADORES);
  if (!f.sheet || f.valores.length < 2) return [];
  const dados = f.valores;
  const mapa = f.mapa;
  return dados.slice(1).filter(function(l) { return l[mapa.ID]; }).map(function(l) {
    return {
      ID: String(l[mapa.ID]), Nome: String(l[mapa.Nome] || ''), Profissao: String(l[mapa.Profissao] || ''),
      Perfil: String(l[mapa.Perfil] || ''), Estado: String(l[mapa.Estado] || ''), Email: String(l[mapa.Email] || '')
    };
  });
}

function obterUtilizadorPorId_(userId) {
  return obterUtilizadores_().find(function(u) { return String(u.ID) === String(userId); }) || null;
}

function obterLinhaUtilizadorPorId_(userId) {
  garantirColunasBloqueio_();
  const f = dadosFolha_(SHEETS.UTILIZADORES);
  if (!f.sheet || f.valores.length < 2) return null;
  const dados = f.valores;
  const mapa = f.mapa;
  const idx = dados.slice(1).findIndex(function(l) {
    return String(l[mapa.ID]) === String(userId);
  });
  if (idx < 0) return null;
  return {
    sheet: f.sheet,
    row: idx + 2,
    values: dados[idx + 1],
    mapa: mapa
  };
}

function obterUtilizadorPorEmail_(email) {
  const e = String(email || '').trim().toLowerCase();
  return obterUtilizadores_().find(function(u) { return u.Email.toLowerCase() === e; }) || null;
}

/* ============================================================
   AUTORIZAÇÃO DAS OPERAÇÕES SENSÍVEIS (password / email)
   As funções que mudam password ou email NÃO podem ficar abertas:
   o web app está publicado com acesso "Anyone" e o google.script.run
   expõe TODAS as funções do projeto — sem esta guarda, qualquer
   visitante podia chamar definirPasswordUtilizador('USR_...', 'x')
   e tomar conta do utilizador.

   Regras:
     - com token: sessão válida; só o próprio OU um ADMIN;
     - sem token: apenas no editor do Apps Script e com a conta Google
       de um ADMIN (lista CREDENCIAIS_INICIAIS + folha UTILIZADORES).
   ============================================================ */

function emailsAdministradores_() {
  const out = [];
  try {
    (CREDENCIAIS_INICIAIS || []).forEach(function(c) {
      if (String(c[3] || '').toUpperCase() === ENUMS.PERFIS.ADMIN && c[1]) out.push(String(c[1]).toLowerCase().trim());
    });
  } catch (e) {}
  try {
    obterUtilizadores_().forEach(function(u) {
      if (String(u.Perfil || '').toUpperCase() === ENUMS.PERFIS.ADMIN && u.Email) out.push(String(u.Email).toLowerCase().trim());
    });
  } catch (e) {}
  return out.filter(function(x, i) { return x && out.indexOf(x) === i; });
}

function existemCredenciais_() {
  /* Leitura DIRETA do sheet, sem o cache de execução: uma decisão de
     autorização nunca pode depender de uma fotografia antiga dos dados.
     Com cache, uma folha já lida antes (com emails) fazia a instalação de
     arranque recusar-se a si própria. Em caso de dúvida, exigir autorização. */
  try {
    const sheet = getSpreadsheet_().getSheetByName(SHEETS.UTILIZADORES);
    if (!sheet || sheet.getLastRow() < 2) return false;
    const dados = sheet.getDataRange().getValues();
    const mapa = obterMapaColunas_(sheet);
    for (let i = 1; i < dados.length; i++) {
      if (dados[i][mapa.ID] && String(dados[i][mapa.Email] || '').trim()) return true;
    }
    return false;
  } catch (e) {
    return true;
  }
}

/* Ha alguma Spreadsheet ONDE este sistema ja guarda dados, e que ainda
   abra? Responde pelos tres caminhos do resolverSpreadsheet_ (ativa,
   propriedade, Config.gs).

   O teste e' de ABERTURA, e nao de existencia: um ID guardado que ja nao
   abre (Sheet apagada, partilhada perdida) nao protege nada, e e' precisamente
   o caso em que o gestor PRECISA de voltar a instalar para recuperar o
   sistema. Tratar esse estado como "instalado" deixava o gestor bloqueado
   para sempre, sem porta de entrada. */
function existeSpreadsheetInstalada_() {
  const props = PropertiesService.getScriptProperties();
  try { if (SpreadsheetApp.getActiveSpreadsheet()) return true; } catch (e) {}
  try {
    const guardado = String(props.getProperty('SPREADSHEET_ID') || '').trim();
    if (guardado) { SpreadsheetApp.openById(guardado); return true; }
  } catch (e) { /* ID obsoleto: cai no caso seguinte */ }
  try {
    const manual = String(typeof SPREADSHEET_ID === 'string' ? SPREADSHEET_ID : '').trim();
    if (manual) { SpreadsheetApp.openById(manual); return true; }
  } catch (e) { /* ID obsoleto em Config.gs tambem e' recuperavel */ }
  return false;
}

function autorizarOperacaoSensivel_(userId, autorizacao) {
  const a = autorizacao || {};

  if (a.token) {
    const sessao = exigirSessao_(a.token);
    if (String(sessao.userId) === String(userId)) return sessao;
    if (String(sessao.perfil || '').toUpperCase() === ENUMS.PERFIS.ADMIN) return sessao;
    throw new Error('Sem permissão para alterar password/email de outro utilizador.');
  }

  /* Arranque: aplicar os valores documentados de Config.gs nunca bloqueia
     ninguém — é a reposição oficial das contas. Funciona no editor (conta de
     um ADMIN), numa folha nova (sem credenciais) e sempre que a Spreadsheet
     guardada deixou de abrir (recuperação); numa folha já configurada e
     acessível continua a exigir a conta Google de um administrador.

     A ordem importa: `existeSpreadsheetInstalada_` vem PRIMEIRO porque e' a
     unica das tres perguntas que nao depende de credenciais. Com um ID
     obsoleto, `existemCredenciais_` nao tem folha nenhuma para ler e
     responde pessimista ("existem"), o que trancava o gestor fora do
     proprio sistema que ia recuperar. */
  if (a.arranque === true) {
    try {
      const email = String(Session.getActiveUser().getEmail() || '').toLowerCase().trim();
      if (email && emailsAdministradores_().indexOf(email) >= 0) return { userId: 'EDITOR', perfil: ENUMS.PERFIS.ADMIN };
    } catch (e) {}
    /* Primeira instalacao (standalone/ZIP) ou Spreadsheet que ja nao abre:
       nao ha folha de utilizadores para consultar, ou a que ha esta inacessivel.
       Instalar NAO e' um ataque — ou nao ha nada, ou nao ha nada a perder. */
    if (!existeSpreadsheetInstalada_()) return { userId: 'ARRANQUE', perfil: ENUMS.PERFIS.ADMIN };
    if (!existemCredenciais_()) return { userId: 'ARRANQUE', perfil: ENUMS.PERFIS.ADMIN };
  }

  let email = '';
  try {
    email = String(Session.getActiveUser().getEmail() || '').toLowerCase().trim();
  } catch (e) {
    email = ''; /* sem scope userinfo.email a chamada falha: trata-se como não autorizado */
  }
  if (email && emailsAdministradores_().indexOf(email) >= 0) return { userId: 'EDITOR', perfil: ENUMS.PERFIS.ADMIN };

  throw new Error(
    'Operação não autorizada. Execute-a no editor do Apps Script com a conta Google de um ' +
    'administrador (lista CREDENCIAIS_INICIAIS, em Config.gs) ou a partir da app autenticado.'
  );
}

/* Passwords simples: sem hash e sem salt, ficam em texto na coluna Password.
   Regra deliberadamente permissiva (4 a 64 caracteres, sem símbolos
   obrigatórios) para não haver recusas nem tentativas falhadas. O valor é
   guardado SEM espaços no início/fim: um espaço colado por engano deixaria o
   utilizador sem conseguir entrar nunca mais. */
function normalizarPassword_(password) {
  return String(password == null ? '' : password).trim();
}

function validarPassword_(password) {
  const p = normalizarPassword_(password);
  if (p.length < 4 || p.length > 64) throw new Error('A password deve ter entre 4 e 64 caracteres.');
  return p;
}

/* Comparação tolerante: ignora espaços nas pontas e maiúsculas/minúsculas.
   São passwords curtas e partilhadas oralmente — um Caps Lock ou um espaço
   colado não pode originar tentativas falhadas (que bloqueiam a conta). */
function compararPasswords_(a, b) {
  return normalizarPassword_(a).toLowerCase() === normalizarPassword_(b).toLowerCase();
}

/**
 * Define a password de um utilizador.
 * @param {string} userId
 * @param {string} novaPassword
 * @param {{token?:string}} [autorizacao] token da sessão; sem token só corre no editor.
 */
function definirPasswordUtilizador(userId, novaPassword, autorizacao) {
  const executor = autorizarOperacaoSensivel_(userId, autorizacao);
  return aplicarPasswordUtilizador_(userId, novaPassword, executor);
}

/* Escrita real — ver aplicarEmailUtilizador_ (mesma razão). */
function aplicarPasswordUtilizador_(userId, novaPassword, executor) {
  const password = validarPassword_(novaPassword);
  const info = obterLinhaUtilizadorPorId_(userId);
  if (!info) throw new Error('Utilizador não encontrado.');
  info.sheet.getRange(info.row, info.mapa.Password + 1).setValue(password);
  info.sheet.getRange(info.row, info.mapa.PasswordAlteracaoPendente + 1).setValue('');
  /* Repor a password desbloqueia a conta. Sem isto o utilizador que errou 5
     vezes continuava bloqueado mesmo com a password nova certa: o gestor
     repunha, o utilizador voltava a falhar e a conta bloqueava outra vez —
     um ciclo sem saída. Vale também para a instalação de arranque, em que as
     credenciais da empresa têm de funcionar sempre. */
  limparFalhasLogin_(info);
  info.sheet.getRange(info.row, info.mapa.AtualizadoEm + 1).setValue(new Date());
  try {
    const quem = executor && executor.userId ? executor.userId : 'EDITOR';
    registarAuditoriaSegura_(
      executor && executor.sessao ? executor : { userId: quem },
      'REPOR_PASSWORD',
      'Password reposta para ' + String(userId) + ' por ' + String(quem)
    );
  } catch (e) {}
  return true;
}

function utilizadorEstaAtivo_(info) {
  return info && String(info.values[info.mapa.Estado] || '') === ENUMS.ESTADOS_UTILIZADOR.ATIVO;
}

/* Versão que só olha para a data, sem efeito secundário — usada para
   MOSTRAR o estado na lista de utilizadores. */
function estaBloqueadoAte_(valor) {
  if (!valor) return false;
  const d = valor instanceof Date ? valor : new Date(valor);
  if (isNaN(d.getTime())) return false;
  return d.getTime() > Date.now();
}

/* Um bloqueio que já expirou tem de devolver a conta a zero.
   Sem isto o contador ficava em MAX_TENTATIVAS_LOGIN para sempre: a
   pessoa esperava os 15 minutos, entrava com a password certa e
   funcionava — mas bastava UM erro de dedo depois disso para voltar a
   bloquear 15 minutos, indefinidamente. Para quem tem a password
   simples e um teclado partilhado, isso é um beco sem saída. */
function utilizadorEstaBloqueado_(info) {
  const valor = info.values[info.mapa.BloqueadoAte];
  if (!valor) return false;
  const d = valor instanceof Date ? valor : new Date(valor);
  if (isNaN(d.getTime())) return false;
  if (d.getTime() > Date.now()) return true;
  /* O bloqueio já passou: limpa as falhas para que o próximo erro
     conte como o primeiro, e não como o 9.º. */
  limparFalhasLogin_(info);
  return false;
}

function minutosBloqueioPara_(bloqueiosAnteriores) {
  return bloqueiosAnteriores >= APP.SEGURANCA.BLOQUEIO_LONGO_A_PARTIR_DE
    ? APP.SEGURANCA.BLOQUEIO_MINUTOS_REINCIDENTE
    : APP.SEGURANCA.BLOQUEIO_MINUTOS;
}

/* Nº de bloqueios já sofridos QUE IMPORTAM.
   A versão anterior deduzia isto de TentativasFalhadas, o que nunca
   funcionava: essa coluna é posto a zero em TODOS os caminhos de
   recuperação (login certo, fim do bloqueio, desbloquear, repor a
   password) e portanto valia sempre 0 — o bloqueio de 60 min jamais
   chegava a aplicar-se. Passou a ler um contador próprio (coluna
   Bloqueios), que só o gestor ou uma janela de tempo apagam. */
function bloqueiosAnterioresDe_(info) {
  if (!info || info.mapa.Bloqueios === undefined) return 0;
  const total = Number(info.values[info.mapa.Bloqueios]) || 0;
  if (total <= 0) return 0;

  /* Decai: um bloqueio de há mais de N horas já não conta. */
  if (info.mapa.UltimoBloqueioEm !== undefined) {
    const ultimo = info.values[info.mapa.UltimoBloqueioEm];
    if (ultimo) {
      const d = ultimo instanceof Date ? ultimo : new Date(ultimo);
      if (!isNaN(d.getTime())) {
        const horas = (Date.now() - d.getTime()) / 3600000;
        if (horas >= APP.SEGURANCA.RECINCIDENCIA_ESQUECE_APOS_HORAS) return 0;
      }
    }
  }
  return total;
}

function registarFalhaLogin_(info) {
  const mapa = info.mapa;
  const tent = Number(info.values[mapa.TentativasFalhadas]) || 0;
  const novo = tent + 1;
  info.sheet.getRange(info.row, mapa.TentativasFalhadas + 1).setValue(novo);
  if (novo >= APP.SEGURANCA.MAX_TENTATIVAS_LOGIN) {
    /* Conta este bloqueio ANTES de escolher a duração, para que o
       primeiro use o tempo curto e o segundo e seguintes usem o longo.
       E é a contagem que inclui ESTE bloqueio que se compara com
       BLOQUEIO_LONGO_A_PARTIR_DE: com 1 bloqueio anterior este é o 2.º,
       e 2 >= 2 aplica o tempo longo. Passar `anteriores` (que é 1) nunca
       chegaria ao limiar e o bloqueio de 60 min jamais chegava a
       acontecer. */
    const anteriores = bloqueiosAnterioresDe_(info);
    const contagem = anteriores + 1;
    if (mapa.Bloqueios !== undefined) {
      info.sheet.getRange(info.row, mapa.Bloqueios + 1).setValue(contagem);
      if (mapa.UltimoBloqueioEm !== undefined) {
        info.sheet.getRange(info.row, mapa.UltimoBloqueioEm + 1).setValue(new Date());
      }
    }
    const minutos = minutosBloqueioPara_(contagem);
    info.sheet.getRange(info.row, mapa.BloqueadoAte + 1)
      .setValue(new Date(Date.now() + minutos * 60000));
  }
}

/* Apaga o histórico de bloqueios. Só o gestor (desbloquear) ou uma
   repor de password o chamam: são gestos deliberados de perdoão. */

function limparFalhasLogin_(info) {
  info.sheet.getRange(info.row, info.mapa.TentativasFalhadas + 1).setValue(0);
  info.sheet.getRange(info.row, info.mapa.BloqueadoAte + 1).clearContent();
  /* NÃO toca em Bloqueios: o fim de um bloqueio é o próprio mecanismo
     de punição a funcionar, não um perdão. Se apagasse o histórico aqui,
     a reincidência nunca contaria e o bloqueio longo nunca chegaria a
     existir — que era precisamente o defeito. */
}
function criarSessao_(userId) {
  const sheet = getSpreadsheet_().getSheetByName(SHEETS.SESSOES);
  const token = Utilities.getUuid() + Utilities.getUuid();
  const agora = new Date();
  const expira = new Date(agora.getTime() + APP.SEGURANCA.SESSAO_MINUTOS * 60000);
  const id = 'SES_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16).toUpperCase();
  sheet.appendRow([id, token, userId, agora, expira, ENUMS.ESTADOS_SESSAO.ATIVA, agora]);
  return { token: token, id: id, userId: userId, expiraEm: expira };
}

function obterSessaoPorToken_(token) {
  if (!token) return null;
  const sheet = getSpreadsheet_().getSheetByName(SHEETS.SESSOES);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const dados = sheet.getDataRange().getValues();
  const mapa = obterMapaColunas_(sheet);
  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][mapa.Token] || '') === String(token)) {
      return { sheet: sheet, row: i + 1, values: dados[i], mapa: mapa };
    }
  }
  return null;
}

function validarSessao_(token) {
  const info = obterSessaoPorToken_(token);
  if (!info) throw new Error('Sessão inválida.');
  const estado = String(info.values[info.mapa.Estado] || '');
  if (estado !== ENUMS.ESTADOS_SESSAO.ATIVA) throw new Error('Sessão terminada.');
  const expira = new Date(info.values[info.mapa.ExpiraEm]);
  if (isNaN(expira.getTime()) || expira.getTime() <= Date.now()) {
    info.sheet.getRange(info.row, info.mapa.Estado + 1).setValue(ENUMS.ESTADOS_SESSAO.EXPIRADA);
    throw new Error('Sessão expirada.');
  }
  const user = obterUtilizadorPorId_(info.values[info.mapa.UserID]);
  if (!user || user.Estado !== ENUMS.ESTADOS_UTILIZADOR.ATIVO) throw new Error('Utilizador inativo.');
  const agora = new Date();
  info.sheet.getRange(info.row, info.mapa.UltimaAtividade + 1).setValue(agora);
  return { id: info.values[info.mapa.ID], userId: user.ID, nome: user.Nome, perfil: user.Perfil, sessao: info };
}

function exigirSessao_(token) { return validarSessao_(token); }
function exigirAdmin_(token) {
  const s = validarSessao_(token);
  if (s.perfil !== ENUMS.PERFIS.ADMIN) throw new Error('Acesso reservado a administradores.');
  return s;
}

function autenticarUtilizador(email, password) {

  const lock = adquirirLock_(15000);

  try {

    email = String(email || '').trim().toLowerCase();
    password = normalizarPassword_(password);

    if (!email || !password) {
      throw new Error('Credenciais inválidas.');
    }

    const user = obterUtilizadorPorEmail_(email);

    if (!user) {
      throw new Error('Credenciais inválidas.');
    }

    const info = obterLinhaUtilizadorPorId_(user.ID);

    if (!info) {
      throw new Error('Credenciais inválidas.');
    }

    if (!utilizadorEstaAtivo_(info)) {
      throw new Error('Utilizador inativo.');
    }

    if (utilizadorEstaBloqueado_(info)) {
      const minutos = Math.max(1, Math.ceil((new Date(info.values[info.mapa.BloqueadoAte]).getTime() - Date.now()) / 60000));
      /* A mensagem é a ÚNICA coisa que a pessoa lê quando está bloqueada.
         Dizer "reponha a password" era errado: obrigava a mudar uma
         credencial simples e mantida de propósito, quando o gestor
         tem agora um botão que desbloqueia sem tocar nela. */
      throw new Error('Conta bloqueada (' + minutos + ' min restantes) após ' + APP.SEGURANCA.MAX_TENTATIVAS_LOGIN + ' tentativas falhadas. Aguarde, ou peça ao gestor para desbloquear — não precisa de mudar a palavra-passe.');
    }

    const passwordGuardada = String(info.values[info.mapa.Password] || '');
    
    if (!passwordGuardada || !compararPasswords_(passwordGuardada, password)) {
      registarFalhaLogin_(info);
      const restantes = Math.max(0, APP.SEGURANCA.MAX_TENTATIVAS_LOGIN - (Number(info.values[info.mapa.TentativasFalhadas]) || 0) - 1);
      throw new Error(restantes > 0
        ? 'Credenciais inválidas. ' + restantes + ' tentativa(s) antes do bloqueio.'
        : 'Credenciais inválidas. A conta fica bloqueada Temporariamente; peça ao gestor para repor a password.');
    }

    // Login válido
    limparFalhasLogin_(info);
    registarUltimoLogin_(info);

    const sessao = criarSessao_(user.ID);

    registarAuditoriaSegura_(
      sessao,
      'LOGIN',
      'Login efetuado.'
    );

    return serializarParaFrontend_({
      sucesso: true,

      token: sessao.token,

      /* A interface tambem precisa de saber em que dia a semana comeca: sem
         isto ela fixava a segunda-feira e, se algum dia a configuracao
         mudasse, o filtro "A minha semana" pediria um intervalo diferente do
         que o backend consideraria semana. O valor vem do servidor, que e'
         quem o le de Config.gs. */
      primeiroDiaSemana: primeiroDiaSemana_(),

      passwordAlteracaoPendente: passwordAlteracaoPendente_(info),

      utilizador: {
        id: user.ID,
        nome: user.Nome,
        profissao: user.Profissao,
        perfil: user.Perfil,
        estado: user.Estado
      },

      sessao: sessao
    });

  } finally {

    lock.releaseLock();

  }
}

function terminarSessao(token) {
  const s = validarSessao_(token);
  const lock = adquirirLock_(15000);
  try {
    const info = s.sessao;
    info.sheet.getRange(info.row, info.mapa.Estado + 1).setValue(ENUMS.ESTADOS_SESSAO.TERMINADA);
    registarAuditoriaSegura_(s, 'LOGOUT', 'Logout efetuado.');
    return { sucesso: true };
  } finally { lock.releaseLock(); }
}

/* ============================================================
   AUDITORIA / ERROS
   ============================================================ */

function registarAuditoriaSegura_(sessao, acao, descricao, dados) {
  try {
    const sheet = getSpreadsheet_().getSheetByName(SHEETS.AUDITORIA);
    if (!sheet) return;
    sheet.appendRow([
      'AUD_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16).toUpperCase(),
      new Date(), acao, sessao && sessao.sessao ? sessao.sessao.values[sessao.sessao.mapa.ID] : '',
      sessao ? sessao.userId : '', descricao || '', '', '', dados ? JSON.stringify(dados) : ''
    ]);
  } catch (e) {}
}

/* Trava de re-entrada do registo de erros.

   `registarErro_` precisa de `getSpreadsheet_` para escrever na folha, e
   `getSpreadsheet_` chama `registarErro_` quando falha. Sem esta trava, uma
   falha da Spreadsheet gerava outra, que gerava outra:

       getSpreadsheet_ -> registarErro_ -> getSpreadsheet_ -> registarErro_ -> ...

   ate a pilha rebentar (RangeError). O `try/catch` de `registarErro_` nao
   trava nada aqui: a chamada que rebenta acontece ANTES de a excepcao
   poder ser apanhada.

   O efeito era pior do que um crash: a folha LOG_ERROS nunca recebia nada,
   porque a Spreadsheet que faltava era a mesma que o registo precisava. O
   registo de erros era inutilizavel exactamente na falha que devia
   registar — que e' a falha de "corre setupSistema()". */
var _A_REGISTAR_ERRO_ = false;

function registarErro_(funcao, erro, userId, dados) {
  /* Ja estamos dentro de um registo: nao se volta a entrar, senao a falha
     alimenta-se a si propria. */
  if (_A_REGISTAR_ERRO_) return;
  _A_REGISTAR_ERRO_ = true;
  try {
    const sheet = getSpreadsheet_().getSheetByName(SHEETS.LOG_ERROS);
    if (!sheet) return;
    sheet.appendRow([
      'ERR_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16).toUpperCase(),
      new Date(), funcao || '', erro && erro.message ? erro.message : String(erro),
      erro && erro.stack ? erro.stack : '', userId || '', dados ? JSON.stringify(dados) : ''
    ]);
  } catch (e) {
    /* Sem folha nao ha registo, e nao ha para onde ir. Silencio e' a unica
       opcao: um erro ao registar um erro nunca pode ser LANÇADO, ou a
       falha original chegava ao utilizador em vez de propagar. */
  } finally {
    _A_REGISTAR_ERRO_ = false;
  }
}

