/* ============================================================
   CONSULTAS AUTENTICADAS — HORAS EXTRA + CORREÇÕES
   ============================================================ */

/* ============================================================
   TESTES DE COBERTURA DO TODO (§99–108, §111, §98)
   ============================================================ */

function montarPicagensTeste_(lista) {
  const base = new Date(2026, 8, 18);
  return lista.map(function(p) { return { tipo: p[0], dataHora: criarDataHora_(base, p[1], p[2]) }; });
}

function testesCoberturaHorario_() {
  const casos = [
    { nome: 'TESTE NORMAL 7h30', tipoDia: 'UTIL', picagens: [['ENTRADA_MANHA', 10, 0], ['SAIDA_MANHA', 13, 0], ['ENTRADA_TARDE', 14, 30], ['SAIDA_TARDE', 19, 0]], normal: 450, extra: 0 },
    { nome: 'TESTE ANTECIPADO 09:00', tipoDia: 'UTIL', picagens: [['ENTRADA_MANHA', 9, 0], ['SAIDA_MANHA', 13, 0], ['ENTRADA_TARDE', 14, 30], ['SAIDA_TARDE', 19, 0]], normal: 450, extra: 60 },
    { nome: 'TESTE TARDIO 20:00', tipoDia: 'UTIL', picagens: [['ENTRADA_MANHA', 10, 0], ['SAIDA_MANHA', 13, 0], ['ENTRADA_TARDE', 14, 30], ['SAIDA_TARDE', 20, 0]], normal: 450, extra: 60 },
    { nome: 'TESTE INTERVALO 13:30/14:00', tipoDia: 'UTIL', picagens: [['ENTRADA_MANHA', 10, 0], ['SAIDA_MANHA', 13, 30], ['ENTRADA_TARDE', 14, 0], ['SAIDA_TARDE', 19, 0]], normal: 450, extra: 60 },
    { nome: 'TESTE DOMINGO 10–13', tipoDia: 'DOMINGO', picagens: [['ENTRADA_MANHA', 10, 0], ['SAIDA_MANHA', 13, 0]], normal: 0, extra: 180 },
    { nome: 'TESTE SABADO PREVISTO 10–13', tipoDia: 'SABADO_PREVISTO', picagens: [['ENTRADA_MANHA', 10, 0], ['SAIDA_MANHA', 13, 0]], normal: 180, extra: 0 },
    { nome: 'TESTE SABADO NAO PREVISTO 10–13', tipoDia: 'SABADO_NAO_PREVISTO', picagens: [['ENTRADA_MANHA', 10, 0], ['SAIDA_MANHA', 13, 0]], normal: 0, extra: 180 },
    { nome: 'TESTE SABADO PREVISTO COM INTERVALO 13:00-13:30', tipoDia: 'SABADO_PREVISTO', picagens: [['ENTRADA_MANHA', 10, 0], ['SAIDA_MANHA', 13, 0], ['ENTRADA_TARDE', 13, 30], ['SAIDA_TARDE', 14, 0]], normal: 180, extra: 30 },
    { nome: 'TESTE SABADO PREVISTO EXTRA CONTINUO 10-14', tipoDia: 'SABADO_PREVISTO', picagens: [['ENTRADA_MANHA', 10, 0], ['SAIDA_MANHA', 14, 0]], normal: 180, extra: 60 },
    /* Sábado de escala é um dia NORMAL completo: o turno da tarde NÃO são
       horas extra. Regressão: o horário de sábado tinha só a manhã e as
       4h30 da tarde apareciam como extra. */
    { nome: 'TESTE SABADO PREVISTO TURNO COMPLETO 10-19', tipoDia: 'SABADO_PREVISTO', picagens: [['ENTRADA_MANHA', 10, 0], ['SAIDA_MANHA', 13, 0], ['ENTRADA_TARDE', 14, 30], ['SAIDA_TARDE', 19, 0]], normal: 450, extra: 0 },
    { nome: 'TESTE SABADO PREVISTO ATÉ ÀS 20:00', tipoDia: 'SABADO_PREVISTO', picagens: [['ENTRADA_MANHA', 10, 0], ['SAIDA_MANHA', 13, 0], ['ENTRADA_TARDE', 14, 30], ['SAIDA_TARDE', 20, 0]], normal: 450, extra: 60 }
  ];
  return casos.map(function(caso) {
    const calculo = calcularNormalEExtra_(construirIntervalosTrabalho_(montarPicagensTeste_(caso.picagens)), obterHorarioNormal_(caso.tipoDia));
    const ok = calculo.minutosNormais === caso.normal && calculo.minutosExtra === caso.extra;
    return { teste: caso.nome, resultado: ok ? 'OK' : 'FALHOU', esperado: 'normal ' + caso.normal + ' / extra ' + caso.extra, obtido: 'normal ' + calculo.minutosNormais + ' / extra ' + calculo.minutosExtra };
  });
}

