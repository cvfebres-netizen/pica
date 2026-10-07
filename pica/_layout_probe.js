/* Sonda de layout: renderiza o Index.html REAL num Chrome headless em varios
   tamanhos de ecra e mede o que rebenta (overflow horizontal, elementos fora
   do ecra, texto cortado, alvos de toque pequenos, zoom do iOS).

   Porque DevTools Protocol e nao --window-size: o Chrome headless limita a
   janela a ~500px de largura, por isso nunca mediria um iPhone de 375px. E um
   iframe NAO conta como ecra para o tipo de ponteiro. Com
   Emulation.setDeviceMetricsOverride + emulacao de toque, a medicao corre no
   viewport real do dispositivo, com pointer:coarse verdadeiro.

   Uso: node _layout_probe.js            (prova de ecras)
        node _layout_probe.js --manter   (deixa os ficheiros temporarios) */
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

const dir = __dirname;
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const src = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const MANTER = process.argv.indexOf('--manter') !== -1;
const SHOTS = process.argv.indexOf('--ecras') !== -1 ? path.join(dir, '_ecras') : null;


/* O Index.html chama google.script.run ao arrancar; sem este stub o Chrome
   rebenta num erro de script e a pagina nem chega a pintar. */
const STUB = `<script>
window.google={script:{run:function(){return{withSuccessHandler:function(){return this},
withFailureHandler:function(){return this},withUserObject:function(){return this}}}}};
</script>`;

/* Injeta a sonda no ficheiro real. Mede, para cada elemento visivel:
     wide    = sai do viewport pela direita/esquerda
     clipped = conteudo maior que a caixa, sem forma de o ver
     tiny    = alvo interativo com menos de 44px de altura
     fonts   = campo com fonte < 16px (iOS/Android fazem zoom ao focar) */
