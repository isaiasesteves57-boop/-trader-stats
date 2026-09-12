/**
 * ocr.js
 * Faz a leitura de imagens/prints usando Tesseract.js (carregado via CDN
 * em index.html) e devolve o texto bruto extraído. A interpretação do
 * texto (separar múltiplos jogos, identificar método/entrada) continua
 * sendo responsabilidade do parser.js — o OCR só entrega texto.
 *
 * IMPORTANTE: nenhuma oportunidade é salva automaticamente aqui.
 */

const RadarOCR = (() => {
  let workerPromise = null;

  function getWorker() {
    if (!window.Tesseract) {
      return Promise.reject(
        new Error(
          'Tesseract.js não carregou. Verifique sua conexão com a internet (o OCR é carregado via CDN).'
        )
      );
    }
    if (!workerPromise) {
      workerPromise = window.Tesseract.createWorker('por', 1, {
        logger: () => {}, // silencioso; progresso é reportado via callback do reconhecimento abaixo
      });
    }
    return workerPromise;
  }

  /**
   * Pré-processa a imagem em um canvas para melhorar a leitura do OCR:
   * aumenta contraste e converte para escala de cinza. Recebe um
   * File/Blob ou um dataURL e devolve um dataURL processado.
   */
  function preprocessImage(fileOrDataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          // Limita o maior lado a 2000px para não estourar memória em prints grandes
          const maxSide = 2000;
          let { width, height } = img;
          if (width > maxSide || height > maxSide) {
            const scale = maxSide / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          const imageData = ctx.getImageData(0, 0, width, height);
          const data = imageData.data;
          for (let i = 0; i < data.length; i += 4) {
            const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            // aumenta contraste em torno do ponto médio
            const contrasted = Math.min(255, Math.max(0, (gray - 128) * 1.35 + 128));
            data[i] = data[i + 1] = data[i + 2] = contrasted;
          }
          ctx.putImageData(imageData, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('Não foi possível carregar a imagem selecionada.'));

      if (typeof fileOrDataUrl === 'string') {
        img.src = fileOrDataUrl;
      } else {
        const reader = new FileReader();
        reader.onload = (e) => {
          img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('Falha ao ler o arquivo de imagem.'));
        reader.readAsDataURL(fileOrDataUrl);
      }
    });
  }

  /**
   * Recebe um File (input type=file) ou dataURL, roda OCR e devolve
   * { textoBruto, dataUrlProcessado }.
   */
  async function readImage(fileOrDataUrl, onProgress) {
    const processedDataUrl = await preprocessImage(fileOrDataUrl);
    const worker = await getWorker();

    if (onProgress) onProgress(10);

    const result = await worker.recognize(processedDataUrl);

    if (onProgress) onProgress(100);

    return {
      textoBruto: result && result.data ? result.data.text : '',
      dataUrlProcessado: processedDataUrl,
    };
  }

  async function terminate() {
    if (workerPromise) {
      const worker = await workerPromise;
      await worker.terminate();
      workerPromise = null;
    }
  }

  return { readImage, terminate, preprocessImage };
})();
