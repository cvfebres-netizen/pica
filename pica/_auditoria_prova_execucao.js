/* ==========================================================================
   PROVA EXECUTAVEL da exposicao.

   Carrega os 13 ficheiros .gs num contexto vm e instrumenta o contexto
   com um Proxy que regista TODA a funcao global lida durante a chamada.

   Metodo: nao pergunta "a funcao tem guarda?" ao texto — pergunta
   "a execucao passou por uma guarda?". Se `exigirSessao_` (ou outra
   guarda) nunca aparecer no rastro, a funcao NAO autenticou ninguem.
   Compara com os invólucros protegidos, que devem mostrar a guarda.

   node _auditoria_prova_execucao.js
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = __dirname;
const ficheiros = fs.readdirSync(dir).filter(function (f) { return f.endsWith('.gs'); }).sort();

/* --- Ambiente Apps Script minimo, so o que o arranque exige. --------- */
const semSheets = {
  getSheetByName: function () { return null; },
  getDataRange: function () { return { getValues: function () { return []; } }; },
  getLastRow: function () { return 1; },
  getLastColumn: function () { return 0; }
};
const fakeSS = {
  getSheetByName: function () { return semSheets; },
  getSpreadsheetTimeZone: function () { return 'Europe/Lisbon'; }
};

/* NAO passamos Math/Date/JSON/etc.: o vm cria os seus proprios
   intrinsics. Injetar os do host mistura dimensoes e quebra
   `d.toISOString()` — foi o que fez a primeira execucao falhar. */
const stubs = {
  SpreadsheetApp: {
    getActive: function () { return null; }, flush: function () {}, app: {},
    getUi: function () { return null; }
  },
  Session: {
    getActiveUser: function () { return null; },
    getEffectiveUser: function () { return null; },
    getScriptTimeZone: function () { return 'Europe/Lisbon'; }
  },
  LockService: {
    getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; }
  },
  CacheService: {
    getScriptCache: function () {
      return { get: function () { return null; }, put: function () {}, remove: function () {} };
    }
  },
  PropertiesService: {
    getScriptProperties: function () {
      return {
        getProperty: function () { return null; },
        setProperty: function () {}, deleteProperty: function () {}
      };
    }
  },
  Utilities: {
    getUuid: function () { return '00000000-0000-0000-0000-000000000000'; },
    sleep: function () {},
    /* Ordem real: Utilities.formatDate(data, fuso, formato).
       Não usar toISOString: a data que chega pode ser um Date criado
       dentro do contexto, e este stub corre no host. */
    formatDate: function (data, fuso, formato) {
      if (!data || typeof data.getFullYear !== 'function') return String(data);
      if (String(formato) === 'yyyy-MM-dd') {
        const m = String(data.getMonth() + 1); const d = String(data.getDate());
        return data.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) +
          '-' + (d.length < 2 ? '0' + d : d);
      }
      return String(data);
    },
    base64Encode: function (s) { return Buffer.from(String(s)).toString('base64'); },
    base64Decode: function (s) { return Buffer.from(String(s), 'base64').toString(); }
  },
  HtmlService: {
    createTemplateFromFile: function () { return { evaluate: function () { return {}; } }; },
    createHtmlOutput: function () { return { setTitle: function () { return this; } }; },
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' }
  },
  DriveApp: { getFolderById: function () { return null; } },
  Browser: { InputBox: function () { return { show: function () { return null; } }; } }
};

const contexto = Object.assign({}, stubs);
vm.createContext(contexto);
ficheiros.forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), contexto, { filename: f });
});

/* Substitui o acesso ao livro: esta e' uma prova de AUTORIZACAO, nao de
   dados. O que interessa e' saber se a funcao exige token ANTES de tentar
   ler seja o que for. */
contexto.__FAKE_SS__ = fakeSS;
vm.runInContext('var getSpreadsheet_ = function () { return __FAKE_SS__; };', contexto);

/* --- Instrumentacao das guardas. --------------------------------------
   Um Proxy no contexto NAO funciona: dentro do vm o contexto E' o
   objecto global, e a leitura de uma variavel global nao passa por
   nenhum `get`. A forma que funciona e' reescrever cada guarda com um
   invólucro que regista a chamada e delega na original — assim o rastro
   e' do que REALMENTE correu, nao do que o texto parece. */
