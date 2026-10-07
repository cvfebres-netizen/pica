/* ============================================================
   COMPLEMENTOS DE INSTALAÇÃO (executar no editor do Apps Script)
   ============================================================ */

/**
 * Define/atualiza o email de login de um utilizador.
 * Necessário porque UTILIZADORES_INICIAIS não traz emails e
 * autenticarUtilizador() identifica o utilizador pelo email.
 * Só corre no editor (conta ADMIN) ou com sessão válida do próprio/admin.
 */
function definirEmailUtilizador(userId, novoEmail, autorizacao) {
  const executor = autorizarOperacaoSensivel_(userId, autorizacao);
  return aplicarEmailUtilizador_(userId, novoEmail, executor);
}

/* Escrita real — só é chamada depois de uma autorização válida.
   Existe separada para que definirCredenciaisUtilizador_ possa autorizar
   UMA vez e escrever email + password sem o segundo passo se reautorizar
   (ver nota em definirCredenciaisUtilizador). */
function aplicarEmailUtilizador_(userId, novoEmail, executor) {
  const email = String(novoEmail || '').trim().toLowerCase();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('Email inválido: ' + novoEmail);
  }

  const jaExiste = obterUtilizadorPorEmail_(email);
  if (jaExiste && String(jaExiste.ID) !== String(userId)) {
    throw new Error('Email já usado pelo utilizador ' + jaExiste.ID + ': ' + email);
  }

  const info = obterLinhaUtilizadorPorId_(userId);
  if (!info) throw new Error('Utilizador não encontrado: ' + userId);

  info.sheet.getRange(info.row, info.mapa.Email + 1).setValue(email);
  info.sheet.getRange(info.row, info.mapa.AtualizadoEm + 1).setValue(new Date());
  try { limparCacheFolhas_(); } catch (e) {}

  return { sucesso: true, userId: String(userId), email: email };
}

/**
 * Define email + password do utilizador de uma só vez.
 * Autoriza UMA vez: se o email fosse gravado primeiro e a password
 * reautorizasse depois, a folha já teria credenciais e a instalação de
 * arranque recusar-se a si própria. As escritas ficam em funções privadas
 * (aplicarEmailUtilizador_ / aplicarPasswordUtilizador_), que só correm
 * depois da autorização — não existe forma de as chamar sem passar por
 * ela, nem de contorná-la a partir do web app.
 */
function definirCredenciaisUtilizador(userId, email, password, autorizacao) {
  const executor = autorizarOperacaoSensivel_(userId, autorizacao);
  return aplicarCredenciaisUtilizador_(userId, email, password, executor);
}

/* Escrita de email + password para um executor JÁ autorizado. Privada:
   só é alcançável a partir de uma das duas funções acima. */
function aplicarCredenciaisUtilizador_(userId, email, password, executor) {
  const resultado = aplicarEmailUtilizador_(userId, email, executor);
  aplicarPasswordUtilizador_(userId, password, executor);
  resultado.passwordDefinida = true;
  return resultado;
}

/**
 * Instalação inicial completa:
 *  1) cria folhas, cabeçalhos, CONFIG, utilizadores e rotação de sábados;
 *  2) define email + password dos utilizadores indicados.
 *
 * A lista "credenciais" (userId, email, password, perfil) está agora em
 * Config.gs (CREDENCIAIS_INICIAIS) e é também usada para autorizar as
 * funções sensíveis. Altere os valores lá se quiser outros emails ou
 * passwords. As passwords ficam em texto simples na coluna Password da
 * folha UTILIZADORES (sem hash e sem salt).
 *
 * Por segurança, esta função só corre no editor com a conta Google de um
 * ADMIN (ou autenticado); um visitante do web app não a consegue executar.
 */
function instalarSistemaComCredenciais() {
  const credenciais = CREDENCIAIS_INICIAIS;

  /* A instalacao de arranque e' a UNICA situacao em que setupSistema()
     pode correr sem token de sessao: ainda nao existe nenhuma. Autoriza-se
     aqui uma unica vez e o resultado passa para o setup, para que o codigo
     nao tenha duas regras de autorizacao diferentes. */
  const executor = autorizarOperacaoSensivel_('INSTALACAO', { arranque: true });
  _EXECUTOR_INSTALACAO = executor;
  const diagnostico = setupSistema();

  if (!credenciais.length) {
    return {
      sucesso: true,
      setup: diagnostico,
      credenciaisAplicadas: 0,
      aviso: 'Preencha a lista "credenciais" em instalarSistemaComCredenciais() e volte a executar para permitir o login.'
    };
  }

  const aplicadas = credenciais.map(function(c) {
    /* Instalação de arranque: os valores de Config.gs são a verdade para
       estas contas e nunca as podem bloquear. */
    return aplicarCredenciaisUtilizador_(c[0], c[1], c[2], executor);
  });

  return {
    sucesso: true,
    setup: diagnostico,
    credenciaisAplicadas: aplicadas.length,
    credenciais: aplicadas
  };
}

/* ============================================================
   GESTÃO — UTILIZADORES (ADMIN)
   Todo §12, §140, §142, §201
   ============================================================ */

