/* Script de lembretes diários (chamar via SO cron, ex: 09:00).
   Liga o WhatsApp, envia lembretes 24h + follow-ups vencidos, e encerra. */
require('dotenv').config();
const { ligarGateway } = require('../src/gateway/baileys-gateway');
const { enviarLembretesDiarios, enviarFollowups } = require('../src/agenda/lembretes');

(async () => {
  let sock;
  try {
    sock = await ligarGateway(async (para, texto) => {
      // envelope genérico: o envio real acontece abaixo via sock.sendMessage
    });
    // função de envio real usando o sock conectado
    const enviar = async (numero, texto) => {
      const jid = numero.includes('@') ? numero : numero.replace(/\D/g, '') + '@s.whatsapp.net';
      await sock.sendMessage(jid, { text: texto });
    };
    const enviados = await enviarLembretesDiarios(enviar);
    console.log('Lembretes enviados:', JSON.stringify(enviados, null, 1));
    const foll = await enviarFollowups(enviar);
    console.log('Follow-ups enviados:', JSON.stringify(foll, null, 1));
    process.exit(0);
  } catch (e) {
    console.error('Falha nos lembretes:', e.message);
    process.exit(1);
  }
})();
