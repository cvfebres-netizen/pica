/* ============================================================
   ROTAÇÃO DE SÁBADOS — LEITURA (ADMIN) — §22–27
   ============================================================ */

function listarGruposSabado(token) {
  exigirAdmin_(token);
  const grupos = obterGruposSabado_();
  const proximos = [];
  const d = normalizarData_(new Date());
  let adicionados = 0;
  while (adicionados < 4) {
    d.setDate(d.getDate() + 1);
    if (!isSabado_(d)) continue;
    adicionados++;
    proximos.push({ data: formatarDataISO_(d), rotacao: obterRotacaoSabadoParaData_(d) });
  }
  return serializarParaFrontend_({ sucesso: true, grupos: grupos, proximosSabados: proximos, validacao: validarConfiguracaoSabados_() });
}