/**
 * strategies.js
 * Regras de negócio sobre estratégias e métodos: CRUD (por cima do
 * storage.js) e agrupamento/filtro de oportunidades por estratégia.
 */

const RadarStrategies = (() => {
  function listarEstrategias() {
    return RadarStorage.getStrategies();
  }

  function criarEstrategia(nome, cor) {
    if (!nome || !nome.trim()) throw new Error('Nome da estratégia é obrigatório.');
    return RadarStorage.addStrategy({ nome: nome.trim(), cor: cor || '#38bdf8' });
  }

  function editarEstrategia(id, changes) {
    return RadarStorage.updateStrategy(id, changes);
  }

  function excluirEstrategia(id) {
    RadarStorage.deleteStrategy(id);
  }

  function listarMetodos() {
    return RadarStorage.getMethods();
  }

  function criarMetodo(nome, cor, icone) {
    if (!nome || !nome.trim()) throw new Error('Nome do método é obrigatório.');
    return RadarStorage.addMethod({ nome: nome.trim().toUpperCase(), cor: cor || '#22c55e', icone: icone || '⚙️' });
  }

  function editarMetodo(id, changes) {
    return RadarStorage.updateMethod(id, changes);
  }

  function excluirMetodo(id) {
    RadarStorage.deleteMethod(id);
  }

  // Agrupa oportunidades por nome de estratégia
  function agruparPorEstrategia(oportunidades) {
    const grupos = {};
    oportunidades.forEach((op) => {
      const chave = op.estrategia || 'Sem estratégia';
      if (!grupos[chave]) grupos[chave] = [];
      grupos[chave].push(op);
    });
    return grupos;
  }

  // Filtro rápido usado na tela de Estratégias: TODAS / FAVORITOS / ZEBRAS / LAY / BACK / OUTRAS
  function filtrarPorCategoria(oportunidades, categoria) {
    if (!categoria || categoria === 'TODAS') return oportunidades;
    const texto = (op) => `${op.metodo || ''} ${op.estrategia || ''}`.toLowerCase();
    switch (categoria) {
      case 'FAVORITOS':
        return oportunidades.filter((op) => texto(op).includes('favorit'));
      case 'ZEBRAS':
        return oportunidades.filter((op) => texto(op).includes('zebra'));
      case 'LAY':
        return oportunidades.filter((op) => texto(op).includes('lay'));
      case 'BACK':
        return oportunidades.filter((op) => texto(op).includes('back') || texto(op).includes('bak'));
      case 'OUTRAS':
        return oportunidades.filter((op) => {
          const t = texto(op);
          return !t.includes('favorit') && !t.includes('zebra') && !t.includes('lay') && !t.includes('back') && !t.includes('bak');
        });
      default:
        return oportunidades;
    }
  }

  return {
    listarEstrategias,
    criarEstrategia,
    editarEstrategia,
    excluirEstrategia,
    listarMetodos,
    criarMetodo,
    editarMetodo,
    excluirMetodo,
    agruparPorEstrategia,
    filtrarPorCategoria,
  };
})();
