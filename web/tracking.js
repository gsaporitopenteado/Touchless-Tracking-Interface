/**
 * tracking.js
 * ----------------------------------------------------------------------
 * Porte 1:1 da lógica de rastreamento do sketch Processing
 * TicTacToe3D (Kyle McDonald / DIY 3D Controller).
 *
 * Arquivos de origem:
 *   TicTacToe3D/Normalize.pde        -> class Normalize
 *   TicTacToe3D/MomentumAverage.pde  -> class MomentumAverage
 *   TicTacToe3D/TicTacToe3D.pde      -> getPosition() e updateSerial()
 *
 * A matemática aqui NAO foi alterada, "corrigida" nem reajustada: ela é
 * uma tradução literal de Java/Processing para JavaScript, porque é essa
 * versão que já foi validada no hardware real. Qualquer coisa que pareça
 * estranha (o `(int) x * div`, o `return 1` quando normalized == 0, os
 * dois filtros com taxas diferentes) está assim de propósito.
 *
 * O firmware (arduino/totem/totem.ino) permanece intocado: ele envia
 * apenas três contagens brutas por linha, e toda a calibração/mapeamento
 * acontece aqui, exatamente como acontecia no Processing.
 * ----------------------------------------------------------------------
 */

// --- equivalentes das funções globais do Processing --------------------

// Processing map(): interpolação linear SEM limitar o resultado.
function pmap(value, start1, stop1, start2, stop2) {
  return start2 + (stop2 - start2) * ((value - start1) / (stop1 - start1));
}

// Processing constrain()
function pconstrain(amt, low, high) {
  return amt < low ? low : amt > high ? high : amt;
}

// ----------------------------------------------------------------------
// Normalize.pde (verbatim)
//
//   boolean linear = true;
//   float minDistance = 1, maxDistance = 4;
// ----------------------------------------------------------------------
const LINEAR = true;
const MIN_DISTANCE = 1;
const MAX_DISTANCE = 4;

class Normalize {
  constructor() {
    this.reset();
  }

  note(x) {
    if (x < this.min) this.min = x;
    if (x > this.max) this.max = x;
  }

  normalize(x) {
    if (this.min === this.max || this.min === Number.POSITIVE_INFINITY) return 0;
    const n = pmap(x, this.min, this.max, 0, 1);
    return pconstrain(n, 0, 1);
  }

  linear(x) {
    const normalized = this.normalize(x);
    if (normalized === 0) return 1;
    let linear = Math.sqrt(1 / normalized);
    linear = pmap(linear, MIN_DISTANCE, MAX_DISTANCE, 0, 1);
    return pconstrain(linear, 0, 1);
  }

  choose(x) {
    return LINEAR ? this.linear(x) : this.normalize(x);
  }

  reset() {
    this.min = Number.POSITIVE_INFINITY;
    this.max = Number.NEGATIVE_INFINITY;
  }
}

// ----------------------------------------------------------------------
// MomentumAverage.pde (verbatim)
// ----------------------------------------------------------------------
class MomentumAverage {
  constructor(adapt) {
    this.adapt = adapt;
    this.reset();
  }

  note(x) {
    if (x === Number.POSITIVE_INFINITY) return;
    else this.avg = this.avg * (1 - this.adapt) + x * this.adapt;
  }

  reset() {
    this.avg = 0;
  }
}

// ----------------------------------------------------------------------
// TicTacToe3D.pde — constantes e getPosition() (verbatim)
// ----------------------------------------------------------------------
const SEN = 3; // sensors
const DIV = 3; // board sub divisions

// flip = {false, true, false} — o eixo Y é invertido em relação a X e Z
const FLIP = [false, true, false];

const CUTOFF = 0.2;

