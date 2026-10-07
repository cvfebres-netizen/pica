/* ============================================================
   _harness.js — mocks de Sheets/Apps Script com os limites REAIS
   Ficheiro local de teste. NAO vai para o Apps Script.
   Exposto por require('./_harness.js').

   Este mock e' FIEL, nao apertado: uma folha tem 10 000 000 x 18 278
   (limite do Google). Um mock com 1000 linhas da FALSO-VERDE — rejeita
   leituras que sao legais na producao.
   ============================================================ */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const GOOGLE = {
  EXEC_MIN: 6,            // 6 min por execucao: DURA, nao negociavel
  TRIGGER_HORAS_DIA: 6,   // 6 h/dia POOL de todos os triggers
  MAX_LINHAS: 10000000,
  MAX_COLUNAS: 18278,
  MAX_CELULAS_RANGE: 10 * 1000 * 1000 * 18 * 1000
};

const FICHEIROS = fs.readdirSync(__dirname).filter(function (f) { return f.endsWith('.gs'); });
const SRC = {};
FICHEIROS.forEach(function (f) { SRC[f] = fs.readFileSync(path.join(__dirname, f), 'utf8'); });
const codigo = FICHEIROS.map(function (f) { return '\n/* == ' + f + ' == */\n' + SRC[f]; }).join('\n');

/* --- contadores de celulas lidas --- */
let LEITURAS = 0, LEITURAS_POR_FOLHA = {}, CONTAR = false;
function zerarContador() { LEITURAS = 0; LEITURAS_POR_FOLHA = {}; CONTAR = true; }
function pararContador() { CONTAR = false; return LEITURAS; }
function contar(n, nome) { if (!CONTAR) return; LEITURAS += n; LEITURAS_POR_FOLHA[nome] = (LEITURAS_POR_FOLHA[nome] || 0) + n; }

let FOLHAS = [];
function criarRange(f, r, c, nr, nc) {
  if (r < 1 || c < 1 || nr < 1 || nc < 1 ||
      (r + nr - 1) > GOOGLE.MAX_LINHAS || (c + nc - 1) > GOOGLE.MAX_COLUNAS) {
    throw new Error('The coordinates or dimensions of the range are invalid.');
  }
  if (nr * nc > GOOGLE.MAX_CELULAS_RANGE) throw new Error('Range exceeds the maximum number of cells.');
  const rg = {
    getValues: function () {
      contar(nr * nc, f._nome);
      const out = [];
      for (let i = 0; i < nr; i++) {
        const l = f._dados[r - 1 + i] || [], linha = [];
        for (let j = 0; j < nc; j++) { const v = l[c - 1 + j]; linha.push(v === undefined || v === null ? '' : v); }
        out.push(linha);
      }
      return out;
    },
    getValue: function () { contar(1, f._nome); const v = (f._dados[r - 1] || [])[c - 1]; return v === undefined || v === null ? '' : v; },
    setValue: function (v) { rg._p(r, c, v); return rg; },
    setValues: function (vs) { for (let i = 0; i < vs.length; i++) for (let j = 0; j < vs[i].length; j++) rg._p(r + i, c + j, vs[i][j]); return rg; },
    clearContent: function () { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) rg._p(r + i, c + j, ''); return rg; },
    setNumberFormat: function () { return rg; },
    setFontWeight: function () { return rg; },
    setBackground: function () { return rg; },
    setHorizontalAlignment: function () { return rg; },
    getA1Notation: function () { return f._nome + '!R' + r + 'C' + c; },
    getNumRows: function () { return nr; },
    getNumColumns: function () { return nc; },
    getLastRow: function () { return r + nr - 1; },
    getLastColumn: function () { return c + nc - 1; },
    _p: function (rr, cc, v) {
      while (f._dados.length < rr) f._dados.push([]);
      const l = f._dados[rr - 1];
      while (l.length < cc) l.push('');
      l[cc - 1] = v;
    },
    protect: function () {
      const p = {
        setDescription: function () { return p; },
        setWarningOnly: function () { return p; },
        getRange: function () { return { getA1Notation: function () { return 'R'; } }; }
      };
      return p;
    }
  };
  return rg;
}

