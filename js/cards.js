/**
 * cards.js
 * Gera o card visual da oportunidade (canvas -> PNG), monta o texto
 * pronto para copiar, e cuida de copiar/baixar/compartilhar.
 */

const RadarCards = (() => {
  const W = 1080;
  const H = 1350;

  function statusColor(status) {
    switch ((status || '').toUpperCase()) {
      case 'GREEN':
        return '#22c55e';
      case 'RED':
        return '#ef4444';
      case 'ENTROU':
        return '#38bdf8';
      case 'CANCELADA':
        return '#64748b';
      default:
        return '#f59e0b'; // AGUARDANDO
    }
  }

  function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = (text || '').split(' ');
    let line = '';
    let currentY = y;
    const lines = [];
    words.forEach((word) => {
      const testLine = line ? `${line} ${word}` : word;
      if (ctx.measureText(testLine).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = testLine;
      }
    });
    if (line) lines.push(line);
    lines.forEach((l, i) => ctx.fillText(l, x, currentY + i * lineHeight));
    return lines.length * lineHeight;
  }

  /**
   * Desenha o card da oportunidade em um canvas novo e devolve o canvas.
   */
  function renderCard(op) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // fundo com leve degradê escuro
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0b1220');
    bg.addColorStop(1, '#05070d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // moldura sutil
    ctx.strokeStyle = 'rgba(34,197,94,0.35)';
    ctx.lineWidth = 4;
    ctx.strokeRect(24, 24, W - 48, H - 48);

    // cabeçalho
    ctx.fillStyle = '#22c55e';
    ctx.font = '600 34px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('📡 RADAR DE OPORTUNIDADE', W / 2, 130);

    ctx.strokeStyle = 'rgba(148,163,184,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(80, 165);
    ctx.lineTo(W - 80, 165);
    ctx.stroke();

    // confronto
    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 56px "Segoe UI", Arial, sans-serif';
    const jogo = (op.jogo || `${op.timeCasa || ''} x ${op.timeVisitante || ''}`).toUpperCase();
    let y = 260;
    y += wrapText(ctx, `⚽ ${jogo}`, W / 2, y, W - 140, 64) - 64;
    y += 60;

    if (op.campeonato) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '400 28px "Segoe UI", Arial, sans-serif';
      ctx.fillText(op.campeonato, W / 2, y);
      y += 60;
    }

    function bloco(label, valor, cor, tamanho) {
      ctx.fillStyle = cor || '#94a3b8';
      ctx.font = '600 30px "Segoe UI", Arial, sans-serif';
      ctx.fillText(label, W / 2, y);
      y += 50;
      ctx.fillStyle = '#f8fafc';
      ctx.font = `700 ${tamanho || 40}px "Segoe UI", Arial, sans-serif`;
      y += wrapText(ctx, (valor || '—').toUpperCase(), W / 2, y, W - 160, (tamanho || 40) + 10);
      y += 55;
    }

    bloco('🎯 MÉTODO', op.metodo, '#38bdf8', 38);
    bloco('✅ ENTRADA', op.entrada, '#22c55e', 46);
    bloco('⏰ HORÁRIO', op.horario, '#f8fafc', 44);

    // status como selo
    const cor = statusColor(op.status);
    const seloY = y + 10;
    ctx.font = '700 32px "Segoe UI", Arial, sans-serif';
    const texto = `📌 ${(op.status || 'AGUARDANDO').toUpperCase()}`;
    const largura = ctx.measureText(texto).width + 60;
    ctx.fillStyle = cor;
    roundRect(ctx, W / 2 - largura / 2, seloY, largura, 64, 32);
    ctx.fill();
    ctx.fillStyle = '#0b1220';
    ctx.fillText(texto, W / 2, seloY + 42);

    // rodapé
    ctx.fillStyle = '#475569';
    ctx.font = '400 22px "Segoe UI", Arial, sans-serif';
    ctx.fillText('Organização pessoal de trading esportivo — sem garantia de resultado', W / 2, H - 60);

    return canvas;
  }

  function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
  }

  function buildCardText(op) {
    const jogo = op.jogo || `${op.timeCasa || ''} x ${op.timeVisitante || ''}`;
    return [
      '📡 RADAR DE OPORTUNIDADE',
      '',
      `⚽ ${jogo}`,
      '',
      '🎯 MÉTODO:',
      (op.metodo || '—').toUpperCase(),
      '',
      '✅ ENTRADA:',
      (op.entrada || '—').toUpperCase(),
      '',
      `⏰ HORÁRIO:`,
      op.horario || '—',
      '',
      '📌 STATUS:',
      (op.status || 'AGUARDANDO').toUpperCase(),
    ].join('\n');
  }

  async function copyCardText(op) {
    const texto = buildCardText(op);
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch (err) {
      // fallback para navegadores sem permissão de clipboard
      const textarea = document.createElement('textarea');
      textarea.value = texto;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (e) {
        ok = false;
      }
      document.body.removeChild(textarea);
      if (!ok) throw err;
      return true;
    }
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  function downloadCardImage(canvas, op) {
    const link = document.createElement('a');
    const nomeArquivo = `radar_${(op.jogo || 'oportunidade').replace(/[^a-z0-9]+/gi, '_').toLowerCase()}.png`;
    link.download = nomeArquivo;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  async function shareCard(canvas, op) {
    const texto = buildCardText(op);
    const blob = await canvasToBlob(canvas);
    const file = new File([blob], 'radar_oportunidade.png', { type: 'image/png' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: 'Radar de Oportunidade',
        text: texto,
      });
      return 'compartilhado';
    }
    if (navigator.share) {
      await navigator.share({ title: 'Radar de Oportunidade', text: texto });
      return 'compartilhado_texto';
    }
    return 'sem_suporte';
  }

  return { renderCard, buildCardText, copyCardText, downloadCardImage, shareCard };
})();
