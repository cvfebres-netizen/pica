/* ============================================================
   PERSISTÊNCIA DIÁRIA / EXCEÇÕES / EXTRA
   ============================================================ */

function obterLinhaPorId_(sheetName, id) {
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const dados = sheet.getDataRange().getValues();
  const mapa = obterMapaColunas_(sheet);
  for (let i=1;i<dados.length;i++) if (String(dados[i][mapa.ID]) === String(id)) return {sheet:sheet,row:i+1,values:dados[i],mapa:mapa};
  return null;
}

function obterDiaTrabalhoExistente_(userId, data) {
  const f = dadosFolha_(SHEETS.DIAS_TRABALHO);
  if (!f.sheet || f.valores.length < 2) return null;
  const sheet = f.sheet, iso = formatarDataISO_(data), dados = f.valores, mapa = f.mapa;
  for (let i=1;i<dados.length;i++) if (String(dados[i][mapa.UserID])===String(userId) && valorDataISO_(dados[i][mapa.Data])===iso) return {sheet:sheet,row:i+1,values:dados[i],mapa:mapa};
  return null;
}

function construirLinhaDiaTrabalho_(r) {
  const user = obterUtilizadorPorId_(r.userId);
  return ['DIA_'+r.data+'_'+r.userId,r.data,r.userId,user?user.Nome:'',r.tipoDia,JSON.stringify(r.horarioNormal),r.minutosPlaneados,r.minutosTrabalhados,r.minutosNormais,r.minutosExtra,r.extraAprovado,r.horasPlaneadas,r.horasTrabalhadas,r.horasNormais,r.horasExtra,r.horasExtraAprovadas,r.estado,r.excecoes.map(function(e){return e.tipo;}).join(', '),new Date()];
}

function guardarDiaTrabalho_(r) {
  const sheet = getSpreadsheet_().getSheetByName(SHEETS.DIAS_TRABALHO);
  const linha = construirLinhaDiaTrabalho_(r), existente = obterDiaTrabalhoExistente_(r.userId,r.data);
  if (existente) sheet.getRange(existente.row,1,1,linha.length).setValues([linha]); else sheet.appendRow(linha);
  return true;
}

function gerarIdExcecao_() { return 'EXC_'+Utilities.getUuid().replace(/-/g,'').substring(0,16).toUpperCase(); }
function obterPrioridadeExcecao_(tipo) { return ['TRABALHO_DOMINGO','TRABALHO_FERIADO'].indexOf(tipo)>=0?'ALTA':(['PICAGEM_INCOMPLETA','SEQUENCIA_PICAGENS'].indexOf(tipo)>=0?'CRITICA':'NORMAL'); }

function criarExcecao_(resultado, tipo, descricao) {
  const sheet = getSpreadsheet_().getSheetByName(SHEETS.EXCECOES);
  /* Só conta como "já existe" uma exceção AINDA ABERTA. Uma já fechada
     (pelo gestor, ou automaticamente porque a condição deixou de se
     aplicar) não impede que a mesma condição volte a acontecer mais tarde
     no mesmo dia: nesse caso tem de nascer uma linha nova, senão o alerta
     desaparecia para sempre e o gestor nunca mais via o que importa. */
  const aberta = obterExcecoesDoDia_(resultado.data, resultado.userId)
    .find(function (e) { return e.tipo === tipo && e.estado === 'PENDENTE'; });
  if (aberta) return aberta.id;
  const user = obterUtilizadorPorId_(resultado.userId), agora = new Date(), id = gerarIdExcecao_();
  sheet.appendRow([id,resultado.data,resultado.userId,user?user.Nome:'',tipo,descricao,obterPrioridadeExcecao_(tipo),'PENDENTE',agora,'','', '']);
  return id;
}

