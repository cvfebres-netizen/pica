/* ============================================================
   _check_horas.js — A REGRA DA CONTAGEM DE HORAS
   Ficheiro LOCAL. NAO vai para o Apps Script.

   O motor de horas e' a regra de negocio central (e' o que entra na folha
   de wages), mas as garantias dele so estavam provadas a mao, num script
   descartavel. O guia de code review do Google e' explicito: os testes
   devem ser adicionados no mesmo change que o codigo de producao — um
   script de verificacao que se apaga depois nao conta.

   node _check_horas.js
   ============================================================ */
const H = require('./_harness.js');

let FALHAS = 0, PASSOS = 0;
const REL = [];
function ass(ok, msg) { PASSOS++; REL.push((ok ? '  OK     ' : '  FALHA  ') + msg); if (!ok) FALHAS++; }
function nota(msg) { REL.push('  ----   ' + msg); }

const E = ['ENTRADA_MANHA', 'SAIDA_MANHA', 'ENTRADA_TARDE', 'SAIDA_TARDE'];
const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

/* Semeia picagens num dia e devolve o que o motor calculou.
   `pares` = [['10:00','13:00'], ['14:30','19:00']] */
function diaCom(pares, dia, userId) {
  const ctx = H.preparar();
  const f = ctx.getSpreadsheet_().getSheetByName('PICAGENS');
  const cab = f.getRange(1, 1, 1, f.getLastColumn()).getValues()[0];
  const m = {}; cab.forEach((h, i) => { m[h] = i; });
  const uid = userId || 'USR_PEDRO_SILVA';
  let k = 0;
  (pares || []).forEach(function (iv) {
    [iv[0], iv[1]].forEach(function (hora) {
      const dt = ctx.criarDataHora_(dia, Number(hora.split(':')[0]), Number(hora.split(':')[1]), 0);
      const l = new Array(cab.length).fill('');
      l[m.ID] = 'H' + (k++); l[m.Data] = ctx.formatarDataISO_(dia); l[m.DataHora] = dt;
      l[m.UserID] = uid; l[m.Nome] = 'Alvo'; l[m.Tipo] = E[k - 1]; l[m.Origem] = 'WEBAPP';
      f._dados.push(l);
    });
  });
  ctx.limparCacheFolhas_();
  return ctx.calcularDia_(uid, dia);
}
function rotulo(r) {
  return 'trab=' + hhmm(r.minutosTrabalhados) + ' normal=' + hhmm(r.minutosNormais) +
    ' extra=' + hhmm(r.minutosExtra);
}
const SEG = new Date(2026, 8, 21); /* segunda-feira */

REL.push('===== 1: SO OS PARES ENTRADA/SAIDA CONTAM =====');
[
  [[['10:00', '13:00'], ['14:30', '19:00']], 450, 450, 0, 'dia completo'],
  [[['09:40', '13:00'], ['14:30', '19:00']], 470, 450, 20, 'entrada 20 min antes'],
  [[['10:00', '13:00'], ['14:30', '20:00']], 510, 450, 60, 'saida 1 h depois'],
  [[['10:00', '13:00']], 180, 180, 0, 'so a manha'],
  [[['13:30', '14:30']], 60, 0, 60, 'picagem dentro da pausa']
].forEach(function (c) {
  const r = diaCom(c[0], SEG);
  ass(r.minutosTrabalhados === c[1] && r.minutosNormais === c[2] && r.minutosExtra === c[3],
    c[4] + ': ' + rotulo(r) + '  (esperado trab=' + hhmm(c[1]) + ' normal=' + hhmm(c[2]) + ' extra=' + hhmm(c[3]) + ')');
});
/* entrada sem saida: o par fica incompleto e tem de valer ZERO */
const ctxInc = H.preparar();
const fInc = ctxInc.getSpreadsheet_().getSheetByName('PICAGENS');
const cabI = fInc.getRange(1, 1, 1, fInc.getLastColumn()).getValues()[0];
const mI = {}; cabI.forEach((h, i) => { mI[h] = i; });
[[E[0], '10:00'], [E[2], '14:30']].forEach(function (p, i) {
  const dt = ctxInc.criarDataHora_(SEG, Number(p[1].split(':')[0]), Number(p[1].split(':')[1]), 0);
  const l = new Array(cabI.length).fill('');
  l[mI.ID] = 'I' + i; l[mI.Data] = ctxInc.formatarDataISO_(SEG); l[mI.DataHora] = dt;
  l[mI.UserID] = 'USR_PEDRO_SILVA'; l[mI.Nome] = 'Alvo'; l[mI.Tipo] = p[0];
  fInc._dados.push(l);
});
/* entrada sem saida: ANTES valia ZERO e o dia ficava INCOMPLETO — quem
   trabalhava perdia o dia inteiro por um botao. Agora o FECHO e' assumido
   no fim do turno, que e' uma hora que o sistema conhece. */
