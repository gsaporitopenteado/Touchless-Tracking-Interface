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
//   zona 0  <->  x < CUTOFF_BAIXO[eixo]
//   zona 1  <->  CUTOFF_BAIXO[eixo] <= x < CUTOFF_ALTO[eixo]
//   zona 2  <->  x >= CUTOFF_ALTO[eixo]
//
// O original usava um CUTOFF so (0.2, ou seja 0.2 / 0.8) para os tres
// eixos. Aqui cada eixo tem os dois limites proprios, porque as placas
// nao respondem igual: na bancada o span foi 373 / 238 / 190 contagens
// e o ruido 24 / 74 / 48, entao a mesma fracao do curso significa
// folgas bem diferentes em cada eixo.
//
// O valor comparado e o que o HUD mostra em cada caixa X/Y/Z (ja
// normalizado, com FLIP e EMA) - leia ali para ajustar.
//
// O QUE CADA LIMITE SIGNIFICA NA MAO (com linear = true)
//
//   eixo  abaixo de BAIXO (zona 0)       acima de ALTO (zona 2)
//   X     esquerda  = mao PERTO da placa  direita  = mao LONGE
//   Y     cima      = mao LONGE (FLIP)    baixo    = mao PERTO
//   Z     confirmar = mao PERTO da placa  desfazer = mao LONGE
//
// Subir BAIXO deixa a zona 0 mais facil de alcancar; descer ALTO deixa
// a zona 2 mais facil. Os dois juntos definem o tamanho da zona morta.
// Precisa BAIXO < ALTO em todo eixo, senao a zona neutra some -
// validaCutoffs() avisa no console ao abrir o sketch.
// ------------------------------------------------------------
//                                X     Y     Z
final float[] CUTOFF_BAIXO = { 0.35,  0.2,  0.35 };
final float[] CUTOFF_ALTO  = { 0.8,  0.65,  0.8 };

int getPosition(int eixo, float x) {
  if (x < CUTOFF_BAIXO[eixo]) return 0;
  if (x < CUTOFF_ALTO[eixo]) return 1;
  return 2;
}

void validaCutoffs() {
  String[] eixos = { "X", "Y", "Z" };
  for (int i = 0; i < 3; i++) {
    if (CUTOFF_BAIXO[i] >= CUTOFF_ALTO[i]) {
      println("AVISO: eixo " + eixos[i] + " com CUTOFF_BAIXO (" + CUTOFF_BAIXO[i]
            + ") >= CUTOFF_ALTO (" + CUTOFF_ALTO[i] + ") - sem zona neutra");
    }
  }
}
