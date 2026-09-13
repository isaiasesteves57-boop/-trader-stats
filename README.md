# Radar de Oportunidades — Trader Stats

App web (PWA) para organizar oportunidades de trading esportivo: cadastro
manual, colar texto (várias oportunidades de uma vez), leitura de
imagem/print via OCR, alertas, gerador de card compartilhável, filtros,
histórico e estatísticas.

## Como rodar

Este projeto é 100% front-end (HTML + CSS + JS puro, sem build step).

**Importante:** para o Service Worker (PWA) e o OCR funcionarem
corretamente, sirva os arquivos por HTTP — não abra `index.html`
diretamente do disco (`file://`). Duas formas simples:

- **GitHub Pages** (recomendado, já que o projeto vai para o repositório
  `trader-stats`): coloque estes arquivos na raiz do repositório (ou na
  pasta que você já usa para o Pages) e ative o GitHub Pages nas
  configurações do repositório.
- **Localmente**, para testar antes de subir:
  ```bash
  cd trader-stats
  python3 -m http.server 8080
  # depois abra http://localhost:8080
  ```

## Estrutura de arquivos

```
trader-stats/
  index.html
  style.css
  app.js
  manifest.json
  service-worker.js
  README.md
  assets/
    icons/
      icon-192.png
      icon-512.png
      icon-maskable-512.png
  js/
    storage.js      -> persistência (localStorage)
    parser.js        -> interpreta texto colado / texto de OCR
    ocr.js            -> leitura de imagem via Tesseract.js
    cards.js          -> gerador de card (canvas), copiar/baixar/compartilhar
    alerts.js         -> alertas/notificações antes do horário
    strategies.js     -> CRUD de métodos e estratégias
    stats.js          -> cálculo de estatísticas e histórico
```

Se o seu repositório `trader-stats` já tem outros arquivos, basta colar
esta pasta por cima (nenhum nome de arquivo aqui deveria colidir com um
projeto diferente; se colidir, me avise qual e eu ajusto).

## O que já está implementado e funcionando

- Cadastro manual completo (data, horário, campeonato, times, método,
  estratégia, entrada, confiança, observação, alerta, status).
- Colar texto com uma ou várias oportunidades — interpretação automática
  (times, horário, método, entrada, percentual), com tela de revisão
  antes de salvar (SALVAR TODAS ou SALVAR INDIVIDUALMENTE).
- Leitura de imagem/print via OCR (Tesseract.js), com pré-processamento
  (escala de cinza + contraste), também caindo na mesma tela de revisão
  — nunca salva OCR automaticamente.
- Gerenciar métodos e estratégias (criar/editar/excluir, cor, ícone).
- Filtros por hoje/amanhã/status na tela principal, e por
  favoritos/zebras/lay/back/outras na tela de Estratégias.
- Alertas configuráveis (5/10/15/30min, 1h) via Notification API do
  navegador.
- Gerador de card visual (canvas → PNG) com os dados exatos da
  oportunidade selecionada, botões Copiar texto / Baixar PNG /
  Compartilhar (Web Share API quando disponível).
- Histórico e estatísticas: total, GREEN/RED, taxa de acerto, melhor
  método, melhor estratégia, desempenho por método/estratégia e por
  dia/semana/mês.
- Persistência via `localStorage` — os dados continuam lá após recarregar
  a página. O módulo `storage.js` isola toda a leitura/escrita, então
  trocar para um banco em nuvem no futuro significa reescrever só esse
  arquivo.
- PWA instalável (manifest + service worker + ícones).
- Navegação inferior no celular (Radar / Entrada / Estratégias /
  Histórico / Ajustes).

## Limitações que você precisa saber (nada escondido)

1. **OCR depende de internet.** O `index.html` carrega o Tesseract.js de
   um CDN (`cdn.jsdelivr.net`) — sem internet, a leitura de imagem não
   funciona, mas o resto do app continua normal (cadastro manual e
   colar texto funcionam offline).
2. **Alertas só disparam com o app aberto** (pode estar em segundo
   plano, mas não fechado). Isso porque é um app 100% front-end, sem
   servidor de push. Para alerta mesmo com o app fechado seria
   necessário um backend com Web Push — o código já isola essa lógica
   em `alerts.js` para facilitar essa evolução depois, se você quiser.
3. **O parser de texto/OCR é baseado em padrões** ("Time x Time - HH:MM
   (pct/pct)" + "Lay/Back ao Time", ou o formato rotulado "Campo:
   valor"). Ele cobre os formatos do seu briefing e variações razoáveis,
   mas textos muito diferentes do esperado podem exigir edição manual
   na tela de revisão — por isso ela sempre aparece antes de salvar.
4. **Ícones do PWA são placeholders simples** (gerados programaticamente,
   tema radar/verde). Troque os arquivos em `assets/icons/` por uma arte
   sua quando quiser, mantendo os mesmos nomes/tamanhos.

## Teste rápido sugerido

1. Abra o app → "+ NOVA OPORTUNIDADE" → "DIGITAR MANUALMENTE" → cadastre
   Santos x Palmeiras, 16:00, BAK FAVORITO, A FAVOR PALMEIRAS,
   AGUARDANDO.
2. Na lista, toque "GERAR CARD" → confira o card → "📋 Copiar" → cole em
   qualquer lugar para conferir o texto.
3. "+ NOVA OPORTUNIDADE" → "COLAR TEXTO" → cole o exemplo de 3 jogos do
   briefing → "Interpretar texto" → confirme que aparecem 3 cards
   separados na revisão → "SALVAR TODAS".
4. Recarregue a página (F5) → confirme que tudo continua lá.
5. Em Ajustes, ative as notificações e cadastre uma oportunidade daqui a
   poucos minutos com alerta "5 minutos antes" para ver a notificação
   chegar.