/* Fecha as exceções ABERTAS deste dia cuja condição deixou de se aplicar.

   Porquê isto existir: a picagem da manhã deixa o dia "incompleto" e abre
   uma exceção. À tarde, com o turno completo, essa condição já não é
   verdade — mas a linha ficava PENDENTE na mesma, e o gestor via um falso
   alerta todos os dias, para sempre. Sem isto, a lista de exceções só
   pode crescer e perde utilidade.

   Duas garantias:
     - só toca em PENDENTE: uma decisão do gestor nunca é desfeita por aqui;
     - uma exceção de um dia NÃO é afetada pelo recálculo de outro dia.

   Escreve uma linha de cada vez, e só quando há mesmo alguma: o caminho
   normal (todas as exceções continuam a valer) não paga ida ao servidor. */
function fecharExcecoesObsoletas_(resultado, tiposActuais) {
  const f = dadosFolha_(SHEETS.EXCECOES);
  if (!f.sheet || f.valores.length < 2) return 0;
  const dados = f.valores, mapa = f.mapa, iso = valorDataISO_(resultado.data), agora = new Date();
  let fechadas = 0;
  for (let i = 1; i < dados.length; i++) {
    if (valorDataISO_(dados[i][mapa.Data]) !== iso) continue;
    if (String(dados[i][mapa.UserID] || '') !== String(resultado.userId)) continue;
    if (String(dados[i][mapa.Estado] || '') !== 'PENDENTE') continue;
    if (tiposActuais.indexOf(String(dados[i][mapa.Tipo] || '')) >= 0) continue;
    const linha = i + 1;
    f.sheet.getRange(linha, mapa.Estado + 1).setValue('RESOLVIDA');
    f.sheet.getRange(linha, mapa.ResolvidoEm + 1).setValue(agora);
    f.sheet.getRange(linha, mapa.ResolvidoPor + 1).setValue('SISTEMA');
    f.sheet.getRange(linha, mapa.Observacoes + 1).setValue(
      'Fechada automaticamente: a condição deixou de se aplicar quando o dia foi recalculado.');
    fechadas++;
  }
  return fechadas;
}

function guardarExcecoesDoDia_(resultado) {
  const tipos = resultado.excecoes.map(function (e) { return e.tipo; });
  resultado.excecoes.forEach(function (e) { criarExcecao_(resultado, e.tipo, e.descricao); });
  return fecharExcecoesObsoletas_(resultado, tipos);
}

function gerarIdHoraExtra_() { return 'HEX_'+Utilities.getUuid().replace(/-/g,'').substring(0,16).toUpperCase(); }

function obterHoraExtraExistente_(userId,data,inicio,fim) {
  const sheet=getSpreadsheet_().getSheetByName(SHEETS.HORAS_EXTRA); if(!sheet||sheet.getLastRow()<2)return null;
  const iso=formatarDataISO_(data),dados=sheet.getDataRange().getValues(),mapa=obterMapaColunas_(sheet);
  for(let i=1;i<dados.length;i++) if(String(dados[i][mapa.UserID])===String(userId)&&valorDataISO_(dados[i][mapa.Data])===iso&&String(dados[i][mapa.InicioExtra])===String(inicio)&&String(dados[i][mapa.FimExtra])===String(fim)) return {row:i+1,values:dados[i],mapa:mapa,sheet:sheet};
  return null;
}

function guardarHorasExtraCalculadas_(r) {
  const sheet=getSpreadsheet_().getSheetByName(SHEETS.HORAS_EXTRA), user=obterUtilizadorPorId_(r.userId);
  (r.segmentosExtra||[]).forEach(function(seg){
    const inicio=minutosParaHora_(seg.inicio), fim=minutosParaHora_(seg.fim), mins=seg.fim-seg.inicio;
    if(mins<=0||obterHoraExtraExistente_(r.userId,r.data,inicio,fim))return;
    const agora=new Date();
    sheet.appendRow([gerarIdHoraExtra_(),r.data,r.userId,user?user.Nome:'',r.tipoDia,inicio,fim,mins,minutosParaHora_(mins),'CALCULO_AUTOMATICO','PENDENTE','','','','',agora,agora]);
  });
}

function obterMinutosExtraAprovados_(userId,data) {
  const f=dadosFolha_(SHEETS.HORAS_EXTRA); if(!f.sheet||f.valores.length<2)return 0;
  const iso=formatarDataISO_(data),dados=f.valores,mapa=f.mapa;
  return dados.slice(1).reduce(function(total,l){ return String(l[mapa.UserID])===String(userId)&&valorDataISO_(l[mapa.Data])===iso&&String(l[mapa.Estado])==='APROVADO'?total+(Number(l[mapa.MinutosExtra])||0):total; },0);
}

