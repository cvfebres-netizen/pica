/* Servidor BD vetmanag — HTTP + API (2/2). Uso: node _servidor.js [porta] */
const http = require('http');
const fs = require('fs');
const path = require('path');
const S = require('./_srv_bd.js');
const BUSCA = require('./_srv_busca.js');
const HIST = require('./_srv_hist.js');
const F1 = require('./_srv_fichas.js');
const F2 = require('./_srv_fichas2.js');
const PORTA = Number(process.argv[2]) || 4100;
const PAG = fs.readFileSync(path.join(__dirname, 'pag3.html'));
const APPJS = Buffer.concat([
  fs.readFileSync(path.join(__dirname, 'app3.js')),
  fs.readFileSync(path.join(__dirname, 'app3b.js'))
]);
function js(res, o, cod) {
  res.writeHead(cod || 200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(o));
}
function normalizar(s) {
  return String(s == null ? '' : s).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function filtrar(linhas, campo, q, limite) {
  const nq = normalizar(q);
  const out = [];
  for (let i = 0; i < linhas.length && out.length < limite; i++) {
    if (normalizar(linhas[i][campo]).indexOf(nq) !== -1) out.push(linhas[i]);
  }
  return out;
}
S.iniciar();
http.createServer(function (req, res) {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  if (p === '/' || p === '/pag.html' || p === '/pag2.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(PAG);
  }
  if (p === '/app.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    return res.end(APPJS);
  }
  if (p === '/api/estado') return js(res, S.estado());
  const BD = S.bd();
  if (!BD) return js(res, { ok: false, erro: 'BD ainda a carregar; recarrega.' }, 503);
  const T = BD.tabelas;
  if (p === '/api/tabelas') return js(res, { tabelas: BD.ordem.map(function (n) {
    return { nome: n, linhas: T[n].linhas.length, colunas: T[n].colunas.length };
  }) });
  let m = p.match(/^\/api\/tabela\/([A-Za-z0-9_]+)$/);
  if (m) {
    const t = T[m[1]];
    if (!t) return js(res, { ok: false, erro: 'tabela desconhecida' }, 404);
    const lim = Math.min(200, Math.max(1, Number(u.searchParams.get('limite')) || 20));
    const off = Math.max(0, Number(u.searchParams.get('inicio')) || 0);
    return js(res, { tabela: m[1], total: t.linhas.length, colunas: t.colunas,
      linhas: t.linhas.slice(off, off + lim) });
  }
  if (p === '/api/pesquisar') {
    const tipo = u.searchParams.get('tipo') || 'tutor';
    const q = (u.searchParams.get('q') || '').trim();
    if (q.length < 2) return js(res, { ok: false, erro: 'escreve 2+ letras' }, 400);
    if (tipo === 'tutor' && T.clients)
      return js(res, { resultados: filtrar(T.clients.linhas, 'client_name', q, 20) });
    if (tipo === 'animal' && T.animals)
      return js(res, { resultados: filtrar(T.animals.linhas, 'animal_name', q, 20) });
    return js(res, { ok: false, erro: 'tipo invalido' }, 400);
  }
  if (p === '/api/busca') {
    const q = (u.searchParams.get('q') || '').trim();
    return js(res, BUSCA.buscar(BD, S.IDX, q, u.searchParams.get('por_tipo')));
  }
  if (p === '/api/historico') {
    return js(res, HIST.lista(BD, u.searchParams.get('grupo') || 'todos',
      u.searchParams.get('antes') || null, u.searchParams.get('limite') || 50));
  }
  if (p === '/api/historico/resumo') {
    return js(res, HIST.resumo(BD, u.searchParams.get('meses') || 12));
  }
  m = p.match(/^\/api\/ficha\/(tutor|animal|visita|consulta)\/(\d+)$/);
  if (m) {
    const f = m[1] === 'tutor' ? F1.fichaTutor(BD, S.IDX, m[2])
      : m[1] === 'animal' ? F1.fichaAnimal(BD, S.IDX, m[2])
      : m[1] === 'visita' ? F2.fichaVisita(BD, S.IDX, m[2])
      : F2.fichaConsulta(BD, S.IDX, m[2]);
    return js(res, f, f.ok ? 200 : 404);
  }
  if (p === '/api/registo') {
    const tab = u.searchParams.get('tab'), rid = u.searchParams.get('id');
    const t = tab && T[tab];
    if (!t) return js(res, { ok: false, erro: 'tabela desconhecida' }, 404);
    const idC = (S.IDX.pkPorTab && S.IDX.pkPorTab[tab]) || t.colunas.filter(function (x) { return /_id$|^id$/.test(x); })[0];
    const r = t.linhas.filter(function (x) { return String(x[idC]) === String(rid); })[0];
    if (!r) return js(res, { ok: false, erro: 'registo nao existe' }, 404);
    // Ligacoes de saida pelas FKs reais do DDL.
    const fks = (S.IDX.fksPorTab && S.IDX.fksPorTab[tab]) || {};
    const links = [];
    Object.keys(fks).forEach(function (c) {
      if (r[c] == null || r[c] === '') return;
      const d = fks[c], dest = T[d.tab];
      if (!dest) return;
      const rotC = dest.colunas.filter(function (x) { return /name|description|treatment|motivo|reason|email/i.test(x); })[0];
      const alvo = dest.linhas.filter(function (x) { return String(x[d.col]) === String(r[c]); })[0];
      links.push({ coluna: c, tab: d.tab, id: r[c], rot: rotC && alvo ? String(alvo[rotC]).slice(0, 60) : '' });
    });
    return js(res, { ok: true, tab: tab, id: rid, colunas: t.colunas, registo: r, ligacoes: links });
  }
  m = p.match(/^\/api\/animal\/(\d+)$/);
  if (m) {
    const a = S.IDX.aniPorId[m[1]];
    if (!a) return js(res, { ok: false, erro: 'animal nao existe' }, 404);
    const tutor = S.IDX.cliPorId[a[S.IDX.colCliAni]] || null;
    const visitas = (S.IDX.visPorAnimal[m[1]] || []).slice(-20);
    return js(res, { animal: a, tutor: tutor, visitas: visitas });
  }
  js(res, { ok: false, erro: 'rota desconhecida' }, 404);
}).listen(PORTA, '127.0.0.1', function () {
  console.log('Servidor BD Febres: http://127.0.0.1:' + PORTA + '/');
});
