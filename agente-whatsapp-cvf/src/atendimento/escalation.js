/* Escalation: após N mensagens não percebidas do mesmo cliente,
   avisa o gestor para pegar a conversa. Estado em JSON local.
   Inclui TTL (time-to-live): contadores expiram após 24h para não
   marcar clientes para sempre. */
const fs = require('fs');
const path = require('path');

const FICHA = path.join(__dirname, '..', 'dados', 'escalation.json');
const LIMITE = 2;
const TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

function ler() {
  try {
    if (!fs.existsSync(FICHA)) return {};
    return JSON.parse(fs.readFileSync(FICHA, 'utf8'));
  } catch (e) { return {}; }
}
function guardar(obj) { fs.writeFileSync(FICHA, JSON.stringify(obj, null, 1)); }

function chave(jid) { return String(jid).replace(/\D/g, ''); }

function agora() { return Date.now(); }

function limparExpirados(obj) {
  const agoraMs = agora();
  let mudou = false;
  for (const k of Object.keys(obj)) {
    if (agoraMs - (obj[k].ts || 0) > TTL_MS) {
      delete obj[k];
      mudou = true;
    }
  }
  if (mudou) guardar(obj);
  return obj;
}

function registarFalha(jid) {
  let obj = ler();
  obj = limparExpirados(obj);
  const c = chave(jid);
  obj[c] = obj[c] || { count: 0, ts: agora() };
  obj[c].count += 1;
  obj[c].ts = agora();
  guardar(obj);
  return obj[c].count;
}

function resetar(jid) {
  const obj = ler();
  const c = chave(jid);
  if (obj[c] !== undefined) { delete obj[c]; guardar(obj); }
}

function deveEscalar(jid) {
  const obj = ler();
  return (obj[chave(jid)]?.count || 0) >= LIMITE;
}

module.exports = { registarFalha, resetar, deveEscalar, LIMITE, TTL_MS };