ctxInc.limparCacheFolhas_();
const rInc = ctxInc.calcularDia_('USR_PEDRO_SILVA', SEG);
ass(rInc.minutosTrabalhados === 450,
  'entrada SEM saida fecha no fim do turno (7h30, nao zero): ' + rotulo(rInc));
ass(rInc.saidasAssumidas === 2, 'e ficam marcados os 2 fechos assumidos :: ' + rInc.saidasAssumidas);
ass(rInc.picagens.filter(function (p) { return p.saidaAssumida; })
    .every(function (p) { return p.origem === 'FECHO_ASSUMIDO'; }),
  'a picagem inventada fica MARCADA como FECHO_ASSUMIDO');
ass(rInc.validacaoPicagens.valido, 'e o dia nao fica com sequencia invalida: ' +
  (rInc.validacaoPicagens.problemas.join(' ') || 'valido'));

/* A outra metade da regra: na ABERTURA nao se inventa nada. Uma saida sem
   entrada correspondente continua a ser um dia incompleto. */
const ctxSoSaida = H.preparar();
const fSS = ctxSoSaida.getSpreadsheet_().getSheetByName('PICAGENS');
const cabSS = fSS.getRange(1, 1, 1, fSS.getLastColumn()).getValues()[0];
const mSS = {}; cabSS.forEach(function (h, i) { mSS[h] = i; });
const lSS = new Array(cabSS.length).fill('');
lSS[mSS.ID] = 'SO1'; lSS[mSS.Data] = ctxSoSaida.formatarDataISO_(SEG);
lSS[mSS.DataHora] = ctxSoSaida.criarDataHora_(SEG, 13, 0, 0);
lSS[mSS.UserID] = 'USR_PEDRO_SILVA'; lSS[mSS.Nome] = 'Alvo';
lSS[mSS.Tipo] = 'SAIDA_MANHA'; lSS[mSS.Origem] = 'WEBAPP';
fSS._dados.push(lSS);
ctxSoSaida.limparCacheFolhas_();
const rSS = ctxSoSaida.calcularDia_('USR_PEDRO_SILVA', SEG);
ass(rSS.saidasAssumidas === 0 && rSS.estado === 'INCOMPLETO',
  'so a ABERTURA nunca e assumida (saida sem entrada nao inventa entrada): ' + rSS.estado);

/* Se a pessoa picar a saida a seguir, passa a valer a picagem REAL. */
const ctxReal = H.preparar();
const fR = ctxReal.getSpreadsheet_().getSheetByName('PICAGENS');
const cabR = fR.getRange(1, 1, 1, fR.getLastColumn()).getValues()[0];
const mR = {}; cabR.forEach(function (h, i) { mR[h] = i; });
[[E[0], '10:00'], [E[1], '13:00'], [E[2], '14:30'], [E[3], '20:00']].forEach(function (p, i) {
  const l = new Array(cabR.length).fill('');
  l[mR.ID] = 'R' + i; l[mR.Data] = ctxReal.formatarDataISO_(SEG);
  l[mR.DataHora] = ctxReal.criarDataHora_(SEG, Number(p[1].split(':')[0]), Number(p[1].split(':')[1]), 0);
  l[mR.UserID] = 'USR_PEDRO_SILVA'; l[mR.Nome] = 'Alvo'; l[mR.Tipo] = p[0]; l[mR.Origem] = 'WEBAPP';
  fR._dados.push(l);
});
ctxReal.limparCacheFolhas_();
const rReal = ctxReal.calcularDia_('USR_PEDRO_SILVA', SEG);
ass(rReal.saidasAssumidas === 0 && rReal.minutosTrabalhados === 510,
  'com saida REAL as 20h vale 8h30, nao o fecho assumido: ' + rotulo(rReal));

