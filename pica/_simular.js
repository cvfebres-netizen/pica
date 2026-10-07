/* ============================================================
   SIMULACAO DA APP — ambiente falso do Apps Script
   Uso: node _simular.js
   (ficheiro local; nao vai para o Apps Script)
   ============================================================ */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const dir = __dirname;


let falhas = 0;
const registo = [];
function titulo(t) { registo.push('\n--- ' + t + ' ---'); }
function assinalar(cond, msg) {
  if (cond) { registo.push('  OK   ' + msg); }
  else { falhas++; registo.push('  ERRO ' + msg); }
}
function nota(msg) { registo.push('  ....  ' + msg); }
let avisos = 0;
function alerta(msg) { avisos++; registo.push('  AVISO ' + msg); }

/* ---------------- celulas / ranges ---------------- */
function escrever(folha, r, c, v) {
  while (folha._dados.length < r) folha._dados.push([]);
  const linha = folha._dados[r - 1];
  while (linha.length < c) linha.push('');
  linha[c - 1] = v;
}

/* Contador de leituras, para MEDIR: quantas celulas o backend vai buscar
   a folha. E o numero que traduz "a cache ahorra trabalho" — sem ele,
   dizer que ficou mais rapido e' so opiniao. */
let LEITURAS = 0;
let CONTAR_LEITURAS = false;
/* Atribuição por folha: sem ela só se sabe QUANTAS células foram lidas, não
   ONDE. Foi esta contagem que revelou que o dashboard não lê a PICAGENS
   inteira — e portanto que o risco de escala está noutra folha. */
let LEITURAS_POR_FOLHA = {};
function contarLeitura(n, nomeFolha) {
  if (!CONTAR_LEITURAS) return;
  LEITURAS += (n || 1);
  if (nomeFolha) LEITURAS_POR_FOLHA[nomeFolha] = (LEITURAS_POR_FOLHA[nomeFolha] || 0) + (n || 1);
}
function criarRange(folha, r, c, nr, nc) {
  if (r < 1 || c < 1 || nr < 1 || nc < 1 || (r + nr - 1) > folha.maxRows || (c + nc - 1) > folha.maxColumns) {
    throw new Error('The coordinates or dimensions of the range are invalid.');
  }
  const rng = {
    getValues: function () {
      contarLeitura(nr * nc, folha._nome);
      const out = [];
      for (let i = 0; i < nr; i++) {
        const linha = folha._dados[r - 1 + i] || [];
        const l = [];
        for (let j = 0; j < nc; j++) {
          const v = linha[c - 1 + j];
          l.push(v === undefined || v === null ? '' : v);
        }
        out.push(l);
      }
      return out;
    },
    setValue: function (v) { escrever(folha, r, c, v); return rng; },
    setValues: function (vals) {
      for (let i = 0; i < vals.length; i++) {
        for (let j = 0; j < vals[i].length; j++) escrever(folha, r + i, c + j, vals[i][j]);
      }
      return rng;
    },
    clearContent: function () {
      for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) escrever(folha, r + i, c + j, '');
      return rng;
    },
    setNumberFormat: function () { return rng; },
    setFontWeight: function () { return rng; },
    setBackground: function () { return rng; },
    getA1Notation: function () { return folha._nome + '!R' + r + 'C' + c; },
    getNumRows: function () { return nr; },
    getNumColumns: function () { return nc; },
    offset: function (dr, dc, nnr, nnc) {
      return criarRange(folha, r + dr, c + dc, nnr === undefined ? nr : nnr, nnc === undefined ? nc : nnc);
    },
    protect: function () {
      return {
        setDescription: function () { return this; },
        setWarningOnly: function () { return this; },
        getRange: function () { return { getA1Notation: function () { return folha._nome + '!R' + r + 'C' + c; } }; }
      };
    }
  };
  return rng;
}

function criarFolha(nome) {
  const f = {
    _nome: nome,
    _dados: [],
    maxRows: 1000,
    maxColumns: 26,
    getName: function () { return f._nome; },
    getLastRow: function () {
      let ultima = 0;
      for (let i = 0; i < f._dados.length; i++) {
        const linha = f._dados[i] || [];
        if (linha.some(function (v) { return v !== undefined && v !== null && v !== ''; })) ultima = i + 1;
      }
      return ultima;
    },
    getLastColumn: function () {
      let ultima = 0;
      for (let i = 0; i < f._dados.length; i++) {
        const linha = f._dados[i] || [];
        for (let j = 0; j < linha.length; j++) {
          const v = linha[j];
          if (v !== undefined && v !== null && v !== '') ultima = Math.max(ultima, j + 1);
        }
      }
      return ultima;
    },
    getMaxRows: function () { return f.maxRows; },
    getMaxColumns: function () { return f.maxColumns; },
    getDataRange: function () {
      return criarRange(f, 1, 1, Math.max(f.getLastRow(), 1), Math.max(f.getLastColumn(), 1));
    },
    getRange: function (r, c, nr, nc) { return criarRange(f, r, c, nr || 1, nc || 1); },
    appendRow: function (vals) { f._dados.push(vals.slice()); },
    /* Ver _harness.js: sem deleteRows no mock, a poda de sessoes rebentava
       e o try/catch escondia — a suite passava sem a ter testado. */
    deleteRows: function (pos, quantas) { f._dados.splice(pos - 1, quantas || 0); },
    insertColumnsAfter: function (depois, quantas) { f.maxColumns += quantas; },
    insertRowsAfter: function (depois, quantas) { f.maxRows += quantas; },
    setFrozenRows: function () {},
    autoResizeColumns: function () {},
    getProtections: function () { return []; }
  };
  return f;
}

/* ---------------- spreadsheet ---------------- */
const FOLHAS = [];
const PLANILHAS_EXPORTADAS = [];

/* Modo standalone. É o que a Google documenta para um projeto importado
   por ZIP: "only standalone scripts can be imported". Nele
   getActiveSpreadsheet() devolve SEMPRE null, porque não há nenhuma Sheet
   ligada ao projeto. Sem este modo o simulador nunca reproduzia o arranque
   de uma instalação nova — que era precisamente o caso que falhava. */
let MODO_STANDALONE = false;
let SEQUENCIA_SS = 0;

const SS = {
  getId: function () { return 'SS_SIMULADA'; },
  getUrl: function () { return 'https://docs.google.com/spreadsheets/d/SS_SIMULADA/edit'; },
  getSheetByName: function (n) {
    for (let i = 0; i < FOLHAS.length; i++) if (FOLHAS[i]._nome === n) return FOLHAS[i];
    return null;
  },
  insertSheet: function (n) { const f = criarFolha(n); FOLHAS.push(f); return f; },
  getSheets: function () { return FOLHAS.slice(); },
  setSpreadsheetTimeZone: function () {},
  getSpreadsheetTimeZone: function () { return 'Europe/Lisbon'; }
};

/* ---------------- servicos Google ---------------- */
const PROPS = {};
const SpreadsheetApp = {
  getActiveSpreadsheet: function () { return MODO_STANDALONE ? null : SS; },
  getActive: function () { return SS; },
  openById: function (id) {
    const alvo = String(id);
    for (let i = PLANILHAS_EXPORTADAS.length - 1; i >= 0; i--) {
      if (PLANILHAS_EXPORTADAS[i].ss.getId() === alvo) return PLANILHAS_EXPORTADAS[i].ss;
    }
    if (alvo === 'SS_SIMULADA') return SS;
    throw new Error('Documento não encontrado: ' + alvo);
  },
  create: function (nome) {
    const folhas = [criarFolha('Sheet1')];
    const id = 'SS_NOVA_' + (++SEQUENCIA_SS);
    const novo = {
      _nome: nome,
      getId: function () { return id; },
      getUrl: function () { return 'https://docs.google.com/spreadsheets/d/' + id + '/edit'; },
      getSheetByName: function (n) {
        for (let i = 0; i < folhas.length; i++) if (folhas[i]._nome === n) return folhas[i];
        return null;
      },
      insertSheet: function (n) { const f = criarFolha(n); folhas.push(f); return f; },
      getSheets: function () { return folhas.slice(); },
      setSpreadsheetTimeZone: function () {},
      getSpreadsheetTimeZone: function () { return 'Europe/Lisbon'; }
    };
    PLANILHAS_EXPORTADAS.push({ nome: nome, folha: folhas[0], folhas: folhas, ss: novo });
    return novo;
  },
  flush: function () {},
  ProtectionType: { RANGE: 'RANGE', SHEET: 'SHEET' }
};

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

const Utilities = {
  getUuid: uuid,
  computeDigest: function () { return [1, 2, 3, 4]; },
  base64Encode: function () { return 'QjY0'; },
  base64EncodeWebSafe: function () { return 'QjY0Vw'; },
  formatDate: function (d, tz, fmt) {
    const p2 = function (n) { return ('0' + n).slice(-2); };
    if (String(fmt).indexOf('yyyy') === 0) {
      return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    }
    return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear();
  },
  sleep: function () {},
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  Charset: { UTF_8: 'UTF_8' }
};

/* O contrato REAL do Google (o mesmo que _harness.js usa em LOCK_REAL):
   waitLock devolve TRUE se consegue a lock e FALSE se nao conseguiu dentro do
   prazo; releaseLock liberta.

   Antes devolvia `undefined` e nao libertava nada. A versao endurecida de
   adquirirLock_ passou a LER o retorno (e a falhar com "sistema ocupado" em
   vez de escrever sem serializacao), e um mock que devolve `undefined` faz
   essa leitura falhar sempre: TODOS os cenarios comecavam a dar erro na
   primeira operacao com lock. O mock mentia sobre a API que fingia medir. */
const LOCKS_SIM = { script: false };
const LockService = {
  getScriptLock: function () {
    return {
      waitLock: function () { if (!LOCKS_SIM.script) { LOCKS_SIM.script = true; return true; } return false; },
      tryLock: function () { if (LOCKS_SIM.script) return null; LOCKS_SIM.script = true; return { releaseLock: function () { LOCKS_SIM.script = false; } }; },
      releaseLock: function () { LOCKS_SIM.script = false; }
    };
  }
};

const PropertiesService = {
  getScriptProperties: function () {
    return {
      getProperty: function (k) { return PROPS[k] === undefined ? null : PROPS[k]; },
      setProperty: function (k, v) { PROPS[k] = v; return this; },
      deleteProperty: function (k) { delete PROPS[k]; return this; }
    };
  }
};

const TRIGGERS = [];
const ScriptApp = {
  newTrigger: function (nome) {
    /* `getHandlerFunction()` e' o metodo REAL do trigger do Apps Script, e e'
       o que `garantirTriggerManutencao_()` usa para saber se o trigger ja
       existe. O mock so tinha `_nome`: a chamada rebentava com TypeError
       e caia no catch, que devolvia "nao criado" sem dar conta. */
    const t = { _nome: nome, _quando: '', getHandlerFunction: function () { return nome; } };
    const api = {
      timeBased: function () { return api; },
      everyDays: function (n) { t._quando = 'a cada ' + n + ' dia(s)'; return api; },
      atHour: function (h) { t._quando += ' as ' + h + ':00'; return api; },
      create: function () { TRIGGERS.push(t); return t; }
    };
    return api;
  },
  getProjectTriggers: function () { return TRIGGERS.slice(); },
  deleteTrigger: function () {}
};

const HtmlService = {
  createHtmlOutput: function (html) {
    return { _html: html, setTitle: function () { return this; }, addMetaTag: function () { return this; }, setXFrameOptionsMode: function () { return this; } };
  },
  createTemplateFromFile: function (nome) {
    if (nome !== 'Index' && nome !== 'index') throw new Error('Ficheiro ' + nome + ' nao encontrado.');
    return {
      evaluate: function () {
        return { setTitle: function () { return this; }, addMetaTag: function () { return this; }, setXFrameOptionsMode: function () { return this; } };
      }
    };
  },
  XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' }
};

/* ---------------- carregar os 13 ficheiros num so contexto ----------------
   (equivale ao ambito global partilhado do Apps Script; se houvesse
   constantes duplicadas, o carregamento falhava — como no Apps Script)   */
const FICHEIROS = fs.readdirSync(dir).filter(function (f) { return f.endsWith('.gs'); });
const codigo = FICHEIROS.map(function (f) {
  return '\n/* ===== ' + f + ' ===== */\n' + fs.readFileSync(path.join(dir, f), 'utf8');
}).join('\n');

/* ---------------- controlo do "agora" (para simular horarios) ---------------- */
const DateReal = Date;
let AGORA_FALSA = null;
class DateFalsa extends DateReal {
  constructor(...args) {
    if (args.length === 0 && AGORA_FALSA) super(AGORA_FALSA.getTime());
    else super(...args);
  }
}
DateFalsa.now = function () { return AGORA_FALSA ? AGORA_FALSA.getTime() : DateReal.now(); };
DateFalsa.parse = DateReal.parse;
DateFalsa.UTC = DateReal.UTC;
function fixarAgora(ano, mes, dia, h, m) { AGORA_FALSA = new DateReal(ano, mes - 1, dia, h, m, 0, 0); }

/* ---------------- sessao (conta Google que executa o script) ----------------
   No editor, Session.getActiveUser() e a conta de quem executa (o admin).
   Nos pedidos do web app e a conta de quem visita — que pode ser anonima. */
let EMAIL_ATIVO = 'pedromds84@gmail.com';
const Session = {
  getActiveUser: function () { return { getEmail: function () { return EMAIL_ATIVO; } }; },
  getEffectiveUser: function () { return { getEmail: function () { return 'deployer@exemplo.com'; } }; }
};

const sandbox = {
  SpreadsheetApp: SpreadsheetApp,
  Utilities: Utilities,
  LockService: LockService,
  PropertiesService: PropertiesService,
  ScriptApp: ScriptApp,
  HtmlService: HtmlService,
  Session: Session,
  Date: DateFalsa, Object: Object, Array: Array, Math: Math, JSON: JSON,
  Number: Number, String: String, Boolean: Boolean, RegExp: RegExp,
  Error: Error, TypeError: TypeError, RangeError: RangeError,
  isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat, console: console
};
const ctxInicial = vm.createContext(Object.assign({}, sandbox));

/**
 * Em Apps Script o ambito global e recriado a cada execucao, pelo que o cache
 * de folhas (CACHE_FOLHAS_) nasce vazio em cada chamada do frontend.
 * Aqui replicamos isso: cada chamada = uma execucao nova (global novo).
 */
function novaExecucao() {
  const c = vm.createContext(Object.assign({}, sandbox));
  vm.runInContext(codigo, c, { filename: 'backend-concatenado.gs' });
  return c;
}

titulo('CARREGAMENTO DO BACKEND');
try {
  novaExecucao();
  assinalar(true, FICHEIROS.length + ' ficheiros carregados num ambito global unico');
} catch (e) {
  assinalar(false, 'falha ao carregar o backend: ' + e.message);
  console.log(registo.join('\n'));
  process.exit(1);
}

/* ---------------- utilitarios de simulacao ---------------- */
function call(nome) {
  const args = Array.prototype.slice.call(arguments, 1);
  const c = novaExecucao();
  const fn = c[nome];
  if (typeof fn !== 'function') throw new Error('funcao ' + nome + ' nao exposta no contexto');
  return fn.apply(null, args);
}
function tentar(nome) {
  const args = Array.prototype.slice.call(arguments, 1);
  try { return { ok: true, valor: call.apply(null, [nome].concat(args)) }; }
  catch (e) { return { ok: false, erro: e.message }; }
}
function indiceColuna(nomeFolha, nomeColuna) {
  const f = SS.getSheetByName(nomeFolha);
  if (!f || f.getLastColumn() === 0) return -1;
  const cab = f.getRange(1, 1, 1, f.getLastColumn()).getValues()[0];
  return cab.indexOf(nomeColuna);
}
function lerCelula(nomeFolha, id, colunaId, colunaAlvo) {
  const f = SS.getSheetByName(nomeFolha);
  const iId = indiceColuna(nomeFolha, colunaId);
  const iAlvo = indiceColuna(nomeFolha, colunaAlvo);
  if (iId < 0 || iAlvo < 0) return undefined;
  const linhas = f.getRange(1, 1, Math.max(f.getLastRow(), 1), f.getLastColumn()).getValues();
  for (let i = 1; i < linhas.length; i++) {
    if (String(linhas[i][iId]) === String(id)) return linhas[i][iAlvo];
  }
  return undefined;
}

