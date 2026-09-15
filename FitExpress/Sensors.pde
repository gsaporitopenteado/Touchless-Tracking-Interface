// ============================================================
// Sensors.pde - a matematica portada do sketch original
//
// Normalize e MomentumAverage vem do TicTacToe3D / DIY 3D Controller
// (Kyle McDonald), com min/max publicos para persistir a calibracao
// em disco. getPosition tambem e do original.
//
// NADA aqui foi "melhorado": e a versao que ja foi validada no
// hardware real. Qualquer coisa que pareca estranha esta assim de
// proposito - inclusive o `return 1` quando normalized == 0, que faz
// todo eixo ler 1 antes de existir calibracao.
// ============================================================

boolean linear = true;
float minDistance = 1, maxDistance = 4;

class Normalize {
  float min, max;

  Normalize() { reset(); }

  void note(float x) {
    if (x < min) min = x;
    if (x > max) max = x;
  }

  float normalize(float x) {
    if (min == max || min == Float.POSITIVE_INFINITY) return 0;
    return constrain(map(x, min, max, 0, 1), 0, 1);
  }

  // capacitancia ~ 1/d^2, entao sqrt(1/n) e aproximadamente a distancia
  float linear(float x) {
    float n = normalize(x);
    if (n == 0) return 1;
    return constrain(map(sqrt(1 / n), minDistance, maxDistance, 0, 1), 0, 1);
  }

  float choose(float x) { return linear ? linear(x) : normalize(x); }

  void reset() {
    min = Float.POSITIVE_INFINITY;
    max = Float.NEGATIVE_INFINITY;
  }
}

class MomentumAverage {
  float adapt, avg;

  MomentumAverage(float adapt) { this.adapt = adapt; reset(); }

  void note(float x) {
    if (Float.isInfinite(x) || Float.isNaN(x)) return;
    avg = avg * (1 - adapt) + x * adapt;
  }

  void reset() { avg = 0; }
}

// ------------------------------------------------------------
// getPosition() do TicTacToe3D.pde: divide o eixo normalizado
// (0..1) em 3 zonas, com a zona morta no meio.
//
//   zona 0  <->  x < CUTOFF            (0.2)
//   zona 1  <->  CUTOFF <= x < 1-CUTOFF
//   zona 2  <->  x >= 1-CUTOFF         (0.8)
//
// A zona morta ocupa de 0.2 a 0.8 do curso, ou seja 60% dele - folga
// de sobra para a mao ficar parada sem acionar nada.
// ------------------------------------------------------------
final float CUTOFF = 0.2;

int getPosition(float x) {
  if (x < CUTOFF) return 0;
  if (x < 1 - CUTOFF) return 1;
  return 2;
}
