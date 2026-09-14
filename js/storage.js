/**
 * storage.js
 * Camada de persistência do Radar de Oportunidades.
 *
 * Hoje usa localStorage. Toda a leitura/escrita passa por este módulo
 * de propósito: no futuro, para migrar para um banco de dados em nuvem
 * (Firebase/Supabase/etc), basta trocar a implementação das funções
 * abaixo — o resto do app (app.js, cards.js, stats.js...) não precisa
 * saber onde os dados realmente moram.
 */

const RadarStorage = (() => {
  const KEYS = {
    OPPORTUNITIES: 'radar_opportunities_v1',
    METHODS: 'radar_methods_v1',
    STRATEGIES: 'radar_strategies_v1',
    SETTINGS: 'radar_settings_v1',
  };

  // ---------- helpers genéricos ----------

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (err) {
      console.error(`[storage] Falha ao ler ${key}:`, err);
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.error(`[storage] Falha ao salvar ${key}:`, err);
      return false;
    }
  }

  function uid() {
    return 'op_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  // ---------- métodos padrão ----------

  const DEFAULT_METHODS = [
    { id: 'm_back_favorito', nome: 'BACK FAVORITO', cor: '#22c55e', icone: '✅' },
    { id: 'm_bak_favorito', nome: 'BAK FAVORITO', cor: '#22c55e', icone: '✅' },
    { id: 'm_lay_favorito', nome: 'LAY FAVORITO', cor: '#ef4444', icone: '🔻' },
    { id: 'm_lay_mandante', nome: 'LAY MANDANTE', cor: '#ef4444', icone: '🏠' },
    { id: 'm_lay_visitante', nome: 'LAY VISITANTE', cor: '#ef4444', icone: '🚌' },
    { id: 'm_zebra_casa', nome: 'ZEBRA CASA', cor: '#f97316', icone: '🦓' },
    { id: 'm_zebra_fora', nome: 'ZEBRA FORA', cor: '#f97316', icone: '🦓' },
    { id: 'm_back_casa', nome: 'BACK CASA', cor: '#22c55e', icone: '🏠' },
    { id: 'm_back_visitante', nome: 'BACK VISITANTE', cor: '#22c55e', icone: '🚌' },
    { id: 'm_outro', nome: 'OUTRO', cor: '#94a3b8', icone: '⚙️' },
  ];

  const DEFAULT_STRATEGIES = [
    { id: 's_favorito', nome: 'Favorito', cor: '#22c55e' },
    { id: 's_zebra', nome: 'Zebra', cor: '#f97316' },
    { id: 's_lay_favorito', nome: 'Lay Favorito', cor: '#ef4444' },
    { id: 's_back_favorito', nome: 'Back Favorito', cor: '#22c55e' },
    { id: 's_over', nome: 'Over', cor: '#38bdf8' },
    { id: 's_under', nome: 'Under', cor: '#818cf8' },
    { id: 's_proprio', nome: 'Método próprio', cor: '#94a3b8' },
  ];

  const DEFAULT_SETTINGS = {
    notificacoesAtivas: false,
    alertaPadraoMin: 15,
    tema: 'escuro',
  };

  // ---------- Oportunidades ----------

  function getOpportunities() {
    return readJSON(KEYS.OPPORTUNITIES, []);
  }

  function saveOpportunities(list) {
    return writeJSON(KEYS.OPPORTUNITIES, list);
  }

  function addOpportunity(op) {
    const list = getOpportunities();
    const novo = Object.assign(
      {
        id: uid(),
        criadoEm: new Date().toISOString(),
        status: 'AGUARDANDO',
        alertaDisparado: false,
      },
      op
    );
    list.push(novo);
    saveOpportunities(list);
    return novo;
  }

  function addOpportunities(ops) {
    return ops.map((op) => addOpportunity(op));
  }

  // Importação inteligente: mesmo jogo (time casa + time visitante + data
  // do jogo + horário) acumula estratégias e entradas em vez de criar
  // cards duplicados. Se qualquer um desses 4 campos for diferente,
  // é tratado como um jogo novo.
  function addOrMergeOpportunity(op) {
    const list = getOpportunities();
    const key = (x) =>
      `${(x.timeCasa || '').trim().toLowerCase()}|${(x.timeVisitante || '').trim().toLowerCase()}|${(x.data || '').trim()}|${(x.horario || '').trim()}`;
    const idx = list.findIndex((item) => key(item) === key(op));

    if (idx === -1) {
      const novo = Object.assign({
        id: uid(),
        criadoEm: new Date().toISOString(),
        status: 'AGUARDANDO',
        alertaDisparado: false,
      }, op);
      list.push(novo);
      saveOpportunities(list);
      return novo;
    }

    const atual = list[idx];
    const juntar = (a, b) => {
      const arr = String(a || '').split(' • ').concat(String(b || '').split(' • ')).map(v => v.trim()).filter(Boolean);
      return [...new Set(arr)].join(' • ');
    };

    list[idx] = Object.assign({}, atual, {
      estrategia: juntar(atual.estrategia, op.estrategia),
      entrada: juntar(atual.entrada, op.entrada),
      metodo: juntar(atual.metodo, op.metodo),
      atualizadoEm: new Date().toISOString(),
    });

    saveOpportunities(list);
    return list[idx];
  }

  function updateOpportunity(id, changes) {
    const list = getOpportunities();
    const idx = list.findIndex((o) => o.id === id);
    if (idx === -1) return null;
    list[idx] = Object.assign({}, list[idx], changes, { atualizadoEm: new Date().toISOString() });
    saveOpportunities(list);
    return list[idx];
  }

  function deleteOpportunity(id) {
    const list = getOpportunities().filter((o) => o.id !== id);
    saveOpportunities(list);
  }

  function getOpportunityById(id) {
    return getOpportunities().find((o) => o.id === id) || null;
  }

  // Normaliza uma data para AAAA-MM-DD. Aceita o formato já esperado
  // (input type="date") e também DD/MM/AAAA, que pode aparecer em
  // registros salvos por uma versão mais antiga do app/parser. Se não
  // reconhecer o formato, devolve a string original (sem quebrar nada).
  function normalizarDataISO(valor) {
    const v = String(valor || '').trim();
    if (!v) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const mBr = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mBr) {
      const [, dd, mm, yyyy] = mBr;
      return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }
    return v;
  }

  // Remove da lista principal os jogos cuja data_jogo é anterior a
  // `dataReferenciaISO` (ex.: hoje). Jogos sem data cadastrada são
  // mantidos, já que não há como saber se estão vencidos.
  // Retorna quantos registros foram removidos.
  function removerJogosAntigos(dataReferenciaISO) {
    const antes = getOpportunities();
    const refISO = normalizarDataISO(dataReferenciaISO);
    const depois = antes.filter((o) => !o.data || normalizarDataISO(o.data) >= refISO);
    saveOpportunities(depois);
    return antes.length - depois.length;
  }

  // Remove todos os jogos cuja data_jogo é exatamente `dataISO`.
  // Retorna quantos registros foram removidos.
  function removerJogosPorData(dataISO) {
    const antes = getOpportunities();
    const alvoISO = normalizarDataISO(dataISO);
    const depois = antes.filter((o) => normalizarDataISO(o.data) !== alvoISO);
    saveOpportunities(depois);
    return antes.length - depois.length;
  }

  // ---------- Métodos ----------

  function getMethods() {
    const stored = readJSON(KEYS.METHODS, null);
    if (!stored) {
      writeJSON(KEYS.METHODS, DEFAULT_METHODS);
      return DEFAULT_METHODS.slice();
    }
    return stored;
  }

  function saveMethods(list) {
    return writeJSON(KEYS.METHODS, list);
  }

  function addMethod(method) {
    const list = getMethods();
    const novo = Object.assign({ id: uid(), cor: '#22c55e', icone: '⚙️' }, method);
    list.push(novo);
    saveMethods(list);
    return novo;
  }

  function updateMethod(id, changes) {
    const list = getMethods();
    const idx = list.findIndex((m) => m.id === id);
    if (idx === -1) return null;
    list[idx] = Object.assign({}, list[idx], changes);
    saveMethods(list);
    return list[idx];
  }

  function deleteMethod(id) {
    saveMethods(getMethods().filter((m) => m.id !== id));
  }

  // ---------- Estratégias ----------

  function getStrategies() {
    const stored = readJSON(KEYS.STRATEGIES, null);
    if (!stored) {
      writeJSON(KEYS.STRATEGIES, DEFAULT_STRATEGIES);
      return DEFAULT_STRATEGIES.slice();
    }
    return stored;
  }

  function saveStrategies(list) {
    return writeJSON(KEYS.STRATEGIES, list);
  }

  function addStrategy(strategy) {
    const list = getStrategies();
    const novo = Object.assign({ id: uid(), cor: '#38bdf8' }, strategy);
    list.push(novo);
    saveStrategies(list);
    return novo;
  }

  function updateStrategy(id, changes) {
    const list = getStrategies();
    const idx = list.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    list[idx] = Object.assign({}, list[idx], changes);
    saveStrategies(list);
    return list[idx];
  }

  function deleteStrategy(id) {
    saveStrategies(getStrategies().filter((s) => s.id !== id));
  }

  // ---------- Configurações ----------

  function getSettings() {
    const stored = readJSON(KEYS.SETTINGS, null);
    if (!stored) {
      writeJSON(KEYS.SETTINGS, DEFAULT_SETTINGS);
      return Object.assign({}, DEFAULT_SETTINGS);
    }
    return Object.assign({}, DEFAULT_SETTINGS, stored);
  }

  function saveSettings(changes) {
    const merged = Object.assign({}, getSettings(), changes);
    writeJSON(KEYS.SETTINGS, merged);
    return merged;
  }

  return {
    uid,
    getOpportunities,
    saveOpportunities,
    addOpportunity,
    addOpportunities,
    addOrMergeOpportunity,
    updateOpportunity,
    deleteOpportunity,
    getOpportunityById,
    removerJogosAntigos,
    removerJogosPorData,
    getMethods,
    saveMethods,
    addMethod,
    updateMethod,
    deleteMethod,
    getStrategies,
    saveStrategies,
    addStrategy,
    updateStrategy,
    deleteStrategy,
    getSettings,
    saveSettings,
  };
})();