/* ---- dias SEM horario normal (sabado fora da escala, domingo, feriado) ----
   Antes estos dias devolviam ZERO horas: quem trabalhava e se esquecia da
   saida perdia o dia. Fecha-se no fim do turno normal da manha (13:00). */
function semHorarioNormal(nome, dia, pares, esperadoMin) {
  const c = H.preparar();
  const ff = c.getSpreadsheet_().getSheetByName('PICAGENS');
  const cc = ff.getRange(1, 1, 1, ff.getLastColumn()).getValues()[0];
  const mm = {}; cc.forEach(function (h, i) { mm[h] = i; });
  pares.forEach(function (p, i) {
    const l = new Array(cc.length).fill('');
    l[mm.ID] = 'SN' + i; l[mm.Data] = c.formatarDataISO_(dia);
    l[mm.DataHora] = c.criarDataHora_(dia, Number(p[1].split(':')[0]), Number(p[1].split(':')[1]), 0);
    l[mm.UserID] = 'USR_PEDRO_SILVA'; l[mm.Nome] = 'Alvo'; l[mm.Tipo] = p[0]; l[mm.Origem] = 'WEBAPP';
    ff._dados.push(l);
  });
  c.limparCacheFolhas_();
  const r = c.calcularDia_('USR_PEDRO_SILVA', dia);
  ass(r.saidasAssumidas === 1 && r.minutosTrabalhados === esperadoMin,
    nome + ': fecha as 13h00 em vez de dar 0 h :: ' + rotulo(r));
}
semHorarioNormal('sabado fora da escala, entrada as 10h', new Date(2026, 8, 26), [['ENTRADA_MANHA', '10:00']], 180);
semHorarioNormal('domingo, entrada as 10h', new Date(2026, 8, 27), [['ENTRADA_MANHA', '10:00']], 180);

/* Nao se inventa um dia inteiro: sem nenhuma picagem continua a ser 0 h.
   Uma regra de "assumir o fecho" que transformasse um dia em branco numas
   horas seria exactamente o oposto do que se quer. */
const cVazio = H.preparar();
cVazio.limparCacheFolhas_();
const rVazio = cVazio.calcularDia_('USR_PEDRO_SILVA', new Date(2026, 8, 27));
ass(rVazio.saidasAssumidas === 0 && rVazio.minutosTrabalhados === 0,
  'dia SEM picagens nao ganha fecho assumido nenhum :: ' + rotulo(rVazio));

/* A entrada da tarde nao pode fechar as 13h se entrou as 15h: ficaria com
   horas negativas. O motor recusa e o dia fica INCOMPLETO. */
const cTarde = H.preparar();
const fT = cTarde.getSpreadsheet_().getSheetByName('PICAGENS');
const cabT = fT.getRange(1, 1, 1, fT.getLastColumn()).getValues()[0];
const mT = {}; cabT.forEach(function (h, i) { mT[h] = i; });
const lT = new Array(cabT.length).fill('');
lT[mT.ID] = 'TD'; lT[mT.Data] = cTarde.formatarDataISO_(new Date(2026, 8, 26));
lT[mT.DataHora] = cTarde.criarDataHora_(new Date(2026, 8, 26), 15, 0, 0);
lT[mT.UserID] = 'USR_PEDRO_SILVA'; lT[mT.Nome] = 'Alvo'; lT[mT.Tipo] = 'ENTRADA_TARDE'; lT[mT.Origem] = 'WEBAPP';
fT._dados.push(lT);
cTarde.limparCacheFolhas_();
const rT = cTarde.calcularDia_('USR_PEDRO_SILVA', new Date(2026, 8, 26));
ass(rT.saidasAssumidas === 0 && rT.minutosTrabalhados === 0,
  'entrada as 15h nao fecha as 13h (seria hora negativa): ' + rotulo(rT));

