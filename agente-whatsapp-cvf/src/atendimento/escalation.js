/* Escalation: após N mensagens não percebidas do mesmo cliente,
   avisa o gestor para pegar a conversa. Estado em JSON local. */
const fs = require('fs');
const path = require('path');

const FICHA = path.join(__dirname, '..', 'dados', 'escalation.json');
const LIMITE = 2;

function ler() {
  try {
    if (!fs.existsSync(FICHA)) return {};
    return JSON.parse(fs.readFileSync(FICHA, 'utf8'));
  } catch (e) { return {}; }
}
function guardar(obj) { fs.writeFileSync(FICHA, JSON.stringify(obj, null, 1)); }

function chave(jid) { return String(jid).replace(/\D/g, ''); }

function registarFalha(jid) {
  const obj = ler();
  const c = chave(jid);
  obj[c] = (obj[c] || 0) + 1;
  guardar(obj);
  return obj[c];
}

function resetar(jid) {
  const obj = ler();
  const c = chave(jid);
  if (obj[c] !== undefined) { delete obj[c]; guardar(obj); }
}

function deveEscalar(jid) {
  const obj = ler();
  return (obj[chave(jid)] || 0) >= LIMITE;
}

module.exports = { registarFalha, resetar, deveEscalar, LIMITE };
