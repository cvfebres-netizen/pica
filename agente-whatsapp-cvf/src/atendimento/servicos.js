/* Tabela de serviços da clínica: nome, duração, preço base e regras de agendamento.
   contactoDireto: true = não se agenda pelo bot, o cliente deve ligar.
   horarioPreferencial: array de "HH:mm" aceites (ex. tosquia/banho só no início da manhã/tarde).
   naoSobreporCom: IDs de serviços que não podem ocupar o mesmo horário. */
module.exports = [
  { id: 'consulta', nomes: ['consulta', 'check', 'check-up', 'checkup'], duracaoMin: 30, preco: 'desde 40 €', agendamentoDireto: true },
  { id: 'vacina', nomes: ['vacina', 'vacinação', 'vacinacao', 'reforço', 'reforco'], duracaoMin: 20, preco: 'tabela na clínica', agendamentoDireto: true },
  { id: 'desparasitacao', nomes: ['desparasit', 'despist'], duracaoMin: 15, preco: 'tabela na clínica', agendamentoDireto: true },
  { id: 'banho', nomes: ['banho'], duracaoMin: 45, preco: 'conforme porte', agendamentoDireto: true, horarioPreferencial: ['10:00', '14:30'], naoSobreporCom: ['tosquia'] },
  { id: 'tosquia', nomes: ['tosquia', 'corte', 'grooming'], duracaoMin: 90, preco: 'conforme porte', agendamentoDireto: true, horarioPreferencial: ['10:00', '14:30'], naoSobreporCom: ['banho'] },
  { id: 'cirurgia', nomes: ['cirurgia', 'esteriliz', 'castracao', 'castração', 'operacao', 'operação'], duracaoMin: 90, preco: 'orçamento na clínica', agendamentoDireto: false, contactoDireto: true },
  { id: 'analises', nomes: ['analise', 'análise', 'sangue', 'raio', 'rx', 'eco', 'ecografia'], duracaoMin: 30, preco: 'conforme exame', agendamentoDireto: true }
];

function detetarServico(texto) {
  const t = (texto || '').toLowerCase();
  const todos = module.exports;
  for (const s of todos) {
    if (s.nomes.some((n) => t.includes(n))) return s;
  }
  return todos[0]; // consulta por omissão
}
module.exports.detetarServico = detetarServico;