REL.push('');
REL.push('===== 2: A PAUSA 13:00-14:30 =====');
/* O horario normal tem duas janelas separadas por uma pausa. Se um par
   atravessasse a pausa, essa pausa seria contada como EXTRA — e nao como
   trabalho. Fica fixado aqui para ninguem mudar isso sem o notar. */
[[['10:00', '19:00']], [['11:00', '16:00']]].forEach(function (p) {
  const r = diaCom(p, SEG);
  ass(r.minutosTrabalhados === (p[0][1] === '19:00' ? 540 : 300),
    'par unico ' + p[0][0] + '-' + p[0][1] + ': ' + rotulo(r));
  nota('  a pausa de 1h30 cai dentro das extra: ' + hhmm(r.minutosExtra));
});
REL.push('');
REL.push('===== 3: SEPARACAO POR DIA =====');
const ctxD = H.preparar();
const fD = ctxD.getSpreadsheet_().getSheetByName('PICAGENS');
const cabD = fD.getRange(1, 1, 1, fD.getLastColumn()).getValues()[0];
const mD = {}; cabD.forEach((h, i) => { mD[h] = i; });
let nD = 0;
[[21, E[0], '10:00', E[1], '13:00'], [22, E[2], '14:30', E[3], '19:00'], [23, E[0], '10:00', E[1], '13:00']]
  .forEach(function (p) {
    const dia = new Date(2026, 8, p[0]);
    [[p[1], p[2]], [p[3], p[4]]].forEach(function (par) {
      const dt = ctxD.criarDataHora_(dia, Number(par[1].split(':')[0]), Number(par[1].split(':')[1]), 0);
      const l = new Array(cabD.length).fill('');
      l[mD.ID] = 'D' + (nD++); l[mD.Data] = ctxD.formatarDataISO_(dia); l[mD.DataHora] = dt;
      l[mD.UserID] = 'USR_PEDRO_SILVA'; l[mD.Nome] = 'Alvo'; l[mD.Tipo] = par[0];
      fD._dados.push(l);
    });
  });
ctxD.limparCacheFolhas_();
[180, 270, 180].forEach(function (esperado, i) {
  const dia = new Date(2026, 8, 21 + i);
  const r = ctxD.calcularDia_('USR_PEDRO_SILVA', dia);
  ass(r.minutosTrabalhados === esperado, ctxD.formatarDataISO_(dia) + ' le SO o seu dia: ' + rotulo(r));
});

REL.push('');
REL.push('===== 4: A SEMANA =====');
const ctxS = H.preparar();
ass(ctxS.inicioDaSemana_(new Date(2026, 8, 21)).getDay() === 1,
  'com primeira=segunda, a semana comeca numa segunda');
const ini = ctxS.inicioDaSemana_(new Date(2026, 8, 24));
const fim = new Date(ini.getTime()); fim.setDate(fim.getDate() + 6);
ass(Math.round((fim - ini) / 86400000) === 6, 'a semana tem sempre 7 dias');
ass(String(ctxS.primeiroDiaSemana_()) ===
  (/PRIMEIRO_DIA_SEMANA:\s*(\d)/.exec(require('fs').readFileSync(__dirname + '/Config.gs', 'utf8'))[1]),
  'o primeiro dia da semana vem de Config.gs (nao esta escrito a mao)');
REL.push('');
REL.push('===== 5: SABADOS =====');
const ctxB = H.preparar();
const grupos = ctxB.obterGruposSabado_();
nota('grupos: ' + JSON.stringify(grupos.map(function (g) {
  return { id: g.grupoId, ordem: g.ordem, inicio: g.dataInicio };
})));
const membros = [];
for (let i = 0; i < 6; i++) {
  const d = new Date(2026, 8, 26 + i * 7);
  const dentro = ctxB.obterRotacaoSabadoParaData_(d).filter(function (r) { return r.userId; });
  if (dentro.length) membros.push({ data: d, userId: dentro[0].userId });
}
nota('sabados de escala: ' + membros.map(function (x) {
  return ctxB.formatarDataISO_(x.data) + '=' + x.userId;
}).join(', '));
ass(membros.length >= 2, 'a rotacao produz sabados de escala para testar');

