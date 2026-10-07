/* ============================================================
   UTILITÁRIOS BASE
   ============================================================ */

/* A cache de folhas (ver Seguranca.gs) valida pelo número de linhas.
   Isso é correcto para acrescentos, mas ERRADO para alterações que não
   mudam o getLastRow(): aprovar uma excepção, decidir uma justificação,
   repor uma password ou recalcular um dia deixavam a cache a devolver
   o valor antigo — o gestor aprovava e voltava a ver "PENDENTE".

   Em vez de acrescentar uma chamada de invalidação a cada escrita
   (e esquecer uma), intercepta-se a escrita num único sítio: onde a
   folha é entregue. Qualquer operação que altere valores ou estrutura
   passa por aqui e limpa a cache. Leituras (getValues/getDataRange)
   não são interceptadas, por isso continuam a ser baratas. */
var METODOS_ESCRITA_RANGE_ = [
  'setValue', 'setValues', 'setFormula', 'setFormulas', 'setNote', 'setNumberFormat',
  'setDataValidation', 'clearContent', 'clear', 'sort', 'merge', 'breakApart'
];

var METODOS_ESCRITA_FOLHA_ = [
  'appendRow', 'appendColumn', 'insertRow', 'insertRowsAfter', 'insertColumnAfter',
  'insertColumnsAfter', 'deleteRow', 'deleteColumn', 'deleteColumns', 'removeRow',
  'removeColumn', 'clear', 'clearContents', 'clearFormat', 'sort', 'insertImage',
  'autoResizeColumns', 'autoResizeRows', 'setName', 'setHidden', 'hideSheet',
  'showSheet', 'setTabColor', 'setFrozenRows', 'setColumnWidths', 'setRowHeights'
];

/* O nome da folha viaja com o Proxy: uma escrita em DIAS_TRABALHO não
   pode apagar o índice de datas de PICAGENS. Sem esta informação, a
   invalidação global obriga o painel a reler a coluna de datas para cada
   utilizador, anulando o recorte por intervalo. */
function nomeDaFolhaResultante_(folha, nomeAlternativo) {
  if (nomeAlternativo) return String(nomeAlternativo);
  try { return folha && typeof folha.getName === 'function' ? String(folha.getName()) : ''; }
  catch (e) { return ''; }
}

function rangeComEscritaDetectada_(range, nomeFolha) {
  if (!range || typeof range !== 'object' || !range.setValue) return range;
  return new Proxy(range, {
    get: function (alvo, prop) {
      const v = alvo[prop];
      if (typeof v !== 'function') return v;
      if (METODOS_ESCRITA_RANGE_.indexOf(String(prop)) >= 0) {
        return function () { marcarFolhasAlteradas_(nomeFolha); return v.apply(alvo, arguments); };
      }
      if (String(prop).charAt(0) === 's' && String(prop).indexOf('set') === 0) {
        return function () { marcarFolhasAlteradas_(nomeFolha); return v.apply(alvo, arguments); };
      }
      return v.bind(alvo);
    }
  });
}

function folhaComEscritaDetectada_(sheet, nomeConhecido) {
  if (!sheet || typeof sheet !== 'object') return sheet;
  const nomeFolha = nomeDaFolhaResultante_(sheet, nomeConhecido);
  return new Proxy(sheet, {
    get: function (alvo, prop) {
      const v = alvo[prop];
      if (typeof v !== 'function') return v;
      if (prop === 'getRange' || prop === 'getDataRange' || prop === 'getRangeBetween' || prop === 'getLastRow') {
        /* getLastRow e leituras passam intactos — a cache depende do
           getLastRow() continuar a ser uma leitura barata. */
        return function () { return rangeComEscritaDetectada_(v.apply(alvo, arguments), nomeFolha); };
      }
      if (METODOS_ESCRITA_FOLHA_.indexOf(String(prop)) >= 0) {
        return function () { marcarFolhasAlteradas_(nomeFolha); return v.apply(alvo, arguments); };
      }
      if (String(prop).charAt(0) === 's' && String(prop).indexOf('set') === 0) {
        return function () { marcarFolhasAlteradas_(nomeFolha); return v.apply(alvo, arguments); };
      }
      return v.bind(alvo);
    }
  });
}

