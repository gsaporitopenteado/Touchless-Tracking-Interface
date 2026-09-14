/**
 * fake-firmware.js
 * ----------------------------------------------------------------------
 * Firmware FALSO para testar a interface sem o hardware.
 *
 * Expõe exatamente a mesma interface pública de ArduinoLink (serial.js):
 * `isSupported`, `isConnected`, `connect()`, `disconnect()` e os eventos
 * `connect` / `disconnect` / `data` / `error`. Por isso app.js trata os
 * dois de forma idêntica — só troca qual objeto está plugado.
 *
 * O ponto importante: este módulo NAO emite posições nem índices de
 * grade. Ele emite CONTAGENS BRUTAS, iguais em espírito às que o
 * arduino/totem/totem.ino imprime. Assim o teclado exercita todo o
 * pipeline real (Normalize -> MomentumAverage -> getPosition),
 * incluindo a calibração — e não um atalho que pula justamente a parte
 * que precisa ser testada.
 *
 * TECLADO
 *   ← / →   eixo X (horizontal)
 *   ↑ / ↓   eixo Y (vertical)
 *   w / s   eixo Z (afasta / aproxima a mão da placa Z)
 *
 * MODELO FÍSICO
 * A contagem do totem.ino cresce com a capacitância do nó, e a
 * capacitância cresce quando a mão se aproxima da placa. O Normalize.pde
 * desfaz isso com `sqrt(1 / normalized)`, o que implica que o autor
 * modelou capacitância ∝ 1/d². Usamos o mesmo modelo na direção
 * inversa:
 *
 *     raw(d) = BASELINE + SCALE / d²,   d = DMIN + u * (DMAX - DMIN)
 *
 * onde `u` é a "mão virtual" de 0 (encostada na placa) a 1 (longe).
 * DMAX = 2.6 foi escolhido para que, depois de uma varredura de
 * calibração completa, as três células da grade fiquem com faixas de
 * tamanho parecido (~28% / ~43% / ~30% do curso de `u`).
 * ----------------------------------------------------------------------
 */

const FAKE_SCALE = 24000;   // ganho da capacitância simulada
const FAKE_BASELINE = 1200; // capacitância parasita / ambiente
const FAKE_DMIN = 1.0;      // mão encostada na placa
const FAKE_DMAX = 2.6;      // mão fora do alcance útil
const FAKE_NOISE = 0.004;   // ±0.4% de ruído, para parecer um sensor real
const FAKE_STEP = 0.08;     // quanto cada tecla move a mão virtual
const FAKE_EMIT_MS = 100;   // ~10 Hz — mesma taxa do totem.ino real

// Direção que cada tecla imprime na mão virtual. Os sinais levam em conta
// o `flip = {false, true, false}` do sketch original, de forma que
// ArrowUp realmente sobe na tela e ArrowLeft realmente vai para a
// esquerda. Ver README para a dedução.
const FAKE_KEYMAP = {
  ArrowLeft:  { axis: 0, delta: -FAKE_STEP },
  ArrowRight: { axis: 0, delta: +FAKE_STEP },
  ArrowUp:    { axis: 1, delta: +FAKE_STEP },
  ArrowDown:  { axis: 1, delta: -FAKE_STEP },
  w:          { axis: 2, delta: +FAKE_STEP },
  s:          { axis: 2, delta: -FAKE_STEP },
};

class FakeArduinoLink extends EventTarget {
  constructor() {
    super();
    this.timer = null;
    // mão virtual começa no centro dos três eixos -> célula (1,1,1)
    this.u = [0.5, 0.5, 0.5];
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  get isSupported() {
    return true;
  }

  get isConnected() {
    return this.timer !== null;
  }

  async connect() {
    if (this.isConnected) return;
    window.addEventListener("keydown", this._onKeyDown);
    this.timer = setInterval(() => this._emit(), FAKE_EMIT_MS);
    this.dispatchEvent(new CustomEvent("connect"));
  }

  async disconnect() {
    if (!this.isConnected) return;
    window.removeEventListener("keydown", this._onKeyDown);
    clearInterval(this.timer);
    this.timer = null;
    this.dispatchEvent(new CustomEvent("disconnect"));
  }

  /** Devolve a mão virtual ao centro. */
  recenter() {
    this.u = [0.5, 0.5, 0.5];
  }

  _onKeyDown(event) {
    const mapping = FAKE_KEYMAP[event.key];
    if (!mapping) return;
    event.preventDefault();
    const { axis, delta } = mapping;
    this.u[axis] = Math.min(1, Math.max(0, this.u[axis] + delta));
  }

  /** raw(d) = BASELINE + SCALE / d², com ruído. */
  _rawFor(u) {
    const d = FAKE_DMIN + u * (FAKE_DMAX - FAKE_DMIN);
    const clean = FAKE_BASELINE + FAKE_SCALE / (d * d);
    const noise = 1 + (Math.random() * 2 - 1) * FAKE_NOISE;
    return Math.round(clean * noise);
  }

  _emit() {
    const raw = this.u.map((u) => this._rawFor(u));
    // mesmo payload que serial.js produz ao ler "12480 3312 7936"
    this.dispatchEvent(new CustomEvent("data", { detail: { raw } }));
  }

  /** Só para o HUD de depuração. */
  virtualHand() {
    return this.u.slice();
  }
}
