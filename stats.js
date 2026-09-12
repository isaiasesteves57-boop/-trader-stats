/**
 * stats.js
 * Cálculo de estatísticas a partir da lista de oportunidades:
 * contagens gerais, taxa de acerto e desempenho por método,
 * estratégia, campeonato, dia/semana/mês.
 */

const RadarStats = (() => {
  function contarPorStatus(lista) {
    const contagem = { AGUARDANDO: 0, ENTROU: 0, GREEN: 0, RED: 0, CANCELADA: 0 };
    lista.forEach((op) => {
      const status = (op.status || 'AGUARDANDO').toUpperCase();
      if (contagem[status] === undefined) contagem[status] = 0;
      contagem[status]++;
    });
    return contagem;
  }

  function taxaDeAcerto(lista) {
    const finalizadas = lista.filter((op) => op.status === 'GREEN' || op.status === 'RED');
    if (finalizadas.length === 0) return 0;
    const greens = finalizadas.filter((op) => op.status === 'GREEN').length;
    return (greens / finalizadas.length) * 100;
  }

  function agruparEDesempenho(lista, campo) {
    const grupos = {};
    lista.forEach((op) => {
      const chave = op[campo] || 'Não informado';
      if (!grupos[chave]) grupos[chave] = { total: 0, green: 0, red: 0 };
      grupos[chave].total++;
      if (op.status === 'GREEN') grupos[chave].green++;
      if (op.status === 'RED') grupos[chave].red++;
    });
    return Object.entries(grupos).map(([nome, dados]) => {
      const finalizadas = dados.green + dados.red;
      return {
        nome,
        total: dados.total,
        green: dados.green,
        red: dados.red,
        taxaAcerto: finalizadas > 0 ? (dados.green / finalizadas) * 100 : 0,
      };
    });
  }

  function melhor(lista, campo) {
    const grupos = agruparEDesempenho(lista, campo).filter((g) => g.green + g.red >= 1);
    if (grupos.length === 0) return null;
    return grupos.reduce((a, b) => (b.taxaAcerto > a.taxaAcerto ? b : a));
  }

  function chaveDia(dataISO) {
    return dataISO ? dataISO.slice(0, 10) : 'sem-data';
  }

  function chaveSemana(dataISO) {
    if (!dataISO) return 'sem-data';
    const d = new Date(dataISO);
    const inicioAno = new Date(d.getFullYear(), 0, 1);
    const diasPassados = Math.floor((d - inicioAno) / (24 * 60 * 60 * 1000));
    const semana = Math.ceil((diasPassados + inicioAno.getDay() + 1) / 7);
    return `${d.getFullYear()}-S${semana}`;
  }

  function chaveMes(dataISO) {
    return dataISO ? dataISO.slice(0, 7) : 'sem-data';
  }

  function agruparPorPeriodo(lista, tipo) {
    const fn = tipo === 'semana' ? chaveSemana : tipo === 'mes' ? chaveMes : chaveDia;
    const grupos = {};
    lista.forEach((op) => {
      const base = op.data || (op.criadoEm ? op.criadoEm.slice(0, 10) : '');
      const chave = fn(base);
      if (!grupos[chave]) grupos[chave] = { total: 0, green: 0, red: 0 };
      grupos[chave].total++;
      if (op.status === 'GREEN') grupos[chave].green++;
      if (op.status === 'RED') grupos[chave].red++;
    });
    return Object.entries(grupos)
      .sort((a, b) => (a[0] > b[0] ? 1 : -1))
      .map(([periodo, dados]) => ({ periodo, ...dados }));
  }

  function resumoGeral(lista) {
    const porStatus = contarPorStatus(lista);
    return {
      total: lista.length,
      green: porStatus.GREEN,
      red: porStatus.RED,
      aguardando: porStatus.AGUARDANDO,
      entrou: porStatus.ENTROU,
      cancelada: porStatus.CANCELADA,
      taxaAcerto: taxaDeAcerto(lista),
      melhorMetodo: melhor(lista, 'metodo'),
      melhorEstrategia: melhor(lista, 'estrategia'),
    };
  }

  return {
    contarPorStatus,
    taxaDeAcerto,
    agruparEDesempenho,
    melhor,
    agruparPorPeriodo,
    resumoGeral,
  };
})();