function criarFolha(nome) {
  const f = {
    _nome: nome, _dados: [],
    getName: function () { return nome; },
    getLastRow: function () {
      let u = 0;
      for (let i = 0; i < f._dados.length; i++) {
        const l = f._dados[i] || [];
        for (let j = 0; j < l.length; j++) { const v = l[j]; if (v !== undefined && v !== null && v !== '') { u = i + 1; break; } }
      }
      return u;
    },
    getLastColumn: function () {
      let u = 0;
      for (let i = 0; i < f._dados.length; i++) {
        const l = f._dados[i] || [];
        for (let j = 0; j < l.length; j++) { const v = l[j]; if (v !== undefined && v !== null && v !== '') u = Math.max(u, j + 1); }
      }
      return u;
    },
    getMaxRows: function () { return GOOGLE.MAX_LINHAS; },
    getMaxColumns: function () { return GOOGLE.MAX_COLUNAS; },
    getDataRange: function () { return criarRange(f, 1, 1, Math.max(f.getLastRow(), 1), Math.max(f.getLastColumn(), 1)); },
    getRange: function (r, c, nr, nc) { return criarRange(f, r, c, nr || 1, nc || 1); },
    appendRow: function (v) { f._dados.push((v || []).slice()); },
    /* deleteRows existe porque podarSessoesAntigas_() usa. Sem este metodo no
       mock, a poda rebentava com "is not a function", o try/catch engolia o
       erro e a suite passava sem ter testado nada — o mesmo tipo de buraco
       que o waitLock devolvendo `undefined`. A Sheets apaga de uma vez, por
       isso aqui tambem: um splice, nao um loop de remoções. */
    deleteRows: function (pos, n) {
      contar((n || 0) * Math.max(f.getLastColumn(), 1), f._nome);
      f._dados.splice(pos - 1, n || 0);
    },
    insertColumnsAfter: function () {}, insertRowsAfter: function () {},
    setFrozenRows: function () {}, autoResizeColumns: function () {},
    getProtections: function () { return []; },
    deleteRow: function (r) { f._dados.splice(r - 1, 1); }
  };
  return f;
}

const SS = {
  getId: function () { return 'SS_SIM'; },
  getUrl: function () { return 'https://docs.google.com/spreadsheets/d/SS_SIM/edit'; },
  getSheetByName: function (n) { for (let i = 0; i < FOLHAS.length; i++) if (FOLHAS[i]._nome === n) return FOLHAS[i]; return null; },
  insertSheet: function (n) { const f = criarFolha(n); FOLHAS.push(f); return f; },
  getSheets: function () { return FOLHAS.slice(); },
  setSpreadsheetTimeZone: function () {},
  getSpreadsheetTimeZone: function () { return 'Europe/Lisbon'; }
};
const SpreadsheetApp = {
  getActiveSpreadsheet: function () { return SS; },
  getActive: function () { return SS; },
  openById: function (id) { if (String(id) === 'SS_SIM') return SS; throw new Error('Documento não encontrado: ' + id); },
  create: function () { return SS; },
  flush: function () {},
  ProtectionType: { RANGE: 'RANGE', SHEET: 'SHEET' }
};
function uuid() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }); }
function pad(n) { return String(n).length < 2 ? '0' + n : String(n); }
const Utilities = {
  getUuid: uuid,
  formatDate: function (d, tz, fmt) {
    if (!(d instanceof Date) || isNaN(d.getTime())) throw new Error('Invalid date');
    return String(fmt)
      .replace('yyyy', d.getFullYear()).replace('MM', pad(d.getMonth() + 1)).replace('dd', pad(d.getDate()))
      .replace('HH', pad(d.getHours())).replace('mm', pad(d.getMinutes())).replace('ss', pad(d.getSeconds()));
  },
  sleep: function () {},
  getScriptId: function () { return 'SCRIPT_ID'; },
  base64Encode: function (s) { return Buffer.from(String(s), 'utf8').toString('base64'); },
  base64Decode: function (s) { return Buffer.from(String(s), 'base64').toString('utf8'); }
};
/* LockService com CONCORRENCIA REAL: waitLock devolve FALSE se outro
   ambito ja' segura a lock — igual ao Google. */
