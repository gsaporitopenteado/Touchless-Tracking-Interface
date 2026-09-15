/**
 * sensors.js
 * ----------------------------------------------------------------------
 * Porta fiel, em JavaScript, do algoritmo de calibração/normalização e do
 * getPosition() usados no sketch Processing original do projeto
 * https://github.com/Make-Magazine/3DInterface (arquivos Normalize.pde,
 * MomentumAverage.pde e TicTacToe3D.pde).
 *
 * Motivo: o firmware do Arduino (_3DInterface.ino) é usado SEM modificação
 * e só manda os 3 valores brutos do timer capacitivo por linha:
 *
 *     "<bruto X> <bruto Y> <bruto Z>\n"
 *
 * Esses valores brutos não têm escala fixa (dependem da placa, do cabo, do
 * ambiente) — por isso o projeto original calibra em tempo real: guarda o
 * mínimo e o máximo já vistos em cada eixo (classe Normalize) e usa esses
 * limites para converter a leitura bruta em um valor normalizado de 0 a 1.
 * Essa é exatamente a mesma técnica usada aqui.
 * ----------------------------------------------------------------------
 */

// ---------------------------------------------------------------------
// Normalize — equivalente a Normalize.pde
// ---------------------------------------------------------------------
class Normalize {
  constructor() {
    this.reset();
  }

  reset() {
    this.min = Infinity;
    this.max = -Infinity;
  }

  /** Registra uma leitura bruta durante a calibração (amplia min/max). */
  note(x) {
    if (x < this.min) this.min = x;
    if (x > this.max) this.max = x;
  }

  /** Define min/max diretamente (calibração feita fora do navegador, ex.: Processing). */
  setRange(min, max) {
    this.min = min;
    this.max = max;
  }

  get isCalibrated() {
    return isFinite(this.min) && isFinite(this.max) && this.min !== this.max;
  }

  /** Converte uma leitura bruta em 0..1 usando os limites calibrados. */
  normalize(x) {
    if (!this.isCalibrated) return 0;
    const n = (x - this.min) / (this.max - this.min);
    return Math.min(1, Math.max(0, n));
  }
}

// ---------------------------------------------------------------------
// MomentumAverage — equivalente a MomentumAverage.pde (média móvel exponencial)
// ---------------------------------------------------------------------
class MomentumAverage {
  constructor(adapt) {
    this.adapt = adapt;
    this.reset();
  }

  reset() {
    this.avg = 0;
  }

  note(x) {
    if (!isFinite(x)) return;
    this.avg = this.avg * (1 - this.adapt) + x * this.adapt;
  }
}

// ---------------------------------------------------------------------
// getPosition — equivalente a getPosition() do TicTacToe3D.pde
// ---------------------------------------------------------------------
// Divide o eixo normalizado (0..1) em 3 zonas discretas com uma "zona
// morta" no meio. Os cutoffs default (1/3 e 2/3) reproduzem exatamente a
// especificação do projeto (eixos 0..30, zona morta 10-20):
//   posição 0  <->  eixo < 10   (abaixo do 1º corte)
//   posição 1  <->  10 <= eixo <= 20  (zona morta)
//   posição 2  <->  eixo > 20  (acima do 2º corte)
// (O TicTacToe3D original usa cutoff = 0.2/0.8 para o próprio jogo; aqui
// usamos 1/3–2/3 para bater com os limiares 10/20 do enunciado do projeto.)
const CUTOFF_LOW = 1 / 3;
const CUTOFF_HIGH = 2 / 3;

function getPosition(x, cutoffLow = CUTOFF_LOW, cutoffHigh = CUTOFF_HIGH) {
  if (x < cutoffLow) return 0;
  if (x < cutoffHigh) return 1;
  return 2;
}

// ---------------------------------------------------------------------
// AxisPipeline — agrupa Normalize + MomentumAverage + getPosition para um eixo
// ---------------------------------------------------------------------
class AxisPipeline {
  constructor(smoothing = 0.15) {
    this.normalize = new Normalize();
    this.average = new MomentumAverage(smoothing);
  }

  /** Processa uma leitura bruta e devolve a posição discreta (0, 1 ou 2). */
  update(raw) {
    const n = this.normalize.normalize(raw);
    this.average.note(n);
    return getPosition(this.average.avg);
  }
}