function gerarIdUtilizador_(nome) {
  const base = String(nome || 'UTILIZADOR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').substring(0, 24) || 'UTILIZADOR';
  return 'USR_' + base + '_' + Utilities.getUuid().replace(/-/g, '').substring(0, 4).toUpperCase();
}

function serializarUtilizadorResumo_(linha, mapa) {
  /* O gestor precisa de VER quem está bloqueado e até quando. Sem estes
     dois campos a lista parecia normal e a única forma de recuperar era
     repor a password — que não pode ser a solução de rotina. */
  const bloqueadoAte = linha[mapa.BloqueadoAte] || '';
  const tentativas = Number(linha[mapa.TentativasFalhadas]) || 0;
  return {
    id: String(linha[mapa.ID]), nome: String(linha[mapa.Nome] || ''),
    profissao: String(linha[mapa.Profissao] || ''), perfil: String(linha[mapa.Perfil] || ''),
    estado: String(linha[mapa.Estado] || ''), email: String(linha[mapa.Email] || ''),
    criadoEm: linha[mapa.CriadoEm] || '',
    ultimoLogin: (mapa.UltimoLogin !== undefined ? linha[mapa.UltimoLogin] : '') || '',
    tentativasFalhadas: tentativas,
    bloqueadoAte: bloqueadoAte,
    bloqueado: estaBloqueadoAte_(bloqueadoAte)
  };
}

function listarUtilizadores(token, opcoes) {
  exigirAdmin_(token);
  const o = opcoes || {};
  const sheet = getSpreadsheet_().getSheetByName(SHEETS.UTILIZADORES);
  if (!sheet || sheet.getLastRow() < 2) return { sucesso: true, utilizadores: [], total: 0 };
  const dados = sheet.getDataRange().getValues(), mapa = obterMapaColunas_(sheet);
  const lista = dados.slice(1).filter(function(l) { return l[mapa.ID]; }).map(function(l) { return serializarUtilizadorResumo_(l, mapa); });
  const filtrada = o.incluirInativos ? lista : lista.filter(function(u) { return u.estado === ENUMS.ESTADOS_UTILIZADOR.ATIVO; });
  return serializarParaFrontend_({ sucesso: true, utilizadores: filtrada, total: filtrada.length });
}

function criarUtilizador(token, dados) {
  const s = exigirAdmin_(token), d = dados || {};
  const nome = String(d.nome || '').trim();
  if (!nome) throw new Error('Nome é obrigatório.');
  if (d.perfil !== ENUMS.PERFIS.ADMIN && d.perfil !== ENUMS.PERFIS.COLABORADOR) throw new Error('Perfil inválido.');
  const email = String(d.email || '').trim().toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Email inválido.');
  const lock = adquirirLock_(15000);
  try {
    /* A unicidade do email era verificada ANTES da lock: dois gestores a
       criar contas com o mesmo email ao mesmo tempo passavam os dois na
       verificacao e ficavam dois utilizadores com o mesmo email. A
       verificacao tem de ser feita com a lock presa, sobre os dados ja
       lidos para a escrita — e' o que se faz a seguir. */
    const agora = new Date();
    const sheet = getSpreadsheet_().getSheetByName(SHEETS.UTILIZADORES);
    garantirColunasFolha_(sheet, HEADERS.UTILIZADORES);
    const mapa = obterMapaColunas_(sheet);
    const linhas = sheet.getLastRow() > 1 ? sheet.getDataRange().getValues() : [];
    const emailJaUsado = email && linhas.slice(1).some(function(l) { return String(l[mapa.Email] || '').trim().toLowerCase() === email; });
    if (emailJaUsado) throw new Error('Email já registado.');
    let id = String(d.id || gerarIdUtilizador_(nome)).trim() || gerarIdUtilizador_(nome);
    if (linhas.slice(1).some(function(l) { return String(l[mapa.ID] || '') === id; })) id = gerarIdUtilizador_(nome + '_' + Date.now());
    const linha = new Array(sheet.getLastColumn()).fill('');
    definirValorColuna_(linha, mapa, 'ID', id);
    definirValorColuna_(linha, mapa, 'Nome', nome);
    definirValorColuna_(linha, mapa, 'Profissao', String(d.profissao || ''));
    definirValorColuna_(linha, mapa, 'Perfil', d.perfil);
    definirValorColuna_(linha, mapa, 'Estado', ENUMS.ESTADOS_UTILIZADOR.ATIVO);
    definirValorColuna_(linha, mapa, 'Email', email);
    definirValorColuna_(linha, mapa, 'TentativasFalhadas', 0);
    definirValorColuna_(linha, mapa, 'CriadoEm', agora);
    definirValorColuna_(linha, mapa, 'AtualizadoEm', agora);
    sheet.appendRow(linha);
    let passwordGerada = '';
    if (d.password) {
      definirPasswordUtilizador(id, d.password, { token: token });
    } else {
      passwordGerada = gerarPasswordTemporaria_();
      definirPasswordUtilizador(id, passwordGerada, { token: token });
    }
    registarAuditoriaSegura_(s, 'CRIAR_UTILIZADOR', 'Utilizador ' + id + ' (' + nome + ')');
    return { sucesso: true, id: id, passwordGerada: passwordGerada };
  } finally { lock.releaseLock(); }
}
function editarUtilizador(token, userId, campos) {
  const s = exigirAdmin_(token), c = campos || {};
  if (c.perfil !== undefined && c.perfil !== ENUMS.PERFIS.ADMIN && c.perfil !== ENUMS.PERFIS.COLABORADOR) throw new Error('Perfil inválido.');
  const lock = adquirirLock_(15000);
  try {
    /* A linha era procurada ANTES da lock, e `info.row` e' um indice: se
       outro pedido acrescentasse linhas entretanto, a escrita cairia na
       pessoa errada. A procuracao passou para dentro da lock. */
    const info = obterLinhaUtilizadorPorId_(userId);
    if (!info) throw new Error('Utilizador não encontrado: ' + userId);
    const mapa = info.mapa, linha = info.row;
    if (c.nome !== undefined) info.sheet.getRange(linha, mapa.Nome + 1).setValue(String(c.nome).trim());
    if (c.profissao !== undefined) info.sheet.getRange(linha, mapa.Profissao + 1).setValue(String(c.profissao));
    if (c.perfil !== undefined) info.sheet.getRange(linha, mapa.Perfil + 1).setValue(c.perfil);
    if (c.email !== undefined) {
      const email = String(c.email || '').trim().toLowerCase();
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Email inválido.');
      const outro = email ? obterUtilizadorPorEmail_(email) : null;
      if (outro && String(outro.ID) !== String(userId)) throw new Error('Email já registado.');
      info.sheet.getRange(linha, mapa.Email + 1).setValue(email);
    }
    info.sheet.getRange(linha, mapa.AtualizadoEm + 1).setValue(new Date());
    if (c.password) definirPasswordUtilizador(userId, c.password, { token: token });
    registarAuditoriaSegura_(s, 'EDITAR_UTILIZADOR', 'Utilizador ' + userId);
    return { sucesso: true, id: String(userId) };
  } finally { lock.releaseLock(); }
}

