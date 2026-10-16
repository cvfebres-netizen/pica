/* Fluxo com provisorio no Calendar:
   Cliente pede -> entra logo no Calendar como PROVISORIO + avisa gestor ->
   gestor diz OK (confirma) ou NAO (apaga). O gestor ve sempre tudo no Calendar. */
const R = require('./respostas');
const pendentes = require('./pendentes');
const Esc = require('./escalation');
const servicos = require('./servicos');

function agenda() { return require('../agenda/google-calendar'); }
function gestorNumero() { return (process.env.NUMERO_GESTOR || '').replace(/\D/g, ''); }
function numeroClinica() { return (process.env.TELEFONE_CLINICA || '').replace(/\D/g, ''); }
function ehMesmoNumero(a, b) {
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}
const MESMO_NUMERO = ehMesmoNumero(gestorNumero(), numeroClinica());

function souGestor(de) {
  const g = gestorNumero();
  const d = String(de).replace(/\D/g, '');
  if (!g) return true; // sem número de gestor definido → modo mononúmero: qualquer um gere pendentes
  return d.includes(g) || g.includes(d);
}

const RE = {
  urgencia: /(sangue|hemorragia|nao respira|n[ãa]o respira|envenen|atropel|acidente|convuls|desmai|moribund|urgente|emergencia)/i,
  ok: /^(ok|sim|confirmo|confirma|aprov|pode|segue|força|forca)\b/i,
  nao: /^(nao|não|cancela|rejeita|esquece)(\b|[^a-zà-ÿ])/i,
  cancelar: /(cancel|desmarc)/i,
  remarcar: /(remarc|mudar|alterar|trocar).*(consulta|hora|dia|data)|adiar/i,
  marcar: /(marc|agend|consulta|vacina|desparasit|banho|tosquia|cirurgia|check)/i,
  horario: /(horario|hor[áa]rio|aberto|fecha|quando.*abrem)/i,
  morada: /(morada|onde|localiza|endere[cç]o|como chego)/i,
  preco: /(pre[cç]o|quanto custa|tabela|valor)/i,
  pendentes: /(pendentes|fila|espera|por aprovar)/i
};

async function encaminhar({ de, texto }, enviar) {
  // 1. Gestor a aprovar/recusar um pedido pendente
  if (souGestor(de)) {
    const p = pendentes.ultimoPendente();
    if (RE.ok.test(texto) && p) return await executarAprovado(p, enviar);
    if (RE.nao.test(texto) && p) return await executarRecusado(p, enviar);
    if (RE.pendentes.test(texto)) return pendentes.resumo();
  }

  // 2. Urgência passa à frente de tudo
  if (RE.urgencia.test(texto)) return R.urgencia();

  // 3. Cliente pede MARCAR -> entra logo PROVISORIO + avisa gestor
  // NOTA: cancelar/remarcar vêm ANTES porque "cancelar a consulta"
  // contém a palavra "consulta" e cairia no ramo marcar.
  if (RE.cancelar.test(texto)) {
    const p = pendentes.criar({ tipo: 'cancelar', cliente: de, texto });
    Esc.resetar(de);
    if (enviar && !MESMO_NUMERO) await enviar(p.gestorJid, R.avisoGestor(p));
    return R.pedidoRegistado('cancelamento');
  }
  if (RE.remarcar.test(texto)) {
    const p = pendentes.criar({ tipo: 'remarcar', cliente: de, texto });
    Esc.resetar(de);
    if (enviar && !MESMO_NUMERO) await enviar(p.gestorJid, R.avisoGestor(p));
    return R.pedidoRegistado('remarcação');
  }
  if (RE.marcar.test(texto)) {
    const dados = extrairPedido(texto);
    if (!dados.dia || !dados.hora || !dados.animal) return R.pedirDadosMarcar();
    Esc.resetar(de);
    const servico = servicos.detetarServico(texto);
    dados.servico = servico.id;

    // Serviços que requerem contacto direto (cirurgia) — não cria pendente nem evento
    if (servico.contactoDireto) return R.contactoDireto(servico.id);

    // Horários preferenciais para tosquia e banho (início manhã ou início tarde)
    if (servico.horarioPreferencial) {
      const hhmm = normalizarHora(dados.hora);
      if (hhmm && !servico.horarioPreferencial.includes(hhmm)) {
        return R.horarioPreferencial(servico.id);
      }
    }

    let ev = null;
    let ocupado = false;
    let conflitoEvento = '';
    try {
      ev = await agenda().marcarProvisoria({ cliente: de, ...dados, duracaoMin: servico.duracaoMin });
    } catch (e) {
      ev = null;
      if (e.codigo === 'CONFLITO') { ocupado = true; conflitoEvento = e.evento || ''; }
    }
    const p = pendentes.criar({ tipo: 'marcar', cliente: de, texto, dados, eventoId: ev ? ev.id : null });
    if (enviar && !MESMO_NUMERO) await enviar(p.gestorJid, R.avisoGestor(p));
    if (ocupado) return 'Esse horário já está ocupado (' + conflitoEvento + '). Diga outro dia/hora.';
    return ev ? R.pedidoProvisorio(ev) : R.pedidoRegistado('marcação');
  }
  if (RE.horario.test(texto)) { Esc.resetar(de); return R.horario(); }
  if (RE.morada.test(texto)) { Esc.resetar(de); return R.morada(); }
  if (RE.preco.test(texto)) { Esc.resetar(de); return R.precos(); }
  // não percebeu a intenção → conta falha; ao atingir o limite, escalation para o gestor
  const falhas = Esc.registarFalha(de);
  if (falhas >= Esc.LIMITE && enviar) {
    const gNum = (process.env.NUMERO_GESTOR || '').replace(/\D/g, '');
    const gJid = gNum ? gNum + '@s.whatsapp.net' : '';
    if (gJid) await enviar(gJid, '⚠️ Escalation: ' + de + ' não percebido após ' + falhas + ' tentativas. Pegue na conversa.');
    return 'A nossa equipa vai falar consigo diretamente por aqui. Obrigado.';
  }
  return R.ajuda();
}

