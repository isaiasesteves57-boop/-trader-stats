/**
 * parser.js
 * Interpreta texto (colado manualmente ou vindo do OCR) e devolve uma
 * lista de "candidatos" a oportunidade, no mesmo formato usado pelo
 * cadastro manual (data, horario, campeonato, timeCasa, timeVisitante,
 * jogo, metodo, estrategia, entrada, confianca, status, observacao).
 *
 * Suporta vários formatos de origem diferentes, tentados nesta ordem:
 *  1) Lista "Partidas Favoritas" (linha única "HH:MM - Time x Time")
 *  2) Lista de jogos com odds 1-X-2 em bloco (ex: prints do CSCORE.COM.BR)
 *  3) Grade de dicas/tips por campeonato (ex: prints tipo "Hoje" com
 *     CASA / FORA / EMPATE ANULA / +1.5GOLS / HANDICAP ASIÁTICO etc.)
 *  4) Formato rotulado "Campo: valor" (um campo por linha)
 *  5) Formato livre "Time x Time - HH:MM (pct/pct)" (fallback simples)
 *
 * O OCR costuma embaralhar acentos e espaços — por isso os regexes abaixo
 * são tolerantes a variações comuns (maiúsc./minúsc., pontuação solta,
 * vírgula ou ponto decimal).
 */

