/* Fila de pedidos pendentes de aprovação do gestor.
   Guardada em JSON local — sem base de dados paga. */
const fs = require('fs');
const path = require('path');

const FICHA = path.join(__dirname, '..', 'dados', 'pendentes.json');

function ler() {
  try {
    if (!fs.existsSync(FICHA)) return [];
    return JSON.parse(fs.readFileSync(FICHA, 'utf8'));
  } catch (e) { return []; }
}
function guardar(lista) { fs.writeFileSync(FICHA, JSON.stringify(lista, null, 1)); }

function gestorJid() {
  const n = (process.env.NUMERO_GESTOR || '').replace(/\D/g, '');
  return n ? n + '@s.whatsapp.net' : '551@s.whatsapp.net';
}

function criar({ tipo, cliente, texto, dados, eventoId }) {
  const lista = ler();
  const p = {
    id: 'PED' + Date.now().toString(36).toUpperCase(),
    tipo, cliente, texto,
    dados: dados || null,
    eventoId: eventoId || null,
    estado: 'PENDENTE',
    criadoEm: new Date().toISOString(),
    gestorJid: gestorJid()
  };
  lista.push(p);
  guardar(lista);
  return p;
}

function ultimoPendente() {
  const lista = ler().filter((p) => p.estado === 'PENDENTE');
  return lista[lista.length - 1] || null;
}

function aprovar(id, ev) {
  const lista = ler();
  const p = lista.find((x) => x.id === id);
  if (p) { p.estado = 'APROVADO'; p.evento = ev ? ev.resumo : ''; }
  guardar(lista);
  return p;
}

function recusar(id) {
  const lista = ler();
  const p = lista.find((x) => x.id === id);
  if (p) p.estado = 'RECUSADO';
  guardar(lista);
  return p;
}

function resumo() {
  const lista = ler().filter((p) => p.estado === 'PENDENTE');
  if (!lista.length) return 'Sem pendentes.';
  return 'Pendentes:\n' + lista.map((p) =>
    '• ' + p.id + ' | ' + p.tipo + ' | ' + (p.dados ? (p.dados.animal + ' ' + p.dados.dia + ' ' + p.dados.hora) : p.texto.slice(0, 60))
  ).join('\n') + '\nResponda OK ou NÃO.';
}

module.exports = { criar, ultimoPendente, aprovar, recusar, resumo };
