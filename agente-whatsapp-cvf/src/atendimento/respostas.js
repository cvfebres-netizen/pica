/* Respostas curtas PT-PT, sem rodeios. Máx. 2 mensagens curtas. */
const NOME = () => process.env.NOME_CLINICA || 'a clínica';
const TEL = () => process.env.TELEFONE_CLINICA || 'a clínica';
const MORADA = () => process.env.MORADA_CLINICA || 'a morada no perfil';
const HORARIO = () => process.env.HORARIO_CLINICA || 'Seg-Sex 10:00-13:00 e 14:30-19:00';
const LINK = () => process.env.LINK_AGENDAMENTO || 'https://calendar.app.google/6ZPswU6ftN2VKuUC9';

module.exports = {
  ajuda: () => 'Olá, ' + NOME() + '. Quer marcar consulta? Diga: animal, motivo e dia/hora. Ou marque aqui: ' + LINK(),
  urgencia: () => 'É urgente. Ligue já para ' + TEL() + '. Não espere aqui.',
  horario: () => HORARIO() + '. Marque aqui: ' + LINK(),
  morada: () => MORADA() + '. Marque aqui: ' + LINK(),
  precos: () => 'Preço depende do ato. Consulta base e vacinas têm tabela na clínica. Diga o motivo que confirmo.',
  pedirDadosMarcar: () => 'Claro. Diga: nome do animal, motivo e dia/hora que prefere. Ou marque direto aqui: ' + LINK(),
  pedirDadosRemarcar: () => 'Diga a consulta (animal + dia atual) e a nova dia/hora.',
  pedirDadosCancelar: () => 'Diga qual a consulta a cancelar (animal + dia/hora).',
  confirmada: (ev) => 'Marcado: ' + ev.resumo + '. ' + MORADA() + '. Traga boletim. Para mudar, diga aqui.',
  remarcada: (ev) => 'Alterado: ' + ev.resumo + '. Para mudar de novo, diga aqui.',
  cancelada: (ev) => 'Cancelado: ' + (ev.resumo || 'a sua consulta') + '. Para marcar de novo, diga aqui.',
  falhaAgenda: () => 'Não consegui na agenda. Ligue ' + TEL() + ' que tratamos já.',
  pedidoRegistado: (oQue) => 'Pedido de ' + oQue + ' registado. Confirmamos já de seguida aqui.',
  pedidoProvisorio: (ev) => 'Pré-marcado: ' + ev.resumo + '. Falta só a confirmação da clínica, avisamos já aqui.',
  avisoGestor: (p) => 'Novo pedido ' + p.tipo.toUpperCase() + ' ' + p.id + ': '
    + (p.dados ? (p.dados.animal + ' — ' + p.dados.dia + ' ' + p.dados.hora + ' — ' + p.dados.motivo + ' [' + (p.dados.servico || 'consulta') + ']') : p.texto)
    + ' | Cliente: ' + p.cliente + '. Responda OK ou NÃO.',
  recusada: () => 'A clínica não conseguiu esse horário. Diga outra dia/hora que tratamos.',
  foraHorario: () => 'Estamos fechados. Registei o pedido, confirmamos de manhã. Urgência: ligue ' + TEL() + '.',
  contactoDireto: (servico) => 'Para ' + servico + ' contacte diretamente a clínica por chamada. Não se agenda aqui.',
  horarioPreferencial: (servico) => 'Para ' + servico + ' os horários preferenciais são início da manhã (10:00) ou início da tarde (14:30). Diga outro horário.',
};