// Span mínimo (max - min, em contagens) para considerar um eixo calibrado
// (ver isCalibrated abaixo — acréscimo nosso, não vem do sketch).
//
// Até então isto era uma RAZÃO max/min >= 1.5, que só passava com o
// firmware falso (1200 a 25200 contagens). No totem.ino real ~98% da
// contagem é offset fixo e a mão mexe nos ~2% restantes: as razões
// medidas na bancada são 1.027 / 1.019 / 1.015, então a placa real nunca
// calibrava. Span absoluto não tem esse problema, porque o offset sai na
// subtração. Na bancada: ruído pico-a-pico 24 / 74 / 48 e span do gesto
// 373 / 238 / 190. 120 fica acima do maior ruído e abaixo do menor span
// (é a mesma constante SPAN_MIN_CALIBRACAO do FitExpress em Processing).
const MIN_CALIBRATION_SPAN = 120;

// Leituras cruas por clique nos botões − / + do HUD (~1 s a 10 Hz).
const CALIB_SAMPLES = 10;

function getPosition(x) {
  if (DIV === 3) {
    if (x < CUTOFF) return 0;
    if (x < 1 - CUTOFF) return 1;
    else return 2;
  } else {
    // NOTA: no original em Java o cast liga mais forte que a multiplicação,
    // ou seja `((int) x) * div`. Mantido idêntico de propósito — com
    // div == 3 este ramo nunca executa.
    return x === 1 ? DIV - 1 : Math.trunc(x) * DIV;
  }
}

// ----------------------------------------------------------------------
// Pipeline — equivalente ao updateSerial() + setup() do sketch
// ----------------------------------------------------------------------
class Tracker extends EventTarget {
  constructor() {
    super();

    this.n = [];
    this.cama = [];
    this.axyz = [];
    for (let i = 0; i < SEN; i++) {
      this.n[i] = new Normalize();
      this.cama[i] = new MomentumAverage(0.01);
      this.axyz[i] = new MomentumAverage(0.15);
    }

    this.nxyz = new Array(SEN).fill(0);
    this.ixyz = new Array(SEN).fill(0);
    this.raw = new Array(SEN).fill(0);

    // Equivalente a `mousePressed && mouseButton == LEFT` no Processing:
    // enquanto isto for true, os limites (min/max) são aprendidos.
    this.calibrating = false;

    // Amostragem de um limite só (botões − / + do HUD):
    // { axis, bound: "min" | "max", sum, count } ou null.
    this.sampling = null;
  }

  /**
   * Um quadro de leituras brutas do firmware.
   * Espelha updateSerial() linha por linha.
   */
  update(xyz) {
    if (!xyz || xyz.length !== SEN) return;

    this.raw = xyz.slice();

    // if(mousePressed && mouseButton == LEFT)
    //   for(int i = 0; i < sen; i++) n[i].note(xyz[i]);
    if (this.calibrating) {
      for (let i = 0; i < SEN; i++) this.n[i].note(xyz[i]);
    }

    // acréscimo nosso: amostragem dos botões − / +
    if (this.sampling) this.addSample(xyz[this.sampling.axis]);

    this.nxyz = new Array(SEN).fill(0);
    for (let i = 0; i < SEN; i++) {
      const raw = this.n[i].choose(xyz[i]);
      this.nxyz[i] = FLIP[i] ? 1 - raw : raw;
      this.cama[i].note(this.nxyz[i]);
      this.axyz[i].note(this.nxyz[i]);
      this.ixyz[i] = getPosition(this.axyz[i].avg);
    }

    this.dispatchEvent(new CustomEvent("frame", { detail: this.snapshot() }));
  }

  snapshot() {
    return {
      raw: this.raw.slice(),
      nxyz: this.nxyz.slice(),
      // valores suavizados usados para gerar os índices
      smooth: this.axyz.map((m) => m.avg),
      camera: this.cama.map((m) => m.avg),
      ixyz: this.ixyz.slice(),
      calibrating: this.calibrating,
      sampling: this.sampling
        ? { axis: this.sampling.axis, bound: this.sampling.bound, count: this.sampling.count }
        : null,
    };
  }

