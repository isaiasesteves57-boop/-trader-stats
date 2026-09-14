/**
 * mapa.js
 * Consolida visualmente as oportunidades por horário e partida.
 * Não altera os dados salvos: o mapa é uma visão derivada.
 */
const RadarMapa = (() => {
  function normalizarTexto(texto) {
    return String(texto || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function chavePartida(op) {
    const data = op.data || '';
    const casa = normalizarTexto(op.timeCasa || '');
    const fora = normalizarTexto(op.timeVisitante || '');
    return `${data}|${casa}|${fora}`;
  }

  function agruparPartidas(lista) {
    const mapa = new Map();
    lista.forEach((op) => {
      const chave = chavePartida(op);
      if (!chave || chave === '||') return;
      if (!mapa.has(chave)) {
        mapa.set(chave, {
          chave,
          data: op.data || '',
          horario: op.horario || '',
          timeCasa: op.timeCasa || '',
          timeVisitante: op.timeVisitante || '',
          jogo: op.jogo || `${op.timeCasa || ''} x ${op.timeVisitante || ''}`,
          campeonato: op.campeonato || '',
          sinais: [],
        });
      }
      const grupo = mapa.get(chave);
      if (!grupo.horario && op.horario) grupo.horario = op.horario;
      if (!grupo.campeonato && op.campeonato) grupo.campeonato = op.campeonato;
      grupo.sinais.push(op);
    });
    return Array.from(mapa.values());
  }

  function minutos(horario) {
    const m = String(horario || '').match(/^(\d{1,2}):(\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : 9999;
  }

  function agruparPorHorario(lista) {
    const grupos = {};
    agruparPartidas(lista).forEach((partida) => {
      const horario = partida.horario || '--:--';
      if (!grupos[horario]) grupos[horario] = [];
      grupos[horario].push(partida);
    });
    return Object.keys(grupos)
      .sort((a, b) => minutos(a) - minutos(b) || a.localeCompare(b))
      .map((horario) => ({ horario, partidas: grupos[horario] }));
  }

  function resumoEstrategias(partidas) {
    const contagem = {};
    partidas.forEach((p) => p.sinais.forEach((op) => {
      const nome = op.estrategia || op.metodo || 'Sem estratégia';
      contagem[nome] = (contagem[nome] || 0) + 1;
    }));
    return Object.entries(contagem).sort((a, b) => b[1] - a[1]);
  }

  return { agruparPartidas, agruparPorHorario, resumoEstrategias };
})();
