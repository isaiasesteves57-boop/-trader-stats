/**
 * parser.js
 * Interpreta texto colado (ou extraído por OCR) e transforma em uma
 * lista de oportunidades candidatas. NUNCA salva sozinho — sempre
 * devolve objetos para revisão em tela antes de gravar no storage.
 *
 * Suporta três "formatos" de entrada, podendo misturar entre si no
 * mesmo texto:
 *
 * 1) Formato livre (uma linha de confronto + linha(s) de método/entrada):
 *    Elversberg x Braunschweig - 09:00 (60/40)
 *    Lay ao Braunschweig
 *
 * 2) Formato rotulado (campo: valor, um por linha):
 *    Jogo: Santos x Palmeiras
 *    Horário: 16:00
 *    Método: BAK FAVORITO
 *    Entrada: A FAVOR PALMEIRAS
 *    Estratégia: Favorito
 *    Status: AGUARDANDO
 *
 * 3) Formato "card de site" (ex: prints de listas como CSCORE.COM.BR),
 *    reconhecido pelo rótulo "Lay <Time>" / "Back <Time>" no topo do
 *    card, seguido em qualquer ordem por campeonato, placar/times e
 *    status (FINALIZADO / AO VIVO Xx'). Ex (texto de OCR):
 *    Lay Queen's Park
 *    Championship - Escócia - Rodada 6
 *    FINALIZADO
 *    Dunfermline Athletic 2 x 0 Queen's Park
 */