  /**
   * Verdadeiro quando os três eixos já viram uma faixa min/max utílizável.
   *
   * Isto NÃO faz parte do porte — o sketch original nunca precisou saber
   * se estava calibrado, porque quem olhava a tela decidia isso. Aqui a
   * interface precisa de um portão ("já pode começar o pedido?"), então
   * exigimos uma variação mínima: só `min !== max` não serve, porque o
   * ruído do sensor garante valores diferentes mesmo com a mão parada.
   * O span mínimo (MIN_CALIBRATION_SPAN) separa uma varredura real de um
   * botão apertado sem mover a mão.
   */
  get isCalibrated() {
    return this.n.every(
      (norm) =>
        norm.min !== Number.POSITIVE_INFINITY &&
        norm.min > 0 &&
        norm.max - norm.min >= MIN_CALIBRATION_SPAN
    );
  }

  startCalibration() {
    this.sampling = null; // a varredura substitui a amostragem em curso
    this.calibrating = true;
    this.dispatchEvent(new CustomEvent("calibration", { detail: true }));
  }

  stopCalibration() {
    this.calibrating = false;
    this.dispatchEvent(new CustomEvent("calibration", { detail: false }));
  }

  /** Equivalente ao reset() do sketch (botão direito do mouse). */
  reset() {
    this.sampling = null;
    for (let i = 0; i < SEN; i++) {
      this.n[i].reset();
      this.cama[i].reset();
      this.axyz[i].reset();
    }
    this.nxyz = new Array(SEN).fill(0);
    this.ixyz = new Array(SEN).fill(0);
    this.dispatchEvent(new CustomEvent("calibration", { detail: this.calibrating }));
  }

  /** Faixa aprendida por eixo — só para exibição no painel. */
  bounds() {
    return this.n.map((norm) => ({ min: norm.min, max: norm.max }));
  }
}

// ----------------------------------------------------------------------
// Recalibração por eixo com o site rodando (botões − / + do HUD)
//
// Acréscimo nosso, não vem do sketch. Cada clique tira a MÉDIA de
// CALIB_SAMPLES leituras cruas de um eixo e grava no min (−, mão longe
// da placa) ou no max (+, mão encostada). Contagem crua, sem FLIP: em todo
// eixo ela SOBE quando a mão se aproxima.
//
// Média e não pico, ao contrário da varredura (Normalize.note guarda o
// extremo de ruído, o que alarga a faixa em ~ruído pico-a-pico). A média
// de 10 leituras corta o desvio em ~3x.
//
// Um limite que deixaria o span abaixo de MIN_CALIBRATION_SPAN é RECUSADO
// e a calibração anterior fica intacta — é o que acontece ao apertar +
// com a mão longe por engano. Sem o outro limite (logo depois de
// "Reiniciar calibração") qualquer valor é aceito.
//
// Eventos: "sample" com { axis, bound, mean, accepted, span } ao terminar;
// "calibration" também, quando o limite foi aceito, para quem já escuta
// mudanças de calibração (dica da tela inicial, portão do pedido).
// ----------------------------------------------------------------------
Tracker.prototype.startSampling = function (axis, bound) {
  if (this.calibrating) return false;
  this.sampling = { axis, bound, sum: 0, count: 0 };
  return true;
};

Tracker.prototype.cancelSampling = function () {
  this.sampling = null;
};

Tracker.prototype.addSample = function (value) {
  const s = this.sampling;
  s.sum += value;
  s.count++;
  if (s.count < CALIB_SAMPLES) return;

  this.sampling = null;
  const result = this.applySample(s.axis, s.bound, s.sum / s.count);
  this.dispatchEvent(new CustomEvent("sample", { detail: result }));
  if (result.accepted) {
    this.dispatchEvent(new CustomEvent("calibration", { detail: this.calibrating }));
  }
};

Tracker.prototype.applySample = function (axis, bound, mean) {
  const norm = this.n[axis];
  const other = bound === "max" ? norm.min : norm.max;
  const result = { axis, bound, mean, accepted: true, span: null };

  if (Number.isFinite(other)) {
    result.span = bound === "max" ? mean - other : other - mean;
    if (result.span < MIN_CALIBRATION_SPAN) {
      result.accepted = false;
      return result;
    }
  }
  norm[bound] = mean;
  return result;
};
