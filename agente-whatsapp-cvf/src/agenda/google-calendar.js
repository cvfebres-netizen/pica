/* Google Calendar gratuito: marcar / remarcar / cancelar / listar.
   Auth OAuth2 1 vez (npm run ligar-google). Depois usa token guardado.
   NOTA: googleapis e dotenv só são carregados quando usados, para o
   simulador correr sem npm install. */
const fs = require('fs');
const path = require('path');

const FICHA_TOKEN = path.join(__dirname, '..', 'dados', 'google-token.json');
const FUSO = () => process.env.FUSO || 'Europe/Lisbon';
const CAL_ID = () => process.env.GOOGLE_CALENDAR_ID || 'primary';

function oauthClient() {
  const { google } = require('googleapis');
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback'
  );
}

function guardarToken(t) { fs.writeFileSync(FICHA_TOKEN, JSON.stringify(t)); }
function lerToken() {
  if (!fs.existsSync(FICHA_TOKEN)) return null;
  return JSON.parse(fs.readFileSync(FICHA_TOKEN, 'utf8'));
}

async function calendario() {
  const { google } = require('googleapis');
  const auth = oauthClient();
  const t = lerToken();
  if (!t) throw new Error('Sem token Google. Corra: npm run ligar-google');
  auth.setCredentials(t);
  return google.calendar({ version: 'v3', auth });
}

/* Converte "amanhã 10:30" / "12/05 15h" em Date. Simples e suficiente. */
function paraData(dia, hora) {
  const agora = new Date();
  let d = new Date(agora);
  const diaL = (dia || '').toLowerCase();
  const mData = diaL.match(/(\d{1,2})\/(\d{1,2})/);
  if (diaL.includes('amanh')) d.setDate(d.getDate() + 1);
  else if (mData) { d.setMonth(Number(mData[2]) - 1, Number(mData[1])); }
  else if (/segunda/.test(diaL)) d.setDate(d.getDate() + ((8 - (d.getDay() || 7)) % 7 || 7));
  const mHora = String(hora || '10:00').match(/(\d{1,2})[:h\s]*(\d{2})?/);
  d.setHours(Number(mHora[1]), Number(mHora[2] || 0), 0, 0);
  return d;
}

/* Estado no Calendar: PROVISÓRIO entra logo (transparente + "PROVISÓRIO"),
   OK do gestor confirma (opaco + "CONFIRMADO"), NÃO apaga. */

/* Verifica se o intervalo já tem evento OCUPADO (opaco).
   Provisórios (transparent) não bloqueam — só confirmados contam. */
async function horarioLivre(inicio, fim) {
  const cal = await calendario();
  const r = await cal.events.list({
    calendarId: CAL_ID(),
    timeMin: inicio.toISOString(),
    timeMax: fim.toISOString(),
    singleEvents: true, maxResults: 10
  });
  const ocupados = (r.data.items || []).filter((e) =>
    e.transparency !== 'transparent' && e.status !== 'cancelled');
  return ocupados.length === 0 ? null : ocupados[0];
}

async function marcarProvisoria({ cliente, animal, motivo, dia, hora, duracaoMin }) {
  const cal = await calendario();
  const inicio = paraData(dia, hora);
  const dur = Number(duracaoMin) || 30;
  const fim = new Date(inicio.getTime() + dur * 60000);
  const conflito = await horarioLivre(inicio, fim);
  if (conflito) {
    const err = new Error('Horário ocupado: ' + (conflito.summary || ''));
    err.codigo = 'CONFLITO';
    err.evento = conflito.summary;
    throw err;
  }
  const r = await cal.events.insert({
    calendarId: CAL_ID(),
    requestBody: {
      summary: '⏳ PROVISÓRIO — Consulta ' + (animal || '') + ' — ' + (motivo || '').slice(0, 60),
      description: 'WhatsApp: ' + cliente + '\nMotivo: ' + motivo + '\nEstado: AGUARDA OK DO GESTOR',
      start: { dateTime: inicio.toISOString(), timeZone: FUSO() },
      end: { dateTime: fim.toISOString(), timeZone: FUSO() },
      transparency: 'transparent' // não ocupa / mostra-se "livre"
    }
  });
  return { id: r.data.id, resumo: (animal || 'consulta') + ' — ' + inicio.toLocaleString('pt-PT') };
}

