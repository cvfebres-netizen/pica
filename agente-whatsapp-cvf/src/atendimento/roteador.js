/* Fluxo com provisorio no Calendar:
   Cliente pede -> entra logo no Calendar como PROVISORIO + avisa gestor ->
   gestor diz OK (confirma) ou NAO (apaga). O gestor ve sempre tudo no Calendar. */
const R = require('./respostas');
const pendentes = require('./pendentes');
const Esc = require('./escalation');
const servicos = require('./servicos');
const Form = require('./formulario');
const Historico = require('./historico');
const ListaEspera = require('./listaEspera');
const Idiomas = require('./idiomas');

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
  if (!g) return true;
  return d.includes(g) || g.includes(d);
}

const RE = {
  urgencia: /(sangue|hemorragia|nao respira|n[ãa]o respira|envenen|atropel|acidente|convuls|desmai|moribund|urgente|emergencia)/i,
  sintomasLigeiros: /(v[oô]mito|diarreia|coceira|falta.*apetite|espirr|tosse|fraqueza|apatia|letargia)/i,
  panico: /(deses|p[êe]nico|ang[úu]stia|socorro|estou a perder|morrer|vai morrer)/i,
  agressivo: /(est[ou]pid|idiota|in[úu]til|lixo|pior|odiar|odeio|imbecil|merda|caralho|puta|foda)/i,
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
  const lang = Idiomas.detectar(texto, de);
  Idiomas.guardarIdioma(de, lang);
  if (Form.temFormularioAberto(de)) {
    const r = Form.processar({ de, texto });
    if (r && r.concluiu && r.pendente && enviar && !MESMO_NUMERO) {
      await enviar(r.pendente.gestorJid, R.avisoGestor(r.pendente));
    }
    return r ? r.resposta : null;
  }
  if (souGestor(de)) {
    const p = pendentes.ultimoPendente();
    if (RE.ok.test(texto) && p) return await executarAprovado(p, enviar);
    if (RE.nao.test(texto) && p) return await executarRecusado(p, enviar);
    if (RE.pendentes.test(texto)) return pendentes.resumo();
  }
  if (RE.urgencia.test(texto)) return R.urgencia(lang);
  if (RE.panico.test(texto) || RE.agressivo.test(texto)) {
    Esc.resetar(de);
    const gNum = (process.env.NUMERO_GESTOR || '').replace(/\D/g, '');
    const gJid = gNum ? gNum + '@s.whatsapp.net' : '';
    if (gJid && enviar) await enviar(gJid, '⚠️ Escalation (pânico/agressividade): ' + de + ' precisa de atendimento humano imediato.');
    return R.equipaFala(lang);
  }
  if (RE.sintomasLigeiros.test(texto)) return R.sintomasLigeiros(lang);
  if (RE.cancelar.test(texto)) {
    const p = pendentes.criar({ tipo: 'cancelar', cliente: de, texto });
    Esc.resetar(de);
    if (enviar && !MESMO_NUMERO) await enviar(p.gestorJid, R.avisoGestor(p));
    return R.pedidoRegistado('cancelamento', lang);
  }
  if (RE.remarcar.test(texto)) {
    const p = pendentes.criar({ tipo: 'remarcar', cliente: de, texto });
    Esc.resetar(de);
    if (enviar && !MESMO_NUMERO) await enviar(p.gestorJid, R.avisoGestor(p));
    return R.pedidoRegistado('remarcação', lang);
  }
  const dados = extrairPedido(texto);
  if (RE.marcar.test(texto)) {
    const horaNorm = normalizarHora(dados.hora);
    let sugestao = '';
    try {
      const A = agenda();
      if (dados.dia && horaNorm) {
        const inicio = A.paraData(dados.dia, horaNorm);
        const fim = new Date(inicio.getTime() + 30 * 60000);
        const ocupado = await A.horarioLivre(inicio, fim, 'consulta');
        if (ocupado) {
          ListaEspera.adicionar({
            cliente: de, servico: 'consulta', animal: dados.animal, especie: '',
            dataPreferida: dados.dia, horaPreferida: horaNorm, contacto: de
          });
          const alternativas = [
            new Date(inicio.getTime() - 60 * 60000),
            new Date(inicio.getTime() + 60 * 60000),
            new Date(inicio.getTime() + 2 * 60 * 60000)
          ];
          sugestao = '\nEsse horário está ocupado. Ficou na lista de espera. Sugestões: '
            + alternativas.map((a) => a.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })).join(' / ')
            + '\nDiga outro dia/hora se preferir.';
        }
      }
    } catch (e) {}
    const p = pendentes.criar({ tipo: 'marcar', cliente: de, texto, dados });
    Esc.resetar(de);
    if (enviar && !MESMO_NUMERO) await enviar(p.gestorJid, R.avisoGestor(p));
    return R.pedidoRegistado('marcação', lang) + sugestao;
  }
  if (!dados.dia || !dados.hora || !dados.animal) {
    const r = Form.processar({ de, texto });
    if (r) return r.resposta;
    // não inicia formulário → cai abaixo para registar falha/escalation
  } else {
    Esc.resetar(de);
    const servico = servicos.detetarServico(texto);
    dados.servico = servico.id;
    if (servico.contactoDireto) return R.contactoDireto(servico.id, lang);
    if (servico.horarioPreferencial) {
      const hhmm = normalizarHora(dados.hora);
      if (hhmm && !servico.horarioPreferencial.includes(hhmm)) {
        return R.horarioPreferencial(servico.id, lang);
      }
    }
    let ev = null;
    let ocupado = false;
    let conflitoEvento = '';
    try {
      ev = await agenda().marcarProvisoria({ cliente: de, ...dados, duracaoMin: servico.duracaoMin, servico: servico.id });
    } catch (e) {
      ev = null;
      if (e.codigo === 'CONFLITO') {
        ocupado = true;
        conflitoEvento = e.evento || '';
        ListaEspera.adicionar({ cliente: de, servico: servico.id, animal: dados.animal, especie: '', dataPreferida: dados.dia, horaPreferida: dados.hora, contacto: '' });
      }
    }
    const p = pendentes.criar({ tipo: 'marcar', cliente: de, texto, dados, eventoId: ev ? ev.id : null });
    if (enviar && !MESMO_NUMERO) await enviar(p.gestorJid, R.avisoGestor(p));
    if (ocupado) return 'Esse horário já está ocupado (' + conflitoEvento + '). Ficou na lista de espera para ' + servico.id + '. Avisamos quando houver vaga.';
    return ev ? R.pedidoProvisorio(ev) : R.pedidoRegistado('marcação', lang);
  }

  // não percebeu a intenção → conta falha; ao atingir o limite, escalation para o gestor
  const falhas = Esc.registarFalha(de);
  if (falhas >= Esc.LIMITE && enviar) {
    const gNum = (process.env.NUMERO_GESTOR || '').replace(/\D/g, '');
    const gJid = gNum ? gNum + '@s.whatsapp.net' : '';
    if (gJid) await enviar(gJid, '⚠️ Escalation: ' + de + ' não percebido após ' + falhas + ' tentativas. Pegue na conversa.');
    return 'A nossa equipa vai falar consigo diretamente por aqui. Obrigado.';
  }
  return R.ajuda(lang);
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
  if (p.tipo === 'marcar' && p.dados) {
    Historico.registar({
      cliente: p.cliente,
      tipo: p.tipo,
      servico: p.dados.servicoId || p.dados.servico || 'consulta',
      animal: p.dados.animal || '',
      especie: p.dados.especie || '',
      dataHora: p.dados.dia || '',
      eventoId: ev ? ev.id : null,
      estado: 'CONFIRMADO'
    });
  }
  if (enviar) {
    if (p.tipo === 'marcar') await enviar(p.cliente, R.confirmada(ev));
    if (p.tipo === 'remarcar') await enviar(p.cliente, R.remarcada(ev));
    if (p.tipo === 'cancelar') await enviar(p.cliente, R.cancelada(ev));
  }
  return 'Feito e cliente avisado: ' + ev.resumo;
}

