/*
  ============================================================================
  Touchless Tracking Interface — Firmware
  Fast Food Saudável — Sistema de Pedidos por Gestos
  ============================================================================

  Baseado em / inspirado por:
    - Make: "A Touchless 3D Tracking Interface"
      https://makezine.com/projects/a-touchless-3d-tracking-interface/
    - https://github.com/Make-Magazine/3DInterface

  PRINCÍPIO DE SENSORIAMENTO (conforme o esquemático fornecido)
  ----------------------------------------------------------------------------
  Cada placa (X, Y, Z) usa UM único pino digital do Arduino, sem par
  emissor/receptor separado:

      5V ──[220kΩ]──┬── nó da placa ──[10kΩ]── PIN (8/9/10)
                     └── PLACA (alumínio)

  O nó fica permanentemente "puxado" para 5V pelo resistor de 220kΩ. O pino
  do Arduino consegue descarregar esse nó para GND (modo OUTPUT LOW) através
  do resistor de 10kΩ. Quando o pino volta a modo INPUT (alta impedância), o
  220kΩ recarrega o nó através da capacitância formada pela placa + o corpo
  humano próximo a ela (efeito capacitivo de proximidade).

  Quanto mais perto a mão está da placa, MAIOR a capacitância adicionada ao
  nó, e portanto MAIS TEMPO o nó demora para recarregar até o pino ler HIGH.
  Medimos esse tempo (em microssegundos) com micros() — é a mesma técnica de
  "charge transfer" usada em diversos sensores capacitivos caseiros.

      mão longe da placa  -> recarrega rápido  -> tempo pequeno -> distância ~30
      mão em cima da placa -> recarrega devagar -> tempo grande  -> distância ~0

  Esse tempo bruto é então mapeado para uma escala de 0 a 30 (conforme a
  especificação do projeto) usando uma calibração de dois pontos por eixo
  (NEAR = mão tocando a placa, FAR = mão fora de alcance / ausente).

  IMPORTANTE: os valores brutos de tempo variam MUITO de acordo com o
  tamanho/posição real das placas, umidade, cabo, etc. Este firmware fornece
  comandos de calibração via Serial Monitor (ver README.md) — calibre antes
  de usar de verdade.

  ============================================================================
  LÓGICA DE POSICIONAMENTO (especificação do projeto)
  ----------------------------------------------------------------------------
  Origem do sistema de coordenadas no encontro das 3 placas. Eixos de 0 a 30.

    Eixo X (plano XY controla esquerda/direita):
      10 <= X <= 20  -> parado na horizontal
      X < 10         -> move para a DIREITA
      X > 20         -> move para a ESQUERDA

    Eixo Y (plano XY controla cima/baixo):
      10 <= Y <= 20  -> parado na vertical
      Y < 10         -> move para CIMA
      Y > 20         -> move para BAIXO

    Eixo Z (planos XZ/YZ controlam seleção do item):
      10 <= Z <= 20  -> nenhuma mudança de seleção
      Z < 10         -> DESSELECIONA o item
      Z > 20         -> SELECIONA o item

  O movimento (X/Y) é emitido como "passos" com repetição limitada no tempo
  (como tecla segurada), para não disparar um movimento por loop. A seleção
  (Z) é emitida por BORDA — um único evento a cada vez que a mão cruza para
  dentro da zona de seleção/desseleção — para não repetir centenas de vezes
  enquanto a mão fica parada na zona.

  ============================================================================
  SAÍDA SERIAL (115200 baud)
  ----------------------------------------------------------------------------
  Uma linha JSON por ciclo (~30 ms), consumida pelo front-end via Web Serial:

    {"x":18.4,"y":9.2,"z":24.7,"moveH":"RIGHT","moveV":"NONE","gesture":"SELECT"}

    x,y,z    : posição estimada de cada eixo, 0.0 a 30.0
    moveH    : "LEFT" | "RIGHT" | "NONE"   (evento de passo, não estado contínuo)
    moveV    : "UP"   | "DOWN"  | "NONE"   (evento de passo, não estado contínuo)
    gesture  : "SELECT" | "DESELECT" | "NONE" (evento de borda)

  Linhas de calibração/depuração começam com '#' (o front-end as ignora).

  COMANDOS DE CALIBRAÇÃO (digite no Serial Monitor, sem quebra de linha CRLF)
  ----------------------------------------------------------------------------
    xn / xf   -> grava NEAR / FAR do eixo X com a leitura atual
    yn / yf   -> grava NEAR / FAR do eixo Y
    zn / zf   -> grava NEAR / FAR do eixo Z
    s         -> salva a calibração atual na EEPROM
    r         -> restaura calibração padrão (de fábrica)
    p         -> imprime a calibração atual e as leituras brutas
  ============================================================================
*/

#include <EEPROM.h>
#include <string.h>

// ---------------------------------------------------------------------------
// Configuração de hardware
// ---------------------------------------------------------------------------
const uint8_t PIN_X = 8;
const uint8_t PIN_Y = 9;
const uint8_t PIN_Z = 10;