async function confirmarEvento(eventId) {
  const cal = await calendario();
  const atual = await cal.events.get({ calendarId: CAL_ID(), eventId });
  const titulo = String(atual.data.summary || '').replace(/^⏳ PROVISÓRIO — /, '✅ CONFIRMADO — ');
  const r = await cal.events.patch({
    calendarId: CAL_ID(), eventId,
    requestBody: {
      summary: titulo,
      description: (atual.data.description || '') + '\nEstado: CONFIRMADO PELO GESTOR',
      transparency: 'opaque'
    }
  });
  return { id: r.data.id, resumo: r.data.summary };
}

async function apagarEvento(eventId) {
  const cal = await calendario();
  await cal.events.delete({ calendarId: CAL_ID(), eventId });
  return { id: eventId };
}

async function marcarConsulta({ cliente, animal, motivo, dia, hora }) {
  const cal = await calendario();
  const inicio = paraData(dia, hora);
  const fim = new Date(inicio.getTime() + 30 * 60000);
  const r = await cal.events.insert({
    calendarId: CAL_ID(),
    requestBody: {
      summary: 'Consulta ' + (animal || '') + ' — ' + (motivo || '').slice(0, 60),
      description: 'WhatsApp: ' + cliente + '\nMotivo: ' + motivo,
      start: { dateTime: inicio.toISOString(), timeZone: FUSO() },
      end: { dateTime: fim.toISOString(), timeZone: FUSO() }
    }
  });
  return { id: r.data.id, resumo: (animal || 'consulta') + ' — ' + inicio.toLocaleString('pt-PT') };
}

async function _procurar(cliente, texto) {
  const cal = await calendario();
  const r = await cal.events.list({
    calendarId: CAL_ID(), q: texto.split(' ').slice(0, 4).join(' '),
    timeMin: new Date().toISOString(), maxResults: 5, singleEvents: true
  });
  return { cal, ev: (r.data.items || [])[0] || null };
}

async function cancelarConsulta({ cliente, texto }) {
  const { cal, ev } = await _procurar(cliente, texto);
  if (!ev) return null;
  await cal.events.delete({ calendarId: CAL_ID(), eventId: ev.id });
  return { resumo: ev.summary };
}

async function remarcarConsulta({ cliente, texto }) {
  // Formato esperado: "atual ... nova DIA HORA". Divide-se no "para/nova".
  const partes = texto.split(/\bpara\b|\bnova?\b/i);
  const { cal, ev } = await _procurar(cliente, partes[0] || texto);
  if (!ev) return null;
  const m = (partes[1] || '').match(/(hoje|amanh[ãa]|\d{1,2}\/\d{1,2})?.*?(\d{1,2}[:h]\d{0,2})/i);
  const inicio = paraData(m?.[1] || '', m?.[2] || '10:00');
  const fim = new Date(inicio.getTime() + 30 * 60000);
  const r = await cal.events.patch({
    calendarId: CAL_ID(), eventId: ev.id,
    requestBody: {
      start: { dateTime: inicio.toISOString(), timeZone: FUSO() },
      end: { dateTime: fim.toISOString(), timeZone: FUSO() }
    }
  });
  return { id: r.data.id, resumo: r.data.summary + ' — ' + inicio.toLocaleString('pt-PT') };
}

/* Ligação inicial: corre com --ligar, abre browser, guarda token. */
if (process.argv.includes('--ligar')) {
  try { require('dotenv').config(); } catch (e) {}
  (async () => {
    const auth = oauthClient();
    const url = auth.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar']
    });
    console.log('Abra este link no browser e autorize:\n' + url);
    console.log('Depois cole o CÓDIGO aqui.');
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Código: ', async (code) => {
      const { tokens } = await auth.getToken(code.trim());
      guardarToken(tokens);
      console.log('Google ligado. Token guardado.');
      rl.close();
    });
  })();
}

module.exports = { marcarConsulta, marcarProvisoria, confirmarEvento, apagarEvento, remarcarConsulta, cancelarConsulta, paraData };

