/**
 * app.js
 * Controlador principal da interface. Liga storage.js, parser.js,
 * ocr.js, cards.js, alerts.js, strategies.js e stats.js à tela.
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------
  // Estado em memória (espelha o storage, evita ficar lendo o tempo todo)
  // ---------------------------------------------------------------
  let filtroStatusAtual = 'TODAS';
  let filtroCategoriaAtual = 'TODAS';
  let filtroPeriodoAtual = 'dia';
  let filtroMapaAtual = 'TODAS';
  let candidatosRevisao = []; // oportunidades aguardando revisão (texto/OCR)
  let editandoId = null; // id da oportunidade em edição no form manual

  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $all = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  // ---------------------------------------------------------------
  // Utilidades de data/hora
  // ---------------------------------------------------------------

  function hojeISO() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function amanhaISO() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  // Data escolhida para um lote de entrada (texto/imagem).
  // Uma única data é aplicada a todos os jogos daquele lote.
  function aplicarDataDoLote(itens, data) {
    const dataFinal = data || hojeISO();
    return itens.map((op) => Object.assign({}, op, { data: dataFinal }));
  }

  // Aplica uma estratégia informada no cabeçalho da importação a todos os
  // jogos encontrados no lote. A revisão individual continua disponível.
  function aplicarEstrategiaDoLote(itens, estrategia) {
    const estrategiaFinal = String(estrategia || '').trim();
    if (!estrategiaFinal) return itens;
    return itens.map((op) => {
      const atualizado = Object.assign({}, op, { estrategia: estrategiaFinal });
      // Se o usuário informou "Lay ...", não deixe o método ficar vazio ou
      // contraditório quando o OCR não conseguiu identificar o método.
      if (/^lay\b/i.test(estrategiaFinal)) atualizado.metodo = 'LAY';
      else if (/^back\b/i.test(estrategiaFinal) || /^bak\b/i.test(estrategiaFinal)) atualizado.metodo = 'BACK';
      else if (/^zebra\b/i.test(estrategiaFinal)) atualizado.metodo = 'ZEBRA';
      atualizado.precisaRevisao = !atualizado.timeCasa || !atualizado.timeVisitante || !atualizado.horario || !atualizado.metodo;
      return atualizado;
    });
  }

  function prepararDataLote(id) {
    const el = $(id);
    if (el) el.value = hojeISO();
  }

  function formatarDataCabecalho() {
    const d = new Date();
    return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
  }

  function opDataEfetiva(op) {
    return op.data || hojeISO();
  }

  function minutosAteHorario(op) {
    const alvo = RadarAlerts.parseDataHorario(op);
    if (!alvo) return null;
    return Math.round((alvo.getTime() - Date.now()) / 60000);
  }

  // ---------------------------------------------------------------
  // Modais genéricos
  // ---------------------------------------------------------------

  function abrirModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
  }

  function fecharModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  }

  $all('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => fecharModal(btn.dataset.close));
  });
  $all('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
  });

  function mostrarToast(texto) {
    const slot = $('#toast-slot');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = texto;
    slot.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  // ---------------------------------------------------------------
  // Navegação entre views
  // ---------------------------------------------------------------

  function irParaView(viewId) {
    $all('.view').forEach((v) => v.classList.remove('active'));
    const alvo = document.getElementById(viewId);
    if (alvo) alvo.classList.add('active');

    $all('.bottom-nav__item[data-view]').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === viewId);
    });

    if (viewId === 'view-estrategias') renderEstrategiasView();
    if (viewId === 'view-historico') renderHistoricoView();
    if (viewId === 'view-ajustes') renderAjustesView();
    if (viewId === 'view-radar') renderDashboard();
    if (viewId === 'view-mapa') renderMapaView();
  }

  $all('.bottom-nav__item[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => irParaView(btn.dataset.view));
  });

  $('#nav-entrada').addEventListener('click', () => abrirModal('modal-escolha-entrada'));
  $('#btn-nova-oportunidade').addEventListener('click', () => abrirModal('modal-escolha-entrada'));

  // ---------------------------------------------------------------
  // Cabeçalho (data + tirinha de estatísticas)
  // ---------------------------------------------------------------

  function renderHeader() {
    $('#header-date').textContent = formatarDataCabecalho();
    const lista = RadarStorage.getOpportunities();
    const hoje = hojeISO();
    const doDia = lista.filter((op) => opDataEfetiva(op) === hoje);
    const contagem = RadarStats.contarPorStatus(lista);

    $('#stat-hoje').textContent = doDia.length;
    $('#stat-aguardando').textContent = contagem.AGUARDANDO;
    $('#stat-green').textContent = contagem.GREEN;
    $('#stat-red').textContent = contagem.RED;
  }

  // ---------------------------------------------------------------
  // Dashboard (RADAR DE HOJE)
  // ---------------------------------------------------------------

  function opcoesSelect(select, itens, campoValor, campoLabel, valorAtual) {
    select.innerHTML = itens
      .map((i) => `<option value="${escapeHtml(i[campoLabel])}">${escapeHtml(i[campoLabel])}</option>`)
      .join('');
    if (valorAtual) select.value = valorAtual;
  }

  function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderProximaOportunidade(lista) {
    const slot = $('#next-op-slot');
    const candidatas = lista
      .filter((op) => op.status === 'AGUARDANDO' && RadarAlerts.parseDataHorario(op))
      .map((op) => ({ op, min: minutosAteHorario(op) }))
      .filter((x) => x.min !== null && x.min >= -5)
      .sort((a, b) => a.min - b.min);

    if (candidatas.length === 0) {
      slot.innerHTML = '';
      return;
    }

    const { op, min } = candidatas[0];
    const faltamTexto = min <= 0 ? 'Já está no horário' : `Faltam ${min} minuto${min === 1 ? '' : 's'}`;

    slot.innerHTML = `
      <div class="next-op-banner">
        <div>
          <div class="tag">🚨 PRÓXIMA</div>
          <div class="game">${escapeHtml(op.jogo)}</div>
          <div class="countdown">${faltamTexto}</div>
        </div>
        <div class="time">${escapeHtml(op.horario || '--:--')}</div>
      </div>
    `;
  }

  function filtrarListaPorStatus(lista, filtro) {
    switch (filtro) {
      case 'HOJE':
        return lista.filter((op) => opDataEfetiva(op) === hojeISO());
      case 'AMANHA':
        return lista.filter((op) => opDataEfetiva(op) === amanhaISO());
      case 'TODAS':
        return lista;
      default:
        return lista.filter((op) => (op.status || 'AGUARDANDO') === filtro);
    }
  }

  function ordenarPorHorario(lista) {
    return lista.slice().sort((a, b) => {
      const da = `${opDataEfetiva(a)} ${a.horario || '99:99'}`;
      const db = `${opDataEfetiva(b)} ${b.horario || '99:99'}`;
      return da.localeCompare(db);
    });
  }

  function cardHtml(op) {
    const status = (op.status || 'AGUARDANDO').toUpperCase();
    return `
    <div class="opportunity-card" data-id="${op.id}">
      <div class="opportunity-card__top">
        <div class="opportunity-card__time">${escapeHtml(op.horario || '--:--')}</div>
        <div class="opportunity-card__status status-${status}">${status}</div>
      </div>
      <div class="opportunity-card__game">${escapeHtml(op.jogo || `${op.timeCasa || ''} x ${op.timeVisitante || ''}`)}</div>
      <div class="opportunity-card__meta">
        <div><div class="k">Método</div><div class="v">${escapeHtml(op.metodo || '—')}</div></div>
        <div><div class="k">Entrada</div><div class="v">${escapeHtml(op.entrada || '—')}</div></div>
        <div><div class="k">Estratégia</div><div class="v">${escapeHtml(op.estrategia || '—')}</div></div>
        <div><div class="k">Campeonato</div><div class="v">${escapeHtml(op.campeonato || '—')}</div></div>
      </div>
      <div class="opportunity-card__actions">
        <button class="btn" data-action="ver">VER</button>
        <button class="btn" data-action="editar">EDITAR</button>
        <button class="btn btn-blue" data-action="card">GERAR CARD</button>
        <button class="btn btn-green" data-action="green">MARCAR GREEN</button>
        <button class="btn btn-red" data-action="red">MARCAR RED</button>
        <button class="btn btn-ghost" data-action="excluir">EXCLUIR</button>
      </div>
    </div>`;
  }

  function renderDashboard() {
    renderHeader();
    const lista = RadarStorage.getOpportunities();
    renderProximaOportunidade(lista);

    const filtrada = ordenarPorHorario(filtrarListaPorStatus(lista, filtroStatusAtual));
    const container = $('#lista-oportunidades');

    if (filtrada.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="icon">📡</div>
          <div>Nenhuma oportunidade por aqui ainda.<br/>Toque em "+ NOVA OPORTUNIDADE" para começar.</div>
        </div>`;
      return;
    }

    container.innerHTML = filtrada.map(cardHtml).join('');
  }

  $('#filter-status-row').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    filtroStatusAtual = chip.dataset.status;
    $all('#filter-status-row .chip').forEach((c) => c.classList.toggle('active', c === chip));
    renderDashboard();
  });

  $('#lista-oportunidades').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const cardEl = e.target.closest('.opportunity-card');
    const id = cardEl.dataset.id;
    executarAcaoCard(btn.dataset.action, id);
  });

  function executarAcaoCard(acao, id) {
    const op = RadarStorage.getOpportunityById(id);
    if (!op) return;
    switch (acao) {
      case 'ver':
        abrirDetalhes(op);
        break;
      case 'editar':
        abrirFormManual(op);
        break;
      case 'card':
        abrirCard(op);
        break;
      case 'green':
        RadarStorage.updateOpportunity(id, { status: 'GREEN' });
        mostrarToast('Marcado como GREEN');
        renderTudo();
        break;
      case 'red':
        RadarStorage.updateOpportunity(id, { status: 'RED' });
        mostrarToast('Marcado como RED');
        renderTudo();
        break;
      case 'excluir':
        if (confirm('Excluir esta oportunidade?')) {
          RadarStorage.deleteOpportunity(id);
          mostrarToast('Excluída');
          renderTudo();
        }
        break;
    }
  }

  window.RadarApp = {
    abrirOportunidade: (id) => {
      const op = RadarStorage.getOpportunityById(id);
      if (op) abrirDetalhes(op);
    },
  };

  function abrirDetalhes(op) {
    const status = (op.status || 'AGUARDANDO').toUpperCase();
    $('#ver-conteudo').innerHTML = `
      <div class="opportunity-card" style="margin-bottom:16px;">
        <div class="opportunity-card__top">
          <div class="opportunity-card__time">${escapeHtml(op.horario || '--:--')}</div>
          <div class="opportunity-card__status status-${status}">${status}</div>
        </div>
        <div class="opportunity-card__game">${escapeHtml(op.jogo)}</div>
        <div class="opportunity-card__meta">
          <div><div class="k">Data</div><div class="v">${escapeHtml(op.data || 'Hoje')}</div></div>
          <div><div class="k">Campeonato</div><div class="v">${escapeHtml(op.campeonato || '—')}</div></div>
          <div><div class="k">Método</div><div class="v">${escapeHtml(op.metodo || '—')}</div></div>
          <div><div class="k">Estratégia</div><div class="v">${escapeHtml(op.estrategia || '—')}</div></div>
          <div><div class="k">Entrada</div><div class="v">${escapeHtml(op.entrada || '—')}</div></div>
          <div><div class="k">Confiança</div><div class="v">${escapeHtml(op.confianca || '—')}</div></div>
        </div>
        ${op.observacao ? `<div style="margin-top:10px; color:var(--text-1); font-size:13px;"><strong>Obs:</strong> ${escapeHtml(op.observacao)}</div>` : ''}
      </div>
      <div class="opportunity-card__actions">
        <button class="btn" data-detalhe-action="editar">EDITAR</button>
        <button class="btn btn-blue" data-detalhe-action="card">GERAR CARD</button>
        <button class="btn btn-green" data-detalhe-action="green">MARCAR GREEN</button>
        <button class="btn btn-red" data-detalhe-action="red">MARCAR RED</button>
        <button class="btn btn-ghost" data-detalhe-action="excluir">EXCLUIR</button>
      </div>
    `;
    $('#ver-conteudo').querySelectorAll('[data-detalhe-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        fecharModal('modal-ver');
        executarAcaoCard(btn.dataset.detalheAction, op.id);
      });
    });
    abrirModal('modal-ver');
  }

  // ---------------------------------------------------------------
  // Gerador de card
  // ---------------------------------------------------------------

  let canvasCardAtual = null;
  let opCardAtual = null;

  function abrirCard(op) {
    opCardAtual = op;
    canvasCardAtual = RadarCards.renderCard(op);
    const wrap = $('#card-preview-wrap');
    wrap.innerHTML = '';
    wrap.appendChild(canvasCardAtual);
    abrirModal('modal-card');
  }

  $('#btn-copiar-card').addEventListener('click', async () => {
    try {
      await RadarCards.copyCardText(opCardAtual);
      mostrarToast('✓ COPIADO');
    } catch (err) {
      mostrarToast('Não foi possível copiar. Copie manualmente.');
    }
  });

  $('#btn-baixar-card').addEventListener('click', () => {
    RadarCards.downloadCardImage(canvasCardAtual, opCardAtual);
    mostrarToast('Imagem baixada');
  });

  $('#btn-compartilhar-card').addEventListener('click', async () => {
    try {
      const resultado = await RadarCards.shareCard(canvasCardAtual, opCardAtual);
      if (resultado === 'sem_suporte') {
        mostrarToast('Compartilhamento nativo indisponível neste navegador — use copiar ou baixar.');
      }
    } catch (err) {
      if (err && err.name !== 'AbortError') {
        mostrarToast('Não foi possível compartilhar.');
      }
    }
  });

  
  // Atalhos de data na importação: Hoje / Amanhã
  document.querySelectorAll('[data-date-target]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const alvo = document.getElementById(btn.dataset.dateTarget);
      if (!alvo) return;
      const d = new Date();
      d.setDate(d.getDate() + Number(btn.dataset.dateOffset || 0));
      const iso = d.toISOString().slice(0, 10);
      alvo.value = iso;
    });
  });

// ---------------------------------------------------------------
  // Escolha do tipo de entrada (texto / imagem / manual)
  // ---------------------------------------------------------------

  $('#opt-lay-zebra-texto').addEventListener('click', () => {
    fecharModal('modal-escolha-entrada');
    $('#input-lay-zebra-texto').value = '';
    prepararDataLote('#input-data-lote-lay-zebra');
    abrirModal('modal-lay-zebra-texto');
  });

  $('#opt-colar-texto').addEventListener('click', () => {
    fecharModal('modal-escolha-entrada');
    $('#input-texto-colado').value = '';
    prepararDataLote('#input-data-lote-texto');
    abrirModal('modal-colar-texto');
  });

  $('#opt-digitar-manual').addEventListener('click', () => {
    fecharModal('modal-escolha-entrada');
    abrirFormManual(null);
  });

  $('#opt-ler-imagem').addEventListener('click', () => {
    fecharModal('modal-escolha-entrada');
    $('#ocr-status').textContent = '';
    $('#ocr-preview').innerHTML = '';
    $('#input-estrategia-lote-imagem').value = '';
    prepararDataLote('#input-data-lote-imagem');
    abrirModal('modal-ler-imagem');
  });

  // ---------------------------------------------------------------
  // Formulário manual (criar/editar)
  // ---------------------------------------------------------------

  function preencherSelectsFormulario(valorMetodo, valorEstrategia) {
    const metodos = RadarStrategies.listarMetodos();
    const estrategias = RadarStrategies.listarEstrategias();
    opcoesSelect($('#f-metodo'), metodos, 'nome', 'nome', valorMetodo);
    opcoesSelect($('#f-estrategia'), estrategias, 'nome', 'nome', valorEstrategia);
  }

  function abrirFormManual(op) {
    editandoId = op ? op.id : null;
    $('#titulo-form-manual').textContent = op ? '⌨️ Editar oportunidade' : '⌨️ Nova oportunidade';
    preencherSelectsFormulario(op ? op.metodo : null, op ? op.estrategia : null);

    $('#f-id').value = op ? op.id : '';
    $('#f-data').value = op ? op.data || '' : hojeISO();
    $('#f-horario').value = op ? op.horario || '' : '';
    $('#f-campeonato').value = op ? op.campeonato || '' : '';
    $('#f-time-casa').value = op ? op.timeCasa || '' : '';
    $('#f-time-visitante').value = op ? op.timeVisitante || '' : '';
    $('#f-entrada').value = op ? op.entrada || '' : '';
    $('#f-confianca').value = op ? op.confianca || '' : '';
    $('#f-status').value = op ? op.status || 'AGUARDANDO' : 'AGUARDANDO';
    $('#f-observacao').value = op ? op.observacao || '' : '';
    $('#f-alerta').value = op && op.alertaMin ? String(op.alertaMin) : '15';

    abrirModal('modal-form-manual');
  }

  $('#form-manual').addEventListener('submit', (e) => {
    e.preventDefault();
    const timeCasa = $('#f-time-casa').value.trim();
    const timeVisitante = $('#f-time-visitante').value.trim();

    const dados = {
      data: $('#f-data').value || hojeISO(),
      horario: $('#f-horario').value,
      campeonato: $('#f-campeonato').value.trim(),
      timeCasa,
      timeVisitante,
      jogo: `${timeCasa} x ${timeVisitante}`,
      metodo: $('#f-metodo').value,
      estrategia: $('#f-estrategia').value,
      entrada: $('#f-entrada').value.trim(),
      confianca: $('#f-confianca').value.trim(),
      status: $('#f-status').value,
      observacao: $('#f-observacao').value.trim(),
      alertaMin: $('#f-alerta').value,
    };

    if (!dados.horario || !timeCasa || !timeVisitante || !dados.entrada) {
      mostrarToast('Preencha horário, times e entrada.');
      return;
    }

    if (editandoId) {
      RadarStorage.updateOpportunity(editandoId, dados);
      mostrarToast('Oportunidade atualizada');
    } else {
      dados.alertaDisparado = false;
      RadarStorage.addOpportunity(dados);
      mostrarToast('Oportunidade salva');
    }

    fecharModal('modal-form-manual');
    renderTudo();
  });

  // ---------------------------------------------------------------
  // Colar texto -> interpretar -> revisão
  // ---------------------------------------------------------------

  $('#btn-interpretar-texto').addEventListener('click', () => {
    const texto = $('#input-texto-colado').value;
    const dataLote = $('#input-data-lote-texto').value || hojeISO();
    const resultado = aplicarDataDoLote(RadarParser.parseSmartText(texto), dataLote);
    if (resultado.length === 0) {
      mostrarToast('Não consegui identificar nenhuma oportunidade nesse texto.');
      return;
    }
    fecharModal('modal-colar-texto');
    abrirRevisao(resultado, 'OPORTUNIDADES IDENTIFICADAS');
  });

  $('#btn-interpretar-lay-zebra-texto').addEventListener('click', () => {
    const texto = $('#input-lay-zebra-texto').value;
    const dataLote = $('#input-data-lote-lay-zebra').value || hojeISO();
    const resultado = aplicarDataDoLote(RadarParser.parseLayZebraText(texto), dataLote);
    if (resultado.length === 0) {
      mostrarToast('Não consegui identificar nenhuma oportunidade nesse texto.');
      return;
    }
    fecharModal('modal-lay-zebra-texto');
    abrirRevisao(resultado, 'LAY / ZEBRA — OPORTUNIDADES IDENTIFICADAS');
  });

  // ---------------------------------------------------------------
  // Ler imagem -> OCR -> interpretar -> revisão
  // ---------------------------------------------------------------

  $('#upload-zone').addEventListener('click', () => $('#input-imagem').click());

  $('#input-imagem').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Mostra a imagem IMEDIATAMENTE após a seleção.
    // Não esperamos o OCR terminar para dar feedback visual ao usuário.
    const previewUrl = URL.createObjectURL(file);
    $('#ocr-preview').innerHTML = `<img src="${previewUrl}" alt="Imagem selecionada" style="display:block; width:100%; max-height:420px; object-fit:contain; border-radius:10px; margin-top:10px; background:#111827;" />`;
    $('#ocr-status').textContent = '📷 Imagem carregada. Preparando leitura...';

    try {
      // Os formatos suportados são os dois modelos de print definidos para o app.
      // O parser decide automaticamente qual estrutura foi encontrada.
      const { textoBruto, dataUrlProcessado } = await RadarOCR.readImage(file, (p) => {
        $('#ocr-status').textContent = `⏳ Lendo imagem (OCR)... ${p}%`;
      });

      // Substitui o preview original pelo resultado pré-processado somente após o OCR preparar a imagem.
      if (dataUrlProcessado) {
        $('#ocr-preview').innerHTML = `<img src="${dataUrlProcessado}" alt="Imagem processada" style="display:block; width:100%; max-height:420px; object-fit:contain; border-radius:10px; margin-top:10px; background:#111827;" />`;
      }

      const dataLote = $('#input-data-lote-imagem').value || hojeISO();
      const estrategiaLote = $('#input-estrategia-lote-imagem').value || '';
      let resultado = RadarParser.parseSmartText(textoBruto);
      resultado = aplicarDataDoLote(resultado, dataLote);
      resultado = aplicarEstrategiaDoLote(resultado, estrategiaLote);
      $('#ocr-status').textContent = '';

      if (resultado.length === 0) {
        $('#ocr-status').innerHTML = `Não consegui identificar oportunidades automaticamente. Texto lido:<br/><em style="color:var(--text-1)">${escapeHtml(textoBruto).slice(0, 400)}</em><br/>Você pode cadastrar manualmente com base nesse texto.`;
        return;
      }

      fecharModal('modal-ler-imagem');
      abrirRevisao(resultado, 'OPORTUNIDADES ENCONTRADAS');
    } catch (err) {
      console.error(err);
      $('#ocr-status').textContent = `Erro ao ler imagem: ${err.message}`;
    } finally {
      // Não revoga antes do navegador terminar de pintar o preview.
      setTimeout(() => URL.revokeObjectURL(previewUrl), 1500);
      e.target.value = '';
    }
  });

  // ---------------------------------------------------------------
  // Tela de revisão (comum para texto e imagem)
  // ---------------------------------------------------------------

  function abrirRevisao(itens, titulo) {
    candidatosRevisao = itens;
    $('#titulo-revisao').textContent = titulo;
    renderRevisao();
    abrirModal('modal-revisao');
  }

  function renderRevisao() {
    const metodos = RadarStrategies.listarMetodos();
    const estrategias = RadarStrategies.listarEstrategias();
    const container = $('#lista-revisao');

    if (candidatosRevisao.length === 0) {
      container.innerHTML = '<div class="empty-state">Nenhuma oportunidade restante para revisar.</div>';
      $('#btn-salvar-todas').classList.add('hidden');
      return;
    }
    $('#btn-salvar-todas').classList.remove('hidden');

    container.innerHTML = candidatosRevisao
      .map((op, idx) => {
        const precisaRevisao = op.precisaRevisao;
        return `
        <div class="review-item ${precisaRevisao ? 'needs-review' : ''}" data-idx="${idx}">
          ${precisaRevisao ? '<div class="warn">⚠️ Confira os dados — alguns campos podem estar incompletos</div>' : ''}
          <div class="form-grid">
            <div class="field"><label>Time casa</label><input type="text" data-field="timeCasa" value="${escapeHtml(op.timeCasa)}" /></div>
            <div class="field"><label>Time visitante</label><input type="text" data-field="timeVisitante" value="${escapeHtml(op.timeVisitante)}" /></div>
            <div class="field"><label>Data</label><input type="date" data-field="data" value="${escapeHtml(op.data)}" /></div>
            <div class="field"><label>Horário</label><input type="time" data-field="horario" value="${escapeHtml(op.horario)}" /></div>
          </div>
          <div class="field"><label>Campeonato</label><input type="text" data-field="campeonato" value="${escapeHtml(op.campeonato)}" /></div>
          <div class="form-grid">
            <div class="field">
              <label>Método</label>
              <select data-field="metodo">
                <option value="">—</option>
                ${metodos.map((m) => `<option value="${escapeHtml(m.nome)}" ${op.metodo === m.nome ? 'selected' : ''}>${escapeHtml(m.nome)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>Estratégia</label>
              <select data-field="estrategia">
                <option value="">—</option>
                ${estrategias.map((s) => `<option value="${escapeHtml(s.nome)}" ${op.estrategia === s.nome ? 'selected' : ''}>${escapeHtml(s.nome)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field"><label>Entrada</label><input type="text" data-field="entrada" value="${escapeHtml(op.entrada)}" /></div>
          <div class="form-grid">
            <div class="field"><label>Confiança</label><input type="text" data-field="confianca" value="${escapeHtml(op.confianca)}" /></div>
            <div class="field">
              <label>Status</label>
              <select data-field="status">
                ${['AGUARDANDO', 'ENTROU', 'GREEN', 'RED', 'CANCELADA'].map((s) => `<option value="${s}" ${op.status === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field"><label>Observação</label><input type="text" data-field="observacao" value="${escapeHtml(op.observacao)}" /></div>
          <div class="opportunity-card__actions">
            <button class="btn btn-green" data-review-action="salvar">SALVAR ESTA</button>
            <button class="btn btn-ghost" data-review-action="remover">REMOVER</button>
          </div>
        </div>`;
      })
      .join('');
  }

  $('#lista-revisao').addEventListener('input', (e) => {
    const item = e.target.closest('.review-item');
    if (!item) return;
    const idx = parseInt(item.dataset.idx, 10);
    const campo = e.target.dataset.field;
    if (!campo) return;
    candidatosRevisao[idx][campo] = e.target.value;
    if (campo === 'timeCasa' || campo === 'timeVisitante') {
      candidatosRevisao[idx].jogo = `${candidatosRevisao[idx].timeCasa} x ${candidatosRevisao[idx].timeVisitante}`;
    }
  });

  $('#lista-revisao').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-review-action]');
    if (!btn) return;
    const item = e.target.closest('.review-item');
    const idx = parseInt(item.dataset.idx, 10);

    if (btn.dataset.reviewAction === 'salvar') {
      salvarCandidato(candidatosRevisao[idx]);
      candidatosRevisao.splice(idx, 1);
      renderRevisao();
      mostrarToast('Oportunidade salva');
      renderTudo();
    } else if (btn.dataset.reviewAction === 'remover') {
      candidatosRevisao.splice(idx, 1);
      renderRevisao();
    }
  });

  $('#btn-salvar-todas').addEventListener('click', () => {
    if (candidatosRevisao.length === 0) return;
    candidatosRevisao.forEach((op) => salvarCandidato(op));
    mostrarToast(`${candidatosRevisao.length} oportunidade(s) integrada(s) ao mapa`);
    candidatosRevisao = [];
    fecharModal('modal-revisao');
    renderTudo();
  });

  function salvarCandidato(op) {
    const limpo = Object.assign({}, op);
    delete limpo.precisaRevisao;
    delete limpo.origemTexto;
    delete limpo.jogoTexto;
    if (!limpo.jogo) limpo.jogo = `${limpo.timeCasa || ''} x ${limpo.timeVisitante || ''}`;
    if (!limpo.status) limpo.status = 'AGUARDANDO';
    if (!limpo.alertaMin) limpo.alertaMin = '15';
    limpo.alertaDisparado = false;
    RadarStorage.addOrMergeOpportunity(limpo);
  }

  // ---------------------------------------------------------------
  // Mapa de oportunidades por horário
  // ---------------------------------------------------------------

  function mapaStatusPermitido(op) {
    return filtroMapaAtual === 'TODAS' || (op.status || 'AGUARDANDO').toUpperCase() === filtroMapaAtual;
  }

  function mapaStatusClass(status) {
    return `status-${String(status || 'AGUARDANDO').toUpperCase()}`;
  }

  function mapaSinalHtml(op) {
    const status = (op.status || 'AGUARDANDO').toUpperCase();
    return `
      <div class="mapa-sinal">
        <span class="mapa-sinal__strategy">${escapeHtml(op.estrategia || 'Sem estratégia')}</span>
        <span class="mapa-sinal__method">${escapeHtml(op.metodo || 'Sem método')}</span>
        <span class="mapa-sinal__entry">${escapeHtml(op.entrada || '—')}</span>
        <span class="mapa-sinal__status ${mapaStatusClass(status)}">${status}</span>
      </div>`;
  }

  function renderMapaView() {
    const todas = RadarStorage.getOpportunities();
    const lista = todas.filter(mapaStatusPermitido);
    const horarios = RadarMapa.agruparPorHorario(lista);
    const resumoEstrat = RadarMapa.resumoEstrategias(RadarMapa.agruparPartidas(lista));

    $('#mapa-resumo').innerHTML = `
      <div class="mapa-summary">
        <div class="mapa-summary-card"><div class="n">${lista.length}</div><div class="l">Sinais</div></div>
        <div class="mapa-summary-card"><div class="n">${RadarMapa.agruparPartidas(lista).length}</div><div class="l">Partidas</div></div>
        <div class="mapa-summary-card"><div class="n">${horarios.length}</div><div class="l">Horários</div></div>
      </div>`;

    if (!horarios.length) {
      $('#mapa-conteudo').innerHTML = '<div class="mapa-empty">Nenhuma oportunidade encontrada com esse filtro.</div>';
      return;
    }

    $('#mapa-conteudo').innerHTML = horarios.map((grupo) => {
      const estrategias = RadarMapa.resumoEstrategias(grupo.partidas);
      return `
        <div class="mapa-hour">
          <div class="mapa-hour__head">
            <div class="mapa-hour__time">⏰ ${escapeHtml(grupo.horario)}</div>
            <div class="mapa-hour__count">${grupo.partidas.length} partida(s)</div>
          </div>
          <div class="mapa-strategies">
            ${estrategias.map(([nome, qtd]) => `<span class="mapa-strategy-chip">🎯 ${escapeHtml(nome)} · ${qtd}</span>`).join('')}
          </div>
          ${grupo.partidas.map((p) => `
            <div class="mapa-game">
              <div class="mapa-game__title">⚽ ${escapeHtml(p.jogo)}</div>
              ${p.campeonato ? `<div class="mapa-game__meta">${escapeHtml(p.campeonato)}</div>` : ''}
              ${p.sinais.map(mapaSinalHtml).join('')}
            </div>`).join('')}
        </div>`;
    }).join('');
  }

  $('#btn-abrir-mapa').addEventListener('click', () => irParaView('view-mapa'));
  $('#btn-voltar-radar-mapa').addEventListener('click', () => irParaView('view-radar'));
  $('#mapa-filtros').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip[data-map-filter]');
    if (!chip) return;
    filtroMapaAtual = chip.dataset.mapFilter;
    $all('#mapa-filtros .chip').forEach((c) => c.classList.toggle('active', c === chip));
    renderMapaView();
  });

  // ---------------------------------------------------------------
  // Estratégias (view)
  // ---------------------------------------------------------------

  function renderEstrategiasView() {
    const lista = RadarStorage.getOpportunities();
    const filtrada = RadarStrategies.filtrarPorCategoria(lista, filtroCategoriaAtual);
    const grupos = RadarStrategies.agruparPorEstrategia(filtrada);
    const container = $('#lista-estrategias-grupos');

    const chaves = Object.keys(grupos);
    if (chaves.length === 0) {
      container.innerHTML = '<div class="empty-state">Nenhuma oportunidade nessa categoria ainda.</div>';
      return;
    }

    container.innerHTML = chaves
      .map((nome) => {
        const ops = ordenarPorHorario(grupos[nome]);
        return `
        <h2 class="section-title">${escapeHtml(nome)} <span style="color:var(--text-2); font-weight:400;">(${ops.length})</span></h2>
        ${ops.map(cardHtml).join('')}
      `;
      })
      .join('');
  }

  $('#filter-categoria-row').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    filtroCategoriaAtual = chip.dataset.cat;
    $all('#filter-categoria-row .chip').forEach((c) => c.classList.toggle('active', c === chip));
    renderEstrategiasView();
  });

  $('#lista-estrategias-grupos').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const cardEl = e.target.closest('.opportunity-card');
    executarAcaoCard(btn.dataset.action, cardEl.dataset.id);
  });

  $('#btn-nova-estrategia').addEventListener('click', () => abrirModalEstrategia(null));

  // ---------------------------------------------------------------
  // Histórico / Estatísticas (view)
  // ---------------------------------------------------------------

  function linhaRanking(nome, item) {
    return `<div class="rank-row"><span>${escapeHtml(nome)}</span><span class="pct" style="color:${item.taxaAcerto >= 50 ? 'var(--green)' : 'var(--red)'}">${item.taxaAcerto.toFixed(1)}% (${item.green}G / ${item.red}R)</span></div>`;
  }

  function renderHistoricoView() {
    const lista = RadarStorage.getOpportunities();
    const resumo = RadarStats.resumoGeral(lista);

    $('#hist-total').textContent = resumo.total;
    $('#hist-taxa').textContent = `${resumo.taxaAcerto.toFixed(1)}%`;
    $('#hist-green').textContent = resumo.green;
    $('#hist-red').textContent = resumo.red;

    $('#hist-melhores').innerHTML = `
      ${linhaRanking('Melhor método', resumo.melhorMetodo || { taxaAcerto: 0, green: 0, red: 0 })}
      ${linhaRanking('Melhor estratégia', resumo.melhorEstrategia || { taxaAcerto: 0, green: 0, red: 0 })}
    `;

    const porMetodo = RadarStats.agruparEDesempenho(lista, 'metodo').sort((a, b) => b.total - a.total);
    $('#hist-por-metodo').innerHTML = porMetodo.length
      ? porMetodo.map((m) => linhaRanking(m.nome, m)).join('')
      : '<div style="color:var(--text-2); font-size:13px;">Sem dados ainda.</div>';

    const porEstrategia = RadarStats.agruparEDesempenho(lista, 'estrategia').sort((a, b) => b.total - a.total);
    $('#hist-por-estrategia').innerHTML = porEstrategia.length
      ? porEstrategia.map((m) => linhaRanking(m.nome, m)).join('')
      : '<div style="color:var(--text-2); font-size:13px;">Sem dados ainda.</div>';

    renderHistoricoPeriodo();

    const completa = ordenarPorHorario(lista).reverse();
    $('#hist-lista-completa').innerHTML = completa.length
      ? completa.map(cardHtml).join('')
      : '<div class="empty-state">Nenhuma oportunidade registrada ainda.</div>';
  }

  function renderHistoricoPeriodo() {
    const lista = RadarStorage.getOpportunities();
    const grupos = RadarStats.agruparPorPeriodo(lista, filtroPeriodoAtual).slice(-10);
    $('#hist-por-periodo').innerHTML = grupos.length
      ? grupos
          .map(
            (g) =>
              `<div class="rank-row"><span>${escapeHtml(g.periodo)}</span><span>${g.total} entrada(s) — <span style="color:var(--green)">${g.green}G</span> / <span style="color:var(--red)">${g.red}R</span></span></div>`
          )
          .join('')
      : '<div style="color:var(--text-2); font-size:13px;">Sem dados ainda.</div>';
  }

  $('#view-historico').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip[data-periodo]');
    if (chip) {
      filtroPeriodoAtual = chip.dataset.periodo;
      $all('#view-historico .chip[data-periodo]').forEach((c) => c.classList.toggle('active', c === chip));
      renderHistoricoPeriodo();
      return;
    }
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const cardEl = e.target.closest('.opportunity-card');
    if (cardEl && cardEl.dataset.id) executarAcaoCard(btn.dataset.action, cardEl.dataset.id);
  });

  // ---------------------------------------------------------------
  // Ajustes (view): notificações, métodos, estratégias, limpar dados
  // ---------------------------------------------------------------

  const CORES_DISPONIVEIS = ['#22c55e', '#ef4444', '#f59e0b', '#38bdf8', '#818cf8', '#f472b6', '#94a3b8', '#facc15'];

  function renderAjustesView() {
    const settings = RadarStorage.getSettings();
    $('#switch-notificacoes').classList.toggle('on', settings.notificacoesAtivas);

    const metodos = RadarStrategies.listarMetodos();
    $('#lista-metodos').innerHTML = metodos
      .map(
        (m) => `
      <div class="method-chip-edit" data-id="${m.id}">
        <div class="swatch" style="background:${m.cor}"></div>
        <div class="name">${m.icone || ''} ${escapeHtml(m.nome)}</div>
        <button class="btn" data-metodo-action="editar">EDITAR</button>
        <button class="btn btn-ghost" data-metodo-action="excluir">EXCLUIR</button>
      </div>`
      )
      .join('');

    const estrategias = RadarStrategies.listarEstrategias();
    $('#lista-estrategias-ajustes').innerHTML = estrategias
      .map(
        (s) => `
      <div class="method-chip-edit" data-id="${s.id}">
        <div class="swatch" style="background:${s.cor}"></div>
        <div class="name">${escapeHtml(s.nome)}</div>
        <button class="btn" data-estrategia-action="editar">EDITAR</button>
        <button class="btn btn-ghost" data-estrategia-action="excluir">EXCLUIR</button>
      </div>`
      )
      .join('');
  }

  $('#switch-notificacoes').addEventListener('click', async () => {
    const settings = RadarStorage.getSettings();
    if (!settings.notificacoesAtivas) {
      const permissao = await RadarAlerts.pedirPermissao();
      if (permissao !== 'granted') {
        mostrarToast('Permissão de notificação não concedida pelo navegador.');
        return;
      }
      RadarStorage.saveSettings({ notificacoesAtivas: true });
      RadarAlerts.iniciar();
      mostrarToast('Notificações ativadas');
    } else {
      RadarStorage.saveSettings({ notificacoesAtivas: false });
      RadarAlerts.parar();
      mostrarToast('Notificações desativadas');
    }
    renderAjustesView();
  });

  $('#btn-limpar-dados').addEventListener('click', () => {
    if (confirm('Isso vai apagar TODAS as oportunidades salvas neste dispositivo. Continuar?')) {
      RadarStorage.saveOpportunities([]);
      mostrarToast('Dados apagados');
      renderTudo();
    }
  });

  // ---- Métodos: criar/editar/excluir ----

  function popularCores(containerId, corAtual) {
    const container = $(`#${containerId}`);
    container.innerHTML = CORES_DISPONIVEIS.map(
      (c) => `<div class="sw ${c === corAtual ? 'selected' : ''}" style="background:${c}" data-cor="${c}"></div>`
    ).join('');
  }

  function corSelecionada(containerId) {
    const sel = $(`#${containerId} .sw.selected`);
    return sel ? sel.dataset.cor : CORES_DISPONIVEIS[0];
  }

  $('#metodo-cores').addEventListener('click', (e) => {
    const sw = e.target.closest('.sw');
    if (!sw) return;
    $all('#metodo-cores .sw').forEach((s) => s.classList.remove('selected'));
    sw.classList.add('selected');
  });

  $('#estrategia-cores').addEventListener('click', (e) => {
    const sw = e.target.closest('.sw');
    if (!sw) return;
    $all('#estrategia-cores .sw').forEach((s) => s.classList.remove('selected'));
    sw.classList.add('selected');
  });

  $('#btn-novo-metodo').addEventListener('click', () => abrirModalMetodo(null));

  function abrirModalMetodo(metodo) {
    $('#titulo-modal-metodo').textContent = metodo ? 'Editar método' : 'Novo método';
    $('#metodo-id').value = metodo ? metodo.id : '';
    $('#metodo-nome').value = metodo ? metodo.nome : '';
    $('#metodo-icone').value = metodo ? metodo.icone || '' : '⚙️';
    popularCores('metodo-cores', metodo ? metodo.cor : CORES_DISPONIVEIS[0]);
    abrirModal('modal-metodo');
  }

  $('#btn-salvar-metodo').addEventListener('click', () => {
    const id = $('#metodo-id').value;
    const nome = $('#metodo-nome').value.trim();
    const icone = $('#metodo-icone').value.trim();
    const cor = corSelecionada('metodo-cores');
    if (!nome) {
      mostrarToast('Digite um nome para o método');
      return;
    }
    if (id) {
      RadarStrategies.editarMetodo(id, { nome: nome.toUpperCase(), icone, cor });
    } else {
      RadarStrategies.criarMetodo(nome, cor, icone);
    }
    fecharModal('modal-metodo');
    renderAjustesView();
    mostrarToast('Método salvo');
  });

  $('#lista-metodos').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-metodo-action]');
    if (!btn) return;
    const wrap = e.target.closest('.method-chip-edit');
    const id = wrap.dataset.id;
    if (btn.dataset.metodoAction === 'editar') {
      const metodo = RadarStrategies.listarMetodos().find((m) => m.id === id);
      abrirModalMetodo(metodo);
    } else if (btn.dataset.metodoAction === 'excluir') {
      if (confirm('Excluir este método?')) {
        RadarStrategies.excluirMetodo(id);
        renderAjustesView();
      }
    }
  });

  // ---- Estratégias: criar/editar/excluir ----

  function abrirModalEstrategia(estrategia) {
    $('#titulo-modal-estrategia').textContent = estrategia ? 'Editar estratégia' : 'Nova estratégia';
    $('#estrategia-id').value = estrategia ? estrategia.id : '';
    $('#estrategia-nome').value = estrategia ? estrategia.nome : '';
    popularCores('estrategia-cores', estrategia ? estrategia.cor : CORES_DISPONIVEIS[3]);
    abrirModal('modal-estrategia');
  }

  $('#btn-nova-estrategia-ajustes').addEventListener('click', () => abrirModalEstrategia(null));

  $('#btn-salvar-estrategia').addEventListener('click', () => {
    const id = $('#estrategia-id').value;
    const nome = $('#estrategia-nome').value.trim();
    const cor = corSelecionada('estrategia-cores');
    if (!nome) {
      mostrarToast('Digite um nome para a estratégia');
      return;
    }
    if (id) {
      RadarStrategies.editarEstrategia(id, { nome, cor });
    } else {
      RadarStrategies.criarEstrategia(nome, cor);
    }
    fecharModal('modal-estrategia');
    renderAjustesView();
    mostrarToast('Estratégia salva');
  });

  $('#lista-estrategias-ajustes').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-estrategia-action]');
    if (!btn) return;
    const wrap = e.target.closest('.method-chip-edit');
    const id = wrap.dataset.id;
    if (btn.dataset.estrategiaAction === 'editar') {
      const estrategia = RadarStrategies.listarEstrategias().find((s) => s.id === id);
      abrirModalEstrategia(estrategia);
    } else if (btn.dataset.estrategiaAction === 'excluir') {
      if (confirm('Excluir esta estratégia?')) {
        RadarStrategies.excluirEstrategia(id);
        renderAjustesView();
      }
    }
  });

  // ---------------------------------------------------------------
  // Render geral (chamado após qualquer mudança de dados)
  // ---------------------------------------------------------------

  function renderTudo() {
    renderHeader();
    const viewAtiva = $('.view.active');
    if (viewAtiva) irParaView(viewAtiva.id);
  }

  // ---------------------------------------------------------------
  // Inicialização
  // ---------------------------------------------------------------

  function registrarServiceWorker() {
    if ('serviceWorker' in navigator) {
      // Só registra se estiver servindo via http(s) — evita erro ao abrir o
      // arquivo diretamente do disco (file://), onde Service Worker não roda.
      if (location.protocol === 'http:' || location.protocol === 'https:') {
        navigator.serviceWorker.register('service-worker.js').catch((err) => {
          console.warn('Service worker não registrado:', err);
        });
      }
    }
  }

  function init() {
    renderDashboard();
    const settings = RadarStorage.getSettings();
    if (settings.notificacoesAtivas && RadarAlerts.permissaoConcedida()) {
      RadarAlerts.iniciar();
    }
    // Atualiza a contagem regressiva da "próxima oportunidade" a cada minuto
    setInterval(() => {
      if ($('#view-radar').classList.contains('active')) renderDashboard();
    }, 60 * 1000);
    registrarServiceWorker();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