function planilhaComEscritaDetectada_(ss) {
  if (!ss || typeof ss !== 'object') return ss;
  return new Proxy(ss, {
    get: function (alvo, prop) {
      const v = alvo[prop];
      if (typeof v !== 'function') return v;
      if (prop === 'getSheetByName' || prop === 'getActiveSheet' || prop === 'getSheet' || prop === 'insertSheet') {
        return function () {
          const folha = v.apply(alvo, arguments);
          const nome = prop === 'getSheetByName' || prop === 'insertSheet' ? arguments[0] : null;
          return folhaComEscritaDetectada_(folha, nome);
        };
      }
      return v.bind(alvo);
    }
  });
}

function getSpreadsheet_() {
  try {
    // Primeiro tenta usar a Spreadsheet associada ao projeto.
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (ss) {
      return planilhaComEscritaDetectada_(ss);
    }

    // Fallback para projetos que não tenham contexto de
    // Spreadsheet ativo durante a execução.
    const props = PropertiesService.getScriptProperties();
    const spreadsheetId = props.getProperty('SPREADSHEET_ID');

    if (spreadsheetId) {
      return planilhaComEscritaDetectada_(SpreadsheetApp.openById(spreadsheetId));
    }

    throw new Error(
      'Não foi possível localizar a Spreadsheet de dados. ' +
      'Corre setupSistema() (ou instalarSistemaComCredenciais()) uma vez no editor: ' +
      'o script cria a Spreadsheet e guarda o ID. Se já tens uma Sheet com dados, ' +
      'escreve o ID na constante SPREADSHEET_ID do Config.gs.'
    );

  } catch (erro) {
    registarErro_('getSpreadsheet_', erro, '', {});
    throw erro;
  }
}

/**
 * Resolve a Spreadsheet de dados, CRIANDO-A se ainda não existir.
 *
 * É isto que faz a instalação funcionar num projeto importado por ZIP.
 * A documentação do Google diz que "only standalone scripts can be imported",
 * e num projeto standalone SpreadsheetApp.getActiveSpreadsheet() devolve
 * SEMPRE null — não há Sheet ligada ao projeto.
 *
 * A versão anterior de setupSistema() só guardava o ID no FIM, depois de já
 * ter criado todas as folhas. Num projeto novo isso era um impasse: a
 * instalação nunca arrancava, porque nunca havia ID para abrir. Por isso
 * esta função corre PRIMEIRO e cria a Sheet quando não encontra nenhuma.
 *
 * Ordem de resolução:
 *   1. ATIVA       — execução aberta a partir da Sheet (projeto ligado a ela)
 *   2. PROPRIEDADE — ID registado por uma instalação anterior
 *   3. CONFIG      — ID escrito à mão na constante SPREADSHEET_ID
 *   4. CRIADA      — cria uma Sheet nova e passa a usar essa
 */
function resolverSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  let ss = null;
  let origem = '';

  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
  if (ss) origem = 'ATIVA';

  if (!ss) {
    const guardado = String(props.getProperty('SPREADSHEET_ID') || '').trim();
    if (guardado) {
      try {
        ss = SpreadsheetApp.openById(guardado);
        origem = 'PROPRIEDADE';
      } catch (e) {
        /* ID obsoleto (Sheet apagada, ou partilhada perdida):
           limpa-se e continua a procura pelos outros caminhos. */
        props.deleteProperty('SPREADSHEET_ID');
      }
    }
  }

  if (!ss) {
    const manual = String(typeof SPREADSHEET_ID === 'string' ? SPREADSHEET_ID : '').trim();
    if (manual) {
      try {
        ss = SpreadsheetApp.openById(manual);
        origem = 'CONFIG';
      } catch (e) {
        throw new Error(
          'SPREADSHEET_ID no Config.gs não abre. Confirma o ID: é a parte da ' +
          'URL entre "/d/" e "/edit". Erro original: ' + e.message
        );
      }
    }
  }

  if (!ss) {
    ss = SpreadsheetApp.create(APP.NOME + ' — ' + APP.EMPRESA);
    origem = 'CRIADA';
  }

  props.setProperty('SPREADSHEET_ID', ss.getId());
  try { ss.setSpreadsheetTimeZone(APP.TIMEZONE); } catch (e) {}

  return {
    ss: ss,
    origem: origem,
    id: ss.getId(),
    url: typeof ss.getUrl === 'function' ? ss.getUrl() : ''
  };
}

