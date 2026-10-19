/* Confirmações de presença (resposta SIM/NÃO ao lembrete) + follow-ups
   (ex: reforço de vacina daqui a N dias).
   Ficheiros: src/dados/confirmacoes.json, src/dados/followups.json
   TTL: pedidos de presença expiram 48h após criados; follow-ups enviados são removidos. */
const fs = require('fs');
const path = require('path');

const FICHA_CONF = path.join(__dirname, '..', 'dados', 'confirmacoes.json');
const FICHA_FOLL = path.join(__dirname, '..', 'dados', 'followups.json');
const PRESENCA_TTL_MS = 48 * 60 * 60 * 1000; // 48 horas

function lerFicha(ficha, defeito) {
  try {
    if (!fs.existsSync(ficha)) return defeito;
    return JSON.parse(fs.readFileSync(ficha, 'utf8'));
  } catch (e) { return defeito; }
}
function guardarFicha(ficha, v) {
  try { fs.writeFileSync(ficha, JSON.stringify(v, null, 1)); } catch (e) {}
}
function chave(jid) { return String(jid).replace(/\D/g, ''); }
function agora() { return Date.now(); }

/* ---------- presença ---------- */

function limparExpiradas(lista) {
  const agoraMs = agora();
  return lista.filter((c) => {
    if (c.estado !== 'AGUARDA') return true;
    const ts = c.criadoEm ? new Date(c.criadoEm).getTime() : 0;
    return agoraMs - ts <= PRESENCA_TTL_MS;
  });
}

function pedirPresenca({ cliente, eventoId, resumo }) {
  let lista = limparExpiradas(lerFicha(FICHA_CONF, []));
  // só um pedido pendente por cliente: substitui o anterior
  lista = lista.filter((c) => !(chave(c.cliente) === chave(cliente) && c.estado === 'AGUARDA'));
  const entrada = {
    id: 'CONF' + agora().toString(36).toUpperCase(),
    cliente, eventoId: eventoId || null, resumo: resumo || '',
    estado: 'AGUARDA', criadoEm: new Date().toISOString()
  };
  lista.push(entrada);
  guardarFicha(FICHA_CONF, lista);
  return entrada;
}

function pedidoPendente(cliente) {
  const lista = limparExpiradas(lerFicha(FICHA_CONF, []));
  const p = lista.filter((c) => chave(c.cliente) === chave(cliente) && c.estado === 'AGUARDA');
  return p.length ? p[p.length - 1] : null;
}

function confirmarPresenca(cliente) {
  const lista = lerFicha(FICHA_CONF, []);
  const p = lista.filter((c) => chave(c.cliente) === chave(cliente) && c.estado === 'AGUARDA');
  const alvo = p.length ? p[p.length - 1] : null;
  if (alvo) {
    alvo.estado = 'CONFIRMADA';
    alvo.respondidoEm = new Date().toISOString();
    guardarFicha(FICHA_CONF, lista);
  }
  return alvo;
}

function marcarFalta(cliente, motivo) {
  const lista = lerFicha(FICHA_CONF, []);
  const p = lista.filter((c) => chave(c.cliente) === chave(cliente) && c.estado === 'AGUARDA');
  const alvo = p.length ? p[p.length - 1] : null;
  if (alvo) {
    alvo.estado = 'FALTOU';
    alvo.motivo = motivo || 'cliente avisou que não vem';
    alvo.respondidoEm = new Date().toISOString();
    guardarFicha(FICHA_CONF, lista);
  } else {
    // sem pedido pendente: regista falta avulsa para o painel ver
    lista.push({
      id: 'CONF' + agora().toString(36).toUpperCase(),
      cliente, eventoId: null, resumo: motivo || '',
      estado: 'FALTOU', criadoEm: new Date().toISOString(),
      respondidoEm: new Date().toISOString()
    });
    guardarFicha(FICHA_CONF, lista);
  }
  return alvo;
}

function todasConfirmacoes() { return limparExpiradas(lerFicha(FICHA_CONF, [])); }

/* ---------- follow-ups ---------- */

function diasFollowupPadrao(servico) {
  if (/vacina|reforco|reforço/i.test(servico || '')) {
    return Number(process.env.FOLLOWUP_VACINA_DIAS || 30);
  }
  if (/desparasit/i.test(servico || '')) {
    return Number(process.env.FOLLOWUP_DESPARASITACAO_DIAS || 90);
  }
  return 0; // 0 = sem follow-up automático para este serviço
}

function agendarFollowup({ cliente, animal, servico, dias, mensagem }) {
  const nDias = Number(dias);
  if (!nDias || nDias <= 0) return null;
  const lista = lerFicha(FICHA_FOLL, []);
  const data = new Date(agora() + nDias * 24 * 60 * 60 * 1000);
  const entrada = {
    id: 'FOLL' + agora().toString(36).toUpperCase(),
    cliente, animal: animal || '', servico: servico || '',
    data: data.toISOString().slice(0, 10),
    mensagem: mensagem || '',
    estado: 'AGENDADO', criadoEm: new Date().toISOString()
  };
  lista.push(entrada);
  guardarFicha(FICHA_FOLL, lista);
  return entrada;
}

function followupsVencidos() {
  const hoje = new Date().toISOString().slice(0, 10);
  return lerFicha(FICHA_FOLL, []).filter((f) => f.estado === 'AGENDADO' && f.data <= hoje);
}

function marcarFollowupEnviado(id) {
  const lista = lerFicha(FICHA_FOLL, []);
  const f = lista.find((x) => x.id === id);
  if (f) {
    f.estado = 'ENVIADO';
    f.enviadoEm = new Date().toISOString();
    guardarFicha(FICHA_FOLL, lista);
  }
  return f;
}

function todosFollowups() { return lerFicha(FICHA_FOLL, []); }

module.exports = {
  pedirPresenca, pedidoPendente, confirmarPresenca, marcarFalta, todasConfirmacoes,
  diasFollowupPadrao, agendarFollowup, followupsVencidos, marcarFollowupEnviado, todosFollowups
};