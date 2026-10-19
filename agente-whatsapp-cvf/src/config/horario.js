/* Horário de funcionamento real da clínica.
   Lê HORARIO_CLINICA (ex: "Seg-Sex 10:00-13:00 e 14:30-19:00; Sab por escala").
   abertoAgora(data?) → true/false.
   Se não conseguir interpretar (ou variável vazia), assume ABERTO (fail-open):
   nunca bloqueia atendimento por erro de configuração. */
const DIAS_PT = {
  dom: 0, domingo: 0,
  seg: 1, segunda: 1,
  ter: 2, 'terça': 2, terca: 2,
  qua: 3, quarta: 3,
  qui: 4, quinta: 4,
  sex: 5, sexta: 5,
  sab: 6, 'sábado': 6, sabado: 6
};

function norm(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function parseBlocos(cfg) {
  const blocos = [];
  const partes = String(cfg || '').split(';');
  for (const parte of partes) {
    const p = norm(parte);
    const dias = new Set();
    const mRange = p.match(/([a-z]+)\s*-\s*([a-z]+)/);
    if (mRange && DIAS_PT[mRange[1]] !== undefined && DIAS_PT[mRange[2]] !== undefined) {
      let a = DIAS_PT[mRange[1]];
      const b = DIAS_PT[mRange[2]];
      for (let i = 0; i < 7; i++) {
        dias.add(a);
        if (a === b) break;
        a = (a + 1) % 7;
      }
    } else {
      const mDia = p.match(/(domingo|segunda|terca|quarta|quinta|sexta|sabado|dom|seg|ter|qua|qui|sex|sab)/);
      if (mDia) dias.add(DIAS_PT[mDia[1]]);
    }
    if (!dias.size) continue;
    const intervalos = [];
    const reHoras = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g;
    let m;
    while ((m = reHoras.exec(p)) !== null) {
      intervalos.push([
        Number(m[1]) * 60 + Number(m[2]),
        Number(m[3]) * 60 + Number(m[4])
      ]);
    }
    blocos.push({ dias: [...dias], intervalos });
  }
  return blocos;
}

function abertoAgora(data, horarioStr) {
  if (process.env.HORARIO_VERIFICAR === '0') return true; // testes: ignora horário
  const agora = data || new Date();
  const cfg = horarioStr !== undefined ? horarioStr : (process.env.HORARIO_CLINICA || HORARIO_EXEMPLO);
  if (!cfg || !String(cfg).trim()) return true;
  let blocos;
  try {
    blocos = parseBlocos(cfg);
  } catch (e) { return true; }
  // blocos sem intervalos (ex: "Sab por escala") não abrem nada
  blocos = blocos.filter((b) => b.intervalos.length > 0);
  if (!blocos.length) return true;
  const dow = agora.getDay();
  const mins = agora.getHours() * 60 + agora.getMinutes();
  return blocos.some((b) =>
    b.dias.includes(dow) && b.intervalos.some(([a, f]) => mins >= a && mins < f)
  );
}

/* Horário por defeito (igual ao .env.exemplo) usado quando a variável
   de ambiente não está definida — ex: testes sem dotenv. */
const HORARIO_EXEMPLO = 'Seg-Sex 10:00-13:00 e 14:30-19:00; Sab por escala';

module.exports = { abertoAgora, parseBlocos, HORARIO_EXEMPLO };