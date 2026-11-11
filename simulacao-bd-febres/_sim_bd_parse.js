/* SIMULACAO BD vetmanag (parte 1/3): streaming parser do dump SQL.
   Uso: node _simular_bd.js — ver _sim_bd_parse.js, _sim_bd_main.js */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const BD = path.join(__dirname, 'base-de-dados');
const SQL = path.join(BD, 'vetmanag_vm_febres_20261014_171835.sql');
function partirTuplos(s) {
  const out = [];
  let nivel = 0, atual = '', emStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (emStr) {
      atual += ch;
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === "'") {
        if (s[i + 1] === "'") { atual += "'"; i++; }
        else emStr = false;
      }
      continue;
    }
    if (ch === "'") { emStr = true; atual += ch; }
    else if (ch === '(') { nivel++; atual += ch; }
    else if (ch === ')') {
      nivel--; atual += ch;
      if (nivel === 0) { out.push(atual.trim()); atual = ''; }
    } else if (nivel > 0) atual += ch;
    /* nivel 0 fora de string: virgula/whitespace entre tuplos — ignorar */
  }
  return out;
}
function parseTuplo(t) {
  const inner = t.replace(/^\(/, '').replace(/\)$/, '');
  const vals = [];
  let atual = '', emStr = false, esc = false;
  const partes = [];
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (emStr) {
      atual += ch;
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === "'") {
        if (inner[i + 1] === "'") { atual += "'"; i++; }
        else emStr = false;
      }
      continue;
    }
    if (ch === "'") { emStr = true; atual += ch; }
    else if (ch === ',') { partes.push(atual.trim()); atual = ''; }
    else atual += ch;
  }
  partes.push(atual.trim());
  partes.forEach(function (p) {
    if (p === 'NULL') return vals.push(null);
    if (/^'.*'$/.test(p)) return vals.push(p.slice(1, -1).replace(/\\'/g, "'").replace(/''/g, "'"));
    const n = Number(p);
    vals.push(isNaN(n) ? p : n);
  });
  return vals;
}
module.exports = { BD: BD, SQL: SQL, partirTuplos: partirTuplos, parseTuplo: parseTuplo };