const RadarParser = (() => {
  const LABEL_MAP = {
    jogo: 'jogoTexto',
    confronto: 'jogoTexto',
    partida: 'jogoTexto',
    data: 'data',
    'hora': 'horario',
    'horário': 'horario',
    horario: 'horario',
    campeonato: 'campeonato',
    liga: 'campeonato',
    'método': 'metodo',
    metodo: 'metodo',
    'estratégia': 'estrategia',
    estrategia: 'estrategia',
    entrada: 'entrada',
    'confiança': 'confianca',
    confianca: 'confianca',
    'porcentagem': 'confianca',
    'observação': 'observacao',
    observacao: 'observacao',
    obs: 'observacao',
    status: 'status',
    alerta: 'alertaMin',
  };

  const METHOD_KEYWORDS = [
    { regex: /\blay\b.*\bfavorit/i, metodo: 'LAY FAVORITO' },
    { regex: /\bback\b.*\bfavorit|^bak favorito$/i, metodo: 'BACK FAVORITO' },
    { regex: /\bzebra\b.*\bcasa\b|\bcasa\b.*\bzebra\b/i, metodo: 'ZEBRA CASA' },
    { regex: /\bzebra\b.*\bfora\b|\bfora\b.*\bzebra\b/i, metodo: 'ZEBRA FORA' },
    { regex: /\bback\b.*\bcasa\b/i, metodo: 'BACK CASA' },
    { regex: /\bback\b.*\bvisitant/i, metodo: 'BACK VISITANTE' },
    { regex: /\blay\b/i, metodo: 'LAY' },
    { regex: /\bback\b/i, metodo: 'BACK' },
    { regex: /\bzebra\b/i, metodo: 'ZEBRA' },
    { regex: /\bover\b/i, metodo: 'OVER' },
    { regex: /\bunder\b/i, metodo: 'UNDER' },
  ];

  function normalize(text) {
    return text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  }

  // Divide o texto em blocos: uma linha em branco separa oportunidades
  function splitBlocks(text) {
    const blocks = normalize(text)
      .split(/\n\s*\n+/)
      .map((b) => b.trim())
      .filter(Boolean);
    if (blocks.length > 0) return blocks;
    return [normalize(text)];
  }

  // Detecta se um bloco usa o formato "campo: valor"
  function isLabeledBlock(block) {
    const lines = block.split('\n').filter(Boolean);
    let hits = 0;
    lines.forEach((line) => {
      const m = line.match(/^([a-zçãáéíóúâêô ]+):\s*(.*)$/i);
      if (m && LABEL_MAP[normalizeLabel(m[1])]) hits++;
    });
    return hits >= 2;
  }

  function normalizeLabel(label) {
    return label
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, ''); // remove acentos para casar com o mapa também sem acento
  }

  function parseLabeledBlock(block) {
    const lines = block.split('\n').filter(Boolean);
    const data = {};
    let currentField = null;

    lines.forEach((line) => {
      const m = line.match(/^([a-zçãáéíóúâêô ]+):\s*(.*)$/i);
      if (m) {
        const key = LABEL_MAP[normalizeLabel(m[1])] || LABEL_MAP[m[1].trim().toLowerCase()];
        if (key) {
          currentField = key;
          data[key] = (m[2] || '').trim();
          return;
        }
      }
      // linha sem "campo:" -> continuação do campo anterior (ex: valor na linha de baixo)
      if (currentField && !data[currentField]) {
        data[currentField] = line.trim();
      } else if (currentField) {
        data[currentField] = (data[currentField] + ' ' + line.trim()).trim();
      }
    });

    const times = extractTeams(data.jogoTexto || '');
    return buildOpportunity({
      timeCasa: times.timeCasa,
      timeVisitante: times.timeVisitante,
      horario: data.horario || '',
      data: data.data || '',
      campeonato: data.campeonato || '',
      metodo: (data.metodo || '').toUpperCase().trim(),
      estrategia: data.estrategia || '',
      entrada: data.entrada || '',
      confianca: data.confianca || '',
      observacao: data.observacao || '',
      status: (data.status || 'AGUARDANDO').toUpperCase().trim(),
      origemTexto: block,
    });
  }

  function extractTeams(text) {
    const m = text.match(/(.+?)\s+(?:x|vs\.?|×)\s+(.+)/i);
    if (m) {
      return { timeCasa: m[1].trim(), timeVisitante: m[2].trim() };
    }
    return { timeCasa: '', timeVisitante: '' };
  }

  // Formato livre: primeira linha tem "Time x Time - HH:MM (pct/pct)"
  // linhas seguintes descrevem o método/entrada em texto livre.
  function parseFreeBlock(block) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return null;

    const linhaOriginal = lines[0];
    let headerLine = linhaOriginal;

    // Corrige o formato comum de listas tipo "Partidas Favoritas", onde a
    // hora vem ANTES do confronto: "11:00 - Time A x Time B" (às vezes com
    // um ícone de bandeira antes, que o OCR pode transformar em lixo).
    // Extrai a hora e remove esse prefixo antes de separar os times, para
    // não deixar "11:00 - Time A" grudado no nome do time da casa.
    let horarioPrefixo = '';
    const prefixoHorarioMatch = headerLine.match(
      /([01]?\d|2[0-3])[:h]([0-5]\d)\s*[-–]\s*(.+)$/i
    );
    if (prefixoHorarioMatch) {
      horarioPrefixo = `${prefixoHorarioMatch[1]}:${prefixoHorarioMatch[2]}`;
      headerLine = prefixoHorarioMatch[3].trim();
    }

    const headerMatch = headerLine.match(
      /(.+?)\s+(?:x|vs\.?|×)\s+(.+?)(?:\s*-\s*(\d{1,2}[:h]\d{2}))?(?:\s*\((\d{1,3})\s*\/\s*(\d{1,3})\))?\s*$/i
    );

    if (!headerMatch) return null;

    const timeCasa = headerMatch[1].trim();
    // timeVisitante pode ter "capturado" o horário se não bateu certinho — limpamos abaixo
    let timeVisitante = headerMatch[2].trim();
    let horario = horarioPrefixo || (headerMatch[3] ? headerMatch[3].replace('h', ':') : '');
    const pctCasa = headerMatch[4] || '';
    const pctFora = headerMatch[5] || '';

    // Fallback: procura horário em qualquer lugar da linha original se não veio pelos casos acima
    if (!horario) {
      const hMatch = linhaOriginal.match(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/);
      if (hMatch) horario = `${hMatch[1]}:${hMatch[2]}`;
    }
    // Remove sufixo de horário/percentual que possa ter sobrado grudado no nome do time
    timeVisitante = timeVisitante
      .replace(/\s*-\s*\d{1,2}[:h]\d{2}.*$/i, '')
      .replace(/\s*\(\d+\s*\/\s*\d+\)\s*$/, '')
      .trim();

    const restante = lines.slice(1).join(' ');
    const metodo = detectMethod(restante);
    const entrada = extractEntrada(restante, timeCasa, timeVisitante);

    return buildOpportunity({
      timeCasa,
      timeVisitante,
      horario,
      data: '',
      campeonato: '',
      metodo,
      estrategia: '',
      entrada,
      confianca: pctCasa && pctFora ? `${pctCasa}/${pctFora}` : '',
      observacao: restante && !entrada ? restante : '',
      status: 'AGUARDANDO',
      origemTexto: block,
    });
  }

  function detectMethod(text) {
    for (const { regex, metodo } of METHOD_KEYWORDS) {
      if (regex.test(text)) return metodo;
    }
    return '';
  }

  function extractEntrada(text, timeCasa, timeVisitante) {
    if (!text) return '';
    // Ex: "Lay ao Braunschweig" -> entrada = "CONTRA BRAUNSCHWEIG"
    const layMatch = text.match(/lay\s+(?:ao|a|para)?\s*(.+)/i);
    if (layMatch) return `CONTRA ${layMatch[1].trim().toUpperCase()}`;

    const backMatch = text.match(/back\s+(?:ao|a|para)?\s*(.+)/i);
    if (backMatch) return `A FAVOR ${backMatch[1].trim().toUpperCase()}`;

    // Se nada bateu, devolve o próprio texto em maiúsculas (revisar manualmente)
    return text.trim().toUpperCase();
  }

  // Linhas de interface que aparecem nos prints de sites de "master list"
  // (ex: CSCORE.COM.BR) e que não fazem parte do jogo em si.
  const RUIDO_CARD_REGEX =
    /^(pr[ée]|placares|ao vivo\s*$|acessar partida|an[aá]lise de escala[cç][oõ]es|master list|cscore\.com\.br)/i;

  // Detecta se um bloco é um "card" de site tipo CSCORE: tem um rótulo
  // "Lay <time>" / "Back <time>" e um placar em algum lugar do texto.
  function isCscoreCardBlock(block) {
    return /^\s*(lay|back)\s+\S/im.test(block) && /\d{1,2}\s*[x×]\s*\d{1,2}/i.test(block);
  }

  function parseCscoreBlock(block) {
    const linhas = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const layLineIdx = linhas.findIndex((l) => /^(lay|back)\s+(.+)/i.test(l));
    if (layLineIdx === -1) return null;

    const layMatch = linhas[layLineIdx].match(/^(lay|back)\s+(.+)/i);
    const metodoTipo = layMatch[1].toUpperCase(); // LAY ou BACK
    const alvo = layMatch[2].trim();

    let timeCasa = '';
    let timeVisitante = '';
    let placarCasa = '';
    let placarFora = '';

    // Caso 1: OCR juntou tudo numa linha só, pois times e placar ficam na
    // mesma altura visual no card: "Time A  N x M  Time B"
    const placarInlineRegex = /^(.+?)\s+(\d{1,2})\s*[x×]\s*(\d{1,2})\s+(.+)$/i;
    let placarEncontrado = false;

    linhas.forEach((l) => {
      if (placarEncontrado || RUIDO_CARD_REGEX.test(l)) return;
      const m = l.match(placarInlineRegex);
      if (m && !/^\d+[.,]\d+$/.test(m[1].trim()) && !/^\d+[.,]\d+$/.test(m[4].trim())) {
        timeCasa = m[1].trim();
        placarCasa = m[2];
        placarFora = m[3];
        timeVisitante = m[4].trim();
        placarEncontrado = true;
      }
    });

    // Caso 2: placar sozinho numa linha, times nas linhas vizinhas
    if (!placarEncontrado) {
      const placarSoRegex = /^(\d{1,2})\s*[x×]\s*(\d{1,2})$/i;
      linhas.forEach((l, idx) => {
        if (placarEncontrado) return;
        const m = l.match(placarSoRegex);
        if (!m) return;
        placarCasa = m[1];
        placarFora = m[2];
        placarEncontrado = true;
        for (let i = idx - 1; i >= 0; i--) {
          const cand = linhas[i];
          if (!RUIDO_CARD_REGEX.test(cand) && !/finalizado|ao vivo/i.test(cand) && !/^\d+[.,]\d+/.test(cand)) {
            timeCasa = cand;
            break;
          }
        }
        for (let i = idx + 1; i < linhas.length; i++) {
          const cand = linhas[i];
          if (!RUIDO_CARD_REGEX.test(cand) && !/^\d+[.,]\d+/.test(cand)) {
            timeVisitante = cand;
            break;
          }
        }
      });
    }

    // Campeonato: primeira linha com " - " que não seja a linha do Lay/Back
    // nem ruído de interface nem a linha do placar
    const campeonato =
      linhas.find(
        (l, idx) =>
          idx !== layLineIdx &&
          / - /.test(l) &&
          !RUIDO_CARD_REGEX.test(l) &&
          !placarInlineRegex.test(l)
      ) || '';

    // Status/observação a partir de FINALIZADO ou AO VIVO Xx'
    let observacao = '';
    const finalizadoLine = linhas.find((l) => /finalizado/i.test(l));
    const aoVivoLine = linhas.find((l) => /ao vivo/i.test(l) && /\d/.test(l));
    if (finalizadoLine) {
      observacao = 'FINALIZADO';
    } else if (aoVivoLine) {
      const min = aoVivoLine.match(/(\d+)\s*'?/);
      observacao = min ? `AO VIVO ${min[1]}'` : 'AO VIVO';
    }
    if (placarCasa !== '' && placarFora !== '') {
      observacao = observacao ? `${observacao} - ${placarCasa}x${placarFora}` : `${placarCasa}x${placarFora}`;
    }

    return buildOpportunity({
      timeCasa,
      timeVisitante,
      horario: '',
      data: '',
      campeonato,
      metodo: `${metodoTipo} ${alvo}`.toUpperCase(),
      estrategia: metodoTipo === 'LAY' ? 'Lay' : 'Back',
      entrada: `${metodoTipo === 'LAY' ? 'CONTRA' : 'A FAVOR'} ${alvo.toUpperCase()}`,
      confianca: '',
      observacao,
      status: 'AGUARDANDO',
      origemTexto: block,
    });
  }

  function detectarSecaoLayZebra(texto) {
    const t = normalizeLabel(String(texto || '').replace(/\*/g, ''));
    if (/zebra.*odd.*6.*12|zebra.*nao contabilizado/.test(t)) return { grupoFonte: 'ZEBRA TEXTO', contabilizar: false };
    if (/sugestao.*aposta.*back|academia das apostas/.test(t)) return { grupoFonte: 'BACK TEXTO', contabilizar: true };
    return { grupoFonte: 'LAY TEXTO', contabilizar: true };
  }

  function prepararTextoLayZebra(rawText) {
    let t = String(rawText || '').replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ');
    // O texto recebido pelo usuário pode vir inteiro em uma única linha, com dois
    // ou mais espaços separando cada oportunidade. Isso transforma cada entrada
    // em linhas sem destruir os espaços simples dentro dos nomes.
    t = t.replace(/\s{2,}/g, '\n');
    // Cabeçalhos em negrito vindos de WhatsApp/Telegram/Markdown.
    t = t.replace(/\*\*([^*]+)\*\*/g, '\n$1\n');
    return t.split('\n').map(x => x.trim()).filter(Boolean).join('\n');
  }

  function parseLayZebraText(rawText) {
    const texto = prepararTextoLayZebra(rawText);
    if (!texto) return [];

    // Também aceita várias oportunidades na MESMA linha. O ponto de corte é
    // o padrão "Jogo x Jogo - HH:MM", portanto espaços simples dentro dos
    // nomes dos times não são destruídos.
    const entryStart = /(?=[^\n]*?\s+(?:x|vs\.?|×)\s+[^\n]*?\s*-\s*(?:[01]?\d|2[0-3])[:h][0-5]\d)/i;
    const linhas = texto.split('\n').filter(Boolean);
    const resultados = [];
    let secao = { grupoFonte: 'LAY TEXTO', contabilizar: true };

    const jogoRegex = /^(.+?)\s+(?:x|vs\.?|×)\s+(.+?)\s*-\s*([01]?\d|2[0-3])[:h]([0-5]\d)(?:\s*\((\d{1,3})\s*\/\s*(\d{1,3})\))?(.*)$/i;
    const estrutural = (l) => /^(?:zebra|sugest[aã]o de aposta|academia das apostas|partidas favoritas|lay\s+favorit|back\s+favorit)/i.test(l.replace(/\*/g, '').trim());

    function processarLinha(linha, linhaSeguinte) {
      const limpa = linha.replace(/\*\*/g, '').trim();
      const m = limpa.match(jogoRegex);
      if (!m) return null;
      const timeCasa = m[1].trim();
      let timeVisitante = m[2].trim();
      const horario = `${m[3]}:${m[4]}`;
      const confianca = m[5] && m[6] ? `${m[5]}/${m[6]}` : '';
      let resto = (m[7] || '').trim();

      // Remove odd do nome do visitante e captura a estratégia da mesma linha.
      const oddMatch = limpa.match(/\bODD\s*([0-9]+(?:[.,][0-9]+)?)/i);
      timeVisitante = timeVisitante.replace(/\s*[-–]\s*ODD\s*[\d.,]+.*$/i, '').trim();
      if (!resto && linhaSeguinte && !estrutural(linhaSeguinte) && !jogoRegex.test(linhaSeguinte)) resto = linhaSeguinte.trim();

      const metodo = detectMethod(resto);
      const entrada = extractEntrada(resto, timeCasa, timeVisitante);
      const grupo = secao || { grupoFonte: 'LAY TEXTO', contabilizar: true };
      return buildOpportunity({
        timeCasa, timeVisitante, horario, data: '', campeonato: '',
        metodo: metodo || (grupo.grupoFonte === 'BACK TEXTO' ? 'BACK' : 'LAY'),
        estrategia: grupo.grupoFonte === 'ZEBRA TEXTO' ? 'Zebra' : (grupo.grupoFonte === 'BACK TEXTO' ? 'Back' : 'Lay'),
        entrada, confianca,
        observacao: oddMatch ? `ODD ${oddMatch[1]}` : '',
        status: 'AGUARDANDO', grupoFonte: grupo.grupoFonte,
        contabilizar: grupo.contabilizar, origemTexto: limpa + (resto ? ` | ${resto}` : '')
      });
    }

    for (let i = 0; i < linhas.length; i++) {
      let linha = linhas[i].replace(/\*\*/g, '').trim();
      if (!linha) continue;
      if (estrutural(linha) && !/\bx\b|×|\bvs\.?\b/i.test(linha)) {
        secao = detectarSecaoLayZebra(linha);
        continue;
      }

      // Uma linha pode conter mais de um jogo separado por espaços.
      // Insere uma quebra antes de cada novo padrão "... x ... - HH:MM".
      const partes = linha
        .replace(/\s+(?=[A-ZÀ-Ú][^\n]{1,90}\s+(?:x|vs\.?|×)\s+[^\n]{1,90}\s*-\s*(?:[01]?\d|2[0-3])[:h][0-5]\d)/g, '\n')
        .split('\n').map(x => x.trim()).filter(Boolean);

      for (let j = 0; j < partes.length; j++) {
        const parte = partes[j];
        if (estrutural(parte) && !/\bx\b|×|\bvs\.?\b/i.test(parte)) {
          secao = detectarSecaoLayZebra(parte);
          continue;
        }
        const op = processarLinha(parte, partes[j + 1] || linhas[i + 1]);
        if (op) resultados.push(op);
      }
    }
    return resultados;
  }

  function buildOpportunity(fields) {
    const confiancaOk = !!(fields.timeCasa && fields.timeVisitante);
    return Object.assign(
      {
        jogo: fields.timeCasa && fields.timeVisitante ? `${fields.timeCasa} x ${fields.timeVisitante}` : '',
        precisaRevisao: !confiancaOk || !fields.horario || !fields.metodo,
      },
      fields
    );
  }

  /**
   * Função principal: recebe um texto (colado ou vindo de OCR) e
   * devolve um array de oportunidades candidatas, prontas para
   * revisão na tela "OPORTUNIDADES IDENTIFICADAS".
   */
  function detectarContextoEstrategia(texto) {
    const t = normalizeLabel(texto || '');
    if (/^partidas favoritas?$/.test(t) || /^favoritos?$/.test(t)) return 'Favoritos';
    if (/^zebra\s*\(\s*casa\s*\)$/.test(t) || /^zebra\s+casa$/.test(t)) return 'Zebra Casa';
    if (/^zebra\s*\(\s*fora\s*\)$/.test(t) || /^zebra\s+fora$/.test(t)) return 'Zebra Fora';
    if (/^lay\s+favorit/.test(t)) return 'Lay Favorito';
    if (/^back\s+favorit|^bak\s+favorit/.test(t)) return 'Back Favorito';
    return '';
  }

  function completarEstrategia(op, contexto) {
    if (!op) return op;
    if (contexto) op.estrategia = contexto;
    if (!op.estrategia) {
      const metodo = String(op.metodo || '').toUpperCase();
      if (metodo.includes('LAY')) op.estrategia = 'Lay';
      else if (metodo.includes('BACK') || metodo.includes('BAK')) op.estrategia = 'Back';
      else if (metodo.includes('ZEBRA')) op.estrategia = 'Zebra';
      else if (metodo.includes('OVER')) op.estrategia = 'Over';
      else if (metodo.includes('UNDER')) op.estrategia = 'Under';
    }
    return op;
  }

  function parseText(rawText) {
    if (!rawText || !rawText.trim()) return [];
    const blocks = splitBlocks(rawText);
    const resultados = [];
    let contextoEstrategia = '';

    blocks.forEach((block) => {
      const contextoDetectado = detectarContextoEstrategia(block);
      if (contextoDetectado && !/\sx\s|\svs\.?\s|×/i.test(block)) {
        contextoEstrategia = contextoDetectado;
        return;
      }

      let op = null;
      if (isCscoreCardBlock(block)) {
        op = parseCscoreBlock(block);
      } else if (isLabeledBlock(block)) {
        op = parseLabeledBlock(block);
      } else {
        op = parseFreeBlock(block);
      }
      if (op) resultados.push(completarEstrategia(op, contextoEstrategia));
    });

    // Quando o OCR entrega várias partidas sem linhas em branco, processa
    // cada jogo e carrega junto o último cabeçalho de estratégia encontrado.
    if (resultados.length <= 1) {
      const linhas = normalize(rawText).split('\n').filter(Boolean);
      const linhasDeJogo = linhas.filter((l) => /\sx\s|\svs\.?\s|×/i.test(l) && /\d{1,2}[:h]\d{2}/.test(l));
      if (linhasDeJogo.length > 1) {
        const extras = [];
        let contextoFallback = '';
        linhas.forEach((linha, idx) => {
          const contexto = detectarContextoEstrategia(linha);
          if (contexto && !/\sx\s|\svs\.?\s|×/i.test(linha)) {
            contextoFallback = contexto;
            return;
          }
          if (/\sx\s|\svs\.?\s|×/i.test(linha) && /\d{1,2}[:h]\d{2}/.test(linha)) {
            const proxima = linhas[idx + 1] && !/\sx\s|\svs\.?\s|×/i.test(linhas[idx + 1]) ? linhas[idx + 1] : '';
            const bloco = proxima ? `${linha}\n${proxima}` : linha;
            const op = parseFreeBlock(bloco);
            if (op) extras.push(completarEstrategia(op, contextoFallback));
          }
        });
        if (extras.length > 1) return extras;
      }
    }

    return resultados;
  }

  // Entrada inteligente: decide automaticamente se o conteúdo parece uma
  // lista Lay/Zebra/Back ou um print geral de oportunidades. Isso é usado
  // tanto no texto colado quanto no OCR das imagens.
  function parseSmartText(rawText) {
    const t = String(rawText || '');
    const temLayBack = /\blay\b|\bback\b/i.test(t);
    const temJogosComHora = /(?:x|vs\.?|×).*?(?:[01]?\d|2[0-3])[:h][0-5]\d/i.test(t);
    if (temLayBack && temJogosComHora) {
      const lay = parseLayZebraText(t);
      if (lay.length) return lay;
    }
    return parseText(t);
  }

  return { parseText, parseLayZebraText, parseSmartText, detectMethod, extractTeams, isCscoreCardBlock, parseCscoreBlock };
})();
