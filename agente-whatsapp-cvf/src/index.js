/* Arranque: gateway WhatsApp + atendimento + agenda Google. */
require('dotenv').config();
const { carregar } = require('./config/env');
const cfg = carregar(); // valida variáveis obrigatórias; aborta se faltar algo
const logger = require('./monitor/logger');
const { ligarGateway } = require('./gateway/baileys-gateway');
const { encaminhar } = require('./atendimento/roteador');

async function main() {
  logger.info('[' + cfg.nomeClinica + '] agente a arrancar...');
  await ligarGateway(async (msg, enviar) => {
    try {
      const resposta = await encaminhar(msg, enviar);
      return resposta; // texto curto de volta a quem escreveu
    } catch (e) {
      logger.error('Falha no atendimento para ' + msg.de + ': ' + e.message);
      return 'Tivemos uma falha. Ligue para ' + (cfg.telefoneClinica || 'a clínica') + '.';
    }
  });
}

main().catch((e) => { logger.error(e.message || e); process.exit(1); });