/* ================= CENARIO 1: instalacao ================= */
titulo('CENARIO 1 — setupSistema() e instalarSistemaComCredenciais()');
const rSetup = tentar('setupSistema', { arranque: true });
assinalar(rSetup.ok, 'setupSistema() executou' + (rSetup.ok ? '' : ' :: ' + rSetup.erro));
if (rSetup.ok && rSetup.valor) {
  const faltam = Object.keys(rSetup.valor.folhas || {}).filter(function (k) { return !rSetup.valor.folhas[k]; });
  assinalar(faltam.length === 0, 'todas as folhas criadas (' + Object.keys(rSetup.valor.folhas).length + ')' + (faltam.length ? ' faltam: ' + faltam.join(',') : ''));
}
assinalar(SS.getSheetByName('UTILIZADORES') !== null, 'folha UTILIZADORES existe');

/* A INSTALACAO TEM DE DEIXAR O TRIGGER DIARIO CRIADO.
   `instalarTriggers()` nao era chamado por lado nenhum do codigo de
   producao: o trigger das 3h nunca chegava a ser criado numa instalacao
   normal, e com ele caia a expiracao em lote e a poda que dao tecto a
   folha SESSOES. Aqui nao se chama `instalarTriggers` de proposito — o
   teste tem de passar SO com o que a instalacao faz sozinha. */
const apanhouTrigger = TRIGGERS.filter(function (t) { return t.getHandlerFunction() === 'manutencaoDiaria'; });
assinalar(apanhouTrigger.length === 1,
  'a instalacao deixou 1 trigger de manutencao diaria, sem chamar instalarTriggers :: ' + apanhouTrigger.length);
assinalar(rSetup.ok && rSetup.valor && !!rSetup.valor.triggerManutencao,
  'o diagnostico da instalacao diz o que aconteceu ao trigger :: ' +
  (rSetup.ok && rSetup.valor ? JSON.stringify(rSetup.valor.triggerManutencao) : 'sem valor'));
assinalar((function () {
  const antes = TRIGGERS.length;
  tentar('setupSistema', { arranque: true });
  return TRIGGERS.length === antes;
})(), 'reinstalar NAO duplica o trigger (idempotente) :: ' + TRIGGERS.length);

const rInst = tentar('instalarSistemaComCredenciais');
assinalar(rInst.ok && rInst.valor && rInst.valor.credenciaisAplicadas === 4,
  'credenciais aplicadas: ' + (rInst.ok && rInst.valor ? rInst.valor.credenciaisAplicadas : 'erro ' + rInst.erro));

const EMAILS = [
  ['USR_PEDRO_SILVA', 'pedromds84@gmail.com', 'pedromds84'],
  ['USR_HUGO_SILVA', 'hugofds@outlook.com', '6y6na6cu'],
  ['USR_CELINA_RELVA', 'celinarelva@gmail.com', 'celinarelva'],
  ['USR_RITA_REIS', 'aror.arita8@hotmail.com', 'ritareis']
];
let okCred = true, detalheCred = [];
EMAILS.forEach(function (e) {
  const email = lerCelula('UTILIZADORES', e[0], 'ID', 'Email');
  const pass = lerCelula('UTILIZADORES', e[0], 'ID', 'Password');
  if (String(email) !== e[1]) { okCred = false; detalheCred.push(e[0] + ' email=' + email); }
  if (String(pass) !== e[2]) { okCred = false; detalheCred.push(e[0] + ' password=' + pass); }
});
assinalar(okCred, 'folha UTILIZADORES com Email e Password corretos para os 4' + (okCred ? '' : ' :: ' + detalheCred.join('; ')));
assinalar(indiceColuna('UTILIZADORES', 'PasswordHash') === -1, 'coluna PasswordHash nao existe (sistema antigo removido)');


/* ================= CENARIO 2: login ================= */
titulo('CENARIO 2 — login (sucesso, erros e bloqueio)');

const rLoginOk = tentar('autenticarUtilizador', 'pedromds84@gmail.com', 'pedromds84');
const tokenPedro = (rLoginOk.ok && rLoginOk.valor) ? rLoginOk.valor.token : null;
assinalar(rLoginOk.ok && rLoginOk.valor && rLoginOk.valor.sucesso === true, 'login do Pedro com sucesso');
assinalar(!!tokenPedro, 'token de sessao devolvido' + (tokenPedro ? ' (' + String(tokenPedro).substring(0, 12) + '...)' : ''));
if (rLoginOk.ok && rLoginOk.valor) {
  assinalar(rLoginOk.valor.utilizador && rLoginOk.valor.utilizador.perfil === 'ADMIN',
    'perfil devolvido: ' + (rLoginOk.valor.utilizador ? rLoginOk.valor.utilizador.perfil : '?'));
  assinalar(rLoginOk.valor.passwordAlteracaoPendente === false, 'nao exige alteracao de password no primeiro login');
}

const rMailErrado = tentar('autenticarUtilizador', 'pedromds84@gmail.com', 'errada');
assinalar(!rMailErrado.ok && /Credenciais inv/.test(rMailErrado.erro), 'password errada recusada :: ' + (rMailErrado.erro || 'entrou!'));
assinalar(Number(lerCelula('UTILIZADORES', 'USR_PEDRO_SILVA', 'ID', 'TentativasFalhadas')) === 1,
  'tentativas falhadas registadas: ' + lerCelula('UTILIZADORES', 'USR_PEDRO_SILVA', 'ID', 'TentativasFalhadas'));

const rEmailInexistente = tentar('autenticarUtilizador', 'naoexiste@exemplo.pt', 'x');
assinalar(!rEmailInexistente.ok, 'email desconhecido recusado :: ' + (rEmailInexistente.erro || 'entrou!'));

const rMinusculas = tentar('autenticarUtilizador', 'PEDROMDS84@GMAIL.COM', 'pedromds84');
assinalar(rMinusculas.ok, 'email em maiusculas aceite (normalizacao)');
const rEspacos = tentar('autenticarUtilizador', '  pedromds84@gmail.com  ', 'pedromds84');
assinalar(rEspacos.ok, 'email com espacos aceite (trim)');
const rPassEspacos = tentar('autenticarUtilizador', 'pedromds84@gmail.com', ' pedromds84 ');
assinalar(rPassEspacos.ok, 'password com espacos acidental entra (trim) :: ' + (rPassEspacos.ok ? 'ok' : rPassEspacos.erro));
const rPassMaiusculas = tentar('autenticarUtilizador', 'pedromds84@gmail.com', 'PEDROMDS84');
assinalar(rPassMaiusculas.ok, 'password em maiusculas entra (Caps Lock) :: ' + (rPassMaiusculas.ok ? 'ok' : rPassMaiusculas.erro));

/* O limite vem da CONFIG, nunca de um numero escrito aqui: quando a
   politica mudar, este teste acompanha em vez de falhar por estar velho. */
const MAX_CEN2 = vm.runInContext('APP.SEGURANCA.MAX_TENTATIVAS_LOGIN', novaExecucao());
let bloqueou = false;
for (let i = 0; i <= MAX_CEN2; i++) {
  const r = tentar('autenticarUtilizador', 'aror.arita8@hotmail.com', 'errada');
  if (!r.ok && /bloquead[ao]/i.test(r.erro)) bloqueou = true;
}
assinalar(bloqueou, 'bloqueio temporario apos ' + MAX_CEN2 + ' tentativas falhadas');
const rRitaBloqueada = tentar('autenticarUtilizador', 'aror.arita8@hotmail.com', 'ritareis');
assinalar(!rRitaBloqueada.ok && /bloquead[ao]/i.test(rRitaBloqueada.erro),
  'login correto tambem bloqueado durante o bloqueio :: ' + (rRitaBloqueada.erro || 'entrou!'));
/* A mensagem de bloqueio tem de mandar para o DESBLOQUEIO, nao para a
   reposicao da password: repor a password obriga a mudar a credencial
   simples que a empresa escolheu. */
const rAvisoBloq = tentar('autenticarUtilizador', 'aror.arita8@hotmail.com', 'errada');
assinalar(!rAvisoBloq.ok && /desbloquear/i.test(String(rAvisoBloq.erro || '')),
  'a mensagem de bloqueio manda desbloquear, nao repor a password :: ' + (rAvisoBloq.erro || 'sem guia!'));
const rAviso = tentar('autenticarUtilizador', 'celinarelva@gmail.com', 'errada');
assinalar(!rAviso.ok && /tentativa\(s\) antes do bloqueio/i.test(rAviso.erro),
  'o erro avisa quantas tentativas faltam :: ' + (rAviso.erro || 'sem aviso!'));

/* Regressao do ciclo: a Rita esta bloqueada com a password CORRETA. O gestor
   repõe a password; se o bloqueio nao for limpo, ela continua bloqueada e o
   gestor tem de repetir a operacao sem resultado. Tem de entrar de seguida. */
if (tokenPedro) {
  const rDesbloquear = tentar('reporPasswordUtilizador', tokenPedro, 'USR_RITA_REIS', 'ritareis', false);
  assinalar(rDesbloquear.ok, 'gestor repõe a password da conta bloqueada :: ' + (rDesbloquear.ok ? 'ok' : rDesbloquear.erro));
  const rEntraDepois = tentar('autenticarUtilizador', 'aror.arita8@hotmail.com', 'ritareis');
  assinalar(rEntraDepois.ok, 'a conta bloqueada entra logo com a password reposta (sem ciclo) :: ' + (rEntraDepois.ok ? 'ok' : rEntraDepois.erro));
  assinalar(Number(lerCelula('UTILIZADORES', 'USR_RITA_REIS', 'ID', 'TentativasFalhadas')) === 0,
    'as tentativas falhadas foram limpas ao repor a password :: ' + lerCelula('UTILIZADORES', 'USR_RITA_REIS', 'ID', 'TentativasFalhadas'));
} else {
  assinalar(false, 'sem sessao de admin para testar o desbloqueio ao repor a password');
}

/* ================= CENARIO 3: dia normal de trabalho ================= */
titulo('CENARIO 3 — picagens de um dia normal (10h-13h / 14h30-19h)');

let DIA = new DateReal(2026, 8, 16, 12, 0, 0);
while (DIA.getDay() === 0 || DIA.getDay() === 6) DIA.setDate(DIA.getDate() + 1);
nota('dia de teste: ' + DIA.getFullYear() + '-' + ('0' + (DIA.getMonth() + 1)).slice(-2) + '-' + ('0' + DIA.getDate()).slice(-2) + ' (dia da semana ' + DIA.getDay() + ')');

function limparFolha(nome) {
  const f = SS.getSheetByName(nome);
  if (f) f._dados = f._dados.slice(0, 1);
}
function picar(token, tipo, h, m) {
  fixarAgora(DIA.getFullYear(), DIA.getMonth() + 1, DIA.getDate(), h, m);
  return tentar('registarPicagem', token, tipo, {});
}

limparFolha('PICAGENS');
call('limparCacheFolhas_');

const rEntrada = picar(tokenPedro, 'ENTRADA_MANHA', 10, 0);
assinalar(rEntrada.ok, 'ENTRADA_MANHA as 10:00 :: ' + (rEntrada.ok ? 'ok' : rEntrada.erro));

const rDuplicada = picar(tokenPedro, 'ENTRADA_MANHA', 10, 5);
assinalar(!rDuplicada.ok, 'picagem repetida recusada :: ' + (rDuplicada.erro || 'aceite!'));

const rTipoMau = picar(tokenPedro, 'ENTRADA_NOITE', 10, 10);
assinalar(!rTipoMau.ok, 'tipo de picagem invalido recusado :: ' + (rTipoMau.erro || 'aceite!'));

const rSemSessao = tentar('registarPicagem', 'token-falso', 'SAIDA_MANHA', {});
assinalar(!rSemSessao.ok, 'picagem sem sessao valida recusada :: ' + (rSemSessao.erro || 'aceite!'));

picar(tokenPedro, 'SAIDA_MANHA', 13, 0);
picar(tokenPedro, 'ENTRADA_TARDE', 14, 30);
const rSaidaTarde = picar(tokenPedro, 'SAIDA_TARDE', 19, 0);
assinalar(rSaidaTarde.ok, 'dia completo com 4 picagens');

const rQuinta = picar(tokenPedro, 'ENTRADA_MANHA', 19, 5);
assinalar(!rQuinta.ok, '5.a picagem recusada :: ' + (rQuinta.erro || 'aceite!'));
fixarAgora(DIA.getFullYear(), DIA.getMonth() + 1, DIA.getDate(), 19, 10);

call('limparCacheFolhas_');
const rDia = tentar('calcularMeuDia', tokenPedro, DIA);
if (rDia.ok && rDia.valor) {
  const d = rDia.valor;
  assinalar(d.minutosNormais === 450, 'minutos normais = ' + d.minutosNormais + ' (esperado 450 = 7h30)');
  assinalar(d.minutosExtra === 0, 'minutos extra = ' + d.minutosExtra + ' (esperado 0)');
  assinalar(String(d.horasNormais) === '07:30', 'horasNormais = ' + d.horasNormais + ' (esperado 07:30)');
  assinalar(d.picagens && d.picagens.length === 4, 'picagens no dia: ' + (d.picagens ? d.picagens.length : '?'));
  nota('estado do dia: ' + d.estado + ' | tipoDia: ' + d.tipoDia + ' | extra: ' + d.horasExtra);
} else {
  assinalar(false, 'calcularMeuDia falhou :: ' + rDia.erro);
}

/* ================= CENARIO 4: saida tardia gera extra ================= */
titulo('CENARIO 4 — saida as 20:00 deve gerar 60 min de extra');

limparFolha('PICAGENS');
call('limparCacheFolhas_');
picar(tokenPedro, 'ENTRADA_MANHA', 10, 0);
picar(tokenPedro, 'SAIDA_MANHA', 13, 0);
picar(tokenPedro, 'ENTRADA_TARDE', 14, 30);
picar(tokenPedro, 'SAIDA_TARDE', 20, 0);
fixarAgora(DIA.getFullYear(), DIA.getMonth() + 1, DIA.getDate(), 20, 5);

call('limparCacheFolhas_');
const rExtra = tentar('calcularMeuDia', tokenPedro, DIA);
if (rExtra.ok && rExtra.valor) {
  assinalar(rExtra.valor.minutosNormais === 450, 'minutos normais mantidos: ' + rExtra.valor.minutosNormais);
  assinalar(rExtra.valor.minutosExtra === 60, 'minutos extra = ' + rExtra.valor.minutosExtra + ' (esperado 60)');
} else {
  assinalar(false, 'calcularMeuDia falhou :: ' + rExtra.erro);
}

/* ================= CENARIO 5: domingo so gera extra ================= */
titulo('CENARIO 5 — domingo (sem horario normal)');

let DOM = new DateReal(2026, 8, 16, 12, 0, 0);
while (DOM.getDay() !== 0) DOM.setDate(DOM.getDate() + 1);
limparFolha('PICAGENS');
call('limparCacheFolhas_');
fixarAgora(DOM.getFullYear(), DOM.getMonth() + 1, DOM.getDate(), 10, 0);
tentar('registarPicagem', tokenPedro, 'ENTRADA_MANHA', {});
fixarAgora(DOM.getFullYear(), DOM.getMonth() + 1, DOM.getDate(), 13, 0);
tentar('registarPicagem', tokenPedro, 'SAIDA_MANHA', {});
fixarAgora(DOM.getFullYear(), DOM.getMonth() + 1, DOM.getDate(), 13, 5);

call('limparCacheFolhas_');
const rDom = tentar('calcularMeuDia', tokenPedro, DOM);
if (rDom.ok && rDom.valor) {
  assinalar(rDom.valor.minutosNormais === 0, 'domingo: minutos normais = ' + rDom.valor.minutosNormais + ' (esperado 0)');
  assinalar(rDom.valor.minutosExtra === 180, 'domingo: minutos extra = ' + rDom.valor.minutosExtra + ' (esperado 180)');
  nota('tipoDia domingo: ' + rDom.valor.tipoDia);
} else {
  assinalar(false, 'calcularMeuDia (domingo) falhou :: ' + rDom.erro);
}

/* ================= CENARIO 6: perfis, painel e permissoes ================= */
titulo('CENARIO 6 — painel administrativo e permissoes');

const rHugo = tentar('autenticarUtilizador', 'hugofds@outlook.com', '6y6na6cu');
const tokenHugo = (rHugo.ok && rHugo.valor) ? rHugo.valor.token : null;
assinalar(!!tokenHugo, 'login do Hugo (ADMIN)');

