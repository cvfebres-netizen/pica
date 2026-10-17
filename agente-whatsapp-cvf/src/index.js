/* Arranque: gateway WhatsApp + atendimento + agenda Google. */
require('dotenv').config();
const logger = require('./monitor/logger');
const { ligarGateway } = require('./gateway/baileys-gateway');
const { encaminhar } = require('./atendimento/roteador');

async function main() {
  logger.info('[' + (process.env.NOME_CLINICA || 'CVF') + '] agente a arrancar...');
  await ligarGateway(async (msg, enviar) => {
    try {
      const resposta = await encaminhar(msg, enviar);
      return resposta; // texto curto de volta a quem escreveu
    } catch (e) {
      logger.error('Falha no atendimento para ' + msg.de + ': ' + e.message);
      return 'Tivemos uma falha. Ligue para ' + (process.env.TELEFONE_CLINICA || 'a clínica') + '.';
    }
  });
}

main().catch((e) => { logger.error(e.message || e); process.exit(1); });