const PROBE = `<script>
function probeRun(){
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('login').classList.remove('hidden');
  document.getElementById('app').classList.remove('hidden');
  /* o painel tem de ficar visivel: e la que vivem as tabelas, os 23
     separadores e a barra de filtros — sem isto a sonda media so o
     cabecalho e dava um falso "tudo bem" */
  document.getElementById('panel').classList.remove('hidden');
  document.getElementById('headerUser').textContent =
    'Maria João Gonçalves de Albuquerque Santos — Assistente Veterinária';
  document.querySelectorAll('.tabs').forEach(function(t){
    ['Hoje','Extras','Justificações','Correções','Exceções','Utilizadores','Sessões',
     'Configuração','Sábados','Backups','Auditoria','Relatórios'].forEach(function(n){
      var b=document.createElement('button'); b.className='tab'; b.type='button'; b.textContent=n; t.appendChild(b);
    });
  });
  var view={headers:['Colaborador','Profissão','Tipo de dia','Estado','Previsto','Trabalhado','Normal','Extra','Extra aprov.'],
    rows:[{cells:['Maria João Gonçalves de Albuquerque Santos','Assistente Veterinária com texto bastante comprido para envolver','SABADO_ROTACAO','TRABALHADO','10:00–13:00','00:00–23:59','10:00–13:00','10:00–23:59','00:00–13:00'],
      actions:[{label:'Detalhe',action:'x.d',id:'1'},{label:'Editar',action:'x.e',id:'1'},{label:'Aprovar',action:'x.a',id:'1'},{label:'Rejeitar',action:'x.r',id:'1'}]},
      {cells:['Pedro Silva','Gestor','NORMAL','INTERVALO','09:00–18:00','09:00–12:00','—','—','—'],actions:[{label:'Detalhe',action:'x.d',id:'2'}]}]};
  var pt=document.getElementById('panelTable');
  if(pt){
    pt.innerHTML=buildPanelTable(view);
    /* a barra de filtros tambem e criada pelo JS em runtime */
    var barra=document.createElement('div');
    barra.className='filters';
    barra.innerHTML='<span class="fitem"><label>De</label><input type="date" value="2026-09-01"></span>'+
      '<span class="fitem"><label>Estado</label><select><option>PENDENTE</option></select></span>'+
      '<span class="fitem"><label>Texto</label><input type="search" placeholder="nome"></span>'+
      '<button class="mini" type="button">Aplicar</button>';
    pt.parentNode.insertBefore(barra,pt);
  }
  var pb=document.getElementById('punchList');
  if(pb) pb.innerHTML='<div class="punch-row"><span class="punch-type">Saída Manhã com uma descrição extraordinariamente comprida que tem de envolver</span><span class="punch-time">13:02</span></div>';
  var r={w:window.innerWidth,h:window.innerHeight,
    overflow:document.documentElement.scrollWidth-window.innerWidth,
    coarse:window.matchMedia('(pointer:coarse)').matches,
    wide:[],tiny:[],fonts:[],clipped:[]};
  var all=document.body.querySelectorAll('*');
  for(var i=0;i<all.length;i++){
    var e=all[i], b=e.getBoundingClientRect();
    if(!b.width&&!b.height) continue;
    var cs=getComputedStyle(e);
    if(cs.display==='none'||cs.visibility==='hidden') continue;
    var rolavel=e.closest('.tabs,.table-wrap');
    if(!rolavel && (b.right>window.innerWidth+1 || b.left<-1))
      r.wide.push(e.tagName+'.'+(e.className||'')+' L'+Math.round(b.left)+' R'+Math.round(b.right));
    if(!rolavel && e.scrollWidth>e.clientWidth+1 && cs.overflowX==='visible')
      r.clipped.push(e.tagName+'.'+(e.className||'')+' sw'+e.scrollWidth+'/cw'+e.clientWidth);
    if(e.matches('button,.tab,.mini,.head-btn,.punch') && !e.disabled && b.height>0 && b.height<44 && r.coarse)
      r.tiny.push(e.tagName+'.'+(e.className||'')+' h'+Math.round(b.height));
    if(e.matches('input,select,textarea') && cs.fontSize && parseFloat(cs.fontSize)<16 && r.coarse)
      r.fonts.push(e.tagName+'.'+(e.className||'')+' '+cs.fontSize);
  }
  /* quem esta a alargar a pagina: filhos diretos do content que
     ultrapassam a caixa, e os elementos que chegam mais a destra */
  var cont=document.querySelector('.content');
  if(cont){
    r.larg=[];
    for(var j=0;j<cont.children.length;j++){
      var c=cont.children[j], cb=c.getBoundingClientRect();
      r.larg.push(c.tagName+'.'+(c.className||'')+' sw'+c.scrollWidth+'/cw'+c.clientWidth+' R'+Math.round(cb.right));
    }
    r.dir=[];
    var todos=cont.querySelectorAll('*');
    for(var k=0;k<todos.length;k++){
      var t=todos[k], tb=t.getBoundingClientRect();
      if(tb.width||tb.height) r.dir.push(Math.round(tb.right)+' '+t.tagName+'.'+(t.className||''));
    }
    r.dir.sort(function(a,b){return parseInt(b)-parseInt(a)});
    r.dir=r.dir.slice(0,5);
  }
  return r;
}
</script>`;


const base = path.join(dir, '_tmp_layout.html');
fs.writeFileSync(base, src.replace('<script>', STUB + PROBE + '<script>'), 'utf8');

const DISPOSITIVOS = [
  ['iPhone SE 2/3', 375, 667, true], ['Galaxy S8', 360, 740, true],
  ['iPhone 12/13', 390, 844, true], ['iPhone 14 Pro Max', 430, 932, true],
  ['iPhone SE paisagem', 667, 375, true], ['iPhone paisagem', 844, 390, true],
  ['iPad retrato', 768, 1024, true], ['iPad paisagem', 1024, 768, false],
  ['PC 1366', 1366, 768, false], ['PC FullHD', 1920, 1080, false]
];