const rCelina = tentar('autenticarUtilizador', 'celinarelva@gmail.com', 'celinarelva');
const tokenCelina = (rCelina.ok && rCelina.valor) ? rCelina.valor.token : null;
assinalar(!!tokenCelina, 'login da Celina (COLABORADOR)');

if (tokenHugo) {
  const rDash = tentar('obterDashboardAdministrativo', tokenHugo, DIA);
  if (rDash.ok && rDash.valor) {
    assinalar(Array.isArray(rDash.valor.painel), 'dashboard: painel com ' + rDash.valor.painel.length + ' utilizadores');
    assinalar(!!rDash.valor.resumo, 'dashboard: resumo presente');
    assinalar(!!rDash.valor.pendentes, 'dashboard: pendentes ' + JSON.stringify(rDash.valor.pendentes));
  } else {
    assinalar(false, 'obterDashboardAdministrativo falhou :: ' + rDash.erro);
  }

/* Regressao de desempenho: o dashboard NAO pode calcular o dia de cada
   utilizador duas vezes (uma para o painel, outra para o resumo).
   Cada `call` cria um contexto novo, por isso aqui usamos UM contexto
   proprio e interceptamos calcularDia dentro dele. */
if (tokenHugo) {
  const cPerf = novaExecucao();
  const calcularDiaOriginal = cPerf.calcularDia_;
  let nCalculos = 0;
  cPerf.calcularDia_ = function () { nCalculos++; return calcularDiaOriginal.apply(this, arguments); };
  let painelLen = -1;
  let erroPerf = '';
  try {
    const rPerf = cPerf.obterDashboardAdministrativo(tokenHugo, DIA);
    painelLen = (rPerf && rPerf.painel ? rPerf.painel.length : 0);
  } catch (e) { erroPerf = e.message; }
  assinalar(painelLen > 0 && nCalculos === painelLen && !erroPerf,
    'dashboard: 1 calculo por utilizador (' + nCalculos + ' calculos para ' + painelLen + ' utilizadores)' + (erroPerf ? ' :: ' + erroPerf : ''));
}

  const rAud = tentar('consultarAuditoria', tokenHugo, { limite: 20 });
  assinalar(rAud.ok && rAud.valor && rAud.valor.registos.length > 0,
    'auditoria com ' + (rAud.ok && rAud.valor ? rAud.valor.registos.length : '0') + ' registos');

  const rPend = tentar('obterPendentesAdministrativos', tokenHugo);
  assinalar(rPend.ok, 'obterPendentesAdministrativos respondeu');

  const rSess = tentar('listarSessoes', tokenHugo, {});
  assinalar(rSess.ok && rSess.valor.sessoes.length >= 3, 'sessoes ativas visiveis: ' + (rSess.ok && rSess.valor ? rSess.valor.sessoes.length : '?'));
}

if (tokenCelina) {
  const rNegado = tentar('listarUtilizadores', tokenCelina, {});
  assinalar(!rNegado.ok && /administradores/i.test(rNegado.erro), 'colaborador NAO pode listar utilizadores :: ' + (rNegado.erro || 'conseguiu!'));
  const rNegado2 = tentar('consultarAuditoria', tokenCelina, {});
  assinalar(!rNegado2.ok, 'colaborador NAO pode ver auditoria :: ' + (rNegado2.erro || 'conseguiu!'));
  const rMeuDia = tentar('calcularMeuDia', tokenCelina, DIA);
  assinalar(rMeuDia.ok, 'colaborador pode ver o proprio dia');
  const rOutroDia = tentar('obterResumoColaborador', tokenCelina, 'USR_PEDRO_SILVA', DIA);
  assinalar(!rOutroDia.ok, 'colaborador NAO pode ver o dia de outro :: ' + (rOutroDia.erro || 'conseguiu!'));
}

/* ================= CENARIO 7: configuracao, feriados e sabados ================= */
titulo('CENARIO 7 — configuracao, feriados e grupos de sabados');

const isoHoje = DIA.getFullYear() + '-' + ('0' + (DIA.getMonth() + 1)).slice(-2) + '-' + ('0' + DIA.getDate()).slice(-2);
const DATA_FERIADO = new DateReal(DIA.getFullYear(), DIA.getMonth(), DIA.getDate() + 1, 12, 0, 0);
const isoFer = DATA_FERIADO.getFullYear() + '-' + ('0' + (DATA_FERIADO.getMonth() + 1)).slice(-2) + '-' + ('0' + DATA_FERIADO.getDate()).slice(-2);

if (tokenHugo) {
  const rCfgSet = tentar('definirConfig', tokenHugo, 'TOLERANCIA_MINUTOS', 5);
  assinalar(rCfgSet.ok, 'definirConfig(TOLERANCIA_MINUTOS, 5) :: ' + (rCfgSet.ok ? 'ok' : rCfgSet.erro));
  const rCfgList = tentar('listarConfig', tokenHugo);
  assinalar(rCfgList.ok && !!rCfgList.valor, 'listarConfig devolveu configuracao');

  const rFer = tentar('criarFeriado', tokenHugo, { data: isoFer, descricao: 'Feriado de teste' });
  assinalar(rFer.ok, 'criarFeriado(' + isoFer + ') :: ' + (rFer.ok ? 'ok' : rFer.erro));
  const rFerDup = tentar('criarFeriado', tokenHugo, { data: isoFer, descricao: 'outro' });
  assinalar(!rFerDup.ok, 'feriado repetido recusado :: ' + (rFerDup.erro || 'aceite!'));
  const rFerSemDesc = tentar('criarFeriado', tokenHugo, { data: isoFer });
  assinalar(!rFerSemDesc.ok, 'feriado sem descricao recusado :: ' + (rFerSemDesc.erro || 'aceite!'));
  const rFerList = tentar('listarFeriados', tokenHugo, {});
  assinalar(rFerList.ok && rFerList.valor.total === 1, 'listarFeriados: ' + (rFerList.ok && rFerList.valor ? rFerList.valor.total : '?'));

  const rGrp = tentar('criarGrupoSabado', tokenHugo, {
    grupoId: 'GRUPO_TESTE', ordem: ['USR_PEDRO_SILVA', 'USR_HUGO_SILVA'], dataInicio: isoFer
  });
  assinalar(rGrp.ok, 'criarGrupoSabado :: ' + (rGrp.ok ? 'ok' : rGrp.erro));
  const rGrpCurto = tentar('criarGrupoSabado', tokenHugo, { grupoId: 'XX', ordem: ['USR_PEDRO_SILVA', 'USR_HUGO_SILVA'], dataInicio: isoFer });
  assinalar(!rGrpCurto.ok, 'grupo com id curto recusado :: ' + (rGrpCurto.erro || 'aceite!'));
  const rGrpList = tentar('listarGruposSabado', tokenHugo);
  assinalar(rGrpList.ok && !!rGrpList.valor, 'listarGruposSabado respondeu');
  const rGrpEdit = tentar('editarGrupoSabado', tokenHugo, 'GRUPO_TESTE', { dataInicio: isoFer });
  assinalar(rGrpEdit.ok, 'editarGrupoSabado :: ' + (rGrpEdit.ok ? 'ok' : rGrpEdit.erro));
  const rRot = tentar('obterRotacaoSabadoParaData_', isoFer);
  assinalar(rRot.ok, 'leitura da rotacao de sabados para ' + isoFer + ' :: ' + (rRot.ok ? JSON.stringify(rRot.valor) : rRot.erro));

  /* ---- exportacao (Excel/Sheets) ---- */
  const rExp = tentar('exportarTabelaParaSheets', tokenHugo, {
    titulo: 'Relatorio teste', cabecalhos: ['Data', 'Nome'], linhas: [['2026-01-01', 'Pedro'], ['2026-01-02', 'Hugo']]
  });
  assinalar(rExp.ok && rExp.valor && rExp.valor.linhas === 2 && /^https:\/\//.test(String(rExp.valor.url || '')),
    'exportarTabelaParaSheets :: ' + (rExp.ok && rExp.valor ? (rExp.valor.linhas + ' linha(s), ' + rExp.valor.url) : rExp.erro));
  const rExpVazio = tentar('exportarTabelaParaSheets', tokenHugo, { cabecalhos: [], linhas: [] });
  assinalar(!rExpVazio.ok, 'exportacao sem colunas recusada :: ' + (rExpVazio.erro || 'aceite!'));
  const rExpSemSessao = tentar('exportarTabelaParaSheets', 'TOKEN_INVALIDO', { cabecalhos: ['A'], linhas: [['1']] });
  assinalar(!rExpSemSessao.ok, 'exportacao sem sessao valida recusada :: ' + (rExpSemSessao.erro || 'aceite!'));
}

/* ================= CENARIO 8: ausencias, justificacoes, correcoes e extras ================= */
titulo('CENARIO 8 — ausencias, justificacoes, correcoes e horas extra');

if (tokenHugo) {
  const rAus = tentar('criarAusencia', tokenHugo, {
    userId: 'USR_CELINA_RELVA', tipo: 'FERIAS', dataInicio: isoFer, dataFim: isoFer, motivo: 'ferias de teste'
  });
  assinalar(rAus.ok, 'criarAusencia (FERIAS) :: ' + (rAus.ok ? 'ok' : rAus.erro));
  const rAusMau = tentar('criarAusencia', tokenHugo, {
    userId: 'USR_CELINA_RELVA', tipo: 'INVALIDO', dataInicio: isoFer, dataFim: isoFer
  });
  assinalar(!rAusMau.ok, 'tipo de ausencia invalido recusado :: ' + (rAusMau.erro || 'aceite!'));
  const rAusOrdem = tentar('criarAusencia', tokenHugo, {
    userId: 'USR_CELINA_RELVA', tipo: 'FERIAS', dataInicio: isoFer, dataFim: new DateReal(2020, 0, 1)
  });
  assinalar(!rAusOrdem.ok, 'ausencia com fim antes do inicio recusada :: ' + (rAusOrdem.erro || 'aceite!'));
  const rAusList = tentar('listarAusencias', tokenHugo, {});
  assinalar(rAusList.ok && rAusList.valor.total === 1, 'listarAusencias: ' + (rAusList.ok && rAusList.valor ? rAusList.valor.total : '?'));

  /* ---- editarAusencia: dono edita, outro colaborador nao pode ---- */
  const idAus = (rAusList.ok && rAusList.valor && rAusList.valor.ausencias[0]) ? rAusList.valor.ausencias[0].id : '';
  if (idAus && tokenCelina) {
    const rEditPropria = tentar('editarAusencia', tokenCelina, idAus, { motivo: 'ferias alteradas pela propria' });
    assinalar(rEditPropria.ok, 'editarAusencia pela dona :: ' + (rEditPropria.ok ? 'ok' : rEditPropria.erro));

    const rAusPedro = tentar('criarAusencia', tokenPedro, {
      userId: 'USR_PEDRO_SILVA', tipo: 'FERIAS', dataInicio: isoFer, dataFim: isoFer, motivo: 'teste'
    });
    const idAusPedro = rAusPedro.ok && rAusPedro.valor ? rAusPedro.valor.id : '';
    if (idAusPedro) {
      const rEditAlheia = tentar('editarAusencia', tokenCelina, idAusPedro, { motivo: 'tentativa de alteracao alheia' });
      assinalar(!rEditAlheia.ok && /Sem autorização/.test(String(rEditAlheia.erro || '')),
        'editarAusencia de outro colaborador recusada :: ' + (rEditAlheia.erro || 'ACEITE!'));
    }

    /* sanitizacao: motivo "=1+1" grava-se como texto, nao como formula */
    const rEditFormula = tentar('editarAusencia', tokenCelina, idAus, { motivo: '=1+1' });
    const f = SS.getSheetByName('AUSENCIAS');
    const iMot = indiceColuna('AUSENCIAS', 'Motivo');
    const iID = indiceColuna('AUSENCIAS', 'ID');
    let guardado = '';
    for (let i = 1; i < f._dados.length; i++) {
      if (String(f._dados[i][iID]) === idAus) { guardado = String(f._dados[i][iMot]); break; }
    }
    assinalar(rEditFormula.ok && guardado === "'=1+1",
      'motivo "=1+1" guardado como texto literal :: ' + (rEditFormula.ok ? "'" + guardado + "'" : rEditFormula.erro));
  }
}

if (tokenCelina) {
  const rJust = tentar('criarJustificacao', tokenCelina, {
    data: isoHoje, tipo: 'JUSTIFICADA', descricao: 'consulta medica'
  });
  assinalar(rJust.ok, 'colaborador cria justificacao :: ' + (rJust.ok ? 'ok' : rJust.erro));
}
if (tokenHugo) {
  const rJustList = tentar('listarJustificacoes', tokenHugo, {});
  assinalar(rJustList.ok && rJustList.valor.total >= 1, 'admin ve justificacoes: ' + (rJustList.ok && rJustList.valor ? rJustList.valor.total : '?'));
}

/* dia com extra + correcao de picagem */
limparFolha('PICAGENS');
picar(tokenPedro, 'ENTRADA_MANHA', 10, 0);
picar(tokenPedro, 'SAIDA_MANHA', 13, 0);
picar(tokenPedro, 'ENTRADA_TARDE', 14, 30);
picar(tokenPedro, 'SAIDA_TARDE', 19, 0);
fixarAgora(DIA.getFullYear(), DIA.getMonth() + 1, DIA.getDate(), 19, 5);
call('limparCacheFolhas_');
tentar('calcularMeuDia', tokenPedro, DIA);

const picagensPedro = SS.getSheetByName('PICAGENS')._dados.slice(1);
const idPicagem = picagensPedro.length ? picagensPedro[picagensPedro.length - 1][0] : null;
nota('picagem a corrigir: ' + idPicagem);

if (tokenHugo && idPicagem) {
  const rCorr = tentar('criarCorrecaoPicagem', tokenHugo, {
    userId: 'USR_PEDRO_SILVA', data: isoHoje, picagemId: idPicagem,
    tipoCorrecao: 'ALTERAR_HORA', valorNovo: '20:00', motivo: 'esqueceu-se de picar a saida'
  });
  assinalar(rCorr.ok, 'criarCorrecaoPicagem :: ' + (rCorr.ok ? 'ok' : rCorr.erro));
  const rCorrInvalida = tentar('criarCorrecaoPicagem', tokenHugo, {
    userId: 'USR_PEDRO_SILVA', data: isoHoje, tipoCorrecao: 'INVALIDO', motivo: 'x'
  });
  assinalar(!rCorrInvalida.ok, 'tipo de correcao invalido recusado :: ' + (rCorrInvalida.erro || 'aceite!'));
  const rCorrSemMotivo = tentar('criarCorrecaoPicagem', tokenHugo, {
    userId: 'USR_PEDRO_SILVA', data: isoHoje, tipoCorrecao: 'ALTERAR_HORA'
  });
  assinalar(!rCorrSemMotivo.ok, 'correcao sem motivo recusada :: ' + (rCorrSemMotivo.erro || 'aceite!'));

  if (rCorr.ok && rCorr.valor) {
    const rAprova = tentar('aprovarCorrecao', tokenHugo, rCorr.valor.id);
    assinalar(rAprova.ok, 'aprovarCorrecao :: ' + (rAprova.ok ? 'ok' : rAprova.erro));
    const rAprova2 = tentar('aprovarCorrecao', tokenHugo, rCorr.valor.id);
    assinalar(!rAprova2.ok, 'correcao ja decidida recusada :: ' + (rAprova2.erro || 'aceite!'));
    const rListCorr = tentar('listarCorrecoes', tokenHugo, {});
    assinalar(rListCorr.ok, 'listarCorrecoes: ' + (rListCorr.ok && rListCorr.valor ? rListCorr.valor.total : '?'));
  }

  const rExtras = tentar('listarHorasExtra', tokenHugo, {});
  assinalar(rExtras.ok, 'listarHorasExtra respondeu: ' + (rExtras.ok && rExtras.valor ? rExtras.valor.total : '?') + ' registos');
  const rMinhasExtras = tentar('minhasHorasExtra', tokenPedro, {});
  assinalar(rMinhasExtras.ok, 'minhasHorasExtra respondeu');

  const rExc = tentar('listarExcecoes', tokenHugo, {});
  assinalar(rExc.ok, 'listarExcecoes respondeu: ' + (rExc.ok && rExc.valor ? rExc.valor.total : '?'));
}

