// ============================================================
// Calibration.pde - aprendizado e persistencia dos limites
//
// Equivalente do `mousePressed && mouseButton == LEFT` do sketch
// original: enquanto a tecla C estiver SEGURADA, Normalize.note()
// amplia o min/max de cada eixo.
//
// Tres defeitos da versao anterior deste sketch estao corrigidos aqui,
// e vale registrar quais:
//
//  1. Sem calibracao, choose() devolve 1 para todo eixo (o `return 1`
//     do original). Isso levava Z para a zona de acionar e o sketch
//     adicionava um item sozinho ~2.5s depois de abrir, alem de
//     congelar X/Y. Agora nada e processado enquanto !calibrado().
//
//  2. O JSON do Processing recusa numeros nao finitos. Salvar com
//     min = +Infinity (segurar e soltar C sem dados de serial)
//     derrubava o sketch com RuntimeException. Agora so salva se a
//     calibracao for valida.
//
//  3. A zona de confirmar era a mao LONGE da placa; agora e a mao
//     PERTO, como manda o enunciado e como faz a versao web.
// ============================================================

Normalize[] norm = new Normalize[3];
MomentumAverage[] ema = new MomentumAverage[3];

// Y invertido, igual ao flip = {false, true, false} do sketch original
final boolean[] FLIP = { false, true, false };

float[] bruto = { 0, 0, 0 };   // ultima leitura crua, para o HUD
float[] nxyz  = { 0, 0, 0 };   // normalizado 0..1 antes da suavizacao

boolean calibrando = false;

/** Razao minima max/min para considerar um eixo calibrado.
 *
 *  Isto NAO faz parte do porte: o sketch original nunca precisou saber
 *  se estava calibrado, porque quem olhava a tela decidia. Aqui a
 *  interface precisa de um portao, e so `min != max` nao serve - o
 *  ruido do sensor garante valores diferentes mesmo com a mao parada.
 *  Do encosto na placa ate fora de alcance a contagem varia muito mais
 *  que 50%, entao essa razao separa uma varredura real de uma tecla
 *  apertada sem mover a mao. */
final float RAZAO_MIN_CALIBRACAO = 1.5;

void iniciaSensores() {
  for (int i = 0; i < 3; i++) {
    norm[i] = new Normalize();
    // 0.15 e a mesma taxa do axyz[] do TicTacToe3D original
    ema[i] = new MomentumAverage(0.15);
  }
}

boolean calibrado() {
  for (int i = 0; i < 3; i++) {
    if (norm[i] == null) return false;
    if (Float.isInfinite(norm[i].min) || Float.isNaN(norm[i].min)) return false;
    if (norm[i].min <= 0) return false;
    if (norm[i].max / norm[i].min < RAZAO_MIN_CALIBRACAO) return false;
  }
  return true;
}

void iniciaCalibracao() {
  if (calibrando) return;
  calibrando = true;
  nav.reset(millis());
  mostra("calibrando - varra a mao pelas 3 placas");
}

void terminaCalibracao() {
  if (!calibrando) return;
  calibrando = false;

  // Zera os temporizadores: sem isso, terminar a varredura com a mao
  // dentro de Z0 deixaria o eixo travado.
  nav.reset(millis());

  // A varredura pelo teclado termina com a mao virtual num extremo;
  // devolve-la ao centro deixa Z neutro, pronto para o primeiro
  // confirmar - sem precisar "sair e voltar".
  fakeRecentra();

  if (calibrado()) {
    salvaCalibracao();
  } else {
    mostra("calibracao insuficiente - varra todo o alcance");
  }
}

void reiniciaCalibracao() {
  for (int i = 0; i < 3; i++) {
    norm[i].reset();
    ema[i].reset();
  }
  nav.reset(millis());
  mostra("calibracao reiniciada");
}

// ------------------------------------------------------------
// Persistencia
// ------------------------------------------------------------
String arquivoCalibracao() {
  return dataPath("calib.json");
}

void salvaCalibracao() {
  if (!calibrado()) {
    // JSONObject.setFloat recusa Infinity/NaN com RuntimeException
    mostra("nada para salvar - calibre primeiro");
    return;
  }
  JSONArray a = new JSONArray();
  for (int i = 0; i < 3; i++) {
    JSONObject o = new JSONObject();
    o.setFloat("min", norm[i].min);
    o.setFloat("max", norm[i].max);
    a.setJSONObject(i, o);
  }
  saveJSONArray(a, arquivoCalibracao());
  mostra("calibracao salva");
}

void carregaCalibracao() {
  File f = new File(arquivoCalibracao());
  if (!f.exists()) return;
  try {
    JSONArray a = loadJSONArray(arquivoCalibracao());
    if (a == null) return;
    for (int i = 0; i < 3 && i < a.size(); i++) {
      JSONObject o = a.getJSONObject(i);
      float mn = o.getFloat("min");
      float mx = o.getFloat("max");
      if (Float.isInfinite(mn) || Float.isNaN(mn)) continue;
      if (Float.isInfinite(mx) || Float.isNaN(mx)) continue;
      norm[i].min = mn;
      norm[i].max = mx;
    }
    if (calibrado()) mostra("calibracao carregada do disco");
  }
  catch (Exception e) {
    println("calib.json ilegivel, ignorando: " + e.getMessage());
  }
}

// ------------------------------------------------------------
// Um quadro de leituras cruas -> zonas
// ------------------------------------------------------------
void processaQuadro(float[] raw) {
  for (int i = 0; i < 3; i++) {
    if (calibrando) norm[i].note(raw[i]);
    float v = norm[i].choose(raw[i]);
    nxyz[i] = FLIP[i] ? 1 - v : v;
    ema[i].note(nxyz[i]);
    bruto[i] = raw[i];
  }

  // Durante a varredura os limites mudam a cada quadro, entao as zonas
  // oscilam: congela a navegacao e mantem os temporizadores zerados.
  if (calibrando) {
    nav.reset(millis());
    return;
  }

  // O portao que faltava: sem calibracao, choose() devolve 1 para tudo
  // e a interface acionaria sozinha.
  if (!calibrado()) return;

  float[] suave = { ema[0].avg, ema[1].avg, ema[2].avg };
  nav.update(suave, millis());
}