/* Persiste o dia calculado: DIAS_TRABALHO (o retrato do dia), EXCECOES
   (o que o gestor tem de ver) e HORAS_EXTRA (os segmentos a aprovar).

   INVALIDACAO DE CACHE — o que faltava. As tres folhas estao em
   `FOLHAS_CACHEAVEIS_`, portanto uma leitura feita a seguir, ainda na MESMA
   execucao, devolveria o valor de ANTES da escrita: o painel conta as
   pendentes de EXCECOES e de HORAS_EXTRA, e veria os numeros antigos.
   Invalida-se antes E depois: antes, para que as leituras de
   deduplicacao (esta excecao ja existe? esta hora extra ja foi criada?)
   vejam a folha como ela esta; depois, para que quem venha a ler veja o
   que ficou escrito. */
function recalcularEGuardarDia_(userId,data) {
  const r=calcularDia_(userId,data);
  const escritas=[SHEETS.DIAS_TRABALHO,SHEETS.EXCECOES,SHEETS.HORAS_EXTRA];
  escritas.forEach(marcarFolhasAlteradas_);
  guardarDiaTrabalho_(r); guardarExcecoesDoDia_(r); guardarHorasExtraCalculadas_(r);
  escritas.forEach(marcarFolhasAlteradas_);
  return r;
}
function recalcularMeuDia(token,data){const s=exigirSessao_(token);return recalcularEGuardarDia_(s.userId,data||new Date());}
function recalcularDiaAdmin(token,userId,data){exigirAdmin_(token);return recalcularEGuardarDia_(userId,data||new Date());}

/* ============================================================
   HORAS EXTRA / JUSTIFICAÇÕES / CORREÇÕES
   ============================================================ */

function obterHoraExtraPorId_(id){return obterLinhaPorId_(SHEETS.HORAS_EXTRA,id);}
function atualizarEstadoHoraExtra_(token,id,novoEstado,observacoes){
  const s=exigirAdmin_(token),lock=adquirirLock_(15000);
  try{
    const info=obterHoraExtraPorId_(id);if(!info)throw new Error('Hora extra não encontrada.');
    const atual=String(info.values[info.mapa.Estado]||'');
    const permitidas={PENDENTE:['APROVADO','REJEITADO','CANCELADO'],APROVADO:['CANCELADO'],REJEITADO:['CANCELADO'],CANCELADO:[]};
    if(!permitidas[atual]||permitidas[atual].indexOf(novoEstado)<0)throw new Error('Transição de estado não permitida.');
    const agora=new Date();info.sheet.getRange(info.row,info.mapa.Estado+1).setValue(novoEstado);info.sheet.getRange(info.row,info.mapa.AprovadoPor+1).setValue(s.userId);info.sheet.getRange(info.row,info.mapa.DataAprovacao+1).setValue(agora);info.sheet.getRange(info.row,info.mapa.Observacoes+1).setValue(observacoes||'');info.sheet.getRange(info.row,info.mapa.AtualizadoEm+1).setValue(agora);
    registarAuditoriaSegura_(s,'ALTERAR_HORA_EXTRA',id+' '+atual+' -> '+novoEstado);return {sucesso:true,id:id,estado:novoEstado};
  }finally{lock.releaseLock();}
}
function aprovarHoraExtra(token,id,o){return atualizarEstadoHoraExtra_(token,id,'APROVADO',o);}
function rejeitarHoraExtra(token,id,o){return atualizarEstadoHoraExtra_(token,id,'REJEITADO',o);}
function cancelarHoraExtra(token,id,o){return atualizarEstadoHoraExtra_(token,id,'CANCELADO',o);}