/* ================= CENARIO 9: relatorios, resumos, backups e testes ================= */
titulo('CENARIO 9 — relatorios, resumos, backups e testes');

if (tokenHugo) {
  const provas = [
    ['consultaDiaria', [tokenHugo, DIA, {}]],
    ['consultaSemanal', [tokenHugo, DIA, {}]],
    ['consultaMensal', [tokenHugo, DIA.getFullYear() + '-' + ('0' + (DIA.getMonth() + 1)).slice(-2), {}]],
    ['relatorioGlobal', [tokenHugo, isoHoje, isoHoje, {}]],
    ['relatorioExtras', [tokenHugo, isoHoje, isoHoje, {}]],
    ['relatorioIntegridade', [tokenHugo, isoHoje, isoHoje, {}]],
    ['relatorioIndividual', [tokenHugo, 'USR_PEDRO_SILVA', isoHoje, isoHoje]],
    ['meuRelatorio', [tokenPedro, isoHoje, isoHoje]],
    ['minhaSemana', [tokenPedro, DIA]],
    ['meuMes', [tokenPedro, DIA.getFullYear() + '-' + ('0' + (DIA.getMonth() + 1)).slice(-2)]],
    ['minhasAusencias', [tokenPedro, {}]],
    ['consultarAuditoria', [tokenHugo, { limite: 5 }]]
  ];
  provas.forEach(function (p) {
    const r = tentar.apply(null, [p[0]].concat(p[1]));
    assinalar(r.ok, p[0] + ' :: ' + (r.ok ? 'ok' : r.erro));
  });

  const rResumos = tentar('gerarResumos', tokenHugo, { data: DIA });
  assinalar(rResumos.ok, 'gerarResumos :: ' + (rResumos.ok ? 'ok' : rResumos.erro));

  const rBkp = tentar('criarBackup', tokenHugo, 'backup de teste');
  assinalar(rBkp.ok, 'criarBackup :: ' + (rBkp.ok ? 'ok' : rBkp.erro));
  const rListBkp = tentar('listarBackups', tokenHugo, 5);
  assinalar(rListBkp.ok, 'listarBackups: ' + (rListBkp.ok && rListBkp.valor ? (rListBkp.valor.total || (rListBkp.valor.backups || []).length) : '?'));
  if (rListBkp.ok && rListBkp.valor && rListBkp.valor.backups && rListBkp.valor.backups.length) {
    const rDet = tentar('obterBackup', tokenHugo, rListBkp.valor.backups[0].id);
    assinalar(rDet.ok, 'obterBackup :: ' + (rDet.ok ? 'ok' : rDet.erro));
  }
}

const rTestes = tentar('executarTodosTestesCobertura', tokenHugo);
if (rTestes.ok && rTestes.valor) {
  const t = rTestes.valor;
  const falhados = (t.testes || []).filter(function (x) { return x.resultado === 'FALHOU'; });
  assinalar(t.sucesso === true && falhados.length === 0,
    'suite de testes do motor: ' + t.total + ' testes, ' + falhados.length + ' falhados');
  if (falhados.length) falhados.slice(0, 5).forEach(function (f) { nota('   FALHOU: ' + JSON.stringify(f)); });
} else {
  assinalar(false, 'executarTodosTestesCobertura falhou :: ' + rTestes.erro);
}

const rDiag = tentar('diagnosticoCompleto', tokenHugo);
if (rDiag.ok) {
  assinalar(rDiag.valor && rDiag.valor.sucesso !== false,
    'diagnosticoCompleto: ' + JSON.stringify(rDiag.valor).substring(0, 160));
} else {
  assinalar(false, 'diagnosticoCompleto falhou :: ' + rDiag.erro);
}

const rTesteCripto = tentar('testeCredenciaisSimples_');
/* A funcao `testeCredenciaisSimples_` foi removida: devolvia uma constante
   ({passwordsEmTexto:true}) sem tocar em nada, so para dizer o que ja se
   sabe. O que interessa provar e' que a password NAO e'Transformada — e isso
   verifica-se pelo caminho real: uma password escrita volta a ler-se igual. */
const rProbe = tentar('normalizarPassword_', '  Abc123  ');
assinalar(rProbe.ok && rProbe.valor === 'Abc123',
  'a password e' + ' guardada sem espacos nas pontas (so o utilitario): ' + JSON.stringify(rProbe.valor));

/* ================= CENARIO 10: sessoes, triggers e arranque ================= */
titulo('CENARIO 10 — logout, expiracao de sessao, triggers e doGet');

if (tokenCelina) {
  const rLogout = tentar('terminarSessao', tokenCelina);
  assinalar(rLogout.ok, 'terminarSessao :: ' + (rLogout.ok ? 'ok' : rLogout.erro));
  const rDepois = tentar('calcularMeuDia', tokenCelina, DIA);
  assinalar(!rDepois.ok && /terminada/i.test(rDepois.erro), 'token apos logout recusado :: ' + (rDepois.erro || 'aceite!'));
}

function linhaDeSessao(token) {
  const f = SS.getSheetByName('SESSOES');
  const iTok = indiceColuna('SESSOES', 'Token'), iExp = indiceColuna('SESSOES', 'ExpiraEm');
  for (let i = 1; i < f._dados.length; i++) {
    if (String(f._dados[i][iTok]) === String(token)) return { linha: i, colExpira: iExp };
  }
  return null;
}

const rLogin2 = tentar('autenticarUtilizador', 'pedromds84@gmail.com', 'pedromds84');
const tokenPedro2 = (rLogin2.ok && rLogin2.valor) ? rLogin2.valor.token : null;
const ref = tokenPedro2 ? linhaDeSessao(tokenPedro2) : null;
if (ref) {
  SS.getSheetByName('SESSOES')._dados[ref.linha][ref.colExpira] = new DateReal(2000, 0, 1);
  const rExp = tentar('calcularMeuDia', tokenPedro2, DIA);
  assinalar(!rExp.ok && /expirada/i.test(rExp.erro), 'sessao expirada recusada :: ' + (rExp.erro || 'aceite!'));
} else {
  assinalar(false, 'nao foi possivel localizar a linha da sessao para testar expiracao');
}

/* sessao expirada mas ainda nao usada -> limparSessoesExpiradas deve marca-la */
const rLogin3 = tentar('autenticarUtilizador', 'pedromds84@gmail.com', 'pedromds84');
const tokenPedro3 = (rLogin3.ok && rLogin3.valor) ? rLogin3.valor.token : null;
const ref3 = tokenPedro3 ? linhaDeSessao(tokenPedro3) : null;
if (ref3) SS.getSheetByName('SESSOES')._dados[ref3.linha][ref3.colExpira] = new DateReal(2000, 0, 1);
if (tokenHugo) {
  const rLimpa = tentar('limparSessoesExpiradas', tokenHugo);
  assinalar(rLimpa.ok && rLimpa.valor.marcadas >= 1,
    'limparSessoesExpiradas marcou ' + (rLimpa.ok ? rLimpa.valor.marcadas : '?') + ' sessao(oes) expiradas');
}

if (tokenHugo) {
  const rTrigger = tentar('instalarTriggers', tokenHugo);
  assinalar(rTrigger.ok, 'instalarTriggers :: ' + (rTrigger.ok ? 'ok' : rTrigger.erro));
  nota('triggers registados no simulador: ' + TRIGGERS.length);

  const rManut = tentar('manutencaoDiaria');
  assinalar(rManut.ok, 'manutencaoDiaria() correu :: ' + (rManut.ok ? 'ok' : rManut.erro));

  const rRita = tentar('reporPasswordUtilizador', tokenHugo, 'USR_RITA_REIS', 'nova123', false);
  assinalar(rRita.ok, 'reporPasswordUtilizador (Rita -> nova123) :: ' + (rRita.ok ? 'ok' : rRita.erro));
}

/* desbloquear a Rita e testar a nova password */
(function () {
  const f = SS.getSheetByName('UTILIZADORES');
  const iId = indiceColuna('UTILIZADORES', 'ID');
  const iTent = indiceColuna('UTILIZADORES', 'TentativasFalhadas');
  const iBloq = indiceColuna('UTILIZADORES', 'BloqueadoAte');
  for (let i = 1; i < f._dados.length; i++) {
    if (String(f._dados[i][iId]) === 'USR_RITA_REIS') { f._dados[i][iTent] = 0; f._dados[i][iBloq] = ''; }
  }
})();
const rLoginRita = tentar('autenticarUtilizador', 'aror.arita8@hotmail.com', 'nova123');
assinalar(rLoginRita.ok, 'login da Rita com a password reposta :: ' + (rLoginRita.ok ? 'ok' : rLoginRita.erro));

/* alterar a propria password (botao do Painel -> pass.alterar) */
const tokenRitaNova = rLoginRita.ok && rLoginRita.valor ? rLoginRita.valor.token : null;
if (tokenRitaNova) {
  const rPassErrada = tentar('alterarMinhaPassword', tokenRitaNova, 'errada', 'ritanova1');
  assinalar(!rPassErrada.ok, 'alterarMinhaPassword com atual errada recusada :: ' + (rPassErrada.erro || 'ACEITE!'));

  const rPassCurta = tentar('alterarMinhaPassword', tokenRitaNova, 'nova123', 'ab');
  assinalar(!rPassCurta.ok, 'alterarMinhaPassword com menos de 4 carateres recusada :: ' + (rPassCurta.erro || 'ACEITE!'));

  const rPassOk = tentar('alterarMinhaPassword', tokenRitaNova, 'nova123', 'ritanova1');
  assinalar(rPassOk.ok, 'alterarMinhaPassword (dono da conta) :: ' + (rPassOk.ok ? 'ok' : rPassOk.erro));

  const rLoginNovaPass = tentar('autenticarUtilizador', 'aror.arita8@hotmail.com', 'ritanova1');
  assinalar(rLoginNovaPass.ok, 'login com a password alterada :: ' + (rLoginNovaPass.ok ? 'ok' : rLoginNovaPass.erro));

  const rLoginVelha = tentar('autenticarUtilizador', 'aror.arita8@hotmail.com', 'nova123');
  assinalar(!rLoginVelha.ok, 'password antiga deixa de funcionar :: ' + (rLoginVelha.erro || 'ACEITE!'));

  /* reposicao pelo gestor marca alteracao pendente: nao exige a atual */
  const rResetPendente = tentar('reporPasswordUtilizador', tokenHugo, 'USR_RITA_REIS', 'ritatemp1', true);
  const rSemAtual = tentar('alterarMinhaPassword', tokenRitaNova, '', 'ritanova2');
  assinalar(rResetPendente.ok && rSemAtual.ok,
    'password reposta pelo gestor permite alterar sem indicar a atual :: ' + (rSemAtual.ok ? 'ok' : rSemAtual.erro));

  const rLoginFinal = tentar('autenticarUtilizador', 'aror.arita8@hotmail.com', 'ritanova2');
  assinalar(rLoginFinal.ok, 'login com a password final :: ' + (rLoginFinal.ok ? 'ok' : rLoginFinal.erro));
}

const rDoGet = tentar('doGet', {});
assinalar(rDoGet.ok, 'doGet() devolve a interface :: ' + (rDoGet.ok ? 'ok' : rDoGet.erro));

/* ================= CENARIO 11: sondagens de potenciais problemas ================= */
titulo('CENARIO 11 — potenciais problemas (sondagens)');

/* 11.1 persistencia de DIAS_TRABALHO / HORAS_EXTRA / EXCECOES

   Antes isto so funcionava se alguém chamasse `recalcularDiaAdmin` à mão.
   Agora a persistência acontece sozinha a cada picagem e a cada decisão que
   muda as horas. O teste abaixo faz um turno completo e prova que as três
   folhas se enchem sozinhas — sem tocar em nenhuma função de recálculo. */
if (tokenHugo) {
  tentar('recalcularDiaAdmin', tokenHugo, 'USR_PEDRO_SILVA', DIA);
  const nDias = (SS.getSheetByName('DIAS_TRABALHO')._dados.length || 1) - 1;
  const nExtra = (SS.getSheetByName('HORAS_EXTRA')._dados.length || 1) - 1;
  assinalar(nDias >= 1, 'recalcularDiaAdmin persistiu DIAS_TRABALHO (' + nDias + ' linha(s))');
  if (nExtra === 0) {
    nota('HORAS_EXTRA vazia: o extra de um dia normal so e persistido pelo recalculo explicito (recalcularMeuDia/recalcularDiaAdmin) ou por registo/aprovacao');
  } else {
    nota('HORAS_EXTRA com ' + nExtra + ' linha(s) apos recalcularDiaAdmin');
  }
}

/* 11.1b UMA PICAGEM PERSISTE O DIA SOZINHA (e fecha o que deixa de valer) */
(function () {
  const USUARIO = 'USR_CELINA_RELVA';
  /* Login novo: o token da Celina foi terminado no cenario 10 e nao pode
     picar. Nao se aproveita o de nenhum outro para nao depender da ordem. */
  const rLogin = tentar('autenticarUtilizador', 'celinarelva@gmail.com', 'celinarelva');
  const tok = (rLogin.ok && rLogin.valor) ? rLogin.valor.token : null;
  if (!tok) { assinalar(false, 'nao foi possivel entrar como a Celina para testar a persistencia'); return; }

  limparFolha('PICAGENS'); limparFolha('DIAS_TRABALHO'); limparFolha('EXCECOES');

  function linhasDe(nome, userId) {
    const f = SS.getSheetByName(nome), iU = indiceColuna(nome, 'UserID');
    return f._dados.slice(1).filter(function (l) { return String(l[iU]) === userId; }).length;
  }
  function pendentesDe(userId) {
    const f = SS.getSheetByName('EXCECOES');
    const iU = indiceColuna('EXCECOES', 'UserID'), iE = indiceColuna('EXCECOES', 'Estado');
    return f._dados.slice(1).filter(function (l) {
      return String(l[iU]) === userId && String(l[iE]) === 'PENDENTE';
    }).length;
  }
  const picar = function (h, m, tipo) {
    fixarAgora(DIA.getFullYear(), DIA.getMonth() + 1, DIA.getDate(), h, m);
    return tentar('registarPicagem', tok, tipo, {});
  };

  /* Entrada às 10h: o dia ainda está incompleto, o que abre uma exceção. */
  assinalar(picar(10, 0, 'ENTRADA_MANHA').ok, 'picagem de entrada registada pela Celina');
  assinalar(linhasDe('DIAS_TRABALHO', USUARIO) >= 1,
    'a propria picagem gravou DIAS_TRABALHO, sem chamar nenhum recalculo :: ' +
    linhasDe('DIAS_TRABALHO', USUARIO));

  picar(13, 0, 'SAIDA_MANHA');
  picar(14, 30, 'ENTRADA_TARDE');

  /* Turno completo às 19:30: a última saída passa das 19:00, o que abre uma
     exceção SAIDA_TARDIA. Fica ABERTA — e é essa aLINEha que interessa. */
  picar(19, 30, 'SAIDA_TARDE');
  const pendentesAbertas = pendentesDe(USUARIO);
  assinalar(pendentesAbertas >= 1,
    'uma saída às 19:30 abre uma excecao PENDENTE para o gestor :: ' + pendentesAbertas);

  /* O gestor corrige a saída para as 19:00 e aprova. A condição deixa de
     se aplicar, e a excecao tem de FECHAR sozinha — sem ninguem a decidir. */
  const fP = SS.getSheetByName('PICAGENS');
  const iId = indiceColuna('PICAGENS', 'ID'), iTipo = indiceColuna('PICAGENS', 'Tipo');
  let idSaidaTarde = '';
  for (let i = fP._dados.length - 1; i >= 1; i--) {
    if (String(fP._dados[i][iTipo]) === 'SAIDA_TARDE') { idSaidaTarde = String(fP._dados[i][iId]); break; }
  }
  const dataIso = DIA.getFullYear() + '-' +
    ('0' + (DIA.getMonth() + 1)).slice(-2) + '-' + ('0' + DIA.getDate()).slice(-2);
  if (tokenHugo && idSaidaTarde) {
    const rCor = tentar('criarCorrecaoPicagem', tokenHugo, {
      userId: USUARIO, data: dataIso, picagemId: idSaidaTarde,
      tipoCorrecao: 'ALTERAR_HORA', valorNovo: '19:00', motivo: 'Saiu às 19:00, o registo errou'
    });
    assinalar(rCor.ok, 'o gestor criou a correcao da saida tardia');
    if (rCor.ok) {
      const rApr = tentar('aprovarCorrecao', tokenHugo, rCor.valor.id);
      assinalar(rApr.ok, 'o gestor aprovou a correcao');
      const depoisDaCorrecao = pendentesDe(USUARIO);
      assinalar(depoisDaCorrecao < pendentesAbertas,
        'a excecao fechou sozinha quando a correcao removeu a condicao :: ' +
        pendentesAbertas + ' antes -> ' + depoisDaCorrecao + ' depois');
    }
  } else {
    assinalar(false, 'sem token de gestor ou sem id da picagem para testar o fecho automatico');
  }

  const fE = SS.getSheetByName('EXCECOES');
  const iE = indiceColuna('EXCECOES', 'Estado'), iP = indiceColuna('EXCECOES', 'ResolvidoPor');
  const fechadasAuto = fE._dados.slice(1).filter(function (l) { return String(l[iP]) === 'SISTEMA'; }).length;
  assinalar(fechadasAuto >= 1, 'a excecao fechada sozinha fica marcada como do SISTEMA :: ' + fechadasAuto);

  /* Uma decisão do gestor nunca é desfeita pelo recálculo. */
  const decididas = fE._dados.slice(1).filter(function (l) {
    return String(l[iE]) === 'RESOLVIDA' && String(l[iP]) !== 'SISTEMA';
  }).length;
  assinalar(decididas === 0, 'o fecho automatico so mexe em PENDENTE (nao toca em decisoes do gestor)');
})();