const GUARDAS = [
  'exigirSessao_', 'exigirAdmin_', 'exigirOperacional_',
  'validarSessao_', 'autorizarOperacaoSensivel_'
];

let rastro = [];
const originais = {};

GUARDAS.forEach(function (nome) {
  if (typeof contexto[nome] !== 'function') {
    throw new Error('Guarda inexistente no codigo: ' + nome + ' — a prova seria invalida.');
  }
  originais[nome] = contexto[nome];
  contexto[nome] = function () {
    if (rastro.indexOf(nome) < 0) rastro.push(nome);
    return originais[nome].apply(this, arguments);
  };
});

function executar(rotulo, expr) {
  rastro = [];
  let ok = true, msg = '';
  try {
    const v = vm.runInContext(expr, contexto);
    if (v && typeof v === 'object') {
      const chaves = Object.keys(v);
      msg = 'PAYLOAD(' + chaves.length + ' campos): ' + chaves.slice(0, 14).join(', ');
    } else {
      msg = 'devolveu ' + JSON.stringify(v);
    }
  } catch (e) {
    ok = false;
    msg = 'EXCEPTOU: ' + e.message;
  }
  return {
    rotulo: rotulo, ok: ok, msg: msg,
    guardas: GUARDAS.filter(function (g) { return rastro.indexOf(g) >= 0; })
  };
}

/* --- Onde esta, de fato, cada funcao ---------------------------------
   Os rotulos `interior(Ficheiro.gs:NNN)` eram escritos a mao e
   envelheceram sem ninguem dar por isso: `calcularDia_` mudou de linha
   e o rotulo continuou a dizer 254. O rotulo passa a ser calculado a
   partir do disco, e um rotulo guardado que descorde do codigo passa a
   ser uma FALHA — assim a prova nunca volta a mentir sobre onde esta
   cada coisa. */
const fontes = {};
ficheiros.forEach(function (f) { fontes[f] = fs.readFileSync(path.join(dir, f), 'utf8'); });

function local(nome) {
  const re = new RegExp('^function\\s+' + nome + '\\s*\\(');
  for (let i = 0; i < ficheiros.length; i++) {
    const linhas = fontes[ficheiros[i]].split('\n');
    for (let k = 0; k < linhas.length; k++) {
      if (re.test(linhas[k])) return { ficheiro: ficheiros[i], linha: k + 1 };
    }
  }
  return null;
}

/* Cada caso declara O QUE PROVA. O veredito vem do campo `prova`, e nao
   de `if (rotulo.indexOf('NUCLEO') >= 0)`: era essa leitura do rotulo
   que fazia o caso do alias removido cair na branch dos invólucros e
   contar uma falha eterna, porque "nao existe" nao deixa rasto de
   guardas. Aqui a AUSENCIA e' o objectivo, entao e' o que se exige. */
const CASOS = [
  { rotulo: 'calcularDia_(userId, data)',      nome: 'calcularDia_',
    expr: "calcularDia_('U_PEDRO', '2026-09-25')", prova: 'NUCLEO' },
  { rotulo: 'calcularDia(userId, data)',       nome: 'calcularDia',
    expr: "calcularDia('U_PEDRO', '2026-09-25')", prova: 'REMOVIDA' },
  { rotulo: 'calcularMeuDia(token, data)',      nome: 'calcularMeuDia',
    expr: "calcularMeuDia(undefined, '2026-09-25')", prova: 'INVOLUCRO' },
  { rotulo: 'calcularDiaAdmin(token,id,data)', nome: 'calcularDiaAdmin',
    expr: "calcularDiaAdmin(undefined, 'U_PEDRO', '2026-09-25')", prova: 'INVOLUCRO' },
  { rotulo: 'listarUtilizadores(token)',        nome: 'listarUtilizadores',
    expr: 'listarUtilizadores(undefined)', prova: 'INVOLUCRO' },
  /* Os quatro aliases que WebApp.gs removeu por duplicados. A proteccao
     deles e' a AUSENCIA: enquanto `getMeuDia` nao existir, o dispatcher
     nao a alcanca. Um nome morto aqui e' exactamente o defeito que a
     remocaoevitou — se voltar, esta prova tem de falhar. */
  { rotulo: 'getEstadoHoje(token)',   nome: 'getEstadoHoje',   expr: 'getEstadoHoje(undefined)', prova: 'REMOVIDA' },
  { rotulo: 'getMeuDia(token, data)', nome: 'getMeuDia',      expr: "getMeuDia(undefined, '2026-09-25')", prova: 'REMOVIDA' },
  { rotulo: 'getResumoColaborador(t,i,d)', nome: 'getResumoColaborador',
    expr: "getResumoColaborador(undefined, 'U_PEDRO', '2026-09-25')", prova: 'REMOVIDA' },
  { rotulo: 'getPendentesAdministrativos(token)', nome: 'getPendentesAdministrativos',
    expr: 'getPendentesAdministrativos(undefined)', prova: 'REMOVIDA' }
];