function gerarIdJustificacao_(){return 'JUST_'+Utilities.getUuid().replace(/-/g,'').substring(0,16).toUpperCase();}
function criarJustificacao(token,dados){
  const s=exigirSessao_(token),d=dados||{};if(!d.data||!d.tipo||!d.descricao)throw new Error('Data, tipo e descrição são obrigatórios.');
  if(d.userId&&String(d.userId)!==String(s.userId)&&s.perfil!==ENUMS.PERFIS.ADMIN)throw new Error('Sem autorização.');
  const userId=s.perfil===ENUMS.PERFIS.ADMIN&&d.userId?d.userId:s.userId,user=obterUtilizadorPorId_(userId);
  const lock=adquirirLock_(15000);
  try{
    const sheet=getSpreadsheet_().getSheetByName(SHEETS.JUSTIFICACOES),agora=new Date(),id=gerarIdJustificacao_();
    sheet.appendRow([id,agora,formatarDataISO_(d.data),userId,user?user.Nome:'',d.tipo,d.descricao,d.excecaoId||'','PENDENTE',s.userId,'','',d.observacoes||'',agora]);
    registarAuditoriaSegura_(s,'CRIAR_JUSTIFICACAO','Justificação '+id);return {sucesso:true,id:id,estado:'PENDENTE'};
  }finally{lock.releaseLock();}
}
function obterJustificacaoPorId_(id){return obterLinhaPorId_(SHEETS.JUSTIFICACOES,id);}
function decidirJustificacao_(token,id,estado,obs){
  const s=exigirAdmin_(token),info=obterJustificacaoPorId_(id);if(!info)throw new Error('Justificação não encontrada.');
  if(String(info.values[info.mapa.Estado])!=='PENDENTE')throw new Error('Justificação já decidida.');
  /* A lock faltava. Esta funcao ESCREVE (a coluna Estado, e uma AUSENCIA
     quando a justificação é de falta) e nao a tomava: dois gestores a
     decidir ao mesmo tempo podiam ler o PENDENTE antes de o outro gravar e
     decidir a mesma linha duas vezes. A razao de o teste de lock nao a ter
     apanhado e' a mesma de `manutencaoDiaria`: a escrita acontece num
     auxiliar, e o teste so olha para o corpo da propria funcao. */
  const lock=adquirirLock_(15000);
  try{
  if(estado==='APROVADA'){
    const tipo=String(info.values[info.mapa.Tipo]||'').toUpperCase();
    const target=String(info.values[info.mapa.UserID]||'');
    const dataJust=normalizarData_(info.values[info.mapa.Data]);
    aplicarEfeitoJustificacaoAprovada_(s,target,dataJust,tipo,id,obs);
    /* Uma justificação aprovada pode ter criado uma AUSENCIA, e isso muda o
       estado do dia: o retrato, as horas extra e as pendentes sao refeitos
       agora, e nao à noite, para o gestor não ficar um turno inteiro sem ver
       o efeito da decisão que acabou de tomar. */
    recalcularEGuardarDia_(target,dataJust);
  }
  const agora=new Date();info.sheet.getRange(info.row,info.mapa.Estado+1).setValue(estado);info.sheet.getRange(info.row,info.mapa.AprovadoPor+1).setValue(s.userId);info.sheet.getRange(info.row,info.mapa.DataAprovacao+1).setValue(agora);info.sheet.getRange(info.row,info.mapa.Observacoes+1).setValue(obs||'');info.sheet.getRange(info.row,info.mapa.AtualizadoEm+1).setValue(agora);registarAuditoriaSegura_(s,'DECIDIR_JUSTIFICACAO',id+' -> '+estado);return {sucesso:true,id:id,estado:estado};
  }finally{lock.releaseLock();}
}
function aprovarJustificacao(token,id,o){return decidirJustificacao_(token,id,'APROVADA',o);}
function rejeitarJustificacao(token,id,o){return decidirJustificacao_(token,id,'REJEITADA',o);}