function testesRotacaoCobertura_() {
  const resultados = [];
  const grupo = (obterGruposSabado_() || [])[0];
  if (!grupo || !grupo.ordem.length || !grupo.dataInicio) return [{ teste: 'rotacao', resultado: 'IGNORADO', motivo: 'CONFIG_SABADOS sem dataInicio' }];
  for (let i = 0; i < grupo.ordem.length * 2 + 1; i++) {
    const data = new Date(normalizarData_(grupo.dataInicio).getTime()); data.setDate(data.getDate() + i * 7);
    if (!isSabado_(data)) continue;
    resultados.push({ teste: 'rotacao semana ' + i, resultado: 'OK', esperado: grupo.ordem[i % grupo.ordem.length], obtido: calcularMembroRotacaoSabado_(grupo.grupoId, data) });
  }
  return resultados;
}

function executarTodosTestesCobertura(token) {
  exigirAdmin_(token);
  const testes = testesMotorCompleto_().concat(testesCoberturaHorario_()).concat(testesRotacaoCobertura_());
  return { sucesso: testes.every(function(t) { return t.resultado !== 'FALHOU'; }), total: testes.length, testes: testes };
}

function registarTestesCobertura(token) {
  exigirAdmin_(token);
  const r = executarTodosTestesCobertura(token);
  const lock = adquirirLock_(15000);
  try {
    const sheet = getOrCreateSheet_(SHEETS.TESTES);
    const agora = new Date();
    r.testes.forEach(function(t) {
      sheet.appendRow(['TST_' + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase(), agora, String(t.teste), String(t.resultado), String(t.esperado || ''), String(t.obtido || '')]);
    });
    return { sucesso: r.sucesso, registados: r.testes.length };
  } finally { lock.releaseLock(); }
}

/* Wrapper de leitura em cache: uma folha é lida UMA vez por execução
   (ver dadosFolha_). Estas funções de listagem são abertas pelo utilizador
   em cada clique num separador e, quando o separador é carregado mais do
   que uma vez, reliam a folha inteira do zero. */
function obterLinhasParaLeitura_(nomeFolha) {
  const f = dadosFolha_(nomeFolha);
  return (f && f.sheet && f.valores.length > 1) ? f : null;
}

function listarHorasExtraInterno_(token, filtros) {
  const s = exigirSessao_(token), f = filtros || {};
  const folha = obterLinhasParaLeitura_(SHEETS.HORAS_EXTRA);
  if (!folha) return [];
  const dados = folha.valores, mapa = folha.mapa;
  let lista = dados.slice(1).filter(function(l) { return l[mapa.ID]; }).map(function(l) {
    return { id: String(l[mapa.ID]), data: valorDataISO_(l[mapa.Data]), userId: String(l[mapa.UserID] || ''), nome: String(l[mapa.Nome] || ''), tipoDia: String(l[mapa.TipoDia] || ''), inicio: String(l[mapa.InicioExtra] || ''), fim: String(l[mapa.FimExtra] || ''), minutos: Number(l[mapa.MinutosExtra]) || 0, horas: String(l[mapa.HorasExtra] || ''), origem: String(l[mapa.Origem] || ''), estado: String(l[mapa.Estado] || ''), justificacao: String(l[mapa.Justificacao] || ''), observacoes: String(l[mapa.Observacoes] || '') };
  });
  if (s.perfil !== ENUMS.PERFIS.ADMIN) {
    lista = lista.filter(function(x) { return String(x.userId) === String(s.userId); });
  } else if (f.userId) {
    lista = lista.filter(function(x) { return String(x.userId) === String(f.userId); });
  }
  if (f.estado) lista = lista.filter(function(x) { return x.estado === String(f.estado); });
  if (f.data) lista = lista.filter(function(x) { return x.data === valorDataISO_(f.data); });
  if (f.dataInicio) lista = lista.filter(function(x) { return x.data >= String(f.dataInicio); });
  if (f.dataFim) lista = lista.filter(function(x) { return x.data <= String(f.dataFim); });
  lista.sort(function(a, b) { return a.data < b.data ? 1 : -1; });
  return lista;
}