/* 11.2 ordem das picagens */
limparFolha('PICAGENS');
fixarAgora(DIA.getFullYear(), DIA.getMonth() + 1, DIA.getDate(), 9, 0);
const rForaOrdem = tentar('registarPicagem', tokenPedro, 'SAIDA_TARDE', {});
assinalar(!rForaOrdem.ok, 'picagem fora de ordem recusada :: ' + (rForaOrdem.erro || 'ACEITE!'));
const rSalto = tentar('registarPicagem', tokenPedro, 'ENTRADA_TARDE', {});
assinalar(!rSalto.ok, 'picagem a saltar a manha recusada :: ' + (rSalto.erro || 'ACEITE!'));
const rCerta = tentar('registarPicagem', tokenPedro, 'ENTRADA_MANHA', {});
assinalar(rCerta.ok, 'a picagem seguinte da ordem e aceite');
limparFolha('PICAGENS');

/* 11.3 email duplicado */
if (tokenHugo) {
  const rEditDup = tentar('editarUtilizador', tokenHugo, 'USR_CELINA_RELVA', { email: 'pedromds84@gmail.com' });
  if (rEditDup.ok) {
    alerta('editarUtilizador aceitou um email ja usado por outro utilizador (ficam 2 contas com o mesmo login)');
    tentar('editarUtilizador', tokenHugo, 'USR_CELINA_RELVA', { email: 'celinarelva@gmail.com' });
  } else {
    assinalar(true, 'editarUtilizador recusou email duplicado :: ' + rEditDup.erro);
  }
  const rCredDup = tentar('definirCredenciaisUtilizador', 'USR_RITA_REIS', 'pedromds84@gmail.com', 'nova123');
  assinalar(!rCredDup.ok, 'definirCredenciaisUtilizador recusa email duplicado :: ' + (rCredDup.erro || 'aceite, ficariam 2 contas iguais!'));
}

/* 11.4 repor password sem indicar valor */
if (tokenHugo) {
  const rVazia = tentar('reporPasswordUtilizador', tokenHugo, 'USR_CELINA_RELVA', '', false);
  assinalar(rVazia.ok && !!rVazia.valor.passwordGerada,
    'reporPasswordUtilizador devolve a password gerada :: ' + (rVazia.ok ? rVazia.valor.passwordGerada : rVazia.erro));
  if (rVazia.ok && rVazia.valor.passwordGerada) {
    const rEntraGerada = tentar('autenticarUtilizador', 'celinarelva@gmail.com', rVazia.valor.passwordGerada);
    assinalar(rEntraGerada.ok, 'o colaborador entra com a password gerada');
  }
  tentar('definirPasswordUtilizador', 'USR_CELINA_RELVA', 'celinarelva');
}

/* 11.5 criar utilizador sem indicar password */
if (tokenHugo) {
  const rNovo = tentar('criarUtilizador', tokenHugo, { nome: 'Teste Sem Pass', perfil: 'COLABORADOR', email: 'sem.pass@exemplo.pt' });
  assinalar(rNovo.ok && !!rNovo.valor.passwordGerada,
    'criarUtilizador sem password gera uma :: ' + (rNovo.ok ? rNovo.valor.passwordGerada : rNovo.erro));
  if (rNovo.ok && rNovo.valor.passwordGerada) {
    const rLoginDepois = tentar('autenticarUtilizador', 'sem.pass@exemplo.pt', rNovo.valor.passwordGerada);
    assinalar(rLoginDepois.ok, 'o novo utilizador entra logo com a password gerada');
    tentar('desativarUtilizador', tokenHugo, rNovo.valor.id);
  }
}

/* 11.6 utilizador inativo */
if (tokenHugo && tokenPedro) {
  tentar('desativarUtilizador', tokenHugo, 'USR_PEDRO_SILVA');
  const rInativo = tentar('autenticarUtilizador', 'pedromds84@gmail.com', 'pedromds84');
  assinalar(!rInativo.ok && /inativo/i.test(rInativo.erro), 'utilizador inativo nao entra :: ' + (rInativo.erro || 'entrou!'));
  tentar('reativarUtilizador', tokenHugo, 'USR_PEDRO_SILVA');
  const rReativado = tentar('autenticarUtilizador', 'pedromds84@gmail.com', 'pedromds84');
  assinalar(rReativado.ok, 'utilizador reativado volta a entrar');
}

/* 11.7 password fora dos limites */
const rCurta = tentar('definirPasswordUtilizador', 'USR_CELINA_RELVA', 'ab');
assinalar(!rCurta.ok, 'password com menos de 4 caracteres recusada :: ' + (rCurta.erro || 'aceite!'));
const rLonga = tentar('definirPasswordUtilizador', 'USR_CELINA_RELVA', new Array(70).join('x'));
assinalar(!rLonga.ok, 'password com mais de 64 caracteres recusada :: ' + (rLonga.erro || 'aceite!'));

/* 11.8 dia futuro sem picagens */
limparFolha('PICAGENS');
const FUTURO = new DateReal(DIA.getFullYear(), DIA.getMonth(), DIA.getDate() + 30, 12, 0, 0);
const rFuturo = tentar('calcularMeuDia', tokenPedro, FUTURO);
if (rFuturo.ok) {
  nota('dia futuro sem picagens calcula normalmente (estado ' + rFuturo.valor.estado + ', tipoDia ' + rFuturo.valor.tipoDia + ')');
} else {
  assinalar(false, 'calcularMeuDia num dia futuro falhou :: ' + rFuturo.erro);
}

/* ================= CENARIO 12: autorizacao das funcoes sensiveis =================
   O web app esta publicado com acesso "Anyone" e o google.script.run expoe
   TODAS as funcoes do projeto: password/email nao podem aceitar pedidos de
   visitantes. Sem a guarda autorizarOperacaoSensivel_, qualquer pessoa podia
   chamar definirPasswordUtilizador('USR_PEDRO_SILVA', 'x') e tomar a conta. */
titulo('CENARIO 12 — autorizacao de operacoes sensiveis (password/email)');

EMAIL_ATIVO = 'estranho@gmail.com';
const rSens1 = tentar('definirPasswordUtilizador', 'USR_PEDRO_SILVA', 'pwn12345');
assinalar(!rSens1.ok, 'definirPasswordUtilizador recusado a conta Google nao autorizada :: ' + (rSens1.erro || 'ACEITE!'));

const rSens2 = tentar('definirCredenciaisUtilizador', 'USR_PEDRO_SILVA', 'atacante@exemplo.com', 'pwn12345');
assinalar(!rSens2.ok, 'definirCredenciaisUtilizador recusado a conta nao autorizada :: ' + (rSens2.erro || 'ACEITE!'));

const rSens3 = tentar('definirEmailUtilizador', 'USR_PEDRO_SILVA', 'atacante@exemplo.com');
assinalar(!rSens3.ok, 'definirEmailUtilizador recusado a conta nao autorizada :: ' + (rSens3.erro || 'ACEITE!'));

EMAIL_ATIVO = '';
const rSens4 = tentar('definirPasswordUtilizador', 'USR_PEDRO_SILVA', 'pwn12345');
assinalar(!rSens4.ok, 'operacao sensivel recusada a visitante anonimo :: ' + (rSens4.erro || 'ACEITE!'));

const rSens5 = tentar('instalarSistemaComCredenciais');
assinalar(!rSens5.ok, 'instalarSistemaComCredenciais recusado a visitante anonimo :: ' + (rSens5.erro || 'ACEITE!'));

/* as tentativas nao alteraram nada: o admin continua a entrar com a password original */
const rLoginPedro = tentar('autenticarUtilizador', 'pedromds84@gmail.com', 'pedromds84');
assinalar(rLoginPedro.ok, 'password do admin intacta apos as tentativas :: ' + (rLoginPedro.ok ? 'ok' : rLoginPedro.erro));

/* colaborador autenticado nao pode repor a password de outro utilizador */
EMAIL_ATIVO = 'pedromds84@gmail.com';
const tokenPedroAux = rLoginPedro.ok && rLoginPedro.valor ? rLoginPedro.valor.token : null;
const rLoginCelinaAux = tentar('autenticarUtilizador', 'celinarelva@gmail.com', 'celinarelva');
const tokenCelinaAux = rLoginCelinaAux.ok && rLoginCelinaAux.valor ? rLoginCelinaAux.valor.token : null;
if (!tokenCelinaAux) {
  nota('nao foi possivel abrir sessao da Celina para testar a escalada de privilegios');
} else {
  const rEscalada = tentar('definirPasswordUtilizador', 'USR_PEDRO_SILVA', 'pwn12345', { token: tokenCelinaAux });
  assinalar(!rEscalada.ok && /Sem permissão/.test(String(rEscalada.erro || '')),
    'colaborador com sessao valida nao pode repor a password de outro :: ' + (rEscalada.erro || 'ACEITE!'));
  const rPropria = tentar('definirPasswordUtilizador', 'USR_CELINA_RELVA', 'celina2', { token: tokenCelinaAux });
  assinalar(rPropria.ok, 'colaborador pode alterar a propria password :: ' + (rPropria.ok ? 'ok' : rPropria.erro));
}
if (tokenPedroAux) {
  const rAdminReset = tentar('definirPasswordUtilizador', 'USR_RITA_REIS', 'ritafinal1', { token: tokenPedroAux });
  assinalar(rAdminReset.ok, 'admin com sessao valida pode repor password :: ' + (rAdminReset.ok ? 'ok' : rAdminReset.erro));
  const rLoginRitaFinal = tentar('autenticarUtilizador', 'aror.arita8@hotmail.com', 'ritafinal1');
  assinalar(rLoginRitaFinal.ok, 'Rita entra com a password reposta pelo admin :: ' + (rLoginRitaFinal.ok ? 'ok' : rLoginRitaFinal.erro));

}