if (!fs.existsSync(chrome)) {
  console.log('Chrome nao encontrado em ' + chrome + ' — sonda de layout ignorada.');
  process.exitCode = 0;
} else {
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'cr_layout_'));
  const proc = cp.spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--hide-scrollbars', '--remote-debugging-port=0', '--user-data-dir=' + perfil,
    'about:blank'], { stdio: 'ignore' });

  let falhas = 0;
  const TERMINAR = function (codigo) {
    try { proc.kill(); } catch (e) {}
    if (!MANTER) {
      try { fs.rmSync(perfil, { recursive: true, force: true }); } catch (e) {}
      try { fs.unlinkSync(base); } catch (e) {}
    }
    console.log('\nDISPOSITIVOS_COM_PROBLEMA:' + falhas);
    process.exitCode = codigo === undefined ? (falhas ? 1 : 0) : codigo;
  };

  (async function () {
    let _porta = null;
    const pedir = async function () {
      for (let i = 0; i < 150; i++) {
        try {
          const f = path.join(perfil, 'DevToolsActivePort');
          if (fs.existsSync(f)) {
            _porta = fs.readFileSync(f, 'utf8').split('\n')[0].trim();
            const r = await fetch('http://127.0.0.1:' + _porta + '/json/version');
            if (r.ok) return (await r.json()).webSocketDebuggerUrl;
          }
        } catch (e) {}
        await new Promise(function (r) { setTimeout(r, 100); });
      }
      throw new Error('DevTools nao respondeu');
    };

    const ws = new WebSocket(await pedir());
    await new Promise(function (r, j) { ws.onopen = r; ws.onerror = j; });

    let seq = 0;
    const pendentes = new Map();
    const eventos = [];
    ws.onmessage = function (ev) {
      const m = JSON.parse(ev.data);
      if (m.id && pendentes.has(m.id)) {
        const p = pendentes.get(m.id);
        pendentes.delete(m.id);
        m.error ? p.j(new Error(m.error.message)) : p.r(m.result);
      } else if (m.method) eventos.push(m);
    };
    const cmd = function (method, params, sessionId) {
      return new Promise(function (r, j) {
        const id = ++seq;
        pendentes.set(id, { r: r, j: j });
        ws.send(JSON.stringify({ id: id, method: method, params: params || {}, sessionId: sessionId }));
      });
    };
    const esperar = async function (nome, ms) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        for (let i = 0; i < eventos.length; i++) {
          if (eventos[i].method === nome) { eventos.splice(i, 1); return true; }
        }
        await new Promise(function (r) { setTimeout(r, 25); });
      }
      return false;
    };

    const t = await cmd('Target.createTarget', { url: 'about:blank' });
    const s = await cmd('Target.attachToTarget', { targetId: t.targetId, flatten: true });
    const sess = s.sessionId;
    const ev = function (o) { return cmd(o.method, o.params, sess); };
    await ev({ method: 'Page.enable' });
    await ev({ method: 'Emulation.setDeviceMetricsOverride',
      params: { width: 800, height: 600, deviceScaleFactor: 1, mobile: false } });
    const dist = async function (nome, w, h, coarse) {
      const linhas = [];
      await ev({ method: 'Emulation.setDeviceMetricsOverride',
        params: { width: w, height: h, deviceScaleFactor: 1, mobile: coarse } });
      await ev({ method: 'Emulation.setTouchEmulationEnabled', params: { enabled: !!coarse } });
      await ev({ method: 'Emulation.setEmitTouchEventsForMouse', params: { enabled: !!coarse, configuration: 'mobile' } });
      const url = 'file:///' + path.join(dir, '_tmp_layout.html').replace(/\\/g, '/');
      await ev({ method: 'Page.navigate', params: { url: url } });
      await esperar('Page.loadEventFired', 8000);
      const res = await ev({ method: 'Runtime.evaluate',
        params: { expression: 'probeRun()', returnByValue: true } });
      const r = res.result && res.result.value;
      if (!r) { linhas.push('  !! sem resultado'); falhas++; }
      else {
        const problemas = r.wide.concat(r.tiny, r.fonts, r.clipped);
        if (r.overflow > 0) problemas.push('pagina rola na horizontal: ' + r.overflow + 'px');
        if (problemas.length) {
          falhas++;
          linhas.push('  !! ' + r.wide.length + ' fora do ecrã, ' + r.tiny.length +
            ' alvos <44px, ' + r.fonts.length + ' fontes <16px, ' + r.clipped.length + ' cortados' +
            (r.overflow > 0 ? ', overflow ' + r.overflow + 'px' : ''));
          problemas.slice(0, 8).forEach(function (p) { linhas.push('       ' + p); });
        } else {
          linhas.push('  OK   ' + r.wide.length + ' fora, ' + r.tiny.length +
            ' pequenos, ' + r.fonts.length + ' fontes pequenas, ' + r.clipped.length +
            ' cortados, pointer:coarse=' + r.coarse +
            (r.overflow > 0 ? ', overflow ' + r.overflow : ''));
        }
      }
      console.log(linhas.join('\n'));
    };

    for (const [nome, w, h, coarse] of DISPOSITIVOS) {
      console.log('\n== ' + nome + ' (' + w + 'x' + h + ', ' + (coarse ? 'toque' : 'rato') + ')');
      await dist(nome, w, h, coarse);
    }
    TERMINAR();
  })().catch(function (e) { console.log('ERRO: ' + e.message); TERMINAR(2); });
}
