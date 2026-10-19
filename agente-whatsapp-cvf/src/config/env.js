/* Validação de variáveis de ambiente obrigatórias na inicialização.
   Aborta com erro claro se faltar algo essencial para o deploy standalone. */
const fs = require('fs');
const path = require('path');

const OBRIGATORIAS = [
  'NOME_CLINICA',
  'TELEFONE_CLINICA',
  'NUMERO_GESTOR',
  'GOOGLE_CALENDAR_ID'
];

const OPCIONAIS_MAS_IMPORTANTES = [
  'PAINEL_USER',
  'PAINEL_PASS',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'LINK_AGENDAMENTO'
];

function carregar() {
  require('dotenv').config();
  const faltantes = OBRIGATORIAS.filter((k) => !process.env[k]);
  const avisos = OPCIONAIS_MAS_IMPORTANTES.filter((k) => !process.env[k]);

  if (faltantes.length) {
    const msg = 'Variáveis de ambiente OBRIGATÓRIAS em falta: ' + faltantes.join(', ')
      + '\nCopie .env.exemplo para .env e preencha antes de arrancar.';
    console.error(msg);
    process.exit(1);
  }

  if (avisos.length) {
    console.warn('[config] Variáveis opcionais não definidas (painel/Google funcionam em modo limitado): ' + avisos.join(', '));
  }

  return {
    nomeClinica: process.env.NOME_CLINICA,
    telefoneClinica: process.env.TELEFONE_CLINICA,
    numeroGestor: process.env.NUMERO_GESTOR,
    morada: process.env.MORADA_CLINICA || '',
    horario: process.env.HORARIO_CLINICA || '',
    linkAgendamento: process.env.LINK_AGENDAMENTO || '',
    googleCalendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
    fuso: process.env.FUSO || 'Europe/Lisbon',
    painelUser: process.env.PAINEL_USER || null,
    painelPass: process.env.PAINEL_PASS || null,
    porta: parseInt(process.env.PORT || '3000', 10)
  };
}

module.exports = { carregar, OBRIGATORIAS, OPCIONAIS_MAS_IMPORTANTES };
