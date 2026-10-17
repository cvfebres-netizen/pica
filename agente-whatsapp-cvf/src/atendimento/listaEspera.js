/* Lista de espera para quando não há horários disponíveis.
   Guardado em src/dados/listaEspera.json.
   Cada entrada: { id, cliente, servico, animal, especie, dataPreferida, horaPreferida, contacto, criadoEm, estado }
   TTL: entradas em espera com mais de 30 dias expiram para não acumular. */
const fs = require('fs');
const path = require('path');

const FICHA = path.join(__dirname, '..', 'dados', 'listaEspera.json');
const LISTA_ESPERA_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

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
    // entradas já atendidas não expiram por TTL (ficam como registo)
    if (e.estado === 'ATENDIDO') return true;
    return agoraMs - ts <= LISTA_ESPERA_TTL_MS;
  });
  if (filtrada.length !== lista.length) guardar(filtrada);
  return filtrada;
}

/* Adiciona um cliente à fila de espera. */
function adicionar({ cliente, servico, animal, especie, dataPreferida, horaPreferida, contacto }) {
  let lista = ler();
  lista = limparExpirados(lista);
  const entrada = {
    id: 'ESP' + Date.now().toString(36).toUpperCase(),
    cliente: cliente,
    servico: servico || 'consulta',
    animal: animal || '',
    especie: especie || '',
    dataPreferida: dataPreferida || '',
    horaPreferida: horaPreferida || '',
    contacto: contacto || '',
    criadoEm: new Date().toISOString(),
    estado: 'ESPERA'
  };
  lista.push(entrada);
  guardar(lista);
  return entrada;
}

/* Devolve todas as entradas em espera. */
function listar() {
  let lista = ler();
  lista = limparExpirados(lista);
  return lista.filter((e) => e.estado === 'ESPERA');
}

/* Remove uma entrada da fila (quando é atendida). */
function remover(id) {
  let lista = ler();
  lista = limparExpirados(lista);
  const idx = lista.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  const removida = lista.splice(idx, 1)[0];
  removida.estado = 'ATENDIDO';
  guardar(lista);
  return removida;
}

/* Marca como atendida por ID. */
function atender(id) {
  const lista = ler();
  const e = lista.find((x) => x.id === id);
  if (e) { e.estado = 'ATENDIDO'; guardar(lista); }
  return e;
}

/* Devolve a próxima entrada para um serviço específico (FIFO). */
function proximo(servico) {
  const lista = listar();
  return lista.find((e) => e.servico === servico) || null;
}

module.exports = { adicionar, listar, remover, atender, proximo };