const uint32_t CHARGE_TIMEOUT_US = 3000UL;   // segurança contra travamento
const uint32_t LOOP_INTERVAL_MS  = 30UL;     // ~33 Hz de saída
const uint32_t MOVE_REPEAT_MS    = 350UL;    // taxa de "repetição de tecla"
const float    SMOOTHING_ALPHA   = 0.25f;    // filtro exponencial (0-1)

const float AXIS_MIN = 0.0f;
const float AXIS_MAX = 30.0f;
const float ZONE_LOW  = 10.0f;
const float ZONE_HIGH = 20.0f;

// ---------------------------------------------------------------------------
// Calibração (persistida em EEPROM)
// ---------------------------------------------------------------------------
struct Calibration {
  uint32_t nearX, farX;
  uint32_t nearY, farY;
  uint32_t nearZ, farZ;
};

const uint8_t EEPROM_MAGIC = 0xA5;
const int EEPROM_ADDR_MAGIC = 0;
const int EEPROM_ADDR_CAL   = 1;

// Valores padrão "de fábrica" — SUBSTITUA pela sua calibração real (ver README).
Calibration cal = {
  /*nearX*/ 1800, /*farX*/ 150,
  /*nearY*/ 1800, /*farY*/ 150,
  /*nearZ*/ 1800, /*farZ*/ 150
};

// ---------------------------------------------------------------------------
// Estado por eixo
// ---------------------------------------------------------------------------
struct AxisState {
  uint8_t pin;
  float filtered;   // tempo de carga suavizado (us)
  float value;      // posição mapeada 0..30
};

AxisState axX = { PIN_X, 0, 0 };
AxisState axY = { PIN_Y, 0, 0 };
AxisState axZ = { PIN_Z, 0, 0 };

uint32_t lastLoopMs = 0;
uint32_t lastMoveHMs = 0;
uint32_t lastMoveVMs = 0;

enum ZoneZ { ZONE_NONE, ZONE_SELECT, ZONE_DESELECT };
ZoneZ prevZoneZ = ZONE_NONE;

bool firstLoop = true;

// ---------------------------------------------------------------------------
// Leitura de carga capacitiva (charge-transfer) de um pino
// ---------------------------------------------------------------------------
uint32_t readChargeTime(uint8_t pin) {
  // Descarrega o nó através do resistor de 10k
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);
  delayMicroseconds(15);

  // Libera o pino (alta impedância) — o 220k para 5V começa a recarregar
  pinMode(pin, INPUT);

  uint32_t start = micros();
  while (digitalRead(pin) == LOW) {
    if ((micros() - start) > CHARGE_TIMEOUT_US) break;
  }
  return micros() - start;
}