/**
 * Estado da instalação, para diagnóstico no editor.
 * Devolve sempre um objeto e nunca rebenta, para poder correr ANTES
 * da instalação estar feita — que é quando interessa.
 */
function estadoInstalacao_() {
  const props = PropertiesService.getScriptProperties();
  const guardado = String(props.getProperty('SPREADSHEET_ID') || '').trim();

  let ativa = false;
  try { ativa = !!SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ativa = false; }

  let acessivel = false;
  if (guardado) {
    try { SpreadsheetApp.openById(guardado); acessivel = true; } catch (e) { acessivel = false; }
  }

  let instrucao;
  if (!guardado) {
    instrucao = 'Ainda não há Spreadsheet. Corre instalarSistemaComCredenciais() — cria uma.';
  } else if (!acessivel) {
    instrucao = 'Há um ID guardado mas não abre. Apaga-o em Definições do projeto > ' +
      'Propriedades do script (chave SPREADSHEET_ID), ou corrige SPREADSHEET_ID no Config.gs.';
  } else {
    instrucao = 'Instalado. Próximo passo: Deploy > New deployment > Web app.';
  }

  return {
    projetoStandalone: !ativa,
    spreadsheetIdGuardado: guardado || '(vazio)',
    spreadsheetAcessivel: acessivel,
    instrucao: instrucao
  };
}


/**
 * Converte recursivamente objetos devolvidos pelo backend
 * para tipos seguros para google.script.run.
 *
 * Problema resolvido:
 * Date não deve ser devolvido diretamente para o HTML.
 */
function serializarParaFrontend_(valor, profundidade) {

  if (valor === null || valor === undefined) {
    return valor;
  }

  /* Tecto de profundidade. Esta funcao percorre o valor e chama-se a si
     propria em cada array e cada objecto — e' a unica recursao do
     projecto. Os valores vem do Sheets e de objectos montados a mao, que
     sao aciclicos, entao nao ha ciclo hoje. MAS um unico objecto que se
     aponte a si proprio rebenta a pilha (RangeError) sem dejar rasto: e'
     o serializador de TODA a superficie publica, portanto o estrago seria
     total. Com tecto, um ciclo devolve um marcador e a aplicacao continua.
     Estruturas reais de um dia de trabalho andam na casa das dezenas. */
  const nivel = profundidade || 0;
  if (nivel > 40) return '[…]';

  // Datas -> ISO
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    if (isNaN(valor.getTime())) {
      return null;
    }

    return valor.toISOString();
  }

  // Arrays
  if (Array.isArray(valor)) {
    return valor.map(function(item) {
      return serializarParaFrontend_(item, nivel + 1);
    });
  }

  // Objetos
  if (typeof valor === 'object') {
    const resultado = {};

    Object.keys(valor).forEach(function(chave) {
      resultado[chave] = serializarParaFrontend_(valor[chave], nivel + 1);
    });

    return resultado;
  }

  // String / number / boolean
  return valor;
}

/* As colunas Bloqueios e UltimoBloqueioEm foram acrescentadas DEPOIS de
   várias instalações já estarem feitas. Sem isto, uma folha antiga ficaria
   sem elas, `mapa.Bloqueios` seria undefined e a reincidência nunca
   contaria — o mesmo defeito de antes, só nos clientes que já estavam
   instalados. Acrescenta as colunas em falta uma única vez por execução,
   a partir do cabeçalho que já foi lido para o cache (custo zero quando
   já existem). */
/* Posicao livre para acrescentar uma coluna, calculada a partir do
   CABECALHO e nao de getLastColumn().
   getLastColumn() olha para os VALORES de todas as linhas: numa folha em
   que um bloco de colunas foi esvaziado (ou que veio de outra folha),
   devolve uma posicao anterior a um cabecalho que ainda existe. Escrever
   la apagava uma coluna viva — Losing dados sem erro nenhum. Percorrer o
   cabecalho garante que nunca se escreve sobre um nome. */