/* ================= CENARIO 13: cache nao serve dados antigos apos escrita ================= */
titulo('CENARIO 13 — a cache de folhas tem de respeitar escritas que nao acrescentam linhas');
(function () {
  const c = novaExecucao();
  const folhaUsers = SS.getSheetByName('UTILIZADORES');
  const linhasAntes = folhaUsers.getLastRow();

  /* 1) LEITURA:prime a cache de UTILIZADORES nesta execucao. */
  const ativosAntes = c.obterUtilizadoresAtivos_();
  const eu = c.exigirSessao_(tokenHugo).userId;
  /* Escolhe um alvo que TENHA email: sem isso a verificacao de login
     passaria a vazio ("sem email") e nao provaria nada. */
  const alvo = ativosAntes.find(function (u) {
    return String(u.ID) !== String(eu) && String(u.Email || '').indexOf('@') > 0;
  });
  if (!alvo) { assinalar(false, 'CENARIO 13 sem utilizador com email para testar'); return; }

  /* 2) ESCRITA no lugar: desativar NAO acrescenta linha (getLastRow fica igual). */
  const rDes = c.desativarUtilizador(tokenHugo, alvo.ID);
  assinalar(rDes && rDes.sucesso === true, 'desativar utilizador (escrita sem nova linha) :: ' + JSON.stringify(rDes));
  assinalar(folhaUsers.getLastRow() === linhasAntes,
    'a escrita foi mesmo "no lugar" (linhas ' + linhasAntes + ' -> ' + folhaUsers.getLastRow() + ')');

  /* 3) LEITURA outra vez, MESMA execucao. Antes da correccao devolvia a
        lista antiga e o utilizador desativado continuava a aparecer. */
  const ativosDepois = c.obterUtilizadoresAtivos_();
  const aindaAparece = ativosDepois.some(function (u) { return String(u.ID) === String(alvo.ID); });
  assinalar(!aindaAparece, 'depois de desativar, o utilizador ja nao aparece como ativo :: ' +
    (aindaAparece ? 'AINDA APARECE (cache obsoleta)' : 'ok'));

  /* 4) O login tem de ser recusado — impacto real para quem foi desativado. */
  const emailAlvo = String(alvo.Email || '');
  const rLoginDes = emailAlvo ? tentar('autenticarUtilizador', emailAlvo, 'ritareis') : { ok: false, erro: 'sem email' };
  assinalar(!rLoginDes.ok, 'utilizador desativado nao consegue entrar :: ' + (rLoginDes.ok ? 'ENTROU!' : rLoginDes.erro));

  /* 5) Repoe o estado para nao contaminar os cenarios seguintes. */
  c.reativarUtilizador(tokenHugo, alvo.ID);
  const ativosFinal = c.obterUtilizadoresAtivos_();
  assinalar(ativosFinal.some(function (u) { return String(u.ID) === String(alvo.ID); }),
    'reativar volta a tornar o utilizador ativo (cache coerente)');
})();
/* ================= CENARIO 14: a cache reduz mesmo as leituras ================= */
titulo('CENARIO 14 — mediçao: leituras de folha por chamada (cache ligada vs desligada)');
(function () {
  function medir(fn) {
    const c = novaExecucao();
    c.limparCacheFolhas_();
    LEITURAS = 0; CONTAR_LEITURAS = true;
    let erro = null, res = null;
    try { res = c[fn.nome](tokenHugo, DIA); } catch (e) { erro = e.message; }
    CONTAR_LEITURAS = false;
    return { leituras: LEITURAS, erro: erro, res: res };
  }

  /* o caminho NOVO (uma passagem) */
  const novo = medir({ nome: 'obterDashboardAdministrativo' });
  assinalar(!novo.erro && novo.res && novo.res.sucesso,
    'dashboard numa passagem devolve sucesso :: ' + (novo.erro || 'ok'));
  assinalar(novo.leituras > 0, 'o contador mede leituras reais :: ' + novo.leituras);

  /* o caminho ANTIGO (duas passagens) reconstruido aqui para comparar:
     e' exatamente o que a versao anterior fazia dentro da mesma chamada. */
  function medirAntigo() {
    const c = novaExecucao();
    c.limparCacheFolhas_();
    LEITURAS = 0; CONTAR_LEITURAS = true;
    let erro = null;
    try {
      c.obterPainelAdministrativoHoje(tokenHugo, DIA);
      c.obterResumoAdministrativoDia(tokenHugo, DIA);
      c.obterPendentesAdministrativos(tokenHugo);
      c.obterExcecoesPendentes(tokenHugo);
    } catch (e) { erro = e.message; }
    CONTAR_LEITURAS = false;
    return { leituras: LEITURAS, erro: erro };
  }
  const antigo = medirAntigo();
  assinalar(!antigo.erro, 'caminho antigo ainda corre (so para comparar) :: ' + (antigo.erro || 'ok'));

  const ganho = antigo.leituras ? Math.round((1 - novo.leituras / antigo.leituras) * 100) : 0;
  nota('leituras de folha -> painel: ' + antigo.leituras + ' | dashboard: ' + novo.leituras + ' (' + ganho + '% menos)');
  assinalar(novo.leituras < antigo.leituras,
    'o dashboard numa passagem lê MENOS que o caminho antigo :: ' + antigo.leituras + ' -> ' + novo.leituras);

/* LOG_ERROS — os erros eram ESCRITOS e nunca lidos. `registarErro_` gravava
   a excecao na folha e nao havia caminho de volta: o gestor nunca via nada.
   Aqui escreve-se pelo mesmo caminho que a aplicacao usa e le-se com a
   função nova, `listarErros`. */
(function () {
  limparFolha('LOG_ERROS');

  const vazio = tentar('listarErros', tokenHugo, {});
  assinalar(vazio.ok && vazio.valor && vazio.valor.total === 0,
    'com LOG_ERROS vazia, listarErros responde com 0 registos :: ' +
    (vazio.ok && vazio.valor ? vazio.valor.total : vazio.erro));

  tentar('registarErro_', 'doGet', new Error('Falha de teste'), 'USR_TESTE', { teste: true });

  const depois = tentar('listarErros', tokenHugo, {});
  const n = depois.ok && depois.valor ? depois.valor.total : -1;
  assinalar(n === 1, 'o erro registado volta a ser lido :: ' + n);

  const r = depois.ok && depois.valor ? depois.valor.registos[0] : null;
  assinalar(r && String(r.funcao) === 'doGet' && String(r.mensagem).indexOf('Falha de teste') >= 0,
    'o registo traz a funcao e a mensagem do erro');

  const porFuncao = tentar('listarErros', tokenHugo, { funcao: 'outraCoisa' });
  assinalar(porFuncao.ok && porFuncao.valor && porFuncao.valor.total === 0,
    'o filtro por funcao afasta o que nao corresponde');

  if (tokenCelinaAux) {
    const rColab = tentar('listarErros', tokenCelinaAux, {});
    assinalar(!rColab.ok,
      'um colaborador e' + "'" + ' recusado a ler os erros :: ' + (rColab.erro || 'ACEITOU!'));
  }
/* RECURSAO: `getSpreadsheet_` chama `registarErro_` quando falha, e
   `registarErro_` chama `getSpreadsheet_` para escrever. Sem trava, uma
   falha da Spreadsheet gerava outra e a pilha rebentava — e o registo de
   erros nunca recebia nada, que era o unico registo que interessava. */
(function () {
  const ctx = novaExecucao();
  /* Simula "ainda nao instalado": sem Spreadsheet activa e sem ID guardado.
     Tem de ser dentro do contexto vm — o `SpreadsheetApp` do simulador e'
     uma COPIA, e mexer no de fora nao affects o codigo que corre. */
/* O stub e' partilhado com o resto da simulacao: guardar e restaurar,
     senao `getActive` a devolver null parte os cenarios seguintes. */
  const gActive = ctx.SpreadsheetApp.getActive;
  const gAtiva = ctx.SpreadsheetApp.getActiveSpreadsheet;
  const gProps = ctx.PropertiesService.getScriptProperties;
  ctx.SpreadsheetApp.getActive = function () { return null; };
  ctx.SpreadsheetApp.getActiveSpreadsheet = function () { return null; };
  ctx.PropertiesService.getScriptProperties = function () {
    return { getProperty: function () { return null; }, setProperty: function () {}, deleteProperty: function () {} };
  };
  let erro = null;
  try { ctx.getSpreadsheet_(); } catch (e) { erro = e.message; }
/* O numero de chamadas e' o que se mede. A MENSAGEM de erro nao serve:
     com ou sem trava, o erro que chega ao utilizador e' o mesmo — por isso
     um teste sobre a mensagem passava com a recursao la dentro. Foi o que
     aconteceu na primeira versao deste teste: dava "OK" com 1600 chamadas
     de `getSpreadsheet_` por baixo. Medir chamadas e' o que apanha. */
  let nChamadas = 0;
  const getSpOriginal = ctx.getSpreadsheet_;
  ctx.getSpreadsheet_ = function () { nChamadas++; return getSpOriginal.apply(this, arguments); };
  try { ctx.getSpreadsheet_(); } catch (e2) { /* esperado */ }
  ctx.getSpreadsheet_ = getSpOriginal;
  assinalar(nChamadas <= 3,
    'a falha da Spreadsheet nao se realimenta (poucas chamadas) :: ' + nChamadas);
ctx.SpreadsheetApp.getActive = gActive;
  ctx.SpreadsheetApp.getActiveSpreadsheet = gAtiva;
  ctx.PropertiesService.getScriptProperties = gProps;

  assinalar(!!erro && /Spreadsheet de dados/.test(erro),
    'sem Spreadsheet, getSpreadsheet_ da' + "'" + ' o erro COMO ANTES :: ' + (erro || 'NAO DEVOLVEU ERRO'));

  assinalar(ctx._A_REGISTAR_ERRO_ === false, 'a trava de re-entrada desliga-se no fim :: ' + ctx._A_REGISTAR_ERRO_);

  /* E o registo normal continua a funcionar depois dessa falha. */
  const ctx2 = novaExecucao();
  limparFolha('LOG_ERROS');
  ctx2.registarErro_('doGet', new Error('Falha de teste'), 'USR_TESTE', {});
  const r = tentar('listarErros', tokenHugo, {});
  assinalar(r.ok && r.valor && r.valor.total === 1,
    'depois da falha, o registo de erros volta a funcionar :: ' + (r.ok && r.valor ? r.valor.total : r.erro));
})();

/* O serializador de saida e' a unica recursao do projecto. Um objecto que
   se aponte a si proprio rebentava a pilha sem deixar rasto. */
(function () {
  const ctx = novaExecucao();
  const ciclico = { nome: 'laço' };
  ciclico.proprio = ciclico;
  let r = null;
  try { r = ctx.serializarParaFrontend_(ciclico); } catch (e) { r = { erro: e.message }; }
  assinalar(r && !r.erro && JSON.stringify(r).indexOf('[') >= 0,
    'um objecto ciclico devolve um marcador em vez de rebentar a pilha :: ' +
    (r && r.erro ? 'LANCOU ' + r.erro : 'terminou com ' + JSON.stringify(r).length + ' chars'));

  const bom = ctx.serializarParaFrontend_({ a: { b: { c: 1 } }, quando: new Date(2026, 0, 1), lista: [1, { x: 2 }] });
  assinalar(bom && bom.a.b.c === 1 && typeof bom.quando === 'string' && bom.lista[1].x === 2,
    'a serializacao normal continua igual :: ' + JSON.stringify(bom));
})();
})();
  /* e o resultado tem de ser o mesmo — mais rapido, nunca diferente */
  const c2 = novaExecucao(); c2.limparCacheFolhas_();
  const rAntigo = c2.obterPainelAdministrativoHoje(tokenHugo, DIA);
  const c3 = novaExecucao(); c3.limparCacheFolhas_();
  const rNovo = c3.obterDashboardAdministrativo(tokenHugo, DIA);
  assinalar(rAntigo.utilizadores.length === rNovo.painel.length,
    'a nova versao devolve o mesmo numero de utilizadores no painel :: ' + rNovo.painel.length);
  assinalar(rNovo.resumo && rNovo.resumo.totalHorasTrabalhadas !== undefined &&
             rNovo.pendentes && rNovo.excecoesPendentes,
    'a nova versao devolve tambem resumo, pendentes e excecoes');
})();

/* ================= CENARIO 15: um dia partido nao derruba o painel ================= */
titulo('CENARIO 15 — o calculo de UMA pessoa nao pode retirar o painel inteiro ao gestor');
(function () {
  const c = novaExecucao();
  const iso = c.formatarDataISO_(DIA);
  const folha = SS.getSheetByName('CORRECOES');
  const lenAntes = folha._dados.length;
  const col = function (nome) { return indiceColuna('CORRECOES', nome); };

  const ativos = c.obterUtilizadoresAtivos_();
  if (ativos.length < 2) { assinalar(false, 'CENARIO 15 precisa de pelo menos 2 utilizadores ativos'); return; }
  const alvo = ativos[ativos.length - 1];
  const outro = ativos[0];

  function semearCorrecao(user, dados) {
    const r = lenAntes + 1;
    escrever(folha, r, col('ID') + 1, dados.id);
    escrever(folha, r, col('DataCriacao') + 1, DIA);
    escrever(folha, r, col('Data') + 1, iso);
    escrever(folha, r, col('UserID') + 1, user.ID);
    escrever(folha, r, col('Nome') + 1, user.Nome);
    ['PicagemID', 'TipoCorrecao', 'ValorOriginal', 'ValorNovo', 'TipoOriginal', 'TipoNovo', 'Motivo', 'Estado', 'CriadoPor']
      .forEach(function (nome) {
        if (dados[nome] !== undefined) escrever(folha, r, col(nome) + 1, dados[nome]);
      });
  }
  function limparSemeadura() { folha._dados.length = lenAntes; }

  /* 1) APROVADA com um tipo de picagem que nao existe: calcularDia() LANÇA
        para este utilizador. Antes disto o painel devolvia erro e o gestor
        perdia TODOS os utilizadores e todos os totais. */
  semearCorrecao(alvo, {
    id: 'COR_TESTE_15_MA', PicagemID: '', TipoCorrecao: 'ADICIONAR_PICAGEM',
    ValorOriginal: '', ValorNovo: '09:00', TipoOriginal: '', TipoNovo: 'TIPO_INEXISTENTE',
    Motivo: 'teste de robustez', Estado: 'APROVADA', CriadoPor: 'TESTE'
  });

  const c2 = novaExecucao(); c2.limparCacheFolhas_();
  let painel = null, erro = null;
  try { painel = c2.obterDashboardAdministrativo(tokenHugo, DIA); } catch (e) { erro = e.message; }
  assinalar(!erro && painel && painel.sucesso === true,
    'o dashboard nao rebenta com um dia partido :: ' + (erro || 'ok'));

  const linhaAlvo = (painel && painel.painel || []).find(function (x) { return String(x.userId) === String(alvo.ID); });
  const linhaOutro = (painel && painel.painel || []).find(function (x) { return String(x.userId) === String(outro.ID); });
  assinalar(!!linhaAlvo, 'o utilizador com o dia partido continua a aparecer no painel');
  assinalar(!!linhaOutro, 'os OUTROS utilizadores continuam visiveis (o painel nao inteiro fica em branco)');
  assinalar(linhaAlvo && linhaAlvo.estadoOperacional === 'ERRO_CALCULO',
    'o dia partido fica MARCADO como ERRO_CALCULO, nao disfarçado de "SEM_PICAGEM" :: ' + (linhaAlvo && linhaAlvo.estadoOperacional));
  assinalar(!!(linhaAlvo && linhaAlvo.erroCalculo),
    'o painel diz QUAL foi o problema :: ' + (linhaAlvo ? String(linhaAlvo.erroCalculo).slice(0, 70) : '-'));
  assinalar(!!(painel && painel.resumo && painel.resumo.detalhes &&
      painel.resumo.detalhes.some(function (d) { return String(d.userId) === String(outro.ID); })),
    'os totais continuam a incluir os utilizadores saudaveis');
  assinalar(!!(painel && painel.painel && painel.painel.length === ativos.length),
    'todos os utilizadores continuam listados (' + (painel && painel.painel ? painel.painel.length : 0) + '/' + ativos.length + ')');

  /* 2) APROVADA que aponta para uma picagem inexistente (orfa): antes
        rebentava o dia; agora e ignorada e registada. */
  limparSemeadura();
  semearCorrecao(outro, {
    id: 'COR_TESTE_15_ORFA', PicagemID: 'PIC_QUE_NAO_EXISTE', TipoCorrecao: 'ALTERAR_HORA',
    ValorOriginal: '09:00', ValorNovo: '10:00', TipoOriginal: '', TipoNovo: '',
    Motivo: 'teste orfa', Estado: 'APROVADA', CriadoPor: 'TESTE'
  });
  const c3 = novaExecucao(); c3.limparCacheFolhas_();
  let painelOrfa = null, erroOrfa = null;
  try { painelOrfa = c3.obterDashboardAdministrativo(tokenHugo, DIA); } catch (e) { erroOrfa = e.message; }
  assinalar(!erroOrfa && painelOrfa && painelOrfa.sucesso === true,
    'correcao aprovada orfa nao rebenta o painel :: ' + (erroOrfa || 'ok'));
  const lOrfa = (painelOrfa && painelOrfa.painel || []).find(function (x) { return String(x.userId) === String(outro.ID); });
  assinalar(!!lOrfa && lOrfa.estadoOperacional !== 'ERRO_CALCULO',
    'a correcao orfa e ignorada e o dia calcula-se normal :: ' + (lOrfa && lOrfa.estadoOperacional));

  limparSemeadura();
  const c4 = novaExecucao(); c4.limparCacheFolhas_();
  const painelLimpo = c4.obterDashboardAdministrativo(tokenHugo, DIA);
  assinalar(painelLimpo.painel.every(function (x) { return x.estadoOperacional !== 'ERRO_CALCULO'; }),
    'depois de limpar a correcao de teste, nenhum dia fica marcado como erro');
})();


/* ================= CENARIO 16: politica de bloqueio, ponta a ponta =================
   A password e mantida simples e o teclado e partilhado, por isso a politica
   tem de equilibrar duas coisas opostas: travar quem insiste e NAO punir
   quem se engana. Este cenario percorre o ciclo completo. */
