/* Gateway WhatsApp via Baileys: QR local, sem browser, gratuito para sempre.
   Liga a CONTA BUSINESS NORMAL do telemóvel (Aparelhos ligados).
   Inclui: rate limiting por número, backoff na reconexão, validação de tamanho de mensagem. */
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const path = require('path');

const MAX_MSG_LEN = 4000;
const RATE_LIMIT_MAX = 20;      // max mensagens por minuto por número
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minuto
const RECONNECT_BASE_DELAY = 5000;   // 5s inicial
const RECONNECT_MAX_DELAY = 60 * 1000; // 60s máximo
const MAX_RECONNECT_ATTEMPTS = 10;

const rateMap = new Map(); // numero -> { timestamps: [], blockedUntil: 0 }

function podeEnviar(numero) {
  const agora = Date.now();
  const entrada = rateMap.get(numero) || { timestamps: [], blockedUntil: 0 };
  if (agora < entrada.blockedUntil) return false;
  // remove timestamps fora da janela
  entrada.timestamps = entrada.timestamps.filter((ts) => agora - ts < RATE_LIMIT_WINDOW);
  if (entrada.timestamps.length >= RATE_LIMIT_MAX) {
    entrada.blockedUntil = agora + RATE_LIMIT_WINDOW;
    rateMap.set(numero, entrada);
    return false;
  }
  entrada.timestamps.push(agora);
  rateMap.set(numero, entrada);
  return true;
}

async function ligarGateway(aoReceber) {
  const pastaAuth = path.join(__dirname, '..', 'dados', 'auth_info');
  const { state, saveCreds } = await useMultiFileAuthState(pastaAuth);

  let reconnectAttempts = 0;

  const conectar = async () => {
    const sock = makeWASocket({ auth: state, printQRInTerminal: true });
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
      const { connection, lastDisconnect } = u;
      if (connection === 'open') {
        console.log('WhatsApp ligado. Pronto a atender.');
        reconnectAttempts = 0;
      }
      if (connection === 'close') {
        const codigo = lastDisconnect?.error?.output?.statusCode;
        const retomar = codigo !== DisconnectReason.loggedOut;
        console.log('Ligação fechada. Retomar:', retomar);
        if (!retomar) {
          console.log('Sessão terminada. Apague src/dados/auth_info e leia novo QR.');
          return;
        }
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          console.log('Máximo de tentativas de reconexão atingido. Pare manualmente.');
          return;
        }
        reconnectAttempts++;
        // backoff exponencial: 5s, 10s, 20s, 40s... limitado a 60s
        const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1), RECONNECT_MAX_DELAY);
        console.log('Reconectando em ' + (delay / 1000) + 's (tentativa ' + reconnectAttempts + '/' + MAX_RECONNECT_ATTEMPTS + ')...');
        setTimeout(() => conectar(), delay);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
      const enviar = async (para, texto) => {
        // aceita número simples ou JID completo
        const jid = para.includes('@') ? para : para.replace(/\D/g, '') + '@s.whatsapp.net';
        await sock.sendMessage(jid, { text: texto });
        console.log('>>', jid, ':', texto.slice(0, 120));
      };
      const Transcricao = require('../atendimento/transcricao');
      for (const m of messages) {
        // gestor incluído: o OK/NÃO dele chega como mensagem recebida normal
        if (!m.message || m.key.fromMe) continue;
        let texto = m.message.conversation
          || m.message.extendedTextMessage?.text || '';
        // áudio / voz: tenta transcrever para tratar como texto do cliente
        if (!texto.trim() && (m.message.audio || m.message.voiceMessage)) {
          try {
            const buffer = await sock.downloadMediaMessage(m);
            const transcrito = await Transcricao.transcreverAudio(buffer);
            if (transcrito) {
              texto = transcrito;
              console.log('<< áudio transcrito:', texto.slice(0, 120));
            } else {
              await enviar(m.key.remoteJid, 'Não consegui ouvir o áudio. Pode escrever o que precisa?');
              continue;
            }
          } catch (e) {
            console.log('Falha a transcrever áudio:', e.message);
            await enviar(m.key.remoteJid, 'Não consegui ouvir o áudio. Pode escrever o que precisa?');
            continue;
          }
        }
        if (!texto.trim()) continue;
        // validação de tamanho
        if (texto.length > MAX_MSG_LEN) {
          await enviar(m.key.remoteJid, 'Mensagem demasiado longa. Resuma em menos de ' + MAX_MSG_LEN + ' caracteres.');
          continue;
        }
        const de = m.key.remoteJid;
        const numero = de.replace(/\D/g, '');
        // rate limiting
        if (!podeEnviar(numero)) {
          console.log('Rate limit excedido para ' + numero + '. Ignorando mensagem.');
          await enviar(de, 'Está a enviar mensagens demasiado rápido. Aguarde um momento.');
          continue;
        }
        console.log('<<', de, ':', texto.slice(0, 120));
        const resposta = await aoReceber({ de, texto: texto.trim() }, enviar);
        if (resposta) await enviar(de, resposta);
        await new Promise((r) => setTimeout(r, 1500)); // ritmo humano, anti-ban
      }
    });

    return sock;
  };

  return conectar();
}

module.exports = { ligarGateway };
