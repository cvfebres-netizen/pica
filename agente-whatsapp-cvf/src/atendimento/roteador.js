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
const BV = require('./boasvindas');
const Conf = require('./confirmacoes');
const Horario = require('../config/horario');

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
  sintomasLigeiros: /(vomito|vomitos|diarreia|coceira|comichao|falta.*apetite|espirr|tosse|fraqueza|apatia|letargia|olho|remel|lagrim|ferida|manca|pata|pelo|otite|ouvido)/i,
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
  pendentes: /(pendentes|fila|espera|por aprovar)/i,
  menu: /^[1-4]$/,
  confirmacao: /^(sim.*(venho|vou|confirmo)|vou.*(sim|ir)|confirmo.*presen|estou.*(a caminho|a ir))$/i,
  falta: /^(n[aã]o.*(venho|vou|posso|consigo)|n[aã]o.*(ir|estar)|falto|desisto|nao.*(da|consigo))$/i,
  catalogo: /(servi[cç]os|tabela|cat[aá]logo|lista.*(pre[cç]os|servi[cç]os)|o que fazem)/i,
  historicoAnimal: /(historico|histórico|passado|anteriores).*(do|da|de)\s+([A-Za-zÀ-ÿ]{2,20})/i,
  historico: /(historico|histórico|meus.*atendimentos|minhas.*consultas|ja.*(vim|fui|estive)|ultima.*consulta)/i,
  idioma: /^\/(pt|en|es|fr)$/i
};

async function encaminhar({ de, texto }, enviar) {
  const lang = Idiomas.detectar(texto, de);
  const textoNorm = normou(texto);
  Idiomas.guardarIdioma(de, lang);
  if (Form.temFormularioAberto(de)) {
    const r = Form.processar({ de, texto });
    if (r && r.concluiu && r.pendente && enviar && !MESMO_NUMERO) {
      await enviar(r.pendente.gestorJid, R.avisoGestor(r.pendente));
    }
    return r ? r.resposta : null;
  }
  // Comando explícito de idioma: /pt /en /es /fr
  if (RE.idioma.test(texto.trim())) {
    BV.marcarVisto(de);
    return R.idiomaOk(lang);
  }
  // Menu de boas-vindas: saudação/menu de quem ainda não viu, ou "menu"
  if ((BV.ehSaudacao(texto) && !BV.jaViu(de)) || /^menu$/i.test(texto.trim())) {
    BV.marcarVisto(de);
    Esc.resetar(de);
    return R.menu(lang);
  }
  BV.marcarVisto(de);
  // Resposta numérica ao menu
  if (RE.menu.test(texto.trim())) {
    Esc.resetar(de);
    const op = texto.trim();
    if (op === '1') return R.pedirDadosMarcar(lang);
    if (op === '2') return R.horario(lang) + ' | ' + R.morada(lang);
    if (op === '3') return R.catalogo(lang);
    return R.equipaFala(lang);
  }
  // Confirmação de presença SIM/NÃO (só conta se houver pedido pendente)
  if (Conf.pedidoPendente(de)) {
    if (/^(sim|s|yes|si|oui|ok|confirmo|confirmado)$/i.test(texto.trim())) {
      Conf.confirmarPresenca(de);
      Esc.resetar(de);
      return R.presencaOk(lang);
    }
    if (/^(n[aã]o|nao|n|no|non|not)$/i.test(texto.trim())) {
      Conf.marcarFalta(de, texto);
      Esc.resetar(de);
      return R.presencaFalta(lang);
    }
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
  if (RE.sintomasLigeiros.test(textoNorm)) return R.sintomasLigeiros(lang);
  if (RE.catalogo.test(texto)) { Esc.resetar(de); return R.catalogo(lang); }
  const mHistAnimal = texto.match(RE.historicoAnimal);
  if (mHistAnimal) {
    Esc.resetar(de);
    const entradas = Historico.porAnimal(mHistAnimal[3]);
    if (!entradas.length) return R.semHistoricoAnimal(lang);
    return R.historicoLista(entradas.slice(-5), lang);
  }
  if (RE.historico.test(texto)) {
    Esc.resetar(de);
    const entradas = Historico.listar(de);
    if (!entradas.length) return R.historicoVazio(lang);
    return R.historicoLista(entradas.slice(-5), lang);
  }
  // Fora de horário: urgência/pânico passam; o resto regista pedido sem incomodar o gestor fora de horas
  if (!Horario.abertoAgora()) {
    if (RE.cancelar.test(texto) || RE.remarcar.test(texto) || RE.marcar.test(texto)) {
      const tipoFH = RE.cancelar.test(texto) ? 'cancelar' : (RE.remarcar.test(texto) ? 'remarcar' : 'marcar');
      const dadosFH = tipoFH === 'marcar' ? extrairPedido(texto) : undefined;
      pendentes.criar({ tipo: tipoFH, cliente: de, texto, dados: dadosFH });
      Esc.resetar(de);
      return R.foraHorarioReal(lang);
    }
  }
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
    // Regras de serviço (contacto direto / horário preferencial) aplicam-se
    // também ao ramo rápido, antes de criar o pendente.
    const servRapido = servicos.detetarServico(texto);
    if (servRapido.contactoDireto) { Esc.resetar(de); return R.contactoDireto(servRapido.id, lang); }
    // Texto com animal+dia+hora segue o fluxo rápido de pendente.
    // Só abre o formulário quando faltam dados E o texto não traz dados.
    if ((!dados.animal || !dados.dia || !dados.hora) && !Form.temFormularioAberto(de)) {
      const r = Form.processar({ de, texto });
      if (r && Form.temFormularioAberto(de)) return r.resposta;
      // processar() recusou: cai no fluxo rápido / escalation normal.
    }
    if (Form.temFormularioAberto(de)) {
      const r2 = Form.processar({ de, texto });
      if (r2) return r2.resposta;
    }
    // Horário preferencial do serviço (ex: banho/tosquia só 10:00 ou 14:30).
    if (servRapido.horarioPreferencial) {
      const hhmmRapido = normalizarHora(dados.hora);
      if (hhmmRapido && !servRapido.horarioPreferencial.includes(hhmmRapido)) {
        Esc.resetar(de);
        return R.horarioPreferencial(servRapido.id, lang);
      }
    }
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
  try {
    const servFol = (p.dados && (p.dados.servicoId || p.dados.servico)) || '';
    const nDias = Conf.diasFollowupPadrao(servFol);
    if (nDias > 0 && p.cliente) {
      Conf.agendarFollowup({
        cliente: p.cliente,
        animal: (p.dados && (p.dados.animal || '')) || '',
        servico: servFol,
        dias: nDias,
        mensagem: 'reforço de ' + servFol
      });
    }
  } catch (e) {}
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

function normou(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

module.exports = { encaminhar, extrairPedido, normalizarHora };
