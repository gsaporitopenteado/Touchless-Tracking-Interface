/**
 * serial.js
 * ----------------------------------------------------------------------
 * Wrapper fino sobre a Web Serial API para conversar com o firmware do
 * Arduino (ver /firmware/touchless_interface/touchless_interface.ino).
 *
 * O firmware envia uma linha JSON por ciclo (~30ms):
 *   {"x":18.4,"y":9.2,"z":24.7,"moveH":"RIGHT","moveV":"NONE","gesture":"SELECT"}
 *
 * Linhas de depuração/calibração começam com '#' e são ignoradas aqui.
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
    if (line.startsWith("#")) {
      this.dispatchEvent(new CustomEvent("debug", { detail: line }));
      return;
    }
    if (!line.startsWith("{")) return;

    try {
      const data = JSON.parse(line);
      this.dispatchEvent(new CustomEvent("data", { detail: data }));
    } catch (err) {
      // linha corrompida (comum ao conectar no meio de um frame) — ignora
    }
  }
}
