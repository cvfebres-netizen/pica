/* ============================================================
   PICAGENS
   ============================================================ */

function validarTipoPicagem_(tipo) {
  return Object.keys(ENUMS.TIPOS_PICAGEM).some(function(k) { return ENUMS.TIPOS_PICAGEM[k] === tipo; });
}

function gerarIdPicagem_() { return 'PIC_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16).toUpperCase(); }

function obterPicagensDoDia_(userId, data) {
  const iso = formatarDataISO_(data);
  /* Lê só o dia pedido. Sem este recorte, o painel lia a PICAGENS INTEIRA
     uma vez por utilizador. A folha é acrescentada por ordem cronológica,
     por isso o índice de datas localiza a fatia sem ler as células todas.
     Se os dados não estiverem ordenados, dadosFolhaIntervalo_ desiste e
     devolve null — aí volta-se à leitura completa, como antes. */
  const f = dadosFolhaIntervalo_(SHEETS.PICAGENS, 'Data', iso, iso) || dadosFolha_(SHEETS.PICAGENS);
  if (!f.sheet || f.valores.length < 2) return [];
  const dados = f.valores;
  const mapa = f.mapa;
  return dados.slice(1).filter(function(l) { return String(l[mapa.UserID]) === String(userId) && valorDataISO_(l[mapa.Data]) === iso; }).map(function(l) {
    return { id: String(l[mapa.ID]), data: String(l[mapa.Data]), dataHora: new Date(l[mapa.DataHora]), userId: String(l[mapa.UserID]), nome: String(l[mapa.Nome] || ''), tipo: String(l[mapa.Tipo]), origem: String(l[mapa.Origem] || 'WEBAPP') };
  }).sort(function(a,b) { return a.dataHora - b.dataHora; });
}

/* Ordem canónica das 4 picagens do dia. A interface mostra os botões
   por esta ordem, pelo que o backend passa a exigir a mesma sequência
   (evita picagens fora de ordem por separadores antigos abertos). */
const ORDEM_PICAGENS_ = [
  ENUMS.TIPOS_PICAGEM.ENTRADA_MANHA,
  ENUMS.TIPOS_PICAGEM.SAIDA_MANHA,
  ENUMS.TIPOS_PICAGEM.ENTRADA_TARDE,
  ENUMS.TIPOS_PICAGEM.SAIDA_TARDE
];

function validarSequenciaPicagem_(picagens, novoTipo) {
  if (ORDEM_PICAGENS_.indexOf(novoTipo) < 0) return false;
  if (picagens.some(function(p) { return p.tipo === novoTipo; })) return false;
  if (picagens.length >= ORDEM_PICAGENS_.length) return false;
  /* a picagem tem de ser exatamente a seguinte da ordem */
  return novoTipo === ORDEM_PICAGENS_[picagens.length];
}

function registarPicagem(token, tipo, metadados) {
  const sessao = exigirOperacional_(token);
  if (!validarTipoPicagem_(tipo)) throw new Error('Tipo de picagem inválido.');
  const lock = adquirirLock_(15000);
  try {
    const agora = obterTimestampServidor_();
    const data = formatarDataISO_(agora);
    const picagens = obterPicagensDoDia_(sessao.userId, agora);
    if (!validarSequenciaPicagem_(picagens, tipo)) throw new Error('Sequência de picagem inválida ou picagem já efetuada.');
    const user = obterUtilizadorPorId_(sessao.userId);
    const sheet = getSpreadsheet_().getSheetByName(SHEETS.PICAGENS);
    metadados = metadados || {};
    sheet.appendRow([gerarIdPicagem_(), data, agora, sessao.userId, user.Nome, tipo, 'WEBAPP', metadados.dispositivo || '', metadados.latitude || '', metadados.longitude || '', agora]);
    registarAuditoriaSegura_(sessao, 'REGISTAR_PICAGEM', tipo);

    /* Persiste o dia. SEM ISTO o dia nunca chegava a DIAS_TRABALHO, as horas
       extra nunca eram criadas e as excecoes nunca abriam: a cadeia
       `guardarDiaTrabalho_`/`guardarExcecoesDoDia_`/`guardarHorasExtraCalculadas_`
       so e' alcancavel por `recalcularEGuardarDia_`, e esse era o unico sitio
       onde se chamava — uma picagem, que e' quando o dia passa a existir de
       facto. Sem esta linha, o separador "Excecoes" ficava sempre vazio e o
       fluxo de aprovacao de horas extra nao tinha nada para decidir.
       Corre dentro da lock que ja esta tomada; `recalcularEGuardarDia_` nao
       toma outra (a lock nao e' reentrante). */
    recalcularEGuardarDia_(sessao.userId, agora);

    return { sucesso: true, dataHora: agora, tipo: tipo, estado: obterEstadoPicagensHoje(token) };
  } finally { lock.releaseLock(); }
}

/* NAO existe `apagarPicagem`. As picagens originais nunca se apagam: quem
   corrige uma hora cria uma CORRECAO, que fica registada e auditada
   (ver `criarCorrecaoPicagem`). A funcao que existia aqui — que so fazia
   `throw` — foi removida porque cada nome publico e' uma porta de
   entrada a mais no dispatcher (`google.script.run` alcanca qualquer
   nome), e uma porta que da' sempre erro nao e' uma proteccao: e' ruido
   na superficie publica. A regra continua escrita em `testesCoberturaHorario_`
   e na LEIA-ME. */

function obterEstadoPicagensHoje(token) {
  const s = exigirSessao_(token);
  const agora = new Date();
  const picagens = obterPicagensDoDia_(s.userId, agora);
  return { data: formatarDataISO_(agora), picagens: picagens, quantidade: picagens.length };
}

/* ============================================================
   MOTOR CENTRAL — PICAGENS EFETIVAS / CORREÇÕES
   ============================================================ */

function obterCorrecoesDoDia_(userId, data) {
  const f = dadosFolha_(SHEETS.CORRECOES);
  if (!f.sheet || f.valores.length < 2) return [];
  const iso = formatarDataISO_(data);
  const dados = f.valores;
  const mapa = f.mapa;
  return dados.slice(1).filter(function(l) { return String(l[mapa.UserID]) === String(userId) && valorDataISO_(l[mapa.Data]) === iso; }).map(function(l) {
    return {
      id: String(l[mapa.ID]), picagemId: String(l[mapa.PicagemID] || ''), tipoCorrecao: String(l[mapa.TipoCorrecao] || ''),
      valorOriginal: l[mapa.ValorOriginal], valorNovo: l[mapa.ValorNovo], tipoOriginal: String(l[mapa.TipoOriginal] || ''),
      tipoNovo: String(l[mapa.TipoNovo] || ''), motivo: String(l[mapa.Motivo] || ''), estado: String(l[mapa.Estado] || ''),
      criadoPor: String(l[mapa.CriadoPor] || ''), aplicadoPor: String(l[mapa.AplicadoPor] || ''), dataAplicacao: l[mapa.DataAplicacao], observacoes: String(l[mapa.Observacoes] || '')
    };
  });
}

function obterMencaoCorrecao_(userId, data) {
  /* Resumo do que o utilizador já PORTOU sobre este dia. Os relatórios têm de
     MOSTRAR a menção: um pedido de correção que ninguém vê é um pedido
     perdido. Traz a mais recente por decidir e quantas há em aberto. */
  const doDia = obterCorrecoesDoDia_(userId, data);
  const pedidos = doDia.filter(function (c) { return c.tipoCorrecao === 'PEDIR_REVISAO' && c.estado === 'PEDIDO'; });
  const decididas = doDia.filter(function (c) { return c.tipoCorrecao === 'PEDIR_REVISAO' && c.estado !== 'PEDIDO'; });
  const aberta = pedidos.length ? pedidos[pedidos.length - 1] : null;
  const ultima = decididas.length ? decididas[decididas.length - 1] : null;
  const mostrar = aberta || ultima;
  return {
    existe: !!mostrar,
    estado: mostrar ? mostrar.estado : '',
    motivo: mostrar ? mostrar.motivo : '',
    id: mostrar ? mostrar.id : '',
    pendentes: pedidos.length,
    /* o botão só aparece quando ainda não há nada em aberto: um pedido
       pending que se multiplica a cada clique é ruído, não serviço */
    podePedir: pedidos.length === 0
  };
}

function converterValorParaDataHora_(valor, dataBase) {
  if (valor instanceof Date && !isNaN(valor.getTime())) return new Date(valor.getTime());
  const texto = String(valor || '').trim();
  const m = texto.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return criarDataHora_(dataBase, Number(m[1]), Number(m[2]), Number(m[3] || 0));
  const d = new Date(texto);
  return isNaN(d.getTime()) ? null : d;
}

function obterPicagensEfetivasDoDia_(userId, data) {
  let picagens = obterPicagensDoDia_(userId, data).map(function(p) { return Object.assign({}, p, { origemEfetiva: 'ORIGINAL', corrigida: false, correcaoId: '' }); });
  const correcoes = obterCorrecoesDoDia_(userId, data).filter(function(c) { return c.estado === 'APROVADA'; });
  const orphans = [];
  correcoes.forEach(function(c) {
    if (c.tipoCorrecao === 'REMOVER_PICAGEM' && c.picagemId) {
      picagens = picagens.filter(function(p) { return String(p.id) !== String(c.picagemId); });
      return;
    }
    if (c.tipoCorrecao === 'ADICIONAR_PICAGEM') {
      const hora = converterValorParaDataHora_(c.valorNovo, data);
      if (!hora || !validarTipoPicagem_(c.tipoNovo)) throw new Error('Correção aprovada inválida: ' + c.id);
      picagens.push({ id: '', data: formatarDataISO_(data), dataHora: hora, userId: userId, nome: obterUtilizadorPorId_(userId).Nome, tipo: c.tipoNovo, origem: 'CORRECAO_APROVADA', origemEfetiva: 'CORRECAO', corrigida: true, correcaoId: c.id });
      return;
    }
    if (!c.picagemId) return;
    const idx = picagens.findIndex(function(p) { return String(p.id) === String(c.picagemId); });
    /* Uma correcao aprovada que aponta para uma picagem que ja nao
       existe (a picagem foi removida, o dia foi corrigido a mao, a
       correcao veio de outra folha) NAO pode rebentar a leitura. Esta
       funcao corre para TODOS os utilizadores do painel: um unico
       registo mau deixava o gestor sem ver nada — nenhum utilizador,
       nenhum total, o separador inteiro caido.
       Ignora-se a correcao orfa e regista-se para investigação. */
    if (idx < 0) { orphans.push(c.id); return; }
    const p = picagens[idx];
    if (c.tipoCorrecao === 'ALTERAR_HORA' || c.tipoCorrecao === 'ALTERAR_HORA_E_TIPO') {
      const horaNova = converterValorParaDataHora_(c.valorNovo, data);
      if (!horaNova) throw new Error('Nova hora inválida: ' + c.id);
      p.dataHora = horaNova;
    }
    if (c.tipoCorrecao === 'ALTERAR_TIPO' || c.tipoCorrecao === 'ALTERAR_HORA_E_TIPO') {
      if (!validarTipoPicagem_(c.tipoNovo)) throw new Error('Novo tipo inválido: ' + c.id);
      p.tipo = c.tipoNovo;
    }
    p.origemEfetiva = 'CORRECAO'; p.corrigida = true; p.correcaoId = c.id;
  });
  if (orphans.length) {
    registarErro_('obterPicagensEfetivasDoDia_',
      new Error('Correções aprovadas sem picagem correspondente: ' + orphans.join(', ')),
      userId, { data: formatarDataISO_(data), correcoes: orphans });
  }
  picagens.sort(function(a,b) { return a.dataHora - b.dataHora; });
  return picagens;
}

function validarPicagensEfetivas_(picagens) {
  const tipos = [
    ENUMS.TIPOS_PICAGEM.ENTRADA_MANHA,
    ENUMS.TIPOS_PICAGEM.SAIDA_MANHA,
    ENUMS.TIPOS_PICAGEM.ENTRADA_TARDE,
    ENUMS.TIPOS_PICAGEM.SAIDA_TARDE
  ];
  const problemas = [];
  if (picagens.length > 4) problemas.push('Mais de 4 picagens.');
  const vistos = {};
  picagens.forEach(function(p) { vistos[p.tipo] = (vistos[p.tipo] || 0) + 1; });
  Object.keys(vistos).forEach(function(k) { if (vistos[k] > 1) problemas.push('Tipo duplicado: ' + k); });
  for (let i = 0; i < picagens.length; i++) if (picagens[i].tipo !== tipos[i]) problemas.push('Sequência inválida na posição ' + (i + 1));
  for (let j = 1; j < picagens.length; j++) if (picagens[j].dataHora <= picagens[j-1].dataHora) problemas.push('Horários não cronológicos.');
  return { valido: problemas.length === 0, problemas: problemas };
}

/* ============================================================
   FECHO AUTOMÁTICO — SÓ NO FECHO
   ============================================================
   Quem entra e esquece-se de picar a saída ficava, até agora, com o dia
   INCOMPLETO e **zero horas** — a pessoa trabalhou e o sistema dizia que
   não. Em wages isso é perder dinheiro à pessoa por um botão.

   Aqui assume-se a SAÍDA no fim do turno, que é uma hora que o sistema
   CONHECE: o fim do horário normal do dia (13:00 de manhã, 19:00 de tarde;
   no sábado de escala, os mesmos).

   **Só no fecho, nunca na abertura.** A entrada não se pode inventar:
   um turno pode começar às 9h00 ou às 10h30 e o sistema não tem como
   saber. A saída é diferente — o turno tem um fim definido. Assumir uma
   abertura seria fabricar horas que ninguém pode confirmar.

   A picagem assumida fica MARCADA (`saidaAssumida`), nunca se confunde com
   uma picagem real, e a auditoria regista-a. Se a pessoa picar a saída a
   seguir, passa a valer a picagem real e a suposição desaparece. */
function completarSaidasAutomaticamente_(picagens, horarioNormal) {
  /* Num dia SEM horario normal (sabado fora da escala, domingo, feriado) nao
     ha turno a que fechar — mas quem entrou trabalhou, e devolver zero horas
     e' o erro que esta automatizacao existe para evitar. Fecha-se no fim do
     turno normal da manha (13:00), a unica hora que a empresa conhece com
     seguranca. */
  const horarios = (horarioNormal && horarioNormal.length)
    ? horarioNormal
    : [{ inicio: APP.HORARIO.SEMANA[0].inicio, fim: APP.FECHO_ASSUMIDO_SEM_HORARIO }];
  const normais = converterHorarioParaIntervalosMinutos_(horarios);
  if (!normais.length) return picagens; /* sem horario nao ha hora a assumir */
  const porTipo = {};
  picagens.forEach(function (p) { porTipo[p.tipo] = p; });

  const saidas = [
    { entrada: ENUMS.TIPOS_PICAGEM.ENTRADA_MANHA, saida: ENUMS.TIPOS_PICAGEM.SAIDA_MANHA, periodo: 'MANHA', fim: normais[0] },
    { entrada: ENUMS.TIPOS_PICAGEM.ENTRADA_TARDE, saida: ENUMS.TIPOS_PICAGEM.SAIDA_TARDE, periodo: 'TARDE', fim: normais[1] }
  ];

  let acrescentadas = null;
  saidas.forEach(function (s) {
    const ent = porTipo[s.entrada];
    /* só suprime quando falta a saída E existe a entrada correspondente */
    if (!ent || porTipo[s.saida]) return;
    /* a tarde só é assumida se o turno acabar depois de ela começar */
    if (!s.fim) return;
    const inicioMin = obterMinutosDoDia_(ent.dataHora);
    if (s.fim.fim <= inicioMin) return;
    const assumida = {
      id: '', data: formatarDataISO_(ent.dataHora), dataHora: criarDataHora_(ent.dataHora, Math.floor(s.fim.fim / 60), s.fim.fim % 60, 0),
      userId: ent.userId, nome: ent.nome, tipo: s.saida, origem: 'FECHO_ASSUMIDO',
      origemEfetiva: 'FECHO_ASSUMIDO', corrigida: false, correcaoId: '', saidaAssumida: true
    };
    if (!acrescentadas) acrescentadas = picagens.slice();
    acrescentadas.push(assumida);
    porTipo[s.saida] = assumida;
  });
  if (!acrescentadas) return picagens;
  /* A validacao assume a ordem canonica EM, SM, ET, ST. Como as picagens
     assumidas sao acrescentadas ao FIM, o array saía a misturado
     (EM, ET, SM, ST) e acusava "Sequência inválida" num dia que estava
     perfeitamente bem. Reordenar pela hora resolve. */
  const ordem = {};
  saidas.forEach(function (s, i) { ordem[s.entrada] = i * 2; ordem[s.saida] = i * 2 + 1; });
  acrescentadas.sort(function (a, b) {
    const dif = a.dataHora - b.dataHora;
    if (dif !== 0) return dif;
    return (ordem[a.tipo] || 0) - (ordem[b.tipo] || 0);
  });
  return acrescentadas;
}

function construirIntervalosTrabalho_(picagens) {
  const porTipo = {};
  picagens.forEach(function(p) { porTipo[p.tipo] = p; });
  const intervalos = [];
  const pares = [
    [ENUMS.TIPOS_PICAGEM.ENTRADA_MANHA, ENUMS.TIPOS_PICAGEM.SAIDA_MANHA, 'MANHA'],
    [ENUMS.TIPOS_PICAGEM.ENTRADA_TARDE, ENUMS.TIPOS_PICAGEM.SAIDA_TARDE, 'TARDE']
  ];
  pares.forEach(function(par) {
    if (porTipo[par[0]] && porTipo[par[1]]) {
      intervalos.push({ inicio: porTipo[par[0]].dataHora, fim: porTipo[par[1]].dataHora, periodo: par[2], saidaAssumida: !!porTipo[par[1]].saidaAssumida });
      return;
    }
    if (porTipo[par[0]] || porTipo[par[1]]) intervalos.push({ inicio: porTipo[par[0]] ? porTipo[par[0]].dataHora : null, fim: porTipo[par[1]] ? porTipo[par[1]].dataHora : null, periodo: par[2], incompleto: true });
  });
  return intervalos;
}

function calcularIntersecaoMinutos_(aInicio, aFim, bInicio, bFim) {
  const inicio = Math.max(aInicio, bInicio);
  const fim = Math.min(aFim, bFim);
  return Math.max(0, fim - inicio);
}

function converterHorarioParaIntervalosMinutos_(horarios) {
  return (horarios || []).map(function(i) { return { inicio: horaParaMinutos_(i.inicio), fim: horaParaMinutos_(i.fim) }; });
}

function calcularNormalEExtra_(intervalosTrabalho, horarioNormal) {
  const normais = converterHorarioParaIntervalosMinutos_(horarioNormal);
  let normal = 0, extra = 0;
  const segmentosExtra = [];
  intervalosTrabalho.forEach(function(i) {
    if (i.incompleto || !i.inicio || !i.fim) return;
    const inicio = obterMinutosDoDia_(i.inicio), fim = obterMinutosDoDia_(i.fim);
    let n = 0;
    normais.forEach(function(h) { n += calcularIntersecaoMinutos_(inicio, fim, h.inicio, h.fim); });
    normal += n;
    extra += Math.max(0, fim - inicio - n);
    let cursor = inicio;
    normais.forEach(function(h) {
      if (cursor < h.inicio && h.inicio < fim) segmentosExtra.push({ inicio: cursor, fim: Math.min(h.inicio, fim) });
      if (cursor < h.fim) cursor = Math.max(cursor, h.fim);
    });
    if (cursor < fim) segmentosExtra.push({ inicio: cursor, fim: fim });
  });
  return { minutosNormais: normal, minutosExtra: extra, segmentosExtra: segmentosExtra.filter(function(s) { return s.fim > s.inicio; }) };
}

function calcularMinutosPlaneados_(horarioNormal) { return converterHorarioParaIntervalosMinutos_(horarioNormal).reduce(function(t, i) { return t + i.fim - i.inicio; }, 0); }


function determinarExcecoes_(userId, data, tipoDia, picagens, intervalos, segmentosExtra) {
  const excecoes = [];
  const valida = validarPicagensEfetivas_(picagens);
  if (!valida.valido) excecoes.push({ tipo: 'SEQUENCIA_PICAGENS', descricao: valida.problemas.join(' ') });
  if (intervalos.some(function(i) { return i.incompleto; })) excecoes.push({ tipo: 'PICAGEM_INCOMPLETA', descricao: 'Existe um período sem entrada/saída correspondente.' });
  if (tipoDia === ENUMS.TIPOS_DIA.SABADO_NAO_PREVISTO && picagens.length) excecoes.push({ tipo: 'SABADO_NAO_PREVISTO', descricao: 'Trabalho registado num sábado não previsto.' });
  if (tipoDia === ENUMS.TIPOS_DIA.DOMINGO && picagens.length) excecoes.push({ tipo: 'TRABALHO_DOMINGO', descricao: 'Trabalho registado ao domingo.' });
  if (tipoDia === ENUMS.TIPOS_DIA.FERIADO && picagens.length) excecoes.push({ tipo: 'TRABALHO_FERIADO', descricao: 'Trabalho registado em feriado.' });

  picagens.forEach(function(p) {
    const m = obterMinutosDoDia_(p.dataHora);
    const ehEntrada = p.tipo === ENUMS.TIPOS_PICAGEM.ENTRADA_MANHA || p.tipo === ENUMS.TIPOS_PICAGEM.ENTRADA_TARDE;
    const ehSaida = p.tipo === ENUMS.TIPOS_PICAGEM.SAIDA_MANHA || p.tipo === ENUMS.TIPOS_PICAGEM.SAIDA_TARDE;
    if ((tipoDia === ENUMS.TIPOS_DIA.UTIL || tipoDia === ENUMS.TIPOS_DIA.SABADO_PREVISTO) && ehEntrada && m < 600) {
      excecoes.push({ tipo: 'ENTRADA_ANTECIPADA', descricao: 'Entrada registada antes das 10:00.' });
    }
    if (tipoDia === ENUMS.TIPOS_DIA.UTIL && ehSaida && m > 1140) {
      excecoes.push({ tipo: 'SAIDA_TARDIA', descricao: 'Saída registada depois das 19:00.' });
    }
    if (tipoDia === ENUMS.TIPOS_DIA.SABADO_PREVISTO && ehSaida && m > 1140) {
      excecoes.push({ tipo: 'SAIDA_SABADO_TARDIA', descricao: 'Saída registada depois das 19:00 num sábado de escala.' });
    }
    if (m > 780 && m < 870) {
      excecoes.push({ tipo: 'TRABALHO_INTERVALO', descricao: 'Trabalho registado durante o intervalo 13:00–14:30.' });
    }
  });
  return excecoes;
}

function determinarEstadoDia_(tipoDia, picagens, intervalos, minutosPlaneados, minutosTrabalhados, minutosExtra) {
  if (intervalos.some(function(i) { return i.incompleto; })) return 'INCOMPLETO';
  if (!picagens.length) return minutosPlaneados > 0 ? 'SEM_PICAGENS' : 'SEM_HORARIO_NORMAL';
  if (minutosExtra > 0) return 'COM_EXTRA';
  if (minutosTrabalhados > 0) return 'TRABALHADO';
  return 'SEM_HORAS';
}

function calcularDia_(userId, data) {
  const d = normalizarData_(data);
  const tipoDia = determinarTipoDia_(userId, d);
  const horario = obterHorarioNormal_(tipoDia);
  const picagensReais = obterPicagensEfetivasDoDia_(userId, d);
  /* Fecha o que falta ANTES de validar e calcular: sem isto, uma saida em
     falta deixava o dia a valer zero horas. A validacao corre sobre as
     picagens EFETIVAS (com o fecho ja limpo), senao continuava a acusar
     uma "sequencia invalida" que ja nao existe. */
  const picagens = completarSaidasAutomaticamente_(picagensReais, horario);
  const saidasAssumidas = picagens.filter(function (p) { return p.saidaAssumida; });
  const validacao = validarPicagensEfetivas_(picagens);
  const intervalos = construirIntervalosTrabalho_(picagens);
  const calculo = calcularNormalEExtra_(intervalos, horario);
  const planeado = calcularMinutosPlaneados_(horario);
  const trabalhado = intervalos.filter(function(i) { return !i.incompleto && i.inicio && i.fim; }).reduce(function(t,i) { return t + minutosEntre_(i.inicio,i.fim); },0);
  const excecoes = determinarExcecoes_(userId, d, tipoDia, picagens, intervalos, calculo.segmentosExtra);
  const extraAprovado = obterMinutosExtraAprovados_(userId, d);
  return {
    userId: userId, data: formatarDataISO_(d), tipoDia: tipoDia, horarioNormal: horario,
    minutosPlaneados: planeado, minutosTrabalhados: trabalhado, minutosNormais: calculo.minutosNormais,
    minutosExtra: calculo.minutosExtra, horasPlaneadas: minutosParaHora_(planeado), horasTrabalhadas: minutosParaHora_(trabalhado),
    horasNormais: minutosParaHora_(calculo.minutosNormais), horasExtra: minutosParaHora_(calculo.minutosExtra),
    picagens: picagens, intervalosTrabalho: intervalos, segmentosExtra: calculo.segmentosExtra,
    /* quantos fechos foram assumidos: o gestor ve que ha uma hora que
       ninguem picou, e nao uma hora que o relogio regista */
    saidasAssumidas: saidasAssumidas.length,
    /* o pedido de correcao que o utilizador ja deixou sobre este dia */
    mencaoCorrecao: obterMencaoCorrecao_(userId, d),
    excecoes: excecoes, estado: determinarEstadoDia_(tipoDia,picagens,intervalos,planeado,trabalhado,calculo.minutosExtra),
    validacaoPicagens: validacao, feriado: obterFeriadoPorData_(d), ausencia: obterAusenciaPorData_(userId,d),
    sabado: obterInformacaoSabado_(userId,d), extraAprovado: extraAprovado,
    horasExtraAprovadas: minutosParaHora_(extraAprovado)
  };
}

function calcularMeuDia(token, data) { const s = exigirSessao_(token); return serializarParaFrontend_(calcularDia_(s.userId, data || new Date())); }
function calcularDiaAdmin(token, userId, data) { exigirAdmin_(token); return serializarParaFrontend_(calcularDia_(userId, data || new Date())); }

