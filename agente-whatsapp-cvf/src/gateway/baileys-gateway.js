/* Gateway WhatsApp via Baileys: QR local, sem browser, gratuito para sempre.
   Liga a CONTA BUSINESS NORMAL do telemóvel (Aparelhos ligados).
   Inclui: rate limiting por número, backoff na reconexão, validação de tamanho de mensagem,
   deduplicação de mensagens, try/catch no roteador, persistência de tentativas de reconexão. */
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const logger = require('../monitor/logger');
const metricas = require('../monitor/metricas');

const MAX_MSG_LEN = 4000;
const RATE_LIMIT_MAX = 20;      // max mensagens por minuto por número
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minuto
const RECONNECT_BASE_DELAY = 5000;   // 5s inicial
const RECONNECT_MAX_DELAY = 60 * 1000; // 60s máximo
const MAX_RECONNECT_ATTEMPTS = 10;
const FICHA_RECONNECT = path.join(__dirname, '..', 'dados', 'gateway-state.json');

const rateMap = new Map(); // numero -> { timestamps: [], blockedUntil: 0 }
const mensagensProcessadas = new Map(); // messageId -> timestamp

function podeEnviar(numero) {
  const agora = Date.now();
  let entrada = rateMap.get(numero);
  if (!entrada) {
    const disco = lerRateLimit()[numero];
    entrada = disco || { timestamps: [], blockedUntil: 0 };
    rateMap.set(numero, entrada);
  }
  if (agora < entrada.blockedUntil) return false;
  entrada.timestamps = entrada.timestamps.filter((ts) => agora - ts < RATE_LIMIT_WINDOW);
  if (entrada.timestamps.length >= RATE_LIMIT_MAX) {
    entrada.blockedUntil = agora + RATE_LIMIT_WINDOW;
    rateMap.set(numero, entrada);
    guardarRateLimit(Object.fromEntries(rateMap));
    return false;
  }
  entrada.timestamps.push(agora);
  rateMap.set(numero, entrada);
  // guardarRateLimit throttled: so a cada 5 registos para nao gastar disco
  if (entrada.timestamps.length % 5 === 0) guardarRateLimit(Object.fromEntries(rateMap));
  return true;
}

/* Deduplicação: ignora mensagens já processadas nos últimos 5 minutos. */
function jaProcessada(messageId) {
  if (!messageId) return false;
  const agora = Date.now();
  const ts = mensagensProcessadas.get(messageId);
  if (ts && agora - ts < 5 * 60 * 1000) return true;
  mensagensProcessadas.set(messageId, agora);
  for (const [id, t] of mensagensProcessadas.entries()) {
    if (agora - t > 10 * 60 * 1000) mensagensProcessadas.delete(id);
  }
  return false;
}

function lerReconnectState() {
  try {
    if (!fs.existsSync(FICHA_RECONNECT)) return { attempts: 0 };
    return JSON.parse(fs.readFileSync(FICHA_RECONNECT, 'utf8'));
  } catch (e) { return { attempts: 0 }; }
}
function guardarReconnectState(state) {
  try { fs.writeFileSync(FICHA_RECONNECT, JSON.stringify(state)); } catch (e) {}
}

async function ligarGateway(aoReceber) {
  const pastaAuth = path.join(__dirname, '..', 'dados', 'auth_info');
  const { state, saveCreds } = await useMultiFileAuthState(pastaAuth);

  const statePersistido = lerReconnectState();
  let reconnectAttempts = statePersistido.attempts || 0;

  const salvarAttempts = () => guardarReconnectState({ attempts: reconnectAttempts });

  const conectar = async () => {
    const sock = makeWASocket({ auth: state, printQRInTerminal: true });
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
      const { connection, lastDisconnect } = u;
      if (connection === 'open') {
        logger.info('WhatsApp ligado. Pronto a atender.');
        reconnectAttempts = 0;
        salvarAttempts();
      }
      if (connection === 'close') {
        const codigo = lastDisconnect?.error?.output?.statusCode;
        const retomar = codigo !== DisconnectReason.loggedOut;
        logger.info('Ligação fechada. Retomar: ' + retomar);
        if (!retomar) {
          logger.error('Sessão terminada. Apague src/dados/auth_info e leia novo QR.');
          return;
        }
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          logger.error('Máximo de tentativas de reconexão atingido. Pare manualmente.');
          return;
        }
        reconnectAttempts++;
        salvarAttempts();
        const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1), RECONNECT_MAX_DELAY);
        logger.warn('Reconectando em ' + (delay / 1000) + 's (tentativa ' + reconnectAttempts + '/' + MAX_RECONNECT_ATTEMPTS + ')...');
        setTimeout(() => conectar(), delay);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
      const enviar = async (para, texto) => {
        const jid = para.includes('@') ? para : para.replace(/\D/g, '') + '@s.whatsapp.net';
        try {
          await sock.sendMessage(jid, { text: texto });
          metricas.inc('mensagens_enviadas');
          logger.info('>> ' + jid + ' : ' + texto.slice(0, 120));
        } catch (e) {
          logger.error('Falha a enviar para ' + jid + ': ' + e.message);
          metricas.inc('erros_envio');
        }
      };
      const Transcricao = require('../atendimento/transcricao');
      for (const m of messages) {
        if (!m.message || m.key.fromMe) continue;
        if (jaProcessada(m.key.id)) continue;
        let texto = m.message.conversation
          || m.message.extendedTextMessage?.text || '';
        if (!texto.trim() && (m.message.audio || m.message.voiceMessage)) {
          try {
            const buffer = await sock.downloadMediaMessage(m);
            const transcrito = await Transcricao.transcreverAudio(buffer);
            if (transcrito) {
              texto = transcrito;
              logger.info('<< áudio transcrito: ' + texto.slice(0, 120));
            } else {
              await enviar(m.key.remoteJid, 'Não consegui ouvir o áudio. Pode escrever o que precisa?');
              continue;
            }
          } catch (e) {
            logger.error('Falha a transcrever áudio: ' + e.message);
            await enviar(m.key.remoteJid, 'Não consegui ouvir o áudio. Pode escrever o que precisa?');
            continue;
          }
        }
        if (!texto.trim()) continue;
        if (texto.length > MAX_MSG_LEN) {
          await enviar(m.key.remoteJid, 'Mensagem demasiado longa. Resuma em menos de ' + MAX_MSG_LEN + ' caracteres.');
          continue;
        }
        const de = m.key.remoteJid;
        const numero = de.replace(/\D/g, '');
        if (!podeEnviar(numero)) {
          logger.warn('Rate limit excedido para ' + numero + '. Ignorando mensagem.');
          await enviar(de, 'Está a enviar mensagens demasiado rápido. Aguarde um momento.');
          continue;
        }
        metricas.inc('mensagens_recebidas');
        logger.info('<< ' + de + ' : ' + texto.slice(0, 120));
        try {
          const resposta = await aoReceber({ de, texto: texto.trim() }, enviar);
          if (resposta) await enviar(de, resposta);
        } catch (e) {
          logger.error('Falha no roteador para ' + de + ': ' + e.message);
          metricas.inc('erros_roteador');
          try {
            await enviar(de, 'Tivemos uma falha interna. Ligue para ' + (process.env.TELEFONE_CLINICA || 'a clínica') + '.');
          } catch (e2) {
            logger.error('Falha a enviar mensagem de erro: ' + e2.message);
          }
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    });

    return sock;
  };

  return conectar();
}

module.exports = { ligarGateway };