if (membros.length) {
  const x = membros[0];
  ass(ctxB.determinarTipoDia_(x.userId, x.data) === 'SABADO_PREVISTO',
    'quem esta de escala tem tipo SABADO_PREVISTO em ' + ctxB.formatarDataISO_(x.data));
  const h = ctxB.obterHorarioNormal_('SABADO_PREVISTO');
  ass(h.length === 2 && h[0].inicio === '10:00' && h[0].fim === '13:00' &&
    h[1].inicio === '14:30' && h[1].fim === '19:00',
    'o horario normal de sabado e' + ' 10-13 + 14:30-19 :: ' +
    h.map(function (i) { return i.inicio + '-' + i.fim; }).join(' + '));
  /* [pares, normal esperado, extra esperado] */
  [[[['10:00', '13:00']], 180, 0],
   [[['10:00', '13:00'], ['14:30', '19:00']], 450, 0],
   [[['10:00', '13:00'], ['14:30', '20:30']], 450, 90]]
    .forEach(function (c, i) {
      const r = diaCom(c[0], x.data, x.userId);
      ass(r.minutosNormais === c[1] && r.minutosExtra === c[2],
        'sabado de escala, cenario ' + (i + 1) + ': ' + rotulo(r) +
        '  (esperado normal=' + hhmm(c[1]) + ' extra=' + hhmm(c[2]) + ')');
    });
  ass(ctxB.obterHorarioNormal_('SABADO_NAO_PREVISTO').length === 0,
    'sabado FORA de escala nao tem horario normal (tudo o que se trabalha e' + ' extra)');
REL.push('');
REL.push('===== 6: EXCEDENTE DIARIO E SEMANAL =====');
/* Duas contas diferentes que nao se podem baralhar:
   - o que se passou do horario DO DIA (7h30)
   - o que a SEMANA passou das 40h de contrato -> horas extraordinarias
   Sem isto, "fizeram mais 1 h hoje" e "fizeram horas extra esta semana"
   seriam a mesma coisa, e o banco de horas nao fechava. */
function semanaCom(horasPorDia, quantosDias) {
  const ctx = H.preparar();
  const f = ctx.getSpreadsheet_().getSheetByName('PICAGENS');
  const cab = f.getRange(1, 1, 1, f.getLastColumn()).getValues()[0];
  const m = {}; cab.forEach((h, i) => { m[h] = i; });
  /* A tarde comeca as 14:30 (870 min) e a manha ate as 13:00 (180 min).
     A saida e' 14:30 + o que sobra das horas pedidas. Calcular `horas * 60`
     dava 08:30 para 8h30 — ANTES da entrada das 10:00, e o motor
     descartava as picagens todas (a suite passava sem provar nada). */
  const fimMin = 870 + (Math.round(horasPorDia * 60) - 180);
  const pad = n => ('0' + n).slice(-2);
  const saida = pad(Math.floor(fimMin / 60)) + ':' + pad(fimMin % 60);
  let id = 0;
  for (let d = 0; d < quantosDias; d++) {
    const dia = new Date(2026, 8, 21 + d);
    [[E[0], '10:00'], [E[1], '13:00'], [E[2], '14:30'], [E[3], saida]]
      .forEach(function (p) {
        const dt = ctx.criarDataHora_(dia, Number(p[1].split(':')[0]), Number(p[1].split(':')[1]), 0);
        const l = new Array(cab.length).fill('');
        l[m.ID] = 'E' + (id++); l[m.Data] = ctx.formatarDataISO_(dia); l[m.DataHora] = dt;
        l[m.UserID] = 'USR_PEDRO_SILVA'; l[m.Nome] = 'Alvo'; l[m.Tipo] = p[0]; l[m.Origem] = 'WEBAPP';
        f._dados.push(l);
      });
  }
  ctx.limparCacheFolhas_();
  const ini = ctx.inicioDaSemana_(new Date(2026, 8, 21));
  const fim = new Date(ini.getTime()); fim.setDate(fim.getDate() + 6);
  const dias = ctx.obterDiasTrabalhoIntervalo_('USR_PEDRO_SILVA', ini, fim);
  const t = ctx.resumirDias_(dias);
  const ex = ctx.resumirExcedenteSemanal_(dias, t);
  return { ctx: ctx, dias: dias, t: t, ex: ex, esperadoMin: Math.round(horasPorDia * 60) * quantosDias };
}
/* Rede de seguranca: se as picagens nao entrassem, o total daria 0 e TODAS
   as assercoes de "sem excedente" passariam ao vazio. */
let r0 = semanaCom(7.5, 5);
ass(r0.t.trabalhados === r0.esperadoMin,
  'as picagens entraram mesmo (5 x 7h30 = 37h30) :: ' + hhmm(r0.t.trabalhados));
/* O contrato nao se le de APP (o harness nao expoe a constante), mas a
   propria funcao devolve-o — e e' esse valor que interesta. */
ass(r0.ex.horasContrato === '40:00',
  'o contrato semanal vale 40 h, vem de Config.gs :: ' + r0.ex.horasContrato);

/* 5 x 7h30 = 37h30 -> dentro do contrato */
let r1 = semanaCom(7.5, 5);
ass(r1.ex.excedenteMinutos === 0, '5 x 7h30 = 37h30: dentro das 40 h, sem horas extraordinarias :: ' + r1.ex.horasExtraordinarias);
ass(r1.ex.diasComExcedente === 0, 'e sem dias com excedente diario (bateu certo no horario)');

/* 5 x 8h30 = 42h30 -> +2h30 de horas extraordinarias, em 5 dias */
let r2 = semanaCom(8.5, 5);
ass(r2.ex.excedenteMinutos === 150, '5 x 8h30 = 42h30: +2h30 de horas extraordinarias :: ' + r2.ex.horasExtraordinarias);
ass(r2.ex.horasExtraordinarias === r2.ex.excedenteHoras, 'as horas extraordinarias sao o excedente semanal (entram no banco de horas)');
ass(r2.ex.diasComExcedente === 5, 'e diz EM QUE DIAS: 5 dias :: ' +
  r2.ex.diasExcedente.map(function (d) { return d.data; }).join(' '));

/* 5 x 9h30 = 47h30 -> +7h30 */
let r3 = semanaCom(9.5, 5);
ass(r3.ex.excedenteMinutos === 450, '5 x 9h30 = 47h30: +7h30 de horas extraordinarias :: ' + r3.ex.horasExtraordinarias);

/* abaixo do contrato nunca da divida */
let r4 = semanaCom(8, 3);
ass(r4.ex.excedenteMinutos === 0, '3 dias = 25h30: abaixo do contrato NAO gera divida nem horas extra :: ' + r4.ex.horasExtraordinarias);

/* o excedente diario conta mesmo sem passar das 40h */
let r5 = semanaCom(8, 3);
ass(r5.ex.excedenteDiarioHoras === '01:30', '3 dias a 8h: +1h de "extra dia" em cada dia, mesmo sem passar das 40 h :: ' + r5.ex.excedenteDiarioHoras);
ass(r5.ex.diasComExcedente === 3, 'e sao listados os 3 dias com excedente diario');

/* os dias vem por ordem cronologica e com o dia da semana */
const ds2 = r2.ex.diasExcedente || [];
const primeiro = ds2[0];
ass(!!primeiro && !!primeiro.diaSemana && ds2.length > 1 && primeiro.data < ds2[1].data,
  'os dias de excedente vem por ordem cronologica, com o nome do dia :: ' +
  (primeiro ? primeiro.data + ' ' + primeiro.diaSemana : 'nenhum dia'));

console.log(REL.join('\n'));
  const g = grupos[0];
  if (g) {
    const seq = [];
    for (let i = 0; i < 6; i++) seq.push(ctxB.calcularMembroRotacaoSabado_(g.grupoId, new Date(2026, 8, 26 + i * 7)));
    nota('rotacao ' + g.grupoId + ': ' + seq.join(' '));
    let alterna = true;
    for (let i = 1; i < seq.length; i++) if (seq[i] && seq[i] === seq[i - 1]) alterna = false;
    ass(alterna, 'ninguem fica de escala duas semanas seguidas');
  }
}

console.log(REL.join('\n'));
console.log('');
console.log('verificacoes executadas: ' + PASSOS);
console.log('FALHAS: ' + FALHAS);
process.exit(FALHAS ? 1 : 0);