function aplicarEfeitoJustificacaoAprovada_(s,userId,data,tipoJust,justId,obs) {
  if (tipoJust === 'AUSENCIA' || tipoJust === 'FALTA') {
    const iso = formatarDataISO_(data);
    if (!obterAusenciaPorData_(userId, data)) {
      const agora = new Date();
      const sheet = getSpreadsheet_().getSheetByName(SHEETS.AUSENCIAS);
      const user = obterUtilizadorPorId_(userId);
      sheet.appendRow([gerarIdAusencia_(), iso, iso, userId, user ? user.Nome : '', 'JUSTIFICADA', 'ATIVA', 'Gerada pela justificação ' + justId + (obs ? ' — ' + obs : ''), s.userId, agora, agora]);
      registarAuditoriaSegura_(s, 'AUSENCIA_POR_JUSTIFICACAO', 'Ausência JUSTIFICADA ' + iso + ' (' + userId + ') via ' + justId);
    }
  }
}

function listarJustificacoes(token, filtros) {
  const s = exigirSessao_(token), f = filtros || {};
  const sheet = getSpreadsheet_().getSheetByName(SHEETS.JUSTIFICACOES);
  if (!sheet || sheet.getLastRow() < 2) return { sucesso: true, justificacoes: [], total: 0 };
  const dados = sheet.getDataRange().getValues(), mapa = obterMapaColunas_(sheet);
  let lista = dados.slice(1).filter(function(l) { return l[mapa.ID]; }).map(function(l) {
    return { id: String(l[mapa.ID]), data: valorDataISO_(l[mapa.Data]), userId: String(l[mapa.UserID] || ''), nome: String(l[mapa.Nome] || ''), tipo: String(l[mapa.Tipo] || ''), descricao: String(l[mapa.Descricao] || ''), excecaoId: String(l[mapa.ExcecaoID] || ''), estado: String(l[mapa.Estado] || ''), criadoPor: String(l[mapa.CriadoPor] || ''), observacoes: String(l[mapa.Observacoes] || '') };
  });
  if (s.perfil !== ENUMS.PERFIS.ADMIN) {
    lista = lista.filter(function(j) { return String(j.userId) === String(s.userId); });
  } else if (f.userId) {
    lista = lista.filter(function(j) { return String(j.userId) === String(f.userId); });
  }
  if (f.tipo) lista = lista.filter(function(j) { return String(j.tipo).toUpperCase() === String(f.tipo).toUpperCase(); });
  if (f.estado) lista = lista.filter(function(j) { return j.estado === String(f.estado); });
  if (f.data) lista = lista.filter(function(j) { return j.data === valorDataISO_(f.data); });
  lista.sort(function(a, b) { return a.data < b.data ? 1 : -1; });
  return serializarParaFrontend_({ sucesso: true, justificacoes: lista, total: lista.length });
}



function gerarIdCorrecao_(){return 'COR_'+Utilities.getUuid().replace(/-/g,'').substring(0,16).toUpperCase();}
function criarCorrecaoPicagem(token,dados){
  const s=exigirAdmin_(token),d=dados||{};if(!d.userId||!d.data||!d.tipoCorrecao||!d.motivo)throw new Error('UserID, data, tipo e motivo são obrigatórios.');
  const user=obterUtilizadorPorId_(d.userId);if(!user)throw new Error('Utilizador não encontrado.');
  const permitidos=['ALTERAR_HORA','ALTERAR_TIPO','ALTERAR_HORA_E_TIPO','ADICIONAR_PICAGEM','REMOVER_PICAGEM'];if(permitidos.indexOf(d.tipoCorrecao)<0)throw new Error('Tipo de correção inválido.');
  const lock=adquirirLock_(15000);
  try{
    const sheet=getSpreadsheet_().getSheetByName(SHEETS.CORRECOES),agora=new Date(),id=gerarIdCorrecao_();
    sheet.appendRow([id,agora,formatarDataISO_(d.data),d.userId,user.Nome,d.picagemId||'',d.tipoCorrecao,d.valorOriginal||'',d.valorNovo||'',d.tipoOriginal||'',d.tipoNovo||'',d.motivo,'PENDENTE',s.userId,'','',d.observacoes||'',agora]);
    registarAuditoriaSegura_(s,'CRIAR_CORRECAO','Correção '+id);return {sucesso:true,id:id,estado:'PENDENTE'};
  }finally{lock.releaseLock();}
}

function obterCorrecaoPorId_(id){return obterLinhaPorId_(SHEETS.CORRECOES,id);}

