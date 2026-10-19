/* Lembretes 24h antes da consulta + confirmação 2h antes.
   Lê o Calendar, encontra eventos confirmados de amanhã,
   extrai o WhatsApp do cliente da descrição e envia aviso.
   Evita duplicar: assinala "Lembrete enviado: YYYY-MM-DD" na descrição.
   Chamar via SO cron (ex: todos os dias às 09:00) ou manualmente. */
const { calendario, FUSO, CAL_ID } = require('./google-calendar');

const UM_DIA = 24 * 60 * 60 * 1000;
const DUAS_HORAS = 2 * 60 * 60 * 1000;

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

function jaLembrado(evento, sufixo) {
  const d = (evento.description || '');
  return d.includes(sufixo);
}
function descricaoComLembrete(evento, sufixo) {
  const d = (evento.description || '').trim();
  if (d.includes(sufixo)) return d;
  return d + '\n' + sufixo;
}

/* Busca eventos confirmados num intervalo de dia. */
async function buscarEventosConfirmadosDia(dataDia) {
  const cal = await calendario();
  const r = await cal.events.list({
    calendarId: CAL_ID(),
    timeMin: inicioDoDia(dataDia).toISOString(),
    timeMax: fimDoDia(dataDia).toISOString(),
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
  const amanha = new Date(Date.now() + UM_DIA);
  const eventos = await buscarEventosConfirmadosDia(amanha);
  const enviados = [];
  const sufixo = 'Lembrete enviado: ' + new Date().toISOString().slice(0, 10);
  for (const ev of eventos) {
    if (jaLembrado(ev, sufixo)) continue;
    const tel = telefoneNaDescricao(ev.description);
    if (!tel) continue;
    const inicio = new Date(ev.start.dateTime || ev.start.date);
    const hhmm = inicio.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    const resumo = ev.summary || 'consulta';
    const texto = 'Olá! Lembrete: amanhã às ' + hhmm + ' tem ' + resumo + ' na ' +
      (process.env.NOME_CLINICA || 'a clínica') + '. Confirma com OK.';
    try {
      await enviar(tel, texto);
      await marcarLembreteEnviado(ev.id, descricaoComLembrete(ev, sufixo));
      enviados.push({ tel, evento: ev.id, tipo: '24h' });
    } catch (e) {
      console.log('Falha lembrete ' + tel + ':', e.message);
    }
  }
  return enviados;
}

/* Envia confirmação 2h antes para eventos confirmados hoje ainda não avisados.
   Chamar via SO cron (ex: contínuo ou a cada hora) ou manualmente. */
async function enviarConfirmacao2h(enviar) {
  const agora = new Date();
  const doisHorasDepois = new Date(Date.now() + DUAS_HORAS);
  const hoje = new Date();
  const eventos = await buscarEventosConfirmadosDia(hoje);
  const enviados = [];
  const sufixo = 'Confirmacao 2h enviada: ' + new Date().toISOString().slice(0, 10);
  for (const ev of eventos) {
    if (jaLembrado(ev, sufixo)) continue;
    const inicio = new Date(ev.start.dateTime || ev.start.date);
    // só envia se o evento for daqui a menos de 2h e mais de 0
    const diff = inicio.getTime() - agora.getTime();
    if (diff <= 0 || diff > DUAS_HORAS) continue;
    const tel = telefoneNaDescricao(ev.description);
    if (!tel) continue;
    const hhmm = inicio.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    const resumo = ev.summary || 'consulta';
    const texto = 'Olá! Lembrete: daqui a 2 horas (às ' + hhmm + ') tem ' + resumo + ' na ' +
      (process.env.NOME_CLINICA || 'a clínica') + '. Confirma com OK.';
    try {
      await enviar(tel, texto);
      await marcarLembreteEnviado(ev.id, descricaoComLembrete(ev, sufixo));
      enviados.push({ tel, evento: ev.id, tipo: '2h' });
    } catch (e) {
      console.log('Falha confirmação 2h ' + tel + ':', e.message);
    }
  }
  return enviados;
}

module.exports = { enviarLembretesDiarios, enviarConfirmacao2h, buscarEventosConfirmadosDia, telefoneNaDescricao };
