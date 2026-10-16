/* Gateway WhatsApp via Baileys: QR local, sem browser, gratuito para sempre.
   Liga a CONTA BUSINESS NORMAL do telemóvel (Aparelhos ligados). */
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const path = require('path');

async function ligarGateway(aoReceber) {
  const pastaAuth = path.join(__dirname, '..', 'dados', 'auth_info');
  const { state, saveCreds } = await useMultiFileAuthState(pastaAuth);

  const sock = makeWASocket({ auth: state, printQRInTerminal: true });
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (u) => {
    const { connection, lastDisconnect } = u;
    if (connection === 'open') console.log('WhatsApp ligado. Pronto a atender.');
    if (connection === 'close') {
      const retomar = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Ligação fechada. Retomar:', retomar);
      if (retomar) ligarGateway(aoReceber);
      else console.log('Sessão terminada. Apague src/dados/auth_info e leia novo QR.');
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
      const de = m.key.remoteJid;
      console.log('<<', de, ':', texto.slice(0, 120));
      const resposta = await aoReceber({ de, texto: texto.trim() }, enviar);
      if (resposta) await enviar(de, resposta);
      await new Promise((r) => setTimeout(r, 1500)); // ritmo humano, anti-ban
    }
  });

  return sock;
}

module.exports = { ligarGateway };