/* ============================================================
   PEDIDO DE CORREÇÃO FEITO PELO PRÓPRIO UTILIZADOR
   ============================================================
   Até agora só o gestor criava correções. O colaborador que olha para o
   relatório e pensa "isto está errado, saí às 19h e o sistema diz 18h" não
   tinha forma nenhuma de o dizer — ficava a falar com o gestor de corredor.

   Aqui o utilizador deixa uma MENÇÃO do problema, com o dia e o motivo. Fica
   PENDENTE até o gestor decidir. Não muda hora nenhuma sozinho: um pedido
   não é uma correção, é um pedido de correção. Quem altera o registo continua
   a ser o gestor, através de criarCorrecaoPicagem.

   Um utilizador normal só pode pedir sobre o SEU dia — o userId vem sempre da
   sessão, nunca do que vem no pedido, para ninguém pedir a correção de outro. */
function pedirCorrecaoDia(token, dados) {
  const s = exigirSessao_(token);
  const d = dados || {};
  if (!d.data) throw new Error('Indique o dia.');
  const data = normalizarData_(d.data);
  const alvo = (s.perfil === ENUMS.PERFIS.ADMIN && d.userId) ? String(d.userId) : String(s.userId);
  const motivo = String(d.motivo || '').trim();
  if (!motivo) throw new Error('Escreva o motivo da correção.');
  if (motivo.length < 5) throw new Error('O motivo é demasiado curto — explique o que está errado.');
  if (motivo.length > 300) throw new Error('O motivo é demasiado longo (máximo 300 caracteres).');
  const user = obterUtilizadorPorId_(alvo);
  if (!user) throw new Error('Utilizador não encontrado.');

  const lock = adquirirLock_(15000);
  try {
    /* A folha fica em cache durante a execução. Sem esta limpeza, a leitura
       de "já existe" abaixo via o CACHE — que ainda não sabe da linha que
       acabou de ser escrita noutro pedido — e o utilizador conseguia criar
       quantos pedidos duplicados quisesse. */
    limparCacheFolhas_();
    const jaExiste = obterCorrecoesDoDia_(alvo, data).filter(function (c) {
      return c.tipoCorrecao === 'PEDIR_REVISAO' && c.estado === 'PEDIDO';
    }).length > 0;
    if (jaExiste) throw new Error('Já existe um pedido de correção por decidir neste dia.');

    const sheet = getSpreadsheet_().getSheetByName(SHEETS.CORRECOES);
    const agora = new Date(), id = gerarIdCorrecao_();
    sheet.appendRow([id, agora, formatarDataISO_(data), alvo, user.Nome, '', 'PEDIR_REVISAO', '', '', '', '', motivo, 'PEDIDO', s.userId, '', '', '', agora]);
    limparCacheFolhas_();
    registarAuditoriaSegura_(s, 'PEDIR_CORRECAO', 'Pedido ' + id + ' em ' + formatarDataISO_(data));
    return { sucesso: true, id: id, estado: 'PEDIDO', data: formatarDataISO_(data) };
  } finally { lock.releaseLock(); }
}
function decidirCorrecao_(token,id,estado){
  const s=exigirAdmin_(token),lock=adquirirLock_(15000);
  try{
    const info=obterCorrecaoPorId_(id);if(!info)throw new Error('Correção não encontrada.');
    /* PENDENTE = correção preparada pelo gestor. PEDIDO = menção feita pelo
       próprio utilizador, à espera de resposta. As duas estão por decidir. */
    const estadoAtual=String(info.values[info.mapa.Estado]);
    if(estadoAtual!=='PENDENTE'&&estadoAtual!=='PEDIDO')throw new Error('Correção já decidida.');
    if(estado==='APROVADA'&&estadoAtual!=='PEDIDO'){
      const userId=info.values[info.mapa.UserID],data=info.values[info.mapa.Data];
      /* validação específica antes de aprovar */
      const futuro=obterPicagensEfetivasDoDiaComCorrecaoProposta_(userId,data,id);const v=validarPicagensEfetivas_(futuro);
      if(!v.valido)throw new Error('Correção criaria uma sequência inválida: '+v.problemas.join(' '));
    }
    /* Um PEDIDO é uma menção, não uma alteração: aprová-lo NÃO muda picagem
       nenhuma, só fecha o pedido. Passá-lo pela validação de sequência
       rebentaria com "Picagem não encontrada", porque um pedido não tem
       PicagemID para alterar. O registo fica então igual — quem corrige as
       horas é o gestor, com criarCorrecaoPicagem. */
    const agora=new Date();info.sheet.getRange(info.row,info.mapa.Estado+1).setValue(estado);info.sheet.getRange(info.row,info.mapa.AplicadoPor+1).setValue(s.userId);info.sheet.getRange(info.row,info.mapa.DataAplicacao+1).setValue(agora);info.sheet.getRange(info.row,info.mapa.AtualizadoEm+1).setValue(agora);registarAuditoriaSegura_(s,'DECIDIR_CORRECAO',id+' -> '+estado);
    /* Uma correcao aprovada muda as picagens efectivas, logo muda as horas:
       o retrato do dia, as horas extra e as pendentes tem de ser refeitos.
       Uma MENCAO (PEDIDO -> APROVADA) nao muda picagem nenhuma — por isso
       nao persiste nada. */
    if(estado==='APROVADA'&&estadoAtual==='PENDENTE')recalcularEGuardarDia_(info.values[info.mapa.UserID],info.values[info.mapa.Data]);
    return {sucesso:true,id:id,estado:estado};
  }finally{lock.releaseLock();}
}