const RadarParser = (() => {
  // ---------------------------------------------------------------
  // Helpers gerais
  // ---------------------------------------------------------------

  function limparLinha(l) {
    return String(l || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  function linhasDe(texto) {
    return String(texto || '')
      .split(/\r?\n/)
      .map(limparLinha)
      .filter(Boolean);
  }

  function normalizar(texto) {
    return String(texto || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function novoCandidato(base) {
    return Object.assign(
      {
        data: '',
        horario: '',
        campeonato: '',
        timeCasa: '',
        timeVisitante: '',
        jogo: '',
        metodo: '',
        estrategia: '',
        entrada: '',
        confianca: '',
        status: 'aguardando',
        observacao: '',
        precisaRevisao: false,
      },
      base
    );
  }

  function montarJogo(casa, fora) {
    casa = limparLinha(casa);
    fora = limparLinha(fora);
    return casa && fora ? `${casa} x ${fora}` : casa || fora || '';
  }

  const RE_HORA = /^(\d{1,2}):(\d{2})$/;
  const RE_HORA_EM_LINHA = /(\d{1,2}:\d{2})/;
  const RE_ODD = /\d{1,2}[.,]\d{2}/;
  const RE_SO_ODD = /^\d{1,2}[.,]\d{2}$/;
  const RE_TRES_ODDS = new RegExp(
    RE_ODD.source + String.raw`\D+` + RE_ODD.source + String.raw`\D+` + RE_ODD.source
  );

  // "1", "X", "2", "1 X 2" -- cabeçalho da coluna de odds, deve ser ignorado
  const RE_CABECALHO_1X2 = /^[1x2](\s+[1x2]){0,2}$/i;

  // linhas de interface que não são nem time nem tip nem odd
  const RE_LIXO_UI = /^(termos de uso|pol[ií]tica de privacidade|cookies|suporte|hoje|ontem|amanh[ãa]|partidas favoritas|preview|review)\b/i;

  // "ITÁLIA: SERIE A", "BRASIL: BRASILEIRÃO BETANO", "COLÔMBIA: PRIMEIRA A - ENCERRAMENTO"
  const RE_CAMPEONATO = /^([A-ZÀ-Ú][A-ZÀ-Úa-z ]{2,25}):\s*(.+)$/;

  // dicas/tips conhecidas dos prints de "melhores apostas"
  const RE_TIP = /\b(CASA|FORA|EMPATE|ANULA|GOLS?|HANDICAP\s*ASI[ÁA]TICO|AMBAS\s*MARCAM|BTTS|OVER|UNDER|DUPLA\s*CHANCE)\b/i;

  function pareceNomeDeTime(linha) {
    if (!linha) return false;
    if (RE_HORA.test(linha)) return false;
    if (RE_SO_ODD.test(linha)) return false;
    if (RE_CABECALHO_1X2.test(linha)) return false;
    if (RE_TIP.test(linha)) return false;
    if (RE_CAMPEONATO.test(linha)) return false;
    if (RE_LIXO_UI.test(linha)) return false;
    if (/^\d+$/.test(linha)) return false;
    // nome de time: letras (com acentos), números ocasionais (ex: "1900"),
    // espaços, hífen, ponto, apóstrofo — tamanho razoável
    return /^[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9.'\- ]{1,39}$/.test(linha);
  }

  // ---------------------------------------------------------------
  // 1) "Partidas Favoritas" — "HH:MM - Time x Time" numa linha só
  // ---------------------------------------------------------------

  const RE_FAVORITA =
    /^(\d{1,2}:\d{2})\s*[-–—]\s*(.+?)\s+[xX×]\s+(.+)$/;

  function extrairFavoritas(linhas, usadas) {
    const candidatos = [];
    linhas.forEach((linha, i) => {
      if (usadas.has(i)) return;
      const m = linha.match(RE_FAVORITA);
      if (!m) return;
      const [, horario, casa, fora] = m;
      candidatos.push(
        novoCandidato({
          horario,
          timeCasa: limparLinha(casa),
          timeVisitante: limparLinha(fora),
          jogo: montarJogo(casa, fora),
          observacao: 'Importado de lista de partidas favoritas (sem odds/entrada).',
          precisaRevisao: true,
        })
      );
      usadas.add(i);
    });
    return candidatos;
  }

  // ---------------------------------------------------------------
  // 2) Bloco "HH:MM / Time / Time / (1 X 2) / odd odd odd"
  //    (prints de casa de apostas tipo CSCORE.COM.BR)
  // ---------------------------------------------------------------

  function extrairBlocosDeOdds(linhas, usadas) {
    const candidatos = [];
    let campeonatoAtual = '';

    for (let i = 0; i < linhas.length; i++) {
      if (usadas.has(i)) continue;
      const linha = linhas[i];

      const mCamp = linha.match(RE_CAMPEONATO);
      if (mCamp && !RE_TIP.test(linha)) {
        campeonatoAtual = limparLinha(mCamp[2] ? `${mCamp[1]}: ${mCamp[2]}` : linha);
        continue;
      }

      if (!RE_HORA.test(linha)) continue;
      // já usado por outro extrator (ex: dicas) — pula
      if (usadas.has(i)) continue;

      // procura os dois nomes de time nas próximas linhas
      let j = i + 1;
      const times = [];
      const marcados = [i];
      while (j < linhas.length && times.length < 2 && j < i + 6) {
        if (!usadas.has(j) && pareceNomeDeTime(linhas[j])) {
          times.push(linhas[j]);
          marcados.push(j);
        } else if (RE_HORA.test(linhas[j]) || RE_TRES_ODDS.test(linhas[j])) {
          break; // passou do bloco sem achar 2 times — desiste
        }
        j++;
      }
      if (times.length < 2) continue;

      // procura as odds (1 X 2) logo depois, em até 4 linhas seguintes
      let odds = null;
      let k = j;
      let limite = Math.min(linhas.length, j + 4);
      while (k < limite) {
        if (usadas.has(k)) { k++; continue; }
        const candidataOdds = [linhas[k], linhas[k + 1], linhas[k + 2]]
          .filter(Boolean)
          .join(' ');
        const mOdds = candidataOdds.match(RE_TRES_ODDS);
        if (mOdds) {
          odds = [mOdds[0].match(RE_ODD)[0]];
          // recompute all three matches individually
          const todas = candidataOdds.match(new RegExp(RE_ODD.source, 'g'));
          if (todas && todas.length >= 3) {
            odds = todas.slice(0, 3);
            // marca quantas linhas foram consumidas para achar isso
            for (let m = j; m <= k + 2 && m < linhas.length; m++) {
              if (RE_ODD.test(linhas[m]) || RE_CABECALHO_1X2.test(linhas[m])) marcados.push(m);
            }
          }
          break;
        }
        k++;
      }

      marcados.forEach((idx) => usadas.add(idx));

      const [casa, fora] = times;
      const observacao = odds
        ? `Odds do bloco lido — 1: ${odds[0]} | X: ${odds[1]} | 2: ${odds[2]}`
        : 'Bloco de jogo lido sem odds identificáveis.';

      candidatos.push(
        novoCandidato({
          horario: linha,
          campeonato: campeonatoAtual,
          timeCasa: casa,
          timeVisitante: fora,
          jogo: montarJogo(casa, fora),
          confianca: odds ? odds.join(' / ') : '',
          observacao,
          precisaRevisao: true, // não há entrada/estratégia definida neste tipo de print
        })
      );
    }
    return candidatos;
  }

  // ---------------------------------------------------------------
  // 3) Grade de dicas por campeonato ("Hoje", tipster) — âncora na dica
  //    (CASA / EMPATE ANULA / +1.5GOLS / HANDICAP ASIÁTICO...) e no
  //    horário próximo, olhando para trás pelos dois times.
  // ---------------------------------------------------------------

  function extrairGradeDeTips(linhas, usadas) {
    const candidatos = [];
    let campeonatoAtual = '';

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];
      const mCamp = linha.match(RE_CAMPEONATO);
      if (mCamp && !RE_TIP.test(linha)) {
        campeonatoAtual = limparLinha(linha);
      }
      if (usadas.has(i)) continue;
      if (!RE_TIP.test(linha)) continue;

      // monta o texto da dica juntando linhas vizinhas que também batem
      // com palavras de dica (ex: "EMPATE" + "ANULA" em linhas separadas)
      let fimDica = i;
      let dica = linha;
      while (
        fimDica + 1 < linhas.length &&
        !usadas.has(fimDica + 1) &&
        (RE_TIP.test(linhas[fimDica + 1]) ||
          /^(ANULA|GOLS?|ASI[ÁA]TICO)$/i.test(linhas[fimDica + 1]))
      ) {
        fimDica++;
        dica += ' ' + linhas[fimDica];
      }

      // times: procura para trás, até 4 linhas, os dois últimos que
      // parecerem nome de time
      const times = [];
      for (let b = i - 1; b >= Math.max(0, i - 5) && times.length < 2; b--) {
        if (usadas.has(b)) continue;
        if (RE_CAMPEONATO.test(linhas[b])) break;
        if (pareceNomeDeTime(linhas[b])) times.unshift(b);
      }
      if (times.length < 2) continue;
      const casa = linhas[times[0]];
      const fora = linhas[times[1]];

      // horário e odds: procura para frente, até 6 linhas depois da dica
      let horario = '';
      const odds = [];
      const marcadosDepois = [];
      for (let f = fimDica + 1; f < Math.min(linhas.length, fimDica + 7); f++) {
        if (usadas.has(f)) continue;
        if (!horario && RE_HORA.test(linhas[f])) {
          horario = linhas[f];
          marcadosDepois.push(f);
          continue;
        }
        if (RE_SO_ODD.test(linhas[f]) && odds.length < 3) {
          odds.push(linhas[f]);
          marcadosDepois.push(f);
          continue;
        }
        if (RE_CAMPEONATO.test(linhas[f]) || RE_TIP.test(linhas[f])) break;
      }

      times.forEach((idx) => usadas.add(idx));
      for (let idx = i; idx <= fimDica; idx++) usadas.add(idx);
      marcadosDepois.forEach((idx) => usadas.add(idx));

      candidatos.push(
        novoCandidato({
          horario,
          campeonato: campeonatoAtual,
          timeCasa: casa,
          timeVisitante: fora,
          jogo: montarJogo(casa, fora),
          estrategia: limparLinha(dica),
          entrada: limparLinha(dica),
          confianca: odds.join(' / '),
          observacao: 'Dica lida de grade de tips — confira o time/aposta indicado.',
          precisaRevisao: true,
        })
      );
    }
    return candidatos;
  }

  // ---------------------------------------------------------------
  // 4) Formato rotulado "Campo: valor" (um campo por linha)
  // ---------------------------------------------------------------

  const MAPA_ROTULOS = {
    campeonato: 'campeonato',
    liga: 'campeonato',
    jogo: 'jogo',
    partida: 'jogo',
    'time casa': 'timeCasa',
    casa: 'timeCasa',
    mandante: 'timeCasa',
    'time visitante': 'timeVisitante',
    visitante: 'timeVisitante',
    fora: 'timeVisitante',
    horario: 'horario',
    'horário': 'horario',
    hora: 'horario',
    data: 'data',
    metodo: 'metodo',
    'método': 'metodo',
    estrategia: 'estrategia',
    'estratégia': 'estrategia',
    entrada: 'entrada',
    aposta: 'entrada',
    confianca: 'confianca',
    'confiança': 'confianca',
    observacao: 'observacao',
    'observação': 'observacao',
    obs: 'observacao',
    // odds separadas por rótulo (ex: "ODD CASA: 1.22"), muito comuns em
    // listas de tips já transcritas manualmente do print
    'odd casa': 'oddCasa',
    'odds casa': 'oddCasa',
    'odd 1': 'oddCasa',
    'odd empate': 'oddEmpate',
    'odds empate': 'oddEmpate',
    'odd x': 'oddEmpate',
    'odd fora': 'oddFora',
    'odds fora': 'oddFora',
    'odd 2': 'oddFora',
  };

  function extrairRotulado(linhas, usadas) {
    const candidatos = [];
    let atual = null;
    let idxUsados = [];

    function fechar() {
      if (atual && (atual.jogo || (atual.timeCasa && atual.timeVisitante))) {
        if (!atual.jogo) atual.jogo = montarJogo(atual.timeCasa, atual.timeVisitante);
        // junta ODD CASA / ODD EMPATE / ODD FORA (lidas em linhas separadas)
        // num único resumo de confiança, caso ainda não haja um valor de
        // confiança explícito no bloco
        if (!atual.confianca && (atual.oddCasa || atual.oddEmpate || atual.oddFora)) {
          const partes = [];
          if (atual.oddCasa) partes.push(`Casa ${atual.oddCasa}`);
          if (atual.oddEmpate) partes.push(`Empate ${atual.oddEmpate}`);
          if (atual.oddFora) partes.push(`Fora ${atual.oddFora}`);
          atual.confianca = partes.join(' / ');
        }
        delete atual.oddCasa;
        delete atual.oddEmpate;
        delete atual.oddFora;
        if (!atual.horario || !atual.entrada) atual.precisaRevisao = true;
        candidatos.push(novoCandidato(atual));
        idxUsados.forEach((idx) => usadas.add(idx));
      }
      atual = null;
      idxUsados = [];
    }

    linhas.forEach((linha, i) => {
      if (usadas.has(i)) return;
      const m = linha.match(/^([A-Za-zÀ-ÿ ]{2,20}):\s*(.+)$/);
      const chave = m ? normalizar(m[1]).trim() : null;
      const campo = chave ? MAPA_ROTULOS[chave] : null;
      if (!campo) return;
      if (!atual) atual = {};
      if (atual[campo]) fechar() || (atual = {}); // já tem esse campo -> novo bloco
      if (!atual) atual = {};
      atual[campo] = limparLinha(m[2]);
      idxUsados.push(i);
    });
    fechar();
    return candidatos;
  }

  // ---------------------------------------------------------------
  // 5) Fallback livre: "Time x Time - HH:MM" numa linha (sem odds)
  // ---------------------------------------------------------------

  const RE_LIVRE = /^(.+?)\s+[xX×]\s+(.+?)\s*[-–—]\s*(\d{1,2}:\d{2})/;

  function extrairLivre(linhas, usadas) {
    const candidatos = [];
    linhas.forEach((linha, i) => {
      if (usadas.has(i)) return;
      const m = linha.match(RE_LIVRE);
      if (!m) return;
      const [, casa, fora, horario] = m;
      candidatos.push(
        novoCandidato({
          horario,
          timeCasa: limparLinha(casa),
          timeVisitante: limparLinha(fora),
          jogo: montarJogo(casa, fora),
          precisaRevisao: true,
        })
      );
      usadas.add(i);
    });
    return candidatos;
  }

  // ---------------------------------------------------------------
  // parseSmartText: roda os extratores em ordem e junta tudo
  // ---------------------------------------------------------------

  function parseSmartText(texto) {
    const linhas = linhasDe(texto);
    const usadas = new Set();

    const resultado = [
      ...extrairFavoritas(linhas, usadas),
      ...extrairGradeDeTips(linhas, usadas),
      ...extrairBlocosDeOdds(linhas, usadas),
      ...extrairRotulado(linhas, usadas),
      ...extrairLivre(linhas, usadas),
    ];

    return resultado;
  }

  // ---------------------------------------------------------------
  // parseLayZebraText: "Time x Time - HH:MM (65/35)" + "Lay/Back Time"
  // ---------------------------------------------------------------

  const RE_ZEBRA_JOGO = /^(.+?)\s+[xX×]\s+(.+?)\s*[-–—]\s*(\d{1,2}:\d{2})\s*(?:\((\d{1,3})\s*\/\s*(\d{1,3})\))?/;
  const RE_ZEBRA_ENTRADA = /^(lay|back)\s+(?:ao\s+|no\s+|na\s+)?(.+)$/i;

  function parseLayZebraText(texto) {
    const linhas = linhasDe(texto);
    const candidatos = [];
    let pendente = null;

    linhas.forEach((linha) => {
      const mJogo = linha.match(RE_ZEBRA_JOGO);
      if (mJogo) {
        if (pendente) {
          pendente.precisaRevisao = !pendente.entrada;
          candidatos.push(novoCandidato(pendente));
        }
        const [, casa, fora, horario, pctCasa, pctFora] = mJogo;
        pendente = {
          horario,
          timeCasa: limparLinha(casa),
          timeVisitante: limparLinha(fora),
          jogo: montarJogo(casa, fora),
          confianca: pctCasa && pctFora ? `${pctCasa}/${pctFora}` : '',
        };
        return;
      }
      const mEntrada = linha.match(RE_ZEBRA_ENTRADA);
      if (mEntrada && pendente) {
        pendente.metodo = mEntrada[1].toLowerCase() === 'lay' ? 'Lay' : 'Back';
        pendente.entrada = limparLinha(linha);
      }
    });

    if (pendente) {
      pendente.precisaRevisao = !pendente.entrada;
      candidatos.push(novoCandidato(pendente));
    }

    return candidatos;
  }

  return { parseSmartText, parseLayZebraText };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RadarParser;
}