const LOCKS = { script: false };
const LOCK_REAL = {
  waitLock: function () { if (!LOCKS.script) { LOCKS.script = true; return true; } return false; },
  releaseLock: function () { LOCKS.script = false; },
  tryLock: function () { if (LOCKS.script) return null; LOCKS.script = true; return { releaseLock: function () { LOCKS.script = false; } }; }
};
const LockService = {
  getScriptLock: function () { return LOCK_REAL; },
  getUserLock: function () { return LOCK_REAL; },
  getDocumentLock: function () { return LOCK_REAL; }
};
const PROPS = {};
function propsBag() {
  return {
    getProperty: function (k) { return PROPS[k] === undefined ? null : PROPS[k]; },
    setProperty: function (k, v) { PROPS[k] = String(v); },
    getProperties: function () { return PROPS; },
    deleteProperty: function (k) { delete PROPS[k]; }
  };
}
const PropertiesService = { getScriptProperties: propsBag, getDocumentProperties: propsBag };
const TRIGGERS = [];
const ScriptApp = {
  /* `getHandlerFunction()` e' o nome REAL do metodo (o mock so tinha
     `getHandler`, que nao existe no Apps Script), e e' o que
     `garantirTriggerManutencao_()` usa para ver se o trigger ja existe. */
  newTrigger: function (f) { const t = { handler: f, getHandler: function () { return f; }, getHandlerFunction: function () { return f; } }; TRIGGERS.push(t); return t; },
  getProjectTriggers: function () { return TRIGGERS.slice(); },
  deleteTrigger: function () {}
};
const HtmlService = {
  createHtmlOutput: function () { const o = { setTitle: function () { return o; }, addMetaTag: function () { return o; }, setXFrameOptionsMode: function () { return o; } }; return o; },
  createTemplateFromFile: function () { return { evaluate: function () { return { setTitle: function () { return {}; } }; } }; },
  XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' }
};
const Session = { getActiveUser: function () { return { getEmail: function () { return 'pedromds84@gmail.com'; } }; } };

let AGORA = null;
class DateFalsa extends Date {
  constructor(...a) { super(...(a.length === 0 && AGORA ? [AGORA.getTime()] : a)); }
}
DateFalsa.now = function () { return AGORA ? AGORA.getTime() : Date.now(); };
DateFalsa.parse = Date.parse;
DateFalsa.UTC = Date.UTC;
function fixarAgora(y, m, d, h, mi) { AGORA = new Date(y, m - 1, d, h || 0, mi || 0, 0, 0); }

const SANDBOX = {
  SpreadsheetApp: SpreadsheetApp, Utilities: Utilities, LockService: LockService,
  PropertiesService: PropertiesService, ScriptApp: ScriptApp, HtmlService: HtmlService,
  Session: Session, Date: DateFalsa, Object: Object, Array: Array, Math: Math, JSON: JSON,
  Number: Number, String: String, Boolean: Boolean, RegExp: RegExp, Error: Error,
  TypeError: TypeError, RangeError: RangeError, isNaN: isNaN, parseInt: parseInt,
  parseFloat: parseFloat, console: console
};

