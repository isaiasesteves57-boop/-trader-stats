/**
 * alerts.js
 * Verifica periodicamente as oportunidades pendentes e dispara uma
 * notificação do navegador quando está perto do horário configurado.
 *
 * LIMITAÇÃO IMPORTANTE (documentada para o usuário):
 * este é um app 100% front-end, sem servidor de push. Os alertas só
 * disparam enquanto o navegador/app estiver aberto (pode estar em
 * segundo plano, mas não pode estar fechado). Para alertas mesmo com
 * o app fechado seria necessário um backend com Web Push — a estrutura
 * abaixo já isola essa lógica em um módulo próprio para facilitar essa
 * evolução futura.
 */

const RadarAlerts = (() => {
  let intervalId = null;
  const CHECK_INTERVAL_MS = 20 * 1000;

  function permissaoConcedida() {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted';
  }

  async function pedirPermissao() {
    if (typeof Notification === 'undefined') return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    return await Notification.requestPermission();
  }

  function parseDataHorario(op) {
    // op.data no formato AAAA-MM-DD (input type=date) ou vazio (assume hoje)
    // op.horario no formato HH:MM
    if (!op.horario) return null;
    const [h, m] = op.horario.split(':').map((n) => parseInt(n, 10));
    if (Number.isNaN(h) || Number.isNaN(m)) return null;

    const base = op.data ? new Date(`${op.data}T00:00:00`) : new Date();
    base.setHours(h, m, 0, 0);
    return base;
  }

  function minutosDoAlerta(op) {
    if (!op.alertaMin) return null;
    if (op.alertaMin === 'nenhum') return null;
    const n = parseInt(op.alertaMin, 10);
    return Number.isNaN(n) ? null : n;
  }

  function dispararNotificacao(op) {
    const titulo = '🚨 RADAR DE OPORTUNIDADES';
    const corpo = [
      `Faltam ${minutosDoAlerta(op)} minutos`,
      op.jogo || `${op.timeCasa} x ${op.timeVisitante}`,
      `Método: ${op.metodo || '—'}`,
      `Entrada: ${op.entrada || '—'}`,
      `Horário: ${op.horario || '—'}`,
    ].join('\n');

    if (permissaoConcedida()) {
      const notif = new Notification(titulo, {
        body: corpo,
        tag: `radar-${op.id}`,
        icon: 'assets/icons/icon-192.png',
      });
      notif.onclick = () => {
        window.focus();
        if (window.RadarApp && window.RadarApp.abrirOportunidade) {
          window.RadarApp.abrirOportunidade(op.id);
        }
        notif.close();
      };
    }
  }

  function verificarAlertas() {
    if (!window.RadarStorage) return;
    const agora = new Date();
    const lista = RadarStorage.getOpportunities();
    let algumaAlterada = false;

    lista.forEach((op) => {
      if (op.alertaDisparado) return;
      if (op.status !== 'AGUARDANDO') return;

      const minAntes = minutosDoAlerta(op);
      const horarioOp = parseDataHorario(op);
      if (!minAntes || !horarioOp) return;

      const disparoEm = new Date(horarioOp.getTime() - minAntes * 60 * 1000);
      if (agora >= disparoEm && agora < horarioOp) {
        dispararNotificacao(op);
        op.alertaDisparado = true;
        algumaAlterada = true;
      }
    });

    if (algumaAlterada) {
      RadarStorage.saveOpportunities(lista);
    }
  }

  function iniciar() {
    if (intervalId) return;
    verificarAlertas();
    intervalId = setInterval(verificarAlertas, CHECK_INTERVAL_MS);
  }

  function parar() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  return { pedirPermissao, permissaoConcedida, iniciar, parar, verificarAlertas, parseDataHorario };
})();