function definirEstadoUtilizador(token, userId, estado) {
  const s = exigirAdmin_(token);
  if (estado !== ENUMS.ESTADOS_UTILIZADOR.ATIVO && estado !== ENUMS.ESTADOS_UTILIZADOR.INATIVO) throw new Error('Estado inválido.');
  const lock = adquirirLock_(15000);
  try {
    const info = obterLinhaUtilizadorPorId_(userId);
    if (!info) throw new Error('Utilizador não encontrado: ' + userId);
    if (String(s.userId) === String(userId) && estado === ENUMS.ESTADOS_UTILIZADOR.INATIVO) throw new Error('Não pode desativar a própria conta.');
    info.sheet.getRange(info.row, info.mapa.Estado + 1).setValue(estado);
    info.sheet.getRange(info.row, info.mapa.AtualizadoEm + 1).setValue(new Date());
    registarAuditoriaSegura_(s, 'ESTADO_UTILIZADOR', 'Utilizador ' + userId + ' -> ' + estado);
    return { sucesso: true, id: String(userId), estado: estado };
  } finally { lock.releaseLock(); }
}

function desativarUtilizador(token, userId) { return definirEstadoUtilizador(token, userId, ENUMS.ESTADOS_UTILIZADOR.INATIVO); }
function reativarUtilizador(token, userId) { return definirEstadoUtilizador(token, userId, ENUMS.ESTADOS_UTILIZADOR.ATIVO); }

/* Desbloquear SEM mudar a password.
   Era a lacuna real de recuperação: a única forma de libertar uma conta
   bloqueada era repor a password — ou seja, obrigar a pessoa a mudar
   uma credencial que foi definida de propósito e deve ser mantida.
   Isto dá ao gestor uma saída que não toca no password. */
function desbloquearUtilizador(token, userId) {
  const s = exigirAdmin_(token);
  /* Limpar o contador e o bloqueio e' um LER-MODIFICAR-ESCREVER sobre a mesma
     linha: dois desbloqueios (ou um desbloqueio e um login falhado em
     paralelo) podiam intercalar e deixar a conta com tentativas > 0 — ou
     seja, continuar bloqueada apesar do o gestor ter pedido o desbloqueio. */
  const lock = adquirirLock_(15000);
  try {
    const info = obterLinhaUtilizadorPorId_(userId);
    if (!info) throw new Error('Utilizador não encontrado: ' + userId);
    limparFalhasLogin_(info);
    info.sheet.getRange(info.row, info.mapa.AtualizadoEm + 1).setValue(new Date());
    registarAuditoriaSegura_(s, 'DESBLOQUEAR_UTILIZADOR', 'Conta desbloqueada: ' + userId);
    return { sucesso: true, id: String(userId) };
  } finally { lock.releaseLock(); }
}