function novaExecucao() {
  const c = vm.createContext(Object.assign({}, SANDBOX));
  vm.runInContext(codigo, c, { filename: 'backend.gs' });
  return c;
}
function preparar(opts) {
  const o = opts || {};
  FOLHAS = [];
  TRIGGERS.length = 0;
  for (const k in PROPS) delete PROPS[k];
  LOCKS.script = false;
  AGORA = null;
  const c = novaExecucao();
  if (!o.semInstalar && typeof c.instalarSistemaComCredenciais === 'function') c.instalarSistemaComCredenciais();
  return c;
}
function comoAdmin(c) {
  const r = c.autenticarUtilizador('pedromds84@gmail.com', 'pedromds84');
  return r && r.token ? r.token : null;
}
/* Nomes realmente DECLARADOS no codigo do projecto. O dispatcher
   google.script.run so' expoe funcoes definidas no script — os globais
   do host (parseFloat, Math, Date, Array...) NAO sao alcancaveis. Sem
   este filtro, a contagem de "funcoes sem guarda" encheria-se de
   falsos positivos de biblioteca. */
const DECLARADAS = (function () {
  const set = {};
  const re = /function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  FICHEIROS.forEach(function (f) {
    let m;
    const s = SRC[f];
    while ((m = re.exec(s))) set[m[1]] = true;
  });
  /* Globais declarados com var/let/const que sejam funcoes */
  const re2 = /(?:var|let|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*function\b/g;
  FICHEIROS.forEach(function (f) {
    let m;
    const s = SRC[f];
    while ((m = re2.exec(s))) set[m[1]] = true;
  });
  return set;
})();
/* O dispatcher do frontend e' google.script.run[nome](...) — invocacao
   dinamica. Tudo o que NAO termina em _ e' alcancavel por um visitante. */
function superficiePublica(c) {
  return Object.keys(c).filter(function (k) {
    if (k === 'length' || k === 'name' || /_$/.test(k)) return false;
    if (!DECLARADAS[k]) return false;   /* nao e' do projecto: inalcancavel */
    const v = c[k];
    return typeof v === 'function' || (v && typeof v === 'object' && v.constructor === Function);
  }).sort();
}
function declaradaNoProjecto(nome) { return !!DECLARADAS[nome]; }
/* Percorre o corpo de uma funcao no texto fonte, respeitando aninhamento. */
function corpoDaFuncao(fonte, nome) {
  const re = new RegExp('function\\s+' + nome + '\\s*\\([^)]*\\)\\s*\\{');
  const m = re.exec(fonte);
  if (!m) return null;
  const inicio = m.index + m[0].length;
  /* BUG ANTERIOR: prof comecava a 0, mas a chave de abertura JA foi
     consumida por m[0]. Com prof=0, o primeiro '}' fecha a funcao e da
     prof=-1, que nunca iguala 0 — a funcao nao devolvia corpo nenhum, ou
     devolvia o corpo de umTRY/CATCH truncado. Comeca-se em 1. */
  let prof = 1;
  for (let i = inicio; i < fonte.length; i++) {
    if (fonte[i] === '{') prof++;
    else if (fonte[i] === '}') { prof--; if (prof === 0) return { inicio: inicio, fim: i, texto: fonte.slice(inicio, i), linha: fonte.slice(0, m.index).split('\n').length }; }
  }
  return null;
}

module.exports = {
  GOOGLE: GOOGLE, SRC: SRC, FICHEIROS: FICHEIROS, codigo: codigo,
  LOCKS: LOCKS, TRIGGERS: TRIGGERS, PROPS: PROPS, LOCK_REAL: LOCK_REAL,
  folhas: function () { return FOLHAS; },
  criarFolha: criarFolha,
  novaExecucao: novaExecucao, preparar: preparar, comoAdmin: comoAdmin,
  superficiePublica: superficiePublica, declaradaNoProjecto: declaradaNoProjecto,
  corpoDaFuncao: corpoDaFuncao,
  zerarContador: zerarContador, pararContador: pararContador,
  leituras: function () { return LEITURAS; },
  leiturasPorFolha: function () { return LEITURAS_POR_FOLHA; },
  fixarAgora: fixarAgora
};
