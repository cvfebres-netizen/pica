/* Lembretes 24h antes da consulta.
   Lê o Calendar, encontra eventos confirmados de amanhã,
   extrai o WhatsApp do cliente da descrição e envia aviso.
   Evita duplicar: assinala "Lembrete enviado: YYYY-MM-DD" na descrição.
   Chamar via SO cron (ex: todos os dias às 09:00) ou manualmente. */
const { calendario, FUSO, CAL_ID } = require('./google-calendar');

const UM_DIA = 24 * 60 * 60 * 1000;

function inicioDoDia(d) {
  const dd = new Date(d); dd.setHours(0, 0, 0, 0); return dd;
}
function fimDoDia(d) {
  const dd = new Date(d); dd.setHours(23, 59, 59, 999); return dd;
}

/* Extrai telefone da descrição: linha "WhatsApp: 351911111111" */
function telefoneNaDescricao(descricao) {
  if (!descricao) return null;
  const m = descricao.match(/WhatsApp:\s*(\d[\d\s\+]+)/i);
  return m ? m[1].replace(/\s/g, '') : null;
}

function jaLembrado(evento) {
  const d = (evento.description || '');
  const hoje = new Date().toISOString().slice(0, 10);
  return d.includes('Lembrete enviado: ' + hoje);
}
function descricaoComLembrete(evento) {
  const d = (evento.description || '').trim();
  const hoje = new Date().toISOString().slice(0, 10);
  if (d.includes('Lembrete enviado: ' + hoje)) return d;
  return d + '\nLembrete enviado: ' + hoje;
}

async function buscarEventosConfirmadosAmanha() {
  const cal = await calendario();
  const amanha = new Date(Date.now() + UM_DIA);
  const r = await cal.events.list({
    calendarId: CAL_ID(),
    timeMin: inicioDoDia(amanha).toISOString(),
    timeMax: fimDoDia(amanha).toISOString(),
    singleEvents: true, maxResults: 50, orderBy: 'startTime'
  });
  return (r.data.items || []).filter((e) =>
    e.status !== 'cancelled' && e.transparency !== 'transparent'
  );
}

async function marcarLembreteEnviado(eventId, novaDescricao) {
  const cal = await calendario();
  await cal.events.patch({ calendarId: CAL_ID(), eventId, requestBody: { description: novaDescricao } });
}

/* Envia lembretes para todos os eventos confirmados de amanhã ainda não avisados.
   `enviar` recebe (numero, texto) e devolve promise. */
async function enviarLembretesDiarios(enviar) {
  const eventos = await buscarEventosConfirmadosAmanha();
  const enviados = [];
  for (const ev of eventos) {
    if (jaLembrado(ev)) continue;
    const tel = telefoneNaDescricao(ev.description);
    if (!tel) continue;
    const inicio = new Date(ev.start.dateTime || ev.start.date);
    const hhmm = inicio.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    const resumo = ev.summary || 'consulta';
    const texto = 'Olá! Lembrete: amanhã às ' + hhmm + ' tem ' + resumo + ' na ' +
      (process.env.NOME_CLINICA || 'a clínica') + '. Confirma com OK.';
    try {
      await enviar(tel, texto);
      await marcarLembreteEnviado(ev.id, descricaoComLembrete(ev));
      enviados.push({ tel, evento: ev.id });
    } catch (e) {
      console.log('Falha lembrete ' + tel + ':', e.message);
    }
  }
  return enviados;
}

module.exports = { enviarLembretesDiarios, buscarEventosConfirmadosAmanha, telefoneNaDescricao };
