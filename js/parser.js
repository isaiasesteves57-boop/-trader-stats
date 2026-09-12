/**
 * parser.js
 * Interpreta texto colado (ou extraído por OCR) e transforma em uma
 * lista de oportunidades candidatas. NUNCA salva sozinho — sempre
 * devolve objetos para revisão em tela antes de gravar no storage.
 *
 * Suporta dois "formatos" de entrada, podendo misturar os dois no
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

    const headerLine = lines[0];
    const headerMatch = headerLine.match(
      /(.+?)\s+(?:x|vs\.?|×)\s+(.+?)(?:\s*-\s*(\d{1,2}[:h]\d{2}))?(?:\s*\((\d{1,3})\s*\/\s*(\d{1,3})\))?\s*$/i
    );

    if (!headerMatch) return null;

    const timeCasa = headerMatch[1].trim();
    // timeVisitante pode ter "capturado" o horário se não bateu certinho — limpamos abaixo
    let timeVisitante = headerMatch[2].trim();
    let horario = headerMatch[3] ? headerMatch[3].replace('h', ':') : '';
    const pctCasa = headerMatch[4] || '';
    const pctFora = headerMatch[5] || '';

    // Fallback: procura horário em qualquer lugar da linha se não veio pelo grupo
    if (!horario) {
      const hMatch = headerLine.match(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/);
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
  function parseText(rawText) {
    if (!rawText || !rawText.trim()) return [];
    const blocks = splitBlocks(rawText);
    const resultados = [];

    blocks.forEach((block) => {
      let op = null;
      if (isLabeledBlock(block)) {
        op = parseLabeledBlock(block);
      } else {
        op = parseFreeBlock(block);
      }
      if (op) resultados.push(op);
    });

    // Caso o texto inteiro não tenha sido dividido em blocos por linha em
    // branco, mas contenha várias linhas "Time x Time - HH:MM", tentamos
    // separar linha a linha como fallback (comum em prints de bolsa OCR).
    if (resultados.length <= 1) {
      const linhas = normalize(rawText).split('\n').filter(Boolean);
      const linhasDeJogo = linhas.filter((l) => /\sx\s|\svs\.?\s|×/i.test(l) && /\d{1,2}[:h]\d{2}/.test(l));
      if (linhasDeJogo.length > 1) {
        const extras = [];
        linhas.forEach((linha, idx) => {
          if (/\sx\s|\svs\.?\s|×/i.test(linha) && /\d{1,2}[:h]\d{2}/.test(linha)) {
            const proxima = linhas[idx + 1] && !/\sx\s|\svs\.?\s|×/i.test(linhas[idx + 1]) ? linhas[idx + 1] : '';
            const bloco = proxima ? `${linha}\n${proxima}` : linha;
            const op = parseFreeBlock(bloco);
            if (op) extras.push(op);
          }
        });
        if (extras.length > 1) return extras;
      }
    }

    return resultados;
  }

  return { parseText, detectMethod, extractTeams };
})();