titulo('CENARIO 16 — bloqueio progressivo, desbloqueio pelo gestor e passwords intactas');
(function () {
  const c = novaExecucao();
  const folha = SS.getSheetByName('UTILIZADORES');
  const colId = indiceColuna('UTILIZADORES', 'ID');
  const colTent = indiceColuna('UTILIZADORES', 'TentativasFalhadas');
  const colBloq = indiceColuna('UTILIZADORES', 'BloqueadoAte');
  const colEmail = indiceColuna('UTILIZADORES', 'Email');
  const iRita = (function () {
    for (let i = 1; i < folha._dados.length; i++) if (String(folha._dados[i][colId]) === 'USR_RITA_REIS') return i;
    return -1;
  })();
  if (iRita < 0) { assinalar(false, 'CENARIO 16 sem a Rita'); return; }
  const linhaRita = function () { return folha._dados[iRita]; };
  const emailRita = String(linhaRita()[colEmail]);
  /* A password NAO se escreve aqui. Lê-se da propria folha: e assim que
     qualquer cenario anterior a tenha trocado, este cenario continua a
     valer a mesma coisa — "a password que a pessoa tem hoje funciona
     depois do desbloqueio". Escrever 'ritareis' aqui testava uma
     password que ja nao era a da Rita. */
  const PWD = function () {
    const colPwd = indiceColuna('UTILIZADORES', 'Password');
    return String(linhaRita()[colPwd] || '');
  };
  /* APP e uma const do ambito VM: nao aparece como propriedade do
     contexto, por isso lê-se de lá dentro. */
  const SEG = vm.runInContext('APP.SEGURANCA', c);
  const MAX = SEG.MAX_TENTATIVAS_LOGIN;

  /* IMPORTANTE: cada chamada a tentar() corre num contexto NOVO (e por
     isso com a cache das folhas vazia). O contexto `c` deste cenario e
     de longa duracao: ler uma folha por aqui sem a limpar devolve a
     fotografia de ANTES da escrita e o teste acusa uma falha que nao
     existe. Por isso toda a leitura interna passa por aqui. */
  const ritaBloqueada = function () {
    c.limparCacheFolhas_();
    return c.utilizadorEstaBloqueado_(c.obterLinhaUtilizadorPorId_('USR_RITA_REIS'));
  };

  /* estado limpo */
  linhaRita()[colTent] = 0; linhaRita()[colBloq] = '';

  /* 1) alguns erros NAO bloqueiam: o employee com dedos gordos nao e
        punido logo, e o erro diz-lhe quantas tentativas faltam. */
  for (let i = 1; i < MAX; i++) {
    const r = tentar('autenticarUtilizador', emailRita, 'password-errada');
    assinalar(!r.ok && /tentativa/i.test(String(r.erro || '')),
      'erro ' + i + '/' + MAX + ' avisa sem bloquear :: ' + String(r.erro || '').slice(0, 60));
  }
  assinalar(!!(linhaRita()[colTent] >= MAX - 1) && !ritaBloqueada(),
    'ainda nao bloqueou antes de exhausting as ' + MAX + ' tentativas');

  /* 2) o ultimo erro bloqueia. */
  const rUltimoErro = tentar('autenticarUtilizador', emailRita, 'password-errada');
  assinalar(!rUltimoErro.ok, 'a tentativa limite falha como esperado');
  assinalar(ritaBloqueada(),
    'a conta fica bloqueada ao atingir ' + MAX + ' tentativas');

  /* 3) MESMO com a password CORRECTA, a conta bloqueada nao entra —
        e o erro diz ate quando. */
  const rBloqCerto = tentar('autenticarUtilizador', emailRita, PWD());
  assinalar(!rBloqCerto.ok && /bloqueada/i.test(String(rBloqCerto.erro || '')),
    'password certa nao entra enquanto esta bloqueada, e explica porquê :: ' + String(rBloqCerto.erro || '').slice(0, 80));

  /* 4) o gestor ve o bloqueio na lista de utilizadores. */
  const lista = c.listarUtilizadores(tokenHugo, { incluirInativos: true });
  const ritaNaLista = (lista.utilizadores || []).find(function (u) { return u.id === 'USR_RITA_REIS'; });
  assinalar(ritaNaLista && ritaNaLista.bloqueado === true,
    'o gestor VE que a Rita esta bloqueada na lista');
  assinalar(ritaNaLista && !!ritaNaLista.bloqueadoAte,
    'a lista mostra ATE QUE QUANDO esta bloqueada');

  /* 5) desbloqueio pelo gestor SEM tocar na password. */
  const rDesb = c.desbloquearUtilizador(tokenHugo, 'USR_RITA_REIS');
  assinalar(rDesb && rDesb.sucesso === true, 'o gestor desbloqueia a conta :: ' + JSON.stringify(rDesb));
  assinalar(String(linhaRita()[colTent]) === '0' || Number(linhaRita()[colTent]) === 0,
    'o contador de falhas volta a zero ao desbloquear');
  const rCerto = tentar('autenticarUtilizador', emailRita, PWD());
  assinalar(rCerto.ok, 'a Rita entra com a MESMA password de sempre depois do desbloqueio :: ' + (rCerto.ok ? 'ok' : rCerto.erro));

  /* 6) reincidencia: quem volta a falhar apanha o tempo longo. */
  linhaRita()[colTent] = 0; linhaRita()[colBloq] = '';
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < MAX; i++) tentar('autenticarUtilizador', emailRita, 'errada');
  }
  /* O tempo mede-se SEMPRE pelo relogio da app (AGORA_FALSA). Usar
     Date.now() do host mistura dois relogios — o da simulaçao esta
     fixado em 16/09/2026 e o do host corre para a data real, daí
     aparecerem "-12932 min" e datas de 2026-09-16 como se estivessem
     no passado. */
  const agoraApp = function () { return AGORA_FALSA ? AGORA_FALSA.getTime() : DateReal.now(); };
  const minutos = ritaBloqueada()
    ? Math.round((new Date(linhaRita()[colBloq]).getTime() - agoraApp()) / 60000) : 0;
  assinalar(minutos >= SEG.BLOQUEIO_MINUTOS_REINCIDENTE - 2,
    'a reincidencia aplica o bloqueio mais longo (' + minutos + ' min) :: ' + String(linhaRita()[colBloq]));

  /* 7) um bloqueio que ja passou devolve a conta a zero: o proximo erro
        conta como o primeiro, e nao volta a bloquear de imediato.
        Data relativa ao relogio da app, pela raza acima. */
  linhaRita()[colTent] = MAX - 1;
  linhaRita()[colBloq] = new DateReal(agoraApp() - 60000);
  c.limparCacheFolhas_();
  c.utilizadorEstaBloqueado_(c.obterLinhaUtilizadorPorId_('USR_RITA_REIS'));
  assinalar(Number(linhaRita()[colTent]) === 0,
    'um bloqueio expirado zera o contador (o proximo erro conta como o 1.o)');

  /* estado final: a password da empresa tem de continuar a ser a original */
  linhaRita()[colTent] = 0; linhaRita()[colBloq] = '';
  const rFinal = tentar('autenticarUtilizador', emailRita, PWD());
  assinalar(rFinal.ok, 'a password original continua a funcionar no fim :: ' + (rFinal.ok ? 'ok' : rFinal.erro));
})();


/* CENARIO 17 — folha JA INSTALADA, sem as colunas novas.
   As colunas Bloqueios / UltimoBloqueioEm foram acrescentadas depois de
   várias instalações. Simula-se uma folha antiga: apagam-se os cabecalhos
   e os valores, e a aplicacao tem de os criar sozinha e continuar a
   contar a reincidencia. Sem isto, um cliente que so actualizou os
   ficheiros ficaria com a politica de bloqueio partida em silencio. */
(function () {
  const c = novaExecucao();
  const f = SS.getSheetByName('UTILIZADORES');
  const cab = f._dados[0];
  const iB = cab.indexOf('Bloqueios');
  const iU = cab.indexOf('UltimoBloqueioEm');
  if (iB < 0 || iU < 0) { assinalar(false, 'a folha antiga de teste tem de ter (e depois perder) as colunas de bloqueio'); return; }
  for (let i = 1; i < f._dados.length; i++) { f._dados[i][iB] = ''; f._dados[i][iU] = ''; }
  f._dados[0][iB] = ''; f._dados[0][iU] = '';
  c.limparCacheFolhas_();
  c._COLUNAS_BLOQUEIO_OK_ = false;

  const outra = c.obterLinhaUtilizadorPorId_('USR_CELINA_RELVA');
  const g = outra && outra.mapa;
  assinalar(!!g && g.Bloqueios !== undefined && g.UltimoBloqueioEm !== undefined,
    'a folha antiga ganha sozinha as colunas de bloqueio');
  assinalar(!!outra && Number(outra.values[g.Bloqueios]) === 0,
    'as linhas existentes ficam a zero (e nao vazias) na coluna nova');

  /* E a reincidencia tem de funcionar nessa folha ja "velha". */
  const cel = f._dados.find(function (l) { return l[0] === 'USR_CELINA_RELVA'; });
  if (!cel) { assinalar(false, 'a Celina nao foi encontrada na folha de teste'); return; }
  const iTent = cab.indexOf('TentativasFalhadas');
  const iBlq = cab.indexOf('BloqueadoAte');
  const iEmail = cab.indexOf('Email');
  const SEG17 = vm.runInContext('APP.SEGURANCA', c);
  const MAX = SEG17.MAX_TENTATIVAS_LOGIN;
  for (let volta = 0; volta < 2; volta++) {
    cel[iTent] = 0; cel[iBlq] = ''; c.limparCacheFolhas_();
    for (let k = 0; k < MAX; k++) {
      c.limparCacheFolhas_();
      /* autenticarUtilizador LANÇA o erro de "credenciais inválidas" — é o
         contrato do backend. O try/catch aqui é o mesmo que o `tentar()`
         global faz nas outras linhas; sem ele a falha esperada do teste
         mata a simulação. */
      try { c.autenticarUtilizador(String(cel[iEmail]), 'errada'); } catch (e) {}
    }
  }
  const mins = Math.round((new Date(cel[iBlq]).getTime() - (AGORA_FALSA ? AGORA_FALSA.getTime() : DateReal.now())) / 60000);
  assinalar(mins >= SEG17.BLOQUEIO_MINUTOS_REINCIDENTE - 2,
    'a reincidencia tambem funciona numa folha ja instalada (' + mins + ' min)');
})();
/* ================= CENARIO 18: a rotacao de sabados =================
   Defeito real encontrado na leitura de codigo: a contagem andava de 7 em
   7 dias a partir de `dataInicio`. Se a ancora NAO fosse um sabado (uma
   folha editada a mao, uma DATA_INICIO_CONFIGURACAO velha), o primeiro
   sabado caia fora da rotacao: ninguem ficava previsto nesse dia — o
   colaborador que o gestor via no ecra simplesmente nao trabalhava.
   O ciclo tambem fazia uma volta por semana, dentro de um calculo feito
   para TODOS os utilizadores, todos os dias. */
titulo('CENARIO 18 — a rotacao de sabados esta ancorada no sabado (e nao perde o primeiro)');
(function () {
  const c = novaExecucao();
  const f = SS.getSheetByName('CONFIG_SABADOS');
  if (!f) { assinalar(false, 'a folha CONFIG_SABADOS nao existe no teste'); return; }
  const cab = f._dados[0];
  const iG = cab.indexOf('GrupoID'), iO = cab.indexOf('OrdemUserIDs');
  const iD = cab.indexOf('DataInicio'), iA = cab.indexOf('Ativo');
  if (iG < 0 || iO < 0 || iD < 0 || iA < 0) { assinalar(false, 'a folha CONFIG_SABADOS mudou de colunas'); return; }

  const ORDEM = ['USR_A', 'USR_B', 'USR_C'];
  const inicioSabado = '2026-09-05';                 // 5/set/2026 e um sabado
  const inicioNaoSabado = '2026-09-07';             // segunda-feira

  /* A versao antiga andava de 7 em 7 dias a partir de `dataInicio` e
     contava os passos. Com a ancora numa segunda-feira, os passos
     contavam de segunda para segunda: o sabado de 19/set ficava em
     "passo 2" e o collaborator B era saltado para sempre. E o sabado
     de 12/set (o primeiro a contar) caia em "passo 0" sem nunca
     passar pelo contador — a rotacao ficava desalinhada. */
  function contagemAntiga(ancora, sabado) {
    let n = 0, d = c.formatarDataISO_(new Date(ancora + 'T00:00:00'));
    const alvo = sabado;
    while (d < alvo) {
      const p = d.split('-').map(Number);
      d = c.formatarDataISO_(new Date(p[0], p[1] - 1, p[2] + 7));
      n++;
    }
    return n;
  }

  function testar(ancora, rotulo) {
    f._dados.length = 1;
    f._dados.push(['G_TEST', 'Teste', JSON.stringify(ORDEM), ancora, 'true']);
    c.limparCacheFolhas_();

    /* 1) o primeiro sabado A CONTAR DA ANCORA e a semana 0 */
    const primeiro = c.ajustarDataInicioRotacao_(ancora);   // 1.o sabado >= ancora
    const n0 = c.calcularNumeroSabados_(ancora, primeiro);
    assinalar(n0 === 0, rotulo + ': o 1.o sabado a contar da ancora e a semana 0 (' + primeiro + ', obtido ' + n0 + ')');

    /* 2) os sabados seguintes rodam A->B->C, um a um, sem saltar ninguem
       (e era exactamente aqui que a contagem antiga saltava o B) */
    const p0 = primeiro.split('-').map(Number);
    const vistos = [0, 1, 2, 3, 4].map(function (k) {
      const d = c.formatarDataISO_(new Date(p0[0], p0[1] - 1, p0[2] + 7 * k));
      return c.calcularMembroRotacaoSabado_('G_TEST', d);
    });
    const esperado = [0, 1, 2, 0, 1].map(function (k) { return ORDEM[k]; });
    assinalar(JSON.stringify(vistos) === JSON.stringify(esperado),
      rotulo + ': sabados consecutivos rodam A->B->C sem saltar ninguem (obtido ' + vistos.join(',') + ')');

    /* 3) um sabado ANTERIOR a ancora nao e de ninguem (comeca a rotacao) */
    const pAnt = new Date(p0[0], p0[1] - 1, p0[2] - 7);
    assinalar(c.calcularNumeroSabados_(ancora, c.formatarDataISO_(pAnt)) < 0,
      rotulo + ': o sabado anterior a ancora nao WorkingDay de ninguem');
  }
  testar(inicioSabado, 'ancora sabado');
  testar(inicioNaoSabado, 'ancora NAO sabado (o defeito)');

  /* 4) a contagem antiga e a nova discordam para uma ancora de
     segunda-feira — prova de que o defeito existia e nao era um mito. */
  const d19 = c.formatarDataISO_(new Date(2026, 8, 19));
  assinalar(contagemAntiga(inicioNaoSabado, d19) !== c.calcularNumeroSabados_(inicioNaoSabado, d19),
    'com ancora de segunda-feira, a contagem antiga dava ' + contagemAntiga(inicioNaoSabado, d19) +
    ' e a nova da ' + c.calcularNumeroSabados_(inicioNaoSabado, d19) + ' (a antiga saltava um collaborator)');

  /* 5) com a ancora ja num sabado, o resultado e IDENTICO ao anterior:
     a correcao so muda o que estava errado. */
  let divergencias = 0;
  for (let k = 0; k < 14; k++) {
    const d = c.formatarDataISO_(new Date(2026, 8, 5 + 7 * k));
    if (c.calcularNumeroSabados_(inicioSabado, d) !== contagemAntiga(inicioSabado, d)) divergencias++;
  }
  assinalar(divergencias === 0, 'com a ancora ja num sabado, o resultado e identico ao anterior (' + divergencias + ' divergencias)');
})();





/* arranque: numa folha nova (sem emails) a instalacao tem de funcionar mesmo
   que a conta Google nao seja reconhecida — senao o sistema nunca podia ser
   configurado. Esta excecao desaparece assim que exista um email definido.
   Fica AQUI (depois do cenario 13) porque esvaziar os emails antes dele
   deixaria o cenario sem alvo valido para provar. */
(function () {
  const f = SS.getSheetByName('UTILIZADORES');
  const iEmail = indiceColuna('UTILIZADORES', 'Email');
  for (let i = 1; i < f._dados.length; i++) f._dados[i][iEmail] = '';
})();


EMAIL_ATIVO = '';
const rArranque = tentar('instalarSistemaComCredenciais');
assinalar(rArranque.ok, 'instalacao numa folha nova funciona (bootstrap) :: ' + (rArranque.ok ? 'ok' : rArranque.erro));
const rLoginAposArranque = tentar('autenticarUtilizador', 'pedromds84@gmail.com', 'pedromds84');
assinalar(rLoginAposArranque.ok, 'admin entra apos reinstalacao :: ' + (rLoginAposArranque.ok ? 'ok' : rLoginAposArranque.erro));
/* Regressao: a lista inteira tem de ser aplicada. Autorizar utilizador a
   utilizador fazia a instalacao recusar-se a si propria no 2.o utilizador
   (a folha ja tinha credenciais) e so o primeiro login ficava definido. */
assinalar(rArranque.ok && rArranque.valor && rArranque.valor.credenciaisAplicadas === 4,
  'as 4 credenciais de CREDENCIAIS_INICIAIS foram aplicadas :: ' + (rArranque.ok ? rArranque.valor.credenciaisAplicadas : rArranque.erro));
const rUltimo = tentar('autenticarUtilizador', 'aror.arita8@hotmail.com', 'ritareis');
assinalar(rUltimo.ok, 'o ULTIMO utilizador da lista tambem entra :: ' + (rUltimo.ok ? 'ok' : rUltimo.erro));
/* Garantia final: os logins e passwords fornecidos pela empresa sao os que
   funcionam, tal e qual, depois da instalacao. */
[['pedromds84@gmail.com', 'pedromds84'], ['hugofds@outlook.com', '6y6na6cu'],
 ['celinarelva@gmail.com', 'celinarelva'], ['aror.arita8@hotmail.com', 'ritareis']].forEach(function (c) {
  const r = tentar('autenticarUtilizador', c[0], c[1]);
  assinalar(r.ok, 'credencial fornecida mantida: ' + c[0] + ' :: ' + (r.ok ? 'ok' : r.erro));
});
/* Maiusculas/minusculas nao devem falhar (teclado do telemóvel, Caps Lock). */
const rCx = tentar('autenticarUtilizador', 'PEDROMDS84@GMAIL.COM', 'PedroMDS84');
assinalar(rCx.ok, 'login e password aceitos sem diferenca de maiusculas :: ' + (rCx.ok ? 'ok' : rCx.erro));

/* ================= CENARIO 19: arranque em projeto STANDALONE =================
   Este é o caminho real de quem importa o ZIP. A Google só permite importar
   projetos standalone, e nesses getActiveSpreadsheet() devolve SEMPRE null.

   A versão anterior de setupSistema() guardava o ID da Spreadsheet no FIM,
   depois de já ter criado as folhas. Numa instalação nova nunca havia ID
   para abrir, pelo que a instalação não arrancava e não havia caminho
   para sair do impasse. */