function listarHorasExtra(token, filtros) {
  exigirSessao_(token);
  const lista = listarHorasExtraInterno_(token, filtros || {});
  return serializarParaFrontend_({ sucesso: true, horasExtra: lista, total: lista.length });
}

function minhasHorasExtra(token, filtros) {
  exigirSessao_(token);
  const lista = listarHorasExtraInterno_(token, filtros || {});
  return serializarParaFrontend_({ sucesso: true, horasExtra: lista, total: lista.length });
}

function listarCorrecoes(token, filtros) {
  exigirAdmin_(token);
  const f = filtros || {};
  const folha = obterLinhasParaLeitura_(SHEETS.CORRECOES);
  if (!folha) return { sucesso: true, correcoes: [], total: 0 };
  const dados = folha.valores, mapa = folha.mapa;
  let lista = dados.slice(1).filter(function(l) { return l[mapa.ID]; }).map(function(l) {
    return { id: String(l[mapa.ID]), data: valorDataISO_(l[mapa.Data]), userId: String(l[mapa.UserID] || ''), nome: String(l[mapa.Nome] || ''), picagemId: String(l[mapa.PicagemID] || ''), tipoCorrecao: String(l[mapa.TipoCorrecao] || ''), valorNovo: String(l[mapa.ValorNovo] || ''), tipoNovo: String(l[mapa.TipoNovo] || ''), motivo: String(l[mapa.Motivo] || ''), estado: String(l[mapa.Estado] || '') };
  });
  if (f.userId) lista = lista.filter(function(x) { return String(x.userId) === String(f.userId); });
  if (f.estado) lista = lista.filter(function(x) { return x.estado === String(f.estado); });
  if (f.data) lista = lista.filter(function(x) { return x.data === valorDataISO_(f.data); });
  lista.sort(function(a, b) { return String(a.data) < String(b.data) ? 1 : -1; });
  return serializarParaFrontend_({ sucesso: true, correcoes: lista, total: lista.length });
}
/* ============================================================
   CONSULTAS AUTENTICADAS — EXCEÇÕES + PICAGENS
   ============================================================ */

function listarExcecoes(token, filtros) {
  exigirAdmin_(token);
  const f = filtros || {};
  const folha = obterLinhasParaLeitura_(SHEETS.EXCECOES);
  if (!folha) return { sucesso: true, excecoes: [], total: 0 };
  const dados = folha.valores, mapa = folha.mapa;
  let lista = dados.slice(1).filter(function(l) { return l[mapa.ID]; }).map(function(l) {
    return { id: String(l[mapa.ID]), data: valorDataISO_(l[mapa.Data]), userId: String(l[mapa.UserID] || ''), nome: String(l[mapa.Nome] || ''), tipo: String(l[mapa.Tipo] || ''), descricao: String(l[mapa.Descricao] || ''), prioridade: String(l[mapa.Prioridade] || ''), estado: String(l[mapa.Estado] || '') };
  });
  if (f.userId) lista = lista.filter(function(x) { return String(x.userId) === String(f.userId); });
  if (f.estado) lista = lista.filter(function(x) { return x.estado === String(f.estado); });
  if (f.tipo) lista = lista.filter(function(x) { return x.tipo === String(f.tipo); });
  if (f.data) lista = lista.filter(function(x) { return x.data === valorDataISO_(f.data); });
  if (f.dataInicio) lista = lista.filter(function(x) { return x.data >= String(f.dataInicio); });
  if (f.dataFim) lista = lista.filter(function(x) { return x.data <= String(f.dataFim); });
  lista.sort(function(a, b) { return String(a.data) < String(b.data) ? 1 : -1; });
  return serializarParaFrontend_({ sucesso: true, excecoes: lista, total: lista.length });
}