function primeiraColunaLivre_(f) {
  const cab = (f.valores && f.valores[0]) || [];
  let ult = 0;
  for (let j = 0; j < cab.length; j++) {
    const v = cab[j];
    if (v !== undefined && v !== null && String(v).trim() !== '') ult = j + 1;
  }
  return ult + 1;
}

var _COLUNAS_BLOQUEIO_OK_ = false;
function garantirColunasBloqueio_() {
  if (_COLUNAS_BLOQUEIO_OK_) return;
  const f = dadosFolha_(SHEETS.UTILIZADORES);
  if (!f.sheet) return;
  if (f.mapa.Bloqueios !== undefined && f.mapa.UltimoBloqueioEm !== undefined) {
    _COLUNAS_BLOQUEIO_OK_ = true;
    return;
  }
  try {
    const novas = [];
    if (f.mapa.Bloqueios === undefined) novas.push('Bloqueios');
    if (f.mapa.UltimoBloqueioEm === undefined) novas.push('UltimoBloqueioEm');
    let col = primeiraColunaLivre_(f);
    const ondeBloqueios = novas.indexOf('Bloqueios') >= 0 ? col + novas.indexOf('Bloqueios') : 0;
    novas.forEach(function (c) { f.sheet.getRange(1, col).setValue(c); col++; });
    /* Linhas existentes ficam com 0 (e não vazio) para que
       bloqueiosAnterioresDe_ leia um número e não uma string.
       getRange(...,0,...) rebenta numa folha ainda sem utilizadores, e
       essa exceção era apanhada pelo catch em baixo — o que saltava
       marcarFolhasAlteradas_ e deixava a migração por terminar. */
    const existentes = Math.max(0, f.sheet.getLastRow() - 1);
    if (ondeBloqueios > 0 && existentes > 0) {
      f.sheet.getRange(2, ondeBloqueios, existentes, 1).setValue(0);
    }
    marcarFolhasAlteradas_();
    _COLUNAS_BLOQUEIO_OK_ = true;
  } catch (e) { /* sem permissão de escrita: segue sem as colunas (comportamento antigo) */ }
}

function garantirColunasFolha_(sheetName, colunas) {
  const sheet = typeof sheetName === 'string' ? getOrCreateSheet_(sheetName) : sheetName;
  const atuais = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    : [];
  colunas.forEach(function(c) {
    if (atuais.indexOf(c) === -1) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(c);
      atuais.push(c);
    }
  });
  return sheet;
}

function formatarCabecalho_(sheet) {
  if (!sheet || sheet.getLastColumn() === 0) return;
  sheet.getRange(1, 1, 1, sheet.getLastColumn())
    .setFontWeight('bold')
    .setBackground('#d9eaf7');
  sheet.setFrozenRows(1);
}

function configurarTimezone_() {
  try {
    getSpreadsheet_().setSpreadsheetTimeZone(APP.TIMEZONE);
  } catch (e) {}
  return APP.TIMEZONE;
}

function obterMapaColunas_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const mapa = {};
  headers.forEach(function(h, i) {
    if (h) mapa[String(h)] = i;
  });
  return mapa;
}