titulo('CENARIO 19 — a instalacao arranca num projeto standalone (importado por ZIP)');
(function () {
  assinalar(tentar('estadoInstalacao_').ok && tentar('estadoInstalacao_').valor.projetoStandalone === false,
    'pre-condicao: o simulador arranca ligado a uma Spreadsheet ativa');

  /* Corta com a realidade: projeto standalone, sem ID guardado. */
  MODO_STANDALONE = true;
  delete PROPS.SPREADSHEET_ID;

  const estado = tentar('estadoInstalacao_').valor;
  assinalar(estado && estado.projetoStandalone === true,
    'o projeto e standalone (getActiveSpreadsheet devolve null)');
  assinalar(estado && estado.spreadsheetIdGuardado === '(vazio)',
    'nao ha Spreadsheet registada antes da instalacao');

  const antes = PLANILHAS_EXPORTADAS.length;
  const r = tentar('instalarSistemaComCredenciais');
  assinalar(r.ok, 'instalarSistemaComCredenciais arranca SEM Spreadsheet ativa :: ' + (r.ok ? 'ok' : r.erro));

  const criadas = PLANILHAS_EXPORTADAS.length - antes;
  assinalar(criadas === 1, 'foi criada EXATAMENTE uma Spreadsheet :: ' + criadas);

  const id = String(PROPS.SPREADSHEET_ID || '');
  assinalar(!!id, 'o ID ficou guardado nas propriedades do script :: ' + (id || '(vazio)'));
  assinalar(r.ok && r.valor && r.valor.setup && r.valor.setup.spreadsheetOrigem === 'CRIADA',
    'o diagnostico diz de onde veio a Spreadsheet :: ' +
    (r.ok && r.valor && r.valor.setup ? r.valor.setup.spreadsheetOrigem : '-'));

  /* E tem de ficar utilizavel: todas as folhas existem na Sheet nova. */
  const ssNova = PLANILHAS_EXPORTADAS[PLANILHAS_EXPORTADAS.length - 1].ss;
  const nomesFolhas = vm.runInContext('Object.keys(SHEETS).map(function(k){return SHEETS[k];})', novaExecucao());
  const faltam = nomesFolhas.filter(function (n) { return !ssNova.getSheetByName(n); });
  assinalar(faltam.length === 0, 'as ' + nomesFolhas.length +
    ' folhas foram criadas na Sheet nova :: faltam ' + (faltam.join(', ') || 'nenhuma'));

  /* Idempotencia. Corre-se como ADMIN AUTENTICADO, que e' o caminho real:
     a partir da segunda execucao ja existe uma Spreadsheet com credenciais,
     e por isso a instalacao exige autorizacao (e um visitante sem token tem
     de a recusar — e' o que o CENARIO 12 prova para as operacoes sensiveis).
     Antes, com a guarda nova, esta chamada falhava a nao ser por token. */
  const r3 = tentar('autenticarUtilizador', 'pedromds84@gmail.com', 'pedromds84');
  assinalar(r3.ok, 'o login funciona logo apos a instalacao standalone :: ' + (r3.ok ? 'ok' : r3.erro));
  const tokenAdminStandalone = r3.ok && r3.valor ? r3.valor.token : null;

  const r2 = tentar('setupSistema', tokenAdminStandalone);
  assinalar(r2.ok, 'correr a instalacao uma segunda vez nao rebenta :: ' + (r2.ok ? 'ok' : r2.erro));
  assinalar(PLANILHAS_EXPORTADAS.length - antes === 1,
    'a segunda execucao REUTILIZA a mesma Spreadsheet (nao cria outra)');
  assinalar(r2.ok && r2.valor && r2.valor.spreadsheetOrigem === 'PROPRIEDADE',
    'a segunda execucao le o ID guardado em vez de criar outra Sheet :: ' +
    (r2.ok && r2.valor ? r2.valor.spreadsheetOrigem : '-'));

  /* E o inverso tambem tem de ser provado: sem token, a reinstalacao de um
     sistema JA configurado tem de ser recusada. E' o fecho da porta que a
     guarda de setupSistema abriu. */
  const rSemToken = tentar('setupSistema');
  assinalar(!rSemToken.ok, 'reinstalar um sistema ja configurado SEM token e' + ' recusado :: ' + (rSemToken.ok ? 'ACEITE!' : 'ok'));

  /* Um ID guardado que ja nao abre tem de ser descartado: se nao, o
     sistema fica partido para sempre sem forma de se recuperar. */
  PROPS.SPREADSHEET_ID = 'ID_QUE_NAO_EXISTE';
  /* Nao ha token que sirva: a sessao acima foi aberta contra a Spreadsheet que
     este passo torna inalcavel. E' o que o gestor real enfrenta. Instala-se
     pelo caminho de arranque, que reconhece o ID obsoleto como um sistema a
     recuperar e nao como um sistema a proteger. */
  const antes2 = PLANILHAS_EXPORTADAS.length;
  const r4 = tentar('instalarSistemaComCredenciais');
  assinalar(r4.ok, 'um ID guardado invalido NAO bloqueia a instalacao :: ' + (r4.ok ? 'ok' : r4.erro));
  assinalar(PLANILHAS_EXPORTADAS.length - antes2 === 1,
    'foi criada uma Spreadsheet nova para substituir o ID invalido');

  MODO_STANDALONE = false;
  delete PROPS.SPREADSHEET_ID;
})();


/* ================= CENARIO 20: como o backend escala com o tempo =================
   A Apps Script mata uma execucao aos 6 minutos e tem um heap de ~100 MB.
   O risco real deste sistema NAO e o volume de linhas em si: e a folha
   PICAGENS, que cresce SEMPRE (uma linha por picagem, para sempre) e que o
   dashboard le INTEIRA em cache. Este cenario mede a leitura em 1 ano, 3
   anos e 5 anos de uso real, para dizer quando e que o limite chega. */
titulo('CENARIO 20 — a folha PICAGENS cresce sempre: onde esta o limite');
(function () {
  const c0 = novaExecucao();
  const folha = SS.getSheetByName('PICAGENS');
  const col = function (nome) { return indiceColuna('PICAGENS', nome); };
  const linhaBase = folha._dados.length;

  /* 4 pessoas x 4 picagens/dia = 16 picagens/dia. */
  const PESSOAS = 4, PICAGENS_DIA = 4;
  const porDia = PESSOAS * PICAGENS_DIA;

  /* Ano civil tem 365 dias. 5 anos = 1825 dias = 29 200 picagens.
     Medem-se 1 e 2 anos e o limite e extrapolado: aos 5 anos o PRÓPRIO
     simulador passa dos 5 minutos a construir as linhas (isto e o tempo do
     simulador em Node, nao o do Apps Script). O que interessa e a RAZAO de
     crescimento — e ela que diz se o custo depende do dia ou do historico. */
  const medidas = [
    { anos: 1, dias: 365 },
    { anos: 2, dias: 730 }
  ];

  const linhaModelo = folha._dados[folha._dados.length - 1] || [];
  const relatorio = [];

  /* A folha que ja existe quando o cenario arranca pode ter linhas com
     data mais recente do que o inicio do periodo semeado (sao as picagens
     dos cenarios anteriores). A PICAGENS real e acrescentada por ordem
     cronologica, entao o cenario tem de fazer o mesmo: semeia a partir de
     UMA DATA ANTERIOR a qualquer linha ja presente, e no fim remove
     tudo o que semeou. Sem isto, a folha ficava com um salto de datas no
     meio e o recorte — que e seguro — desiste. */
  const c0b = novaExecucao();
  let inicioSemeadura = new DateReal(DIA.getTime());
  inicioSemeadura.setDate(inicioSemeadura.getDate() - 1);
  for (let i = 1; i < folha._dados.length; i++) {
    const d = c0b.valorDataISO_(folha._dados[i][indiceColuna('PICAGENS', 'Data')]);
    const dt = new DateReal(d + 'T00:00:00Z');
    if (!isNaN(dt.getTime()) && dt < inicioSemeadura) inicioSemeadura = dt;
  }

  medidas.forEach(function (m) {
    /* Enche a folha ate ao equivalente a m.dias de picagens.
       As datas tem de estar ESPALHADAS pelo periodo: se todas caíssem
       no mesmo dia, a leitura acotada por dia encontraria legitimamente
       a folha toda e a medicao diria que a otimizacao nao funciona. */
    /* Cada medicao parte da MESMA folha-base: as linhas semeadas pela
       medicao anterior sao removidas no fim de cada iteracao, senao a
       segunda medicao comeca ja com 1 ano de dados e a soma distorce a
       medicao. */
    folha._dados.length = linhaBase;

    const alvo = linhaBase + porDia * m.dias;
    /* Sem isto, cada vez que a folha cresce, o Proxy de escrita chamava
       limparCacheFolhas_() — mas o custo real era outro: formatarDataISO_
       por linha atraves de um contexto VM novo. Feito uma vez, aqui. */
    const cRef = novaExecucao();
    const DIA_ISO = cRef.formatarDataISO_(DIA);
    const ultimoDia = new DateReal(DIA.getTime());
    ultimoDia.setDate(ultimoDia.getDate() - (m.dias - 1));
    for (let r = folha._dados.length + 1; r <= alvo; r++) {
      const l = linhaModelo.slice();
      const diaOffset = Math.floor((r - linhaBase - 1) / porDia);
      /* A PICAGENS é acrescentada por ordem CRONOLÓGICA: a linha mais
         antiga primeiro. Uma folha por ordem inversa é um caso que a
         otimização não cobre — e o teste tem de reproduzir a ordem real. */
      const d = new DateReal(ultimoDia.getTime());
      d.setDate(d.getDate() + diaOffset);
      const iso = cRef.formatarDataISO_(d);
      l[col('ID')] = 'PIC_ESCALA_' + r;
      l[col('Data')] = iso;
      l[col('DataHora')] = d;
      folha._dados.push(l);
    }
    /* A folha mockada tem dimensao maxima explicita (como a real). Sem
       isto, getDataRange() rebenta ao passar o limite e construirEntradaFolha_
       engole a excecao como se a folha estivesse vazia — a medicao devolvia
       zero e o teste passava sem estar a medir nada. */
    if (folha._dados.length > folha.maxRows) folha.maxRows = folha._dados.length;
    if (folha.getLastColumn() > folha.maxColumns) folha.maxColumns = folha.getLastColumn();

    /* O recorte tem de FUNCIONAR, nao apenas dar a resposta certa. Um
       fallback silencioso para a folha inteira daria os mesmos resultados
       e as mesmas notificas — e o teste passaria sem optimizacao nenhuma. */
    const janela = call('dadosFolhaIntervalo_', 'PICAGENS', 'Data', DIA_ISO, DIA_ISO);
    assinalar(!!janela, 'a folha PICAGENS, ordenada por data, admite recorte por dia');
    if (janela) {
      assinalar(janela.valores.length <= 64,
        'o recorte do dia traz poucas linhas (' + (janela.valores.length - 1) + '), nao a folha toda (' + (folha._dados.length - 1) + ')');
      assinalar(janela.mapa.Data !== undefined && janela.mapa.UserID !== undefined,
        'o recorte traz os cabececos: quem chama mapeia as colunas pelos nomes, nao por posicao');
    }

    const celulas = folha._dados.length * folha.getLastColumn();
    const c = novaExecucao();
    c.limparCacheFolhas_();
    LEITURAS = 0; LEITURAS_POR_FOLHA = {}; CONTAR_LEITURAS = true;
    let res = null, erro = null;
    try { res = c.obterDashboardAdministrativo(tokenHugo, DIA); } catch (e) { erro = e.message; }
    CONTAR_LEITURAS = false;

    /* Estimativa de tempo: cada celula lida de um Range e um objecto JS.
       O custo dominante em Apps Script e a serializacao da resposta, nao a
       leitura. Medimos a serializacao aqui porque e ela que enche o heap. */
    let bytes = 0;
    try { bytes = JSON.stringify(res).length; } catch (e) {}

    const registo = {
      anos: m.anos, linhas: folha._dados.length, celulas: celulas,
      leituras: LEITURAS, bytes: bytes, erro: erro, porFolha: LEITURAS_POR_FOLHA
    };

    relatorio.push(registo);

    assinalar(!erro, m.anos + ' ano(s) de picagens: o dashboard responde :: ' + (erro || 'ok'));
    assinalar(res && res.sucesso === true,
      m.anos + ' ano(s): o painel devolve os ' + (res && res.painel ? res.painel.length : 0) + ' utilizadores');

    /* O painel de um dia esta acotado. O RISCO real nao e ele: sao as
       listagens que pedem so 6 dias mas leem a folha PICAGENS INTEIRA para
       depois filtrar em JavaScript. O filtro nao poupa a leitura. */
    const c2 = novaExecucao(); c2.limparCacheFolhas_();
    LEITURAS = 0; LEITURAS_POR_FOLHA = {}; CONTAR_LEITURAS = true;
    let picagens = null, erroPic = null;
    try { picagens = c2.listarPicagens(tokenHugo, { dataInicio: DIA, dataFim: DIA }); } catch (e) { erroPic = e.message; }
    CONTAR_LEITURAS = false;
    let bytesListagem = 0;
    try { bytesListagem = JSON.stringify(picagens).length; } catch (e) {}

    registo.leituraListagem = LEITURAS;
    registo.picagensFolha = LEITURAS_POR_FOLHA['PICAGENS'] || 0;
    registo.mapaListagem = JSON.stringify(LEITURAS_POR_FOLHA);
    registo.bytesListagem = bytesListagem;
    registo.picagensDevolvidas = picagens && picagens.total !== undefined ? picagens.total : -1;
    registo.erroListagem = erroPic;
  });

  /* A folha tem de ser reposta: um cenario nao pode contaminar os seguintes. */
  folha._dados.length = linhaBase;

  relatorio.forEach(function (r) {
    console.log('    ESCALA ' + r.anos + ' ano(s): ' + r.linhas + ' linhas PICAGENS');
    console.log('      painel  do dia : ' + r.leituras + ' celulas lidas, ~' +
      Math.round(r.bytes / 1024) + ' KB de resposta');
    const topo = Object.keys(r.porFolha).sort(function (a, b) { return r.porFolha[b] - r.porFolha[a]; });
    topo.slice(0, 4).forEach(function (n) {
      console.log('           ' + n + ' -> ' + r.porFolha[n] + ' celulas');
    });
    console.log('      listagem 6 dias: ' + r.picagensFolha + ' celulas lidas na PICAGENS, ' +
      r.picagensDevolvidas + ' picagens devolvidas, ~' + Math.round(r.bytesListagem / 1024) + ' KB' +
      ' [total=' + r.leituraListagem + ' erro=' + r.erroListagem + ']');
  });

  /* A data de cada dia é uma janela contígua. O recorte é feito ANTES da
     leitura — filtrar em JavaScript depois pagaria a folha inteira. A
     invalidação é por folha: guardar DIAS_TRABALHO não obriga a reler o
     índice de PICAGENS para cada pessoa. */
  const um = relatorio[0], dois = relatorio[relatorio.length - 1];
  const razao = dois.leituras / um.leituras;
  const fracaoIntegral = dois.leituras / dois.celulas;
  const fracaoListagem = dois.picagensFolha / dois.celulas;
  console.log('    RAZAO de custo (2 anos / 1 ano): ' + razao.toFixed(2) +
    'x; painel = ' + (fracaoIntegral * 100).toFixed(1) +
    '% da PICAGENS integral; listagem = ' + (fracaoListagem * 100).toFixed(1) + '%');

  assinalar(razao < 2.2,
    'o painel nao cresce de forma desproporcionada ao duplicar o historico :: ' + razao.toFixed(2) + 'x');
  assinalar(fracaoIntegral < 0.2,
    'com 2 anos, o painel le menos de 20% da PICAGENS integral :: ' +
    (fracaoIntegral * 100).toFixed(1) + '%');
  assinalar(fracaoListagem < 0.2,
    'a listagem tambem esta acotada e nao le a folha inteira :: ' +
    (fracaoListagem * 100).toFixed(1) + '%');
  assinalar(dois.leituras < 50000,
    'com 2 anos, o painel continua abaixo de 50 mil celulas lidas :: ' + dois.leituras);
  assinalar(um.leituras < 50000,
    'com 1 ano, o painel continua abaixo de 50 mil celulas lidas :: ' + um.leituras);
})();


/* ================= RESUMO ================= */
console.log(registo.join('\n'));
console.log('\n============================================');
console.log(falhas === 0 ? 'SIMULACAO: TODOS OS CENARIOS PASSARAM' : 'SIMULACAO: ' + falhas + ' problema(s)');
console.log('AVISOS (potenciais problemas): ' + avisos);
console.log('============================================');
process.exit(falhas === 0 ? 0 : 1);