async function executarRecusado(p, enviar) {
  try { if (p.eventoId) await agenda().apagarEvento(p.eventoId); } catch (e) {}
  pendentes.recusar(p.id);
  if (enviar) await enviar(p.cliente, R.recusada());
  return 'Recusado e provisorio removido. Avisei o cliente.';
}

function extrairPedido(texto) {
  const animal = (texto.match(/(c[ãa]o|gato|cadela|gata)\s+([A-Za-zÀ-ÿ]+)/i) || [])[0]
    || (texto.match(/(o|a)\s+([A-Za-zÀ-ÿ]{2,15})\s+(precisa|está|esta|tem)/i) || [])[0] || '';
  const dia = (texto.match(/(hoje|amanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|\d{1,2}\/\d{1,2})/i) || [])[0] || '';
  const hora = (texto.match(/(\d{1,2}:\d{2}|\d{1,2}\s?h(\d{2})?)/i) || [])[0] || '';
  const motivo = texto.slice(0, 140);
  return { animal: animal.trim(), dia: dia.trim(), hora: hora.trim(), motivo };
}

function normalizarHora(hora) {
  const m = String(hora || '').match(/(\d{1,2})[:h\s]*(\d{2})?/);
  if (!m) return '';
  const hh = String(Number(m[1])).padStart(2, '0');
  const mm = String(Number(m[2] || 0)).padStart(2, '0');
  return hh + ':' + mm;
}

module.exports = { encaminhar, extrairPedido, normalizarHora };