function normalizarData_(data) {
  if (data instanceof Date && !isNaN(data.getTime())) {
    return new Date(data.getFullYear(), data.getMonth(), data.getDate());
  }
  if (typeof data === 'string') {
    const m = data.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    /* `new Date(9999, 98, 99)` NAO da Invalid Date: o JavaScript transborda e
       devolve 07-06-10007. O mesmo com '2026-13-45', que virava 14-02-2027.
       Uma data transbordada e' uma data VALIDA e silenciosamente errada: o
       utilizador pedia o dia 45 e recebia um relatorio de meses depois, sem
       qualquer aviso. Por isso o que se escreve tem de ser aquele mesmo dia. */
    if (m) {
      const ano = Number(m[1]), mes = Number(m[2]), dia = Number(m[3]);
      const d = new Date(ano, mes - 1, dia);
      if (d.getFullYear() !== ano || d.getMonth() !== mes - 1 || d.getDate() !== dia)
        throw new Error('Data inválida: ' + data);
      return d;
    }
    const p = data.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
    if (p) {
      const ano = Number(p[3]), mes = Number(p[2]), dia = Number(p[1]);
      const d = new Date(ano, mes - 1, dia);
      if (d.getFullYear() !== ano || d.getMonth() !== mes - 1 || d.getDate() !== dia)
        throw new Error('Data inválida: ' + data);
      return d;
    }
    /* Instante em UTC explicito (`...Z`), que e' o que serializarParaFrontend_
       produz com toISOString(). Sem este caso caia-se no `new Date(data)` de
       baixo, que converte para o fuso LOCAL antes de se extrair o dia: num
       fuso a oeste de UTC, '2026-01-01T00:00:00.000Z' dava 31-12-2025 —
       uma picagem registada no dia errado. O fuso do manifesto e' Lisboa,
       por isso isto hoje nao rebenta, mas o dia tem de ser o dia do
       INSTANTE, e nao o dia desse instante visto de outra hora do mundo. */
    const utc = data.match(/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    if (utc) {
      const ano = Number(utc[1]), mes = Number(utc[2]), dia = Number(utc[3]);
      const d = new Date(ano, mes - 1, dia);
      if (d.getFullYear() !== ano || d.getMonth() !== mes - 1 || d.getDate() !== dia)
        throw new Error('Data inválida: ' + data);
      return d;
    }
  }
  const d = new Date(data);
  if (isNaN(d.getTime())) throw new Error('Data inválida: ' + data);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatarDataISO_(data) {
  const d = normalizarData_(data);
  return Utilities.formatDate(d, APP.TIMEZONE, 'yyyy-MM-dd');
}

function valorDataISO_(valor) {
  if (valor instanceof Date && !isNaN(valor.getTime())) return formatarDataISO_(valor);
  const texto = String(valor || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  const d = new Date(texto);
  return isNaN(d.getTime()) ? texto : formatarDataISO_(d);
}


function obterDiaSemana_(data) {
  return normalizarData_(data).getDay();
}

function obterNomeDiaSemana_(data) {
  return ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'][obterDiaSemana_(data)];
}

function isSabado_(data) { return obterDiaSemana_(data) === 6; }
function isDomingo_(data) { return obterDiaSemana_(data) === 0; }

/* ============================================================
   LOCK — ADQUIRIR OU FALHAR
   ============================================================
   LockService.waitLock(ms) devolve FALSE quando nao consegue a
   lock dentro do prazo. O codigo usava `lock.waitLock(15000);`
   sem ler o retorno, em todas as chamadas.

   O que isso significa no dia-a-dia: se outro ambito (o trigger
   diario, outro administrador) detem a lock, a execucao NAO
   aborta — continua a correr e a ESCREVER sem serializacao. Como
   o caminho tipico e' ler-modificar-escrever (conta tentativas,
   soma horas, muda um estado), duas execucoes podem intercalar e
   o resultado e' um total errado sem qualquer erro em lado
   nenhum. E' o pior tipo de falha: silenciosa e contabil.

   Falhar de forma limpa e' melhor: o utilizador ve "tente de novo",
   o trigger repete a proxima execucao, e nada fica meio-escrito. */
function adquirirLock_(ms) {
  const lock = LockService.getScriptLock();
  const esperado = Math.max(1000, Number(ms) || 15000);
  if (!lock.waitLock(esperado)) {
    throw new Error('O sistema está ocupado com outra operação. Tente novamente dentro de instantes.');
  }
  return lock;
}

/* ============================================================
   INTERVALO DE DATAS COM TETO
   ============================================================
   O laco de datas (ver Relatorios) percorre de `inicio` a `fim`
   sem limite de dominio. Um intervalo de 100 anos produz 36 525
   datas: termina (nao e' um laco infinito) mas nao e' um pedido
   que alguém devia poder fazer, e a interface so protege o que
   o utilizador ve — o dispatcher chama a funcao por nome.

   Teto escolhido: 3660 dias (10 anos). Cobre qualquer auditoria
   de historico, incluindo o relatorio anual completo, e mantem o
   custo na casa das dezenas de milhares de celulas, muito dentro
   dos 6 min. */
var MAX_INTERVALO_DIAS = 3660;
function validarIntervaloDatas_(inicio, fim) {
  const a = normalizarData_(inicio), b = normalizarData_(fim);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) throw new Error('Intervalo de datas inválido.');
  const dias = Math.round((b - a) / 86400000) + 1;
  if (dias <= 0) {
    throw new Error('Intervalo de datas inválido: a data final (' + formatarDataISO_(b) +
      ') é anterior à inicial (' + formatarDataISO_(a) + ').');
  }
  if (dias > MAX_INTERVALO_DIAS) {
    throw new Error('Intervalo demasiado longo (' + dias + ' dias). O máximo é ' +
      MAX_INTERVALO_DIAS + ' dias (10 anos). Escolha um período menor.');
  }
  return { inicio: a, fim: b, dias: dias };
}


/* Texto vindo do utilizador guardado nas folhas: evita que fórmulas de
   folha de cálculo (ex.: "=1+1" ou "=HIPERLIGACAO(...)") executem quando o
   valor é escrito com setValue/appendRow — uma aspa inicial transforma-o
   em texto literal. Só se aplica quando o 1.º caráter é = + - @. */
function sanitizarTextoCelula_(valor) {
  const s = String(valor == null ? '' : valor);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/* Próximo sábado (hoje conta, se hoje for sábado) em ISO yyyy-mm-dd.
   Usado para pré-preencher dataInicio da rotação de sábados — a rotação
   ancora em dataInicio, por isso o ideal é uma data SÁBADO. Sem dataInicio
   todos os sábados ficam SABADO_NAO_PREVISTO (horas normais contadas como
   extra), pelo que este valor é automático e nunca fica vazio. */
function proximoSabadoIso_() {
  const d = normalizarData_(new Date());
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return formatarDataISO_(d);
}

function obterTimestampServidor_() { return new Date(); }

function horaParaMinutos_(hora) {
  if (typeof hora === 'number') return Math.round(hora);
  const p = String(hora || '').split(':');
  if (p.length < 2) throw new Error('Hora inválida: ' + hora);
  return Number(p[0]) * 60 + Number(p[1]);
}

function minutosParaHora_(minutos) {
  minutos = Math.max(0, Math.round(Number(minutos) || 0));
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2);
}

function obterMinutosDoDia_(dataHora) {
  return dataHora.getHours() * 60 + dataHora.getMinutes();
}

function criarDataHora_(data, horas, minutos, segundos) {
  const d = normalizarData_(data);
  d.setHours(Number(horas) || 0, Number(minutos) || 0, Number(segundos) || 0, 0);
  return d;
}

function minutosEntre_(inicio, fim) {
  return Math.max(0, Math.round((fim.getTime() - inicio.getTime()) / 60000));
}


function definirValorColuna_(linha, mapa, coluna, valor) {
  if (mapa[coluna] !== undefined) linha[mapa[coluna]] = valor;
}

/* ============================================================
   CRIAÇÃO / GARANTIA DE FOLHAS E CABEÇALHOS
   ============================================================ */

/**
 * Devolve a folha com o nome indicado, criando-a se ainda
 * não existir na Spreadsheet.
 */
function getOrCreateSheet_(nome) {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(nome);

  if (!sheet) {
    sheet = ss.insertSheet(nome);
  }

  return sheet;
}

/**
 * Garante que a folha tem a linha de cabeçalho completa.
 * Se a folha estiver vazia, escreve o cabeçalho pela ordem
 * canónica de HEADERS; caso contrário, acrescenta no fim as
 * colunas que faltarem (mesma convenção de garantirColunasFolha_).
 */
function garantirCabecalhos_(sheet, cabecalhos) {
  if (!sheet) throw new Error('Folha inválida para cabeçalhos.');

  const colunas = (cabecalhos || []).slice();
  if (!colunas.length) return sheet;

  const ultimaColuna = sheet.getLastColumn();
  const atuais = ultimaColuna > 0
    ? sheet.getRange(1, 1, 1, ultimaColuna).getValues()[0].map(function(h) {
        return String(h === null || h === undefined ? '' : h).trim();
      })
    : [];

  const vazia = ultimaColuna === 0 || atuais.every(function(h) { return h === ''; });

  if (vazia) {
    if (sheet.getMaxColumns() < colunas.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), colunas.length - sheet.getMaxColumns());
    }
    sheet.getRange(1, 1, 1, colunas.length).setValues([colunas]);
    return sheet;
  }

  colunas.forEach(function(coluna) {
    if (atuais.indexOf(coluna) === -1) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(coluna);
      atuais.push(coluna);
    }
  });

  return sheet;
}