const testes = CASOS.map(function (c) {
  const onde = local(c.nome);
  const t = executar(c.rotulo + (onde ? '  [' + onde.ficheiro + ':' + onde.linha + ']' : '  [sem localizacao]'),
    c.expr);
  t.prova = c.prova;
  t.nome = c.nome;
  t.onde = onde;
  return t;
});

const linhas = [];
function dizer(s) { linhas.push(s); console.log(s); }

dizer('=== PROVA EXECUTAVEL: a execucao passou por uma guarda? ===');
dizer('');

let falhas = 0;
testes.forEach(function (t) {
  dizer(t.rotulo);
  dizer('   resultado : ' + t.msg);
  dizer('   guardas   : ' + (t.guardas.length ? t.guardas.join(', ') : 'NENHUMA'));
  dizer('');

  if (t.prova === 'NUCLEO') {
    /* O nucleo devolve dados sem tocar numa guarda — e e' por isso que
       terminou em `_`: se o nome publico `calcularDia` existisse, o
       dispatcher entregaria o dia de um userId arbitrario a qualquer
       visitante. O caso REMOVIDA logo abaixo prova que ja nao acontece. */
    if (!t.ok) { dizer('   !! INESPERADO: excepcionou — a prova esta errada'); falhas++; }
    else if (t.guardas.length) { dizer('   !! INESPERADO: passou por guarda'); falhas++; }
    else dizer('   >>> CONFIRMADO: o motor calcula sem guarda (por isso ficou interno)');
  } else if (t.prova === 'REMOVIDA') {
    /* Um nome que NAO existe nao e' "falhou por outro motivo": e' o
       objectivo. A proteccao e' a AUSENCIA da funcao, porque nao ha
       nada para o dispatcher alcançar. Por isso nao se pode exigir um
       rastro de guardas — nao ha codigo para correr. */
    if (!t.onde) {
      dizer('   >>> CONFIRMADO: `' + t.nome + '` nao existe na superficie publica (o dispatcher nao a alcanca)');
    } else {
      dizer('   !! FALHA GRAVE: `' + t.nome + '` VOLTOU A EXISTIR em ' +
        t.onde.ficheiro + ':' + t.onde.linha + ' — um alias publico e' + "'" +
        ' uma porta de entrada a mais no dispatcher');
      falhas++;
    }
  } else {
    /* Os invólucros têm de recusar quem não tem token E de o fazer
       passando por uma guarda: um erro qualquer (uma assinatura errada,
       por exemplo) não prova que a autorização está lá. */
    if (t.ok) { dizer('   !! INESPERADO: devolveu dados sem token'); falhas++; }
    else if (!t.guardas.length) { dizer('   !! falhou por outro motivo (sem guarda no rastro): ' + t.msg); falhas++; }
    else dizer('   >>> CONFIRMADO: recusou pela guarda (' + t.guardas[0] + ')');
  }
});

console.log('FALHAS_PROVA:' + falhas);

/* grava em ficheiro: em execucao nao-interactiva o stdout pode perder-se */
fs.writeFileSync(path.join(require('os').tmpdir(), 'prova_execucao.txt'),
  linhas.join('\n') + '\nFALHAS_PROVA:' + falhas + '\n', 'utf8');

process.exitCode = falhas ? 1 : 0;