function reporPasswordUtilizador(token, userId, novaPassword, exigirAlteracao) {
  const s = exigirAdmin_(token);
  const gerada = !novaPassword;
  const password = gerada ? gerarPasswordTemporaria_() : String(novaPassword);
  /* Tres escritas na MESMA linha de uma so vez (password, sinalizador de
     alteracao pendente e limpeza do bloqueio). Sem lock, um desbloqueio ou um
     login falhado a correr em paralelo podia escrever DEPOIS e reintroduzir
     o bloqueio que a reposicao acabou de levantar. */
  const lock = adquirirLock_(15000);
  try {
    definirPasswordUtilizador(userId, password, { token: token });
    const info = obterLinhaUtilizadorPorId_(userId);
    garantirColunasFolha_(info.sheet, ['PasswordAlteracaoPendente']);
    const mapa = obterMapaColunas_(info.sheet);
    info.sheet.getRange(info.row, mapa.PasswordAlteracaoPendente + 1).setValue(exigirAlteracao === true ? 'SIM' : '');
    registarAuditoriaSegura_(s, 'REPOR_PASSWORD', 'Password reposta para ' + userId);
    return {
      sucesso: true,
      id: String(userId),
      alteracaoPendente: exigirAlteracao === true,
      passwordGerada: gerada ? password : ''
    };
  } finally { lock.releaseLock(); }
}

function gerarPasswordTemporaria_() {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!?';
  let texto = '';
  for (let i = 0; i < 12; i++) texto += alfabeto.charAt(Math.floor(Math.random() * alfabeto.length));
  return texto;
}


function passwordAlteracaoPendente_(info) {
  const mapa = info.mapa;
  return mapa.PasswordAlteracaoPendente !== undefined && String(info.values[mapa.PasswordAlteracaoPendente] || '') === 'SIM';
}

function alterarMinhaPassword(token, passwordAtual, novaPassword) {
  const s = exigirSessao_(token);
  const info = obterLinhaUtilizadorPorId_(s.userId);
  if (!info) throw new Error('Utilizador não encontrado.');
  const pendente = passwordAlteracaoPendente_(info);
  const atual = String(info.values[info.mapa.Password] || '');
  if (!pendente && !compararPasswords_(atual, passwordAtual)) throw new Error('Password atual incorreta.');
  definirPasswordUtilizador(s.userId, novaPassword, { token: token });
  registarAuditoriaSegura_(s, 'ALTERAR_PASSWORD', 'Password alterada pelo próprio.');
  return { sucesso: true };
}

function registarUltimoLogin_(info) {
  try {
    garantirColunasFolha_(info.sheet, ['UltimoLogin']);
    const mapa = obterMapaColunas_(info.sheet);
    info.sheet.getRange(info.row, mapa.UltimoLogin + 1).setValue(new Date());
  } catch (e) {}
}
/* ============================================================
   GESTÃO — AUSÊNCIAS (ADMIN + COLABORADOR para as próprias)
   Todo §49, §123–125
   ============================================================ */

