/* Histórico de atendimentos por cliente.
   Guardado em src/dados/historico.json — sem base de dados paga.
   Cada entrada: { cliente, tipo, servico, animal, especie, dataHora, eventoId, estado, criadoEm }
   TTL: entradas com mais de 2 anos são removidas para não crescer indefinidamente. */
const fs = require('fs');
const path = require('path');

const FICHA = path.join(__dirname, '..', 'dados', 'historico.json');
const HISTORICO_TTL_MS = 2 * 365 * 24 * 60 * 60 * 1000; // 2 anos

function ler() {
  try {
    if (!fs.existsSync(FICHA)) return [];
    return JSON.parse(fs.readFileSync(FICHA, 'utf8'));
  } catch (e) { return []; }
}
function guardar(lista) { fs.writeFileSync(FICHA, JSON.stringify(lista, null, 1)); }

function chaveCliente(jid) { return String(jid).replace(/\D/g, ''); }

function agora() { return Date.now(); }

function limparExpirados(lista) {
  const agoraMs = agora();
  const filtrada = lista.filter((e) => {
    const ts = e.criadoEm ? new Date(e.criadoEm).getTime() : 0;
    return agoraMs - ts <= HISTORICO_TTL_MS;
  });
  if (filtrada.length !== lista.length) guardar(filtrada);
  return filtrada;
}

/* Regista um atendimento concluído (após aprovação do gestor). */
function registar({ cliente, tipo, servico, animal, especie, dataHora, eventoId, estado }) {
  let lista = ler();
  lista = limparExpirados(lista);
  const entrada = {
    id: 'HIST' + Date.now().toString(36).toUpperCase(),
    cliente: cliente,
    tipo: tipo || 'marcar',
    servico: servico || 'consulta',
    animal: animal || '',
    especie: especie || '',
    dataHora: dataHora || new Date().toISOString(),
    eventoId: eventoId || null,
    estado: estado || 'CONFIRMADO',
    criadoEm: new Date().toISOString()
  };
  lista.push(entrada);
  guardar(lista);
  return entrada;
}

/* Devolve o histórico de um cliente (número de telefone, com ou sem @s.whatsapp.net). */
function listar(cliente) {
  const c = chaveCliente(cliente);
  return ler().filter((e) => chaveCliente(e.cliente) === c);
}

/* Devolve o último atendimento de um cliente. */
function ultimo(cliente) {
  const lista = listar(cliente);
  return lista.length ? lista[lista.length - 1] : null;
}

/* Devolve todos os atendimentos (para o painel web). */
function todos() { return ler(); }

module.exports = { registar, listar, ultimo, todos };