function obterPicagensEfetivasDoDiaComCorrecaoProposta_(userId,data,correcaoId){
  const sheet=getSpreadsheet_().getSheetByName(SHEETS.CORRECOES),iso=formatarDataISO_(data),dados=sheet.getDataRange().getValues(),mapa=obterMapaColunas_(sheet);
  const temp=[];
  for(let i=1;i<dados.length;i++){
    if(String(dados[i][mapa.ID])===String(correcaoId)){
      const linha=dados[i].slice();linha[mapa.Estado]='APROVADA';
      const c={id:String(linha[mapa.ID]),picagemId:String(linha[mapa.PicagemID]||''),tipoCorrecao:String(linha[mapa.TipoCorrecao]||''),valorOriginal:linha[mapa.ValorOriginal],valorNovo:linha[mapa.ValorNovo],tipoOriginal:String(linha[mapa.TipoOriginal]||''),tipoNovo:String(linha[mapa.TipoNovo]||''),estado:'APROVADA'};
      temp.push(c);
    }
  }
  const orig=obterPicagensDoDia_(userId,data).map(function(p){return Object.assign({},p);});
  temp.forEach(function(c){
    if(c.tipoCorrecao==='REMOVER_PICAGEM')return;
    if(c.tipoCorrecao==='ADICIONAR_PICAGEM'){const h=converterValorParaDataHora_(c.valorNovo,data);orig.push({id:'TEMP',dataHora:h,tipo:c.tipoNovo,userId:userId});return;}
    const idx=orig.findIndex(function(p){return String(p.id)===String(c.picagemId);});if(idx<0)throw new Error('Picagem não encontrada.');
    if(c.tipoCorrecao==='ALTERAR_HORA'||c.tipoCorrecao==='ALTERAR_HORA_E_TIPO')orig[idx].dataHora=converterValorParaDataHora_(c.valorNovo,data);
    if(c.tipoCorrecao==='ALTERAR_TIPO'||c.tipoCorrecao==='ALTERAR_HORA_E_TIPO')orig[idx].tipo=c.tipoNovo;
  });
  const rem=temp.filter(function(c){return c.tipoCorrecao==='REMOVER_PICAGEM';}).map(function(c){return c.picagemId;});
  return orig.filter(function(p){return rem.indexOf(String(p.id))<0;}).sort(function(a,b){return a.dataHora-b.dataHora;});
}
function aprovarCorrecao(token,id){return decidirCorrecao_(token,id,'APROVADA');}
function rejeitarCorrecao(token,id){return decidirCorrecao_(token,id,'REJEITADA');}