function gerarIdAusencia_() { return 'AUS_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16).toUpperCase(); }

function validarTipoAusencia_(tipo) {
  return ['FERIAS', 'JUSTIFICADA', 'NAO_JUSTIFICADA'].indexOf(String(tipo || '').toUpperCase()) >= 0;
}

function serializarAusencia_(linha, mapa) {
  return {
    id: String(linha[mapa.ID]), dataInicio: valorDataISO_(linha[mapa.DataInicio]),
    dataFim: valorDataISO_(linha[mapa.DataFim]), userId: String(linha[mapa.UserID]),
    nome: String(linha[mapa.Nome] || ''), tipo: String(linha[mapa.Tipo] || ''),
    estado: String(linha[mapa.Estado] || ''), motivo: String(linha[mapa.Motivo] || ''),
    criadoPor: String(linha[mapa.CriadoPor] || ''), criadoEm: linha[mapa.CriadoEm] || ''
  };
}

function criarAusencia(token, dados) {
  const s = exigirSessao_(token), d = dados || {};
  const alvo = (s.perfil === ENUMS.PERFIS.ADMIN && d.userId) ? String(d.userId) : String(s.userId);
  if (s.perfil !== ENUMS.PERFIS.ADMIN && String(d.userId || s.userId) !== String(s.userId)) throw new Error('Sem autorização.');
  const user = obterUtilizadorPorId_(alvo);
  if (!user) throw new Error('Utilizador não encontrado: ' + alvo);
  const tipo = String(d.tipo || '').toUpperCase();
  if (!validarTipoAusencia_(tipo)) throw new Error('Tipo inválido (FERIAS | JUSTIFICADA | NAO_JUSTIFICADA).');
  const inicio = normalizarData_(d.dataInicio), fim = normalizarData_(d.dataFim);
  if (fim < inicio) throw new Error('DataFim anterior a DataInicio.');
  const dias = Math.round((fim - inicio) / 86400000) + 1;
  if (dias > 45) throw new Error('Intervalo máximo de 45 dias por registo.');
  const lock = adquirirLock_(15000);
  try {
    const agora = new Date(), id = gerarIdAusencia_();
    const sheet = getSpreadsheet_().getSheetByName(SHEETS.AUSENCIAS);
    sheet.appendRow([id, formatarDataISO_(inicio), formatarDataISO_(fim), alvo, user.Nome, tipo, 'ATIVA', sanitizarTextoCelula_(d.motivo), s.userId, agora, agora]);
    registarAuditoriaSegura_(s, 'CRIAR_AUSENCIA', 'Ausência ' + id + ' (' + alvo + ', ' + tipo + ')');
    return { sucesso: true, id: id };
  } finally { lock.releaseLock(); }
}

function obterAusenciaPorId_(id) { return obterLinhaPorId_(SHEETS.AUSENCIAS, id); }

function listarAusencias(token, filtros) {
  const s = exigirSessao_(token), f = filtros || {};
  const sheet = getSpreadsheet_().getSheetByName(SHEETS.AUSENCIAS);
  if (!sheet || sheet.getLastRow() < 2) return { sucesso: true, ausencias: [], total: 0 };
  const dados = sheet.getDataRange().getValues(), mapa = obterMapaColunas_(sheet);
  let lista = dados.slice(1).filter(function(l) { return l[mapa.ID]; }).map(function(l) { return serializarAusencia_(l, mapa); });
  if (s.perfil !== ENUMS.PERFIS.ADMIN) {
    lista = lista.filter(function(a) { return String(a.userId) === String(s.userId); });
  } else if (f.userId) {
    lista = lista.filter(function(a) { return String(a.userId) === String(f.userId); });
  }
  if (f.tipo) lista = lista.filter(function(a) { return a.tipo === String(f.tipo).toUpperCase(); });
  if (f.estado) lista = lista.filter(function(a) { return a.estado === String(f.estado); });
  if (f.dataInicio) lista = lista.filter(function(a) { return a.dataFim >= String(f.dataInicio); });
  if (f.dataFim) lista = lista.filter(function(a) { return a.dataInicio <= String(f.dataFim); });
  lista.sort(function(a, b) { return a.dataInicio < b.dataInicio ? 1 : -1; });
  return serializarParaFrontend_({ sucesso: true, ausencias: lista, total: lista.length });
}

function minhasAusencias(token, filtros) {
  const s = exigirSessao_(token);
  const r = listarAusencias(token, filtros || {});
  return { sucesso: true, ausencias: r.ausencias.filter(function(a) { return String(a.userId) === String(s.userId); }), total: r.ausencias.length };
}

function editarAusencia(token, id, campos) {
  const s = exigirSessao_(token), c = campos || {};
  const info = obterAusenciaPorId_(id);
  if (!info) throw new Error('Ausência não encontrada: ' + id);
  /* Só o admin edita ausências de outros; o colaborador só as suas. */
  if (s.perfil !== ENUMS.PERFIS.ADMIN &&
    String(info.values[info.mapa.UserID]) !== String(s.userId)) throw new Error('Sem autorização.');
  const lock = adquirirLock_(15000);
  try {
    const agora = new Date();
    if (c.tipo !== undefined) {
      if (!validarTipoAusencia_(c.tipo)) throw new Error('Tipo inválido.');
      info.sheet.getRange(info.row, info.mapa.Tipo + 1).setValue(String(c.tipo).toUpperCase());
    }
    if (c.motivo !== undefined) info.sheet.getRange(info.row, info.mapa.Motivo + 1).setValue(sanitizarTextoCelula_(c.motivo));
    if (c.dataInicio !== undefined || c.dataFim !== undefined) {
      const inicio = c.dataInicio !== undefined ? normalizarData_(c.dataInicio) : normalizarData_(info.values[info.mapa.DataInicio]);
      const fim = c.dataFim !== undefined ? normalizarData_(c.dataFim) : normalizarData_(info.values[info.mapa.DataFim]);
      if (fim < inicio) throw new Error('DataFim anterior a DataInicio.');
      info.sheet.getRange(info.row, info.mapa.DataInicio + 1).setValue(formatarDataISO_(inicio));
      info.sheet.getRange(info.row, info.mapa.DataFim + 1).setValue(formatarDataISO_(fim));
    }
    info.sheet.getRange(info.row, info.mapa.AtualizadoEm + 1).setValue(agora);
    registarAuditoriaSegura_(s, 'EDITAR_AUSENCIA', 'Ausência ' + id);
    return { sucesso: true, id: String(id) };
  } finally { lock.releaseLock(); }
}

function cancelarAusencia(token, id) {
  const s = exigirAdmin_(token);
  const lock = adquirirLock_(15000);
  try {
    const info = obterAusenciaPorId_(id);
    if (!info) throw new Error('Ausência não encontrada: ' + id);
    info.sheet.getRange(info.row, info.mapa.Estado + 1).setValue('CANCELADA');
    info.sheet.getRange(info.row, info.mapa.AtualizadoEm + 1).setValue(new Date());
    registarAuditoriaSegura_(s, 'CANCELAR_AUSENCIA', 'Ausência ' + id);
    return { sucesso: true, id: String(id), estado: 'CANCELADA' };
  } finally { lock.releaseLock(); }
}
/* ============================================================
   GESTÃO — FERIADOS (ADMIN)
   Todo §69–70
   ============================================================ */

function gerarIdFeriado_() { return 'FER_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16).toUpperCase(); }

function criarFeriado(token, dados) {
  const s = exigirAdmin_(token), d = dados || {};
  const data = formatarDataISO_(normalizarData_(d.data));
  const descricao = String(d.descricao || '').trim();
  if (!descricao) throw new Error('Descrição é obrigatória.');
  if (obterFeriadoPorData_(data)) throw new Error('Já existe feriado nesta data: ' + data);
  const lock = adquirirLock_(15000);
  try {
    const agora = new Date(), id = gerarIdFeriado_();
    const sheet = getSpreadsheet_().getSheetByName(SHEETS.FERIADOS);
    sheet.appendRow([id, data, descricao, 'true', s.userId, agora, agora]);
    registarAuditoriaSegura_(s, 'CRIAR_FERIADO', 'Feriado ' + data + ' (' + descricao + ')');
    return { sucesso: true, id: id, data: data };
  } finally { lock.releaseLock(); }
}

function listarFeriados(token, opcoes) {
  exigirAdmin_(token);
  const o = opcoes || {};
  const sheet = getSpreadsheet_().getSheetByName(SHEETS.FERIADOS);
  if (!sheet || sheet.getLastRow() < 2) return { sucesso: true, feriados: [], total: 0 };
  const dados = sheet.getDataRange().getValues(), mapa = obterMapaColunas_(sheet);
  let lista = dados.slice(1).filter(function(l) { return l[mapa.ID]; }).map(function(l) {
    return { id: String(l[mapa.ID]), data: valorDataISO_(l[mapa.Data]), descricao: String(l[mapa.Descricao] || ''), ativo: String(l[mapa.Ativo]) !== 'false', criadoPor: String(l[mapa.CriadoPor] || ''), criadoEm: l[mapa.CriadoEm] || '' };
  });
  if (!o.incluirInativos) lista = lista.filter(function(f) { return f.ativo; });
  if (o.ano) lista = lista.filter(function(f) { return String(f.data).substring(0, 4) === String(o.ano); });
  lista.sort(function(a, b) { return a.data < b.data ? -1 : 1; });
  return serializarParaFrontend_({ sucesso: true, feriados: lista, total: lista.length });
}

function definirEstadoFeriado(token, id, ativo) {
  const s = exigirAdmin_(token);
  const lock = adquirirLock_(15000);
  try {
    const info = obterLinhaPorId_(SHEETS.FERIADOS, id);
    if (!info) throw new Error('Feriado não encontrado: ' + id);
    info.sheet.getRange(info.row, info.mapa.Ativo + 1).setValue(ativo ? 'true' : 'false');
    info.sheet.getRange(info.row, info.mapa.AtualizadoEm + 1).setValue(new Date());
    registarAuditoriaSegura_(s, 'ESTADO_FERIADO', 'Feriado ' + id + ' -> ' + (ativo ? 'ativo' : 'inativo'));
    return { sucesso: true, id: String(id), ativo: !!ativo };
  } finally { lock.releaseLock(); }
}
/* ============================================================
   GESTÃO — CONFIG (ADMIN)
   Todo §67–68, §73–77, §135–136
   ============================================================ */

function listarConfig(token) {
  exigirAdmin_(token);
  const sheet = getSpreadsheet_().getSheetByName(SHEETS.CONFIG);
  if (!sheet || sheet.getLastRow() < 2) return { sucesso: true, config: {} };
  const dados = sheet.getDataRange().getValues(), mapa = obterMapaColunas_(sheet);
  const config = {};
  dados.slice(1).forEach(function(l) { if (l[mapa.Chave]) config[String(l[mapa.Chave])] = String(l[mapa.Valor] === null || l[mapa.Valor] === undefined ? '' : l[mapa.Valor]); });
  return { sucesso: true, config: config, protegidas: ['VERSAO', 'APP_NOME', 'EMPRESA'] };
}

function definirConfig(token, chave, valor) {
  const s = exigirAdmin_(token);
  const chavesEditaveis = ['SESSAO_MINUTOS', 'MAX_TENTATIVAS_LOGIN', 'BLOQUEIO_MINUTOS', 'HORARIO_SEMANA', 'HORARIO_SABADO', 'HORARIO_DOMINGO', 'TOLERANCIA_MINUTOS', 'MAINTENANCE_MODE'];
  chave = String(chave || '').trim();
  if (chavesEditaveis.indexOf(chave) < 0) throw new Error('Chave não editável: ' + chave + '. Contacte o desenvolvimento para outras chaves.');
  const lock = adquirirLock_(15000);
  try {
    const sheet = getSpreadsheet_().getSheetByName(SHEETS.CONFIG);
    const mapa = obterMapaColunas_(sheet), dados = sheet.getDataRange().getValues();
    for (let i = 1; i < dados.length; i++) {
      if (String(dados[i][mapa.Chave] || '') === chave) {
        sheet.getRange(i + 1, mapa.Valor + 1).setValue(String(valor));
        sheet.getRange(i + 1, mapa.AtualizadoEm + 1).setValue(new Date());
        registarAuditoriaSegura_(s, 'DEFINIR_CONFIG', chave + ' = ' + valor);
        return { sucesso: true, chave: chave };
      }
    }
    throw new Error('Chave não encontrada: ' + chave);
  } finally { lock.releaseLock(); }
}

function obterConfigValor_(chave, defeito) {
  try {
    const sheet = getSpreadsheet_().getSheetByName(SHEETS.CONFIG);
    if (!sheet || sheet.getLastRow() < 2) return defeito;
    const dados = sheet.getDataRange().getValues(), mapa = obterMapaColunas_(sheet);
    for (let i = 1; i < dados.length; i++) {
      if (String(dados[i][mapa.Chave] || '') === String(chave)) return String(dados[i][mapa.Valor] === null || dados[i][mapa.Valor] === undefined ? '' : dados[i][mapa.Valor]);
    }
  } catch (e) {}
  return defeito;
}

function sistemaEmManutencao_() {
  return String(obterConfigValor_('MAINTENANCE_MODE', 'false')).toLowerCase() === 'true';
}

function exigirOperacional_(token) {
  const s = exigirSessao_(token);
  if (s.perfil !== ENUMS.PERFIS.ADMIN && sistemaEmManutencao_()) throw new Error('Sistema em manutenção. Tente mais tarde.');
  return s;
}

/* ============================================================
   ROTAÇÃO DE SÁBADOS — CRIAÇÃO/EDIÇÃO (ADMIN) — §22–27
   ============================================================ */

function criarGrupoSabado(token, dados) {
  const s = exigirAdmin_(token), d = dados || {};
  const grupoId = String(d.grupoId || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  if (grupoId.length < 3) throw new Error('GrupoID inválido (mínimo 3 caracteres).');
  const ordem = Array.isArray(d.ordem) ? d.ordem.map(function(u) { return String(u); }) : [];
  if (ordem.length < 2) throw new Error('A rotação precisa de pelo menos 2 utilizadores.');
  ordem.forEach(function(u) { if (!obterUtilizadorPorId_(u)) throw new Error('Utilizador inexistente na rotação: ' + u); });
  const dataInicio = ajustarDataInicioRotacao_(String(d.dataInicio || '').trim() || proximoSabadoIso_());
  const lock = adquirirLock_(15000);
  try {
    const sheet = getSpreadsheet_().getSheetByName(SHEETS.CONFIG_SABADOS);
    const mapa = obterMapaColunas_(sheet);
    const linhas = sheet.getLastRow() > 1 ? sheet.getDataRange().getValues() : [];
    const existe = linhas.slice(1).some(function(l) { return String(l[mapa.GrupoID] || '') === grupoId; });
    if (existe) throw new Error('Grupo já existe: ' + grupoId);
    sheet.appendRow([grupoId, String(d.descricao || grupoId), JSON.stringify(ordem), dataInicio, d.ativo === false ? 'false' : 'true', new Date()]);
    registarAuditoriaSegura_(s, 'CRIAR_GRUPO_SABADO', 'Grupo ' + grupoId + ' (início ' + dataInicio + ')');
    return { sucesso: true, grupoId: grupoId };
  } finally { lock.releaseLock(); }
}

function editarGrupoSabado(token, grupoId, campos) {
  const s = exigirAdmin_(token), c = campos || {};
  const lock = adquirirLock_(15000);
  try {
    const sheet = getSpreadsheet_().getSheetByName(SHEETS.CONFIG_SABADOS);
    if (!sheet || sheet.getLastRow() < 2) throw new Error('Sem grupos configurados.');
    /* A linha alvo era procurada ANTES da lock. `alvo` e' um indice de
       folha: se outro pedido acrescentasse um grupo entretanto, a escrita
       cairia no grupo errado. A procuracao passou para dentro da lock. */
    const dados = sheet.getDataRange().getValues(), mapa = obterMapaColunas_(sheet);
    let alvo = -1;
    for (let i = 1; i < dados.length; i++) {
      if (String(dados[i][mapa.GrupoID] || '') === String(grupoId)) { alvo = i + 1; break; }
    }
    if (alvo < 0) throw new Error('Grupo não encontrado: ' + grupoId);
    if (c.descricao !== undefined) sheet.getRange(alvo, mapa.Descricao + 1).setValue(String(c.descricao));
    if (c.ordem !== undefined) {
      if (!Array.isArray(c.ordem) || c.ordem.length < 2) throw new Error('Ordem inválida.');
      c.ordem.forEach(function(u) { if (!obterUtilizadorPorId_(u)) throw new Error('Utilizador inexistente na rotação: ' + u); });
      sheet.getRange(alvo, mapa.OrdemUserIDs + 1).setValue(JSON.stringify(c.ordem));
    }
    if (c.dataInicio !== undefined && String(c.dataInicio || '').trim()) {
      normalizarData_(String(c.dataInicio).trim());
      /* Gravado já ancorado no sábado: o que o gestor vê na folha é
         exactamente a âncora que a rotação usa no cálculo. */
      const novoInicio = ajustarDataInicioRotacao_(String(c.dataInicio).trim());
      sheet.getRange(alvo, mapa.DataInicio + 1).setValue(novoInicio);
    }
    /* Garante que a linha nunca fica sem dataInicio (vazio = manter o
       valor atual; se mesmo assim estiver vazia, preenche automático). */
    if (!String(sheet.getRange(alvo, mapa.DataInicio + 1).getValues()[0][0] || '').trim()) {
      sheet.getRange(alvo, mapa.DataInicio + 1).setValue(proximoSabadoIso_());
    }
    if (c.ativo !== undefined) sheet.getRange(alvo, mapa.Ativo + 1).setValue(c.ativo ? 'true' : 'false');
    sheet.getRange(alvo, mapa.AtualizadoEm + 1).setValue(new Date());
    registarAuditoriaSegura_(s, 'EDITAR_GRUPO_SABADO', 'Grupo ' + grupoId);
    return { sucesso: true, grupoId: String(grupoId) };
  } finally { lock.releaseLock(); }
}
/* ============================================================
   GESTÃO — SESSÕES (ADMIN)
   Todo §16, §149
   ============================================================ */

function listarSessoes(token, opcoes) {
  exigirAdmin_(token);
  const o = opcoes || {};
  const sheet = getSpreadsheet_().getSheetByName(SHEETS.SESSOES);
  if (!sheet || sheet.getLastRow() < 2) return { sucesso: true, sessoes: [], total: 0 };
  const dados = sheet.getDataRange().getValues(), mapa = obterMapaColunas_(sheet);
  let lista = dados.slice(1).filter(function(l) { return l[mapa.ID]; }).map(function(l) {
    return { id: String(l[mapa.ID]), userId: String(l[mapa.UserID] || ''), criadoEm: l[mapa.CriadoEm] || '', expiraEm: l[mapa.ExpiraEm] || '', estado: String(l[mapa.Estado] || ''), ultimaAtividade: l[mapa.UltimaAtividade] || '' };
  });
  if (o.userId) lista = lista.filter(function(x) { return String(x.userId) === String(o.userId); });
  if (!o.incluirTerminadas) lista = lista.filter(function(x) { return x.estado === ENUMS.ESTADOS_SESSAO.ATIVA; });
  lista.sort(function(a, b) { return String(a.criadoEm) < String(b.criadoEm) ? 1 : -1; });
  return serializarParaFrontend_({ sucesso: true, sessoes: lista, total: lista.length });
}

function terminarSessaoAdmin(token, sessaoId) {
  const s = exigirAdmin_(token);
  const lock = adquirirLock_(15000);
  try {
    const sheet = getSpreadsheet_().getSheetByName(SHEETS.SESSOES);
    if (!sheet || sheet.getLastRow() < 2) throw new Error('Sem sessões registadas.');
    const dados = sheet.getDataRange().getValues(), mapa = obterMapaColunas_(sheet);
    for (let i = 1; i < dados.length; i++) {
      if (String(dados[i][mapa.ID] || '') === String(sessaoId)) {
        if (String(dados[i][mapa.UserID]) === String(s.userId)) throw new Error('Não pode terminar a própria sessão por aqui.');
        sheet.getRange(i + 1, mapa.Estado + 1).setValue(ENUMS.ESTADOS_SESSAO.TERMINADA);
        registarAuditoriaSegura_(s, 'TERMINAR_SESSAO_ADMIN', 'Sessão ' + sessaoId + ' terminada pelo ADMIN.');
        return { sucesso: true, id: String(sessaoId) };
      }
    }
    throw new Error('Sessão não encontrada: ' + sessaoId);
  } finally { lock.releaseLock(); }
}

function limparSessoesExpiradas(token) {
  const s = exigirAdmin_(token);
  /* Le a folha INTEIRA e reescreve a coluna Estado. A lock e' obrigatoria
     aqui: um login a criar uma sessao ao mesmo tempo podia ser lido antes
     desta passagem e ficar de fora da limpeza — ou, pior, ser marcado
     como expirada sem nunca o ter sido. A reescrita e' UMA operacao
     (expirarSessoesEmLote_), por isso a lock fica presa por
     milissegundos e nao por minutos.
     O trigger diario (manutencaoDiaria) faz o mesmo trabalho e tambem
     toma a lock, pela mesma razao: as duas reescrevem a coluna e a outra
     apaga linhas. */
  const lock = adquirirLock_(15000);
  try {
    const sheet = getSpreadsheet_().getSheetByName(SHEETS.SESSOES);
    if (!sheet || sheet.getLastRow() < 2) return { sucesso: true, marcadas: 0 };
    const dados = sheet.getDataRange().getValues(), mapa = obterMapaColunas_(sheet);
    const marcadas = expirarSessoesEmLote_(sheet, mapa, dados);
    registarAuditoriaSegura_(s, 'LIMPAR_SESSOES', marcadas + ' sessões expiradas.');
    return { sucesso: true, marcadas: marcadas };
  } finally { lock.releaseLock(); }
}
