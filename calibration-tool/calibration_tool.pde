/**
 * calibration_tool.pde
 * ----------------------------------------------------------------------
 * Utilitário Processing MÍNIMO só para calibrar os 3 sensores capacitivos
 * do Fit Express, sem precisar rodar o jogo TicTacToe3D completo.
 *
 * Usa a mesma técnica de Normalize.pde do projeto original
 * (https://github.com/Make-Magazine/3DInterface/tree/master/TicTacToe3D):
 * segure o botão esquerdo do mouse e mova a mão de ponta a ponta sobre
 * cada uma das 3 placas para "ensinar" os valores mínimo e máximo que o
 * firmware original (_3DInterface.ino) manda para cada eixo.
 *
 * Controles:
 *   segurar botão esquerdo do mouse  -> calibra (atualiza min/max)
 *   'r'                              -> reinicia a calibração
 *   'p'                              -> imprime no console um trecho
 *                                       pronto para colar em
 *                                       web/calibration-config.js
 * ----------------------------------------------------------------------
 */

import processing.serial.*;

Serial serialPort;
int PORT_INDEX = 0; // << ajuste para a porta do seu Arduino (veja a lista impressa no console ao abrir)

final int SENSORS = 3;
final String[] LABELS = { "X", "Y", "Z" };

float[] mn = new float[SENSORS];
float[] mx = new float[SENSORS];
float[] last = new float[SENSORS];

PFont font;

void setup() {
  size(480, 260);
  font = createFont("Monospaced", 16);
  textFont(font);

  println("Portas seriais disponíveis:");
  println(Serial.list());
  serialPort = new Serial(this, Serial.list()[PORT_INDEX], 115200);

  resetBounds();
}

void resetBounds() {
  for (int i = 0; i < SENSORS; i++) {
    mn[i] = Float.POSITIVE_INFINITY;
    mx[i] = Float.NEGATIVE_INFINITY;
  }
}

void draw() {
  readSerial();
  drawUI();
}

void readSerial() {
  String line = serialPort.readStringUntil('\n');
  if (line == null) return;

  String[] parts = split(trim(line), ' ');
  if (parts.length != SENSORS) return;

  for (int i = 0; i < SENSORS; i++) {
    last[i] = float(parts[i]);
    if (mousePressed && mouseButton == LEFT) {
      if (last[i] < mn[i]) mn[i] = last[i];
      if (last[i] > mx[i]) mx[i] = last[i];
    }
  }
}

void drawUI() {
  background(245);
  fill(20);

  text("Calibração Fit Express — Touchless Interface", 20, 30);
  text(mousePressed
    ? "CALIBRANDO... mova a mão nas 3 placas"
    : "Segure o botão ESQUERDO do mouse para calibrar", 20, 55);
  text("'r' reinicia   |   'p' imprime o JSON de calibração no console", 20, 78);

  for (int i = 0; i < SENSORS; i++) {
    String minStr = mn[i] == Float.POSITIVE_INFINITY ? "-" : nf(mn[i], 0, 0);
    String maxStr = mx[i] == Float.NEGATIVE_INFINITY ? "-" : nf(mx[i], 0, 0);
    text(LABELS[i] + "   bruto=" + nf(last[i], 0, 0) +
      "   min=" + minStr + "   max=" + maxStr,
      20, 120 + i * 28);
  }
}

void keyPressed() {
  if (key == 'r' || key == 'R') resetBounds();
  if (key == 'p' || key == 'P') printCalibrationSnippet();
}

void printCalibrationSnippet() {
  println("---- cole isto em web/calibration-config.js ----");
  println("const FIXED_CALIBRATION = {");
  println("  x: { min: " + mn[0] + ", max: " + mx[0] + " },");
  println("  y: { min: " + mn[1] + ", max: " + mx[1] + " },");
  println("  z: { min: " + mn[2] + ", max: " + mx[2] + " },");
  println("};");
  println("--------------------------------------------------");
}