async function executarAprovado(p, enviar) {
  const A = agenda();
  let ev = null;
  try {
    if (p.tipo === 'marcar' && p.eventoId) ev = await A.confirmarEvento(p.eventoId);
    else if (p.tipo === 'marcar') ev = await A.marcarConsulta({ cliente: p.cliente, ...p.dados });
    if (p.tipo === 'cancelar') ev = await A.cancelarConsulta({ cliente: p.cliente, texto: p.texto });
    if (p.tipo === 'remarcar') ev = await A.remarcarConsulta({ cliente: p.cliente, texto: p.texto });
  } catch (e) { ev = null; }
  if (!ev) {
    pendentes.recusar(p.id);
    if (enviar) await enviar(p.cliente, R.falhaAgenda());
    return 'Falhou na agenda. Avisei o cliente para ligar.';
  }
  pendentes.aprovar(p.id, ev);
  if (enviar) {
    if (p.tipo === 'marcar') await enviar(p.cliente, R.confirmada(ev));
    if (p.tipo === 'remarcar') await enviar(p.cliente, R.remarcada(ev));
    if (p.tipo === 'cancelar') await enviar(p.cliente, R.cancelada(ev));
  }
  return 'Feito e cliente avisado: ' + ev.resumo;
}

async function executarRecusado(p, enviar) {
  // NAO apaga o provisorio do Calendar: remove para o gestor nao ver lixo
  try { if (p.eventoId) await agenda().apagarEvento(p.eventoId); } catch (e) {}
  pendentes.recusar(p.id);
  if (enviar) await enviar(p.cliente, R.recusada());
  return 'Recusado e provisorio removido. Avisei o cliente.';
}

/* Extração simples: animal após "cão/gato/nome", dia e hora em texto livre.
   Mantido simples de propósito; a IA local refina se instalada. */
function extrairPedido(texto) {
  const animal = (texto.match(/(c[ãa]o|gato|cadela|gata)\s+([A-Za-zÀ-ÿ]+)/i) || [])[0]
    || (texto.match(/(o|a)\s+([A-Za-zÀ-ÿ]{2,15})\s+(precisa|está|esta|tem)/i) || [])[0] || '';
  const dia = (texto.match(/(hoje|amanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|\d{1,2}\/\d{1,2})/i) || [])[0] || '';
  const hora = (texto.match(/(\d{1,2}:\d{2}|\d{1,2}\s?h(\d{2})?)/i) || [])[0] || '';
  const motivo = texto.slice(0, 140);
  return { animal: animal.trim(), dia: dia.trim(), hora: hora.trim(), motivo };
}

/* Converte "10:30", "10h30", "10 h 30" ou "10" em "HH:mm" */
function normalizarHora(hora) {
  const m = String(hora || '').match(/(\d{1,2})[:h\s]*(\d{2})?/);
  if (!m) return '';
  const hh = String(Number(m[1])).padStart(2, '0');
  const mm = String(Number(m[2] || 0)).padStart(2, '0');
  return hh + ':' + mm;
}

module.exports = { encaminhar, extrairPedido, normalizarHora };