function listarPicagens(token, filtros) {
  const s = exigirSessao_(token), f = filtros || {};
  const alvo = (s.perfil === ENUMS.PERFIS.ADMIN && f.userId) ? String(f.userId) : String(s.userId);
  const inicio = f.dataInicio ? normalizarData_(f.dataInicio) : new Date(normalizarData_(new Date()).getTime() - 6 * 86400000);
  const fim = f.dataFim ? normalizarData_(f.dataFim) : normalizarData_(new Date());
  const isoInicio = formatarDataISO_(inicio), isoFim = formatarDataISO_(fim);
  /* Recorta pela data ANTES de ler. Filtrar em JavaScript depois de ler
     tudo não poupa nada: o custo já foi pago na leitura. */
  const folha = dadosFolhaIntervalo_(SHEETS.PICAGENS, 'Data', isoInicio, isoFim)
             || obterLinhasParaLeitura_(SHEETS.PICAGENS);
  if (!folha) return serializarParaFrontend_({ sucesso: true, picagens: [], total: 0 });
  const dados = folha.valores, mapa = folha.mapa, out = [];
  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][mapa.UserID]) !== alvo) continue;
    const iso = valorDataISO_(dados[i][mapa.Data]);
    if (iso < isoInicio || iso > isoFim) continue;
    out.push({ id: String(dados[i][mapa.ID]), data: iso, dataHora: dados[i][mapa.DataHora], tipo: String(dados[i][mapa.Tipo] || ''), origem: String(dados[i][mapa.Origem] || '') });
  }
  out.sort(function(a, b) { return new Date(a.dataHora) - new Date(b.dataHora); });
  return serializarParaFrontend_({ sucesso: true, picagens: out, total: out.length });
}


function consultarAuditoria(token, filtros) {
  exigirAdmin_(token);
  const f = filtros || {};
  const folha = dadosFolha_(SHEETS.AUDITORIA);
  if (!folha || !folha.sheet || folha.linhas.length === 0) {
    return serializarParaFrontend_({ sucesso: true, registos: [], total: 0 });
  }
  const mapa = folha.mapa;
  const accaoFiltro = f.acao ? String(f.acao) : null;
  const userFiltro = f.userId ? String(f.userId) : null;
  const limite = f.limite ? Math.min(Number(f.limite) || 200, 1000) : 200;

  /* Filtra sobre a linha crua e só depois converte em objecto: com uma
     auditoria grande, buscar 200 registos não deve pagar por 50 000
     objectos intermédios. */
  const registos = [];
  for (let i = folha.linhas.length - 1; i >= 0 && registos.length < limite; i--) {
    const l = folha.linhas[i];
    if (!l[mapa.ID]) continue;
    if (accaoFiltro && String(l[mapa.Acao] || '') !== accaoFiltro) continue;
    if (userFiltro && String(l[mapa.UserID] || '') !== userFiltro) continue;
    registos.push({
      id: String(l[mapa.ID]),
      dataHora: l[mapa.DataHora],
      acao: String(l[mapa.Acao] || ''),
      sessaoId: String(l[mapa.SessaoID] || ''),
      userId: String(l[mapa.UserID] || ''),
      descricao: String(l[mapa.Descricao] || '')
    });
  }
  return serializarParaFrontend_({ sucesso: true, registos: registos, total: registos.length });
}

/* Os erros que a aplicacao registava em LOG_ERROS eram ESCRITOS e nunca
   lidos: `registarErro_` guarda a excepcao e nao hava caminho de volta.
   O gestor via "algo correu mal" em silencio, e a folha so aparecia se
   alguem a abrisse a mao na Spreadsheet — o que nao acontece nunca.

   Este e' o leitor. Copia `consultarAuditoria` de proposito: mesma guarda
   de administrador, mesma folha pela cache, filtro sobre a linha crua e
   limite com tecto. A AUDITORIA responde a pergunta "o que fez a mal"; esta
   responde a "o que correu mal". */
function listarErros(token, filtros) {
  exigirAdmin_(token);
  const f = filtros || {};
  const folha = dadosFolha_(SHEETS.LOG_ERROS);
  if (!folha || !folha.sheet || folha.linhas.length === 0) {
    return serializarParaFrontend_({ sucesso: true, registos: [], total: 0 });
  }
  const mapa = folha.mapa;
  const funcaoFiltro = f.funcao ? String(f.funcao) : null;
  const limite = f.limite ? Math.min(Number(f.limite) || 200, 1000) : 200;

  const registos = [];
  for (let i = folha.linhas.length - 1; i >= 0 && registos.length < limite; i--) {
    const l = folha.linhas[i];
    if (!l[mapa.ID]) continue;
    if (funcaoFiltro && String(l[mapa.Funcao] || '') !== funcaoFiltro) continue;
    registos.push({
      id: String(l[mapa.ID]),
      dataHora: l[mapa.DataHora],
      funcao: String(l[mapa.Funcao] || ''),
      mensagem: String(l[mapa.Mensagem] || ''),
      userId: String(l[mapa.UserID] || ''),
      dados: String(l[mapa.Dados] || '')
    });
  }
  return serializarParaFrontend_({ sucesso: true, registos: registos, total: registos.length });
}
