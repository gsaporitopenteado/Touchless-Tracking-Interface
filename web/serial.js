/**
 * serial.js
 * ----------------------------------------------------------------------
 * Wrapper fino sobre a Web Serial API para conversar com o firmware
 * ORIGINAL e NÃO modificado do Arduino (ver /firmware/_3DInterface/).
 *
 * Esse firmware manda uma linha de texto por ciclo, com os 3 valores
 * brutos do timer capacitivo separados por espaço (sem JSON):
 *
 *     "1234 5678 910\n"
 *
 * A normalização/calibração desses valores brutos (min/max por eixo) e a
 * conversão para posição discreta acontecem em sensors.js — este arquivo
 * só entrega {x, y, z} brutos para quem estiver ouvindo o evento "data".
 *
 * Requisitos do navegador: Chrome/Edge (desktop) com Web Serial API,
 * servido via http://localhost ou https:// (contexto seguro).
 * ----------------------------------------------------------------------
 */

class ArduinoLink extends EventTarget {
  constructor() {
    super();
    this.port = null;
    this.reader = null;
    this.keepReading = false;
    this.lineBuffer = "";
  }

  get isSupported() {
    return "serial" in navigator;
  }

  get isConnected() {
    return !!this.port;
  }

  async connect(baudRate = 115200) {
    if (!this.isSupported) {
      throw new Error(
        "Web Serial API não disponível neste navegador. Use Chrome ou Edge."
      );
    }

    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate });

    this.keepReading = true;
    this._readLoop(); // não aguardamos — roda em background

    this.dispatchEvent(new CustomEvent("connect"));
  }

  async disconnect() {
    this.keepReading = false;

    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch (_) {
        /* ignora */
      }
    }

    if (this.port) {
      try {
        await this.port.close();
      } catch (_) {
        /* ignora */
      }
    }

    this.port = null;
    this.reader = null;
    this.dispatchEvent(new CustomEvent("disconnect"));
  }

  async _readLoop() {
    const textDecoder = new TextDecoderStream();
    const readableClosed = this.port.readable.pipeTo(textDecoder.writable);
    this.reader = textDecoder.readable.getReader();

    try {
      while (this.keepReading) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) this._handleChunk(value);
      }
    } catch (err) {
      this.dispatchEvent(new CustomEvent("error", { detail: err }));
    } finally {
      try {
        this.reader.releaseLock();
      } catch (_) {
        /* ignora */
      }
      await readableClosed.catch(() => {});
    }
  }

  _handleChunk(chunk) {
    this.lineBuffer += chunk;
    let newlineIndex;
    while ((newlineIndex = this.lineBuffer.indexOf("\n")) >= 0) {
      const line = this.lineBuffer.slice(0, newlineIndex).trim();
      this.lineBuffer = this.lineBuffer.slice(newlineIndex + 1);
      if (line) this._handleLine(line);
    }
  }

  _handleLine(line) {
    // formato esperado: "<int> <int> <int>" (x y z brutos, nessa ordem —
    // pinos 8/9/10 no firmware original)
    const parts = line.split(/\s+/);
    if (parts.length !== 3) return;

    const x = Number(parts[0]);
    const y = Number(parts[1]);
    const z = Number(parts[2]);
    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) return;

    this.dispatchEvent(new CustomEvent("data", { detail: { x, y, z } }));
  }
}