float clampf(float v, float lo, float hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

float mapf(float x, float inMin, float inMax, float outMin, float outMax) {
  if (inMax == inMin) return outMin;
  float t = (x - inMin) / (inMax - inMin);
  return outMin + t * (outMax - outMin);
}

// Atualiza um eixo: lê, suaviza (EMA) e converte para escala 0..30
void updateAxis(AxisState &ax, uint32_t nearTime, uint32_t farTime) {
  uint32_t raw = readChargeTime(ax.pin);

  if (firstLoop) {
    ax.filtered = raw;
  } else {
    ax.filtered = SMOOTHING_ALPHA * raw + (1.0f - SMOOTHING_ALPHA) * ax.filtered;
  }

  // nearTime (mão tocando -> distância 0) é MAIOR que farTime (mão longe -> distância 30)
  float mapped = mapf(ax.filtered, (float)nearTime, (float)farTime, AXIS_MIN, AXIS_MAX);
  ax.value = clampf(mapped, AXIS_MIN, AXIS_MAX);
}

// ---------------------------------------------------------------------------
// EEPROM
// ---------------------------------------------------------------------------
void loadCalibration() {
  if (EEPROM.read(EEPROM_ADDR_MAGIC) == EEPROM_MAGIC) {
    EEPROM.get(EEPROM_ADDR_CAL, cal);
  }
}

void saveCalibration() {
  EEPROM.write(EEPROM_ADDR_MAGIC, EEPROM_MAGIC);
  EEPROM.put(EEPROM_ADDR_CAL, cal);
  Serial.println(F("# calibracao salva na EEPROM"));
}

void printCalibration() {
  Serial.print(F("# cal nearX=")); Serial.print(cal.nearX);
  Serial.print(F(" farX="));       Serial.print(cal.farX);
  Serial.print(F(" nearY="));      Serial.print(cal.nearY);
  Serial.print(F(" farY="));       Serial.print(cal.farY);
  Serial.print(F(" nearZ="));      Serial.print(cal.nearZ);
  Serial.print(F(" farZ="));       Serial.println(cal.farZ);

  Serial.print(F("# raw X=")); Serial.print(axX.filtered);
  Serial.print(F(" Y="));      Serial.print(axY.filtered);
  Serial.print(F(" Z="));      Serial.println(axZ.filtered);
}

void handleSerialCommands() {
  while (Serial.available() >= 2) {
    char axis = Serial.read();
    char kind = Serial.read();

    if (axis == 'x' && kind == 'n') cal.nearX = (uint32_t)axX.filtered;
    else if (axis == 'x' && kind == 'f') cal.farX = (uint32_t)axX.filtered;
    else if (axis == 'y' && kind == 'n') cal.nearY = (uint32_t)axY.filtered;
    else if (axis == 'y' && kind == 'f') cal.farY = (uint32_t)axY.filtered;
    else if (axis == 'z' && kind == 'n') cal.nearZ = (uint32_t)axZ.filtered;
    else if (axis == 'z' && kind == 'f') cal.farZ = (uint32_t)axZ.filtered;
    else if (axis == 's') { saveCalibration(); return; }
    else if (axis == 'r') {
      Calibration def = { 1800, 150, 1800, 150, 1800, 150 };
      cal = def;
      Serial.println(F("# calibracao restaurada (padrao)"));
      return;
    } else if (axis == 'p') { printCalibration(); return; }
    else continue; // ignora lixo / bytes fora de sincronia

    Serial.print(F("# calibrado eixo "));
    Serial.print(axis);
    Serial.print(kind == 'n' ? F(" NEAR = ") : F(" FAR = "));
    Serial.println(kind == 'n'
      ? (axis == 'x' ? cal.nearX : axis == 'y' ? cal.nearY : cal.nearZ)
      : (axis == 'x' ? cal.farX  : axis == 'y' ? cal.farY  : cal.farZ));
  }
}

// ---------------------------------------------------------------------------
// Lógica de gestos (aplicada sobre os valores já mapeados 0..30)
// ---------------------------------------------------------------------------
const char* horizontalZone(float x) {
  if (x < ZONE_LOW) return "RIGHT";
  if (x > ZONE_HIGH) return "LEFT";
  return "NONE";
}

const char* verticalZone(float y) {
  if (y < ZONE_LOW) return "UP";
  if (y > ZONE_HIGH) return "DOWN";
  return "NONE";
}

ZoneZ zoneOfZ(float z) {
  if (z < ZONE_LOW) return ZONE_DESELECT;
  if (z > ZONE_HIGH) return ZONE_SELECT;
  return ZONE_NONE;
}

// ---------------------------------------------------------------------------
// Setup / Loop
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  loadCalibration();

  pinMode(PIN_X, INPUT);
  pinMode(PIN_Y, INPUT);
  pinMode(PIN_Z, INPUT);

  Serial.println(F("# Touchless Tracking Interface - firmware pronto"));
  Serial.println(F("# comandos: xn xf yn yf zn zf s r p"));
  printCalibration();

  lastLoopMs = millis();
  lastMoveHMs = millis();
  lastMoveVMs = millis();
}

void loop() {
  handleSerialCommands();

  uint32_t now = millis();
  if (now - lastLoopMs < LOOP_INTERVAL_MS) return;
  lastLoopMs = now;

  updateAxis(axX, cal.nearX, cal.farX);
  updateAxis(axY, cal.nearY, cal.farY);
  updateAxis(axZ, cal.nearZ, cal.farZ);
  firstLoop = false;

  // --- movimento horizontal/vertical com repetição limitada no tempo ---
  const char* hZone = horizontalZone(axX.value);
  const char* vZone = verticalZone(axY.value);

  const char* moveH = "NONE";
  if (strcmp(hZone, "NONE") != 0 && (now - lastMoveHMs) >= MOVE_REPEAT_MS) {
    moveH = hZone;
    lastMoveHMs = now;
  }

  const char* moveV = "NONE";
  if (strcmp(vZone, "NONE") != 0 && (now - lastMoveVMs) >= MOVE_REPEAT_MS) {
    moveV = vZone;
    lastMoveVMs = now;
  }

  // --- gesto de seleção por borda (dispara uma vez por cruzamento de zona) ---
  ZoneZ zoneZ = zoneOfZ(axZ.value);
  const char* gesture = "NONE";
  if (zoneZ != prevZoneZ) {
    if (zoneZ == ZONE_SELECT) gesture = "SELECT";
    else if (zoneZ == ZONE_DESELECT) gesture = "DESELECT";
  }
  prevZoneZ = zoneZ;

  // --- saída JSON ---
  Serial.print(F("{\"x\":"));   Serial.print(axX.value, 1);
  Serial.print(F(",\"y\":"));   Serial.print(axY.value, 1);
  Serial.print(F(",\"z\":"));   Serial.print(axZ.value, 1);
  Serial.print(F(",\"moveH\":\"")); Serial.print(moveH);
  Serial.print(F("\",\"moveV\":\"")); Serial.print(moveV);
  Serial.print(F("\",\"gesture\":\"")); Serial.print(gesture);
  Serial.println(F("\"}"));
}
