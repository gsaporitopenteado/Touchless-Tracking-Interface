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

/** Span minimo (max - min, em contagens) para considerar um eixo
 *  calibrado.
 *
 *  Isto NAO faz parte do porte: o sketch original nunca precisou saber
 *  se estava calibrado, porque quem olhava a tela decidia. Aqui a
 *  interface precisa de um portao, e so `min != max` nao serve - o
 *  ruido do sensor garante valores diferentes mesmo com a mao parada.
 *
 *  ATE ENTAO ISTO ERA UMA RAZAO max/min >= 1.5, calibrada contra o
 *  firmware falso, que ia de 1200 a 25200 contagens. O hardware real
 *  nao chega perto disso: o totem.ino devolve o tempo de carga, e ~98%
 *  dele e offset fixo (capacitancia do pino + overhead do laco). A mao
 *  mexe so nos ~2% restantes, entao as razoes medidas na bancada sao
 *  1.027 / 1.019 / 1.015 - a placa real NUNCA passaria por 1.5, e
 *  "Iniciar Pedido" nunca habilitava com o Arduino conectado.
 *
 *  Span absoluto nao tem esse problema, porque o offset sai na
 *  subtracao. Medicoes de bancada, em contagens:
 *
 *      eixo   ruido pico-a-pico   span do gesto
 *      X               24              373
 *      Y               74              238
 *      Z               48              190
 *
 *  O portao tem que ficar acima do maior ruido (74) e abaixo do menor
 *  span (190); 120 e aproximadamente a media geometrica dos dois, ou
 *  seja a mesma folga para os dois lados. */
final float SPAN_MIN_CALIBRACAO = 120;

void iniciaSensores() {
  validaCutoffs();
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
    if (norm[i].max - norm[i].min < SPAN_MIN_CALIBRACAO) return false;
  }
  return true;
}

void iniciaCalibracao() {
  if (calibrando) return;
  amostraEixo = -1;   // a varredura com C substitui a amostragem em curso
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
  amostraEixo = -1;
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
  // Marca a chegada do quadro ANTES de qualquer portao. So nav.update()
  // marcava, e ele nao roda sem calibracao, durante a varredura com C
  // nem durante a amostragem - entao com o Arduino real e sem
  // calibracao a fonte parecia parada: os botoes - e + ficavam
  // desabilitados justamente quando mais se precisa deles, e
  // verificaSilencio() ligava o firmware falso com dado chegando.
  nav.ultimoQuadro = millis();

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

  // Amostragem dos botoes - e +: a mao vai de proposito a um extremo,
  // entao a navegacao fica congelada do mesmo jeito.
  if (amostraEixo >= 0) {
    registraAmostra(raw[amostraEixo]);
    nav.reset(millis());
    return;
  }

  // O portao que faltava: sem calibracao, choose() devolve 1 para tudo
  // e a interface acionaria sozinha.
  if (!calibrado()) return;

  float[] suave = { ema[0].avg, ema[1].avg, ema[2].avg };
  nav.update(suave, millis());
}

// ------------------------------------------------------------
// Recalibracao por eixo com o sketch rodando: botoes - e + do HUD
//
// Em cima de cada caixa X/Y/Z ha dois botoes:
//   -  mede o MINIMO do eixo  (mao LONGE da placa / fora de alcance)
//   +  mede o MAXIMO do eixo  (mao ENCOSTADA na placa)
//
// Clicar tira a media de AMOSTRAS_CALIB leituras cruas daquele eixo
// e grava no limite correspondente. Min e max sao em contagem crua,
// sem FLIP: em todo eixo a contagem SOBE quando a mao se aproxima.
//
// Media e nao pico, ao contrario da varredura com C: a varredura
// guarda o extremo de ruido (o maior e o menor valor visto), o que
// alarga a faixa em ~ruido pico-a-pico. A media de 10 leituras corta o
// desvio em ~3x (8 / 18 / 14 contagens -> ~3 / 6 / 5).
//
// Clicar de novo no botao ativo cancela. Um limite que deixaria o
// span abaixo de SPAN_MIN_CALIBRACAO e RECUSADO e a calibracao anterior
// fica intacta - e o que acontece ao apertar + com a mao longe por
// engano. Se os dois limites antigos estiverem muito fora, R reinicia
// e qualquer ordem volta a funcionar.
// ------------------------------------------------------------
final int AMOSTRAS_CALIB = 10;   // ~1s a 10 Hz, a taxa do totem.ino
final float BOTAO_CALIB_H = 26;
final float BOTAO_CALIB_FOLGA = 6;
final String[] EIXOS = { "X", "Y", "Z" };

int amostraEixo = -1;        // eixo sendo amostrado; -1 = nenhum
boolean amostraMax = false;  // true = botao +, false = botao -
float amostraSoma = 0;
int amostraN = 0;

void iniciaAmostra(int eixo, boolean max) {
  // clicar no botao ativo cancela - tambem e a saida se a fonte cair
  // no meio e a contagem parar de andar
  if (amostraEixo == eixo && amostraMax == max) {
    amostraEixo = -1;
    nav.reset(millis());
    mostra("amostragem cancelada");
    return;
  }
  if (amostraEixo >= 0) {
    mostra("aguarde a amostragem de " + EIXOS[amostraEixo]);
    return;
  }
  if (calibrando) return;
  if (!fonteViva()) {
    mostra("sem fonte de dados para amostrar");
    return;
  }
  amostraEixo = eixo;
  amostraMax = max;
  amostraSoma = 0;
  amostraN = 0;
  nav.reset(millis());
  mostra(max ? "mao ENCOSTADA na placa " + EIXOS[eixo] + " - medindo max"
             : "mao LONGE da placa " + EIXOS[eixo] + " - medindo min");
}

void registraAmostra(float raw) {
  amostraSoma += raw;
  amostraN++;
  if (amostraN < AMOSTRAS_CALIB) return;

  int eixo = amostraEixo;
  boolean max = amostraMax;
  amostraEixo = -1;
  aplicaAmostra(eixo, max, amostraSoma / amostraN);
}

void aplicaAmostra(int eixo, boolean max, float media) {
  Normalize n = norm[eixo];
  String nome = EIXOS[eixo] + (max ? " max " : " min ") + round(media);

  // So da para checar o span se o outro limite ja existe; sem ele
  // (logo depois de R) qualquer valor e aceito.
  float outro = max ? n.min : n.max;
  if (!Float.isInfinite(outro) && !Float.isNaN(outro)) {
    float span = max ? media - outro : outro - media;
    if (span < SPAN_MIN_CALIBRACAO) {
      mostra(nome + " recusado: span " + round(span)
           + " (minimo " + round(SPAN_MIN_CALIBRACAO) + ")");
      return;
    }
  }

  if (max) n.max = media;
  else n.min = media;
  nav.reset(millis());

  if (calibrado()) {
    salvaCalibracao();
    mostra(nome + " - salvo");
  } else {
    mostra(nome + " - calibracao ainda incompleta");
  }
}

/** Retangulo {x, y, w, h} do botao - (max = false) ou + do eixo. */
float[] retBotaoCalib(int eixo, boolean max) {
  float w = (HUD_BW - BOTAO_CALIB_FOLGA) / 2;
  float x = hudCaixaX(eixo) + (max ? w + BOTAO_CALIB_FOLGA : 0);
  float y = hudCaixaY() - BOTAO_CALIB_FOLGA - BOTAO_CALIB_H;
  return new float[] { x, y, w, BOTAO_CALIB_H };
}

boolean dentroDe(float[] r, float px, float py) {
  return px >= r[0] && px <= r[0] + r[2] && py >= r[1] && py <= r[1] + r[3];
}

/** true se o clique caiu num botao (e foi consumido). */
boolean cliqueBotaoCalib(float px, float py) {
  for (int i = 0; i < 3; i++) {
    for (int k = 0; k < 2; k++) {
      boolean max = (k == 1);
      if (dentroDe(retBotaoCalib(i, max), px, py)) {
        iniciaAmostra(i, max);
        return true;
      }
    }
  }
  return false;
}

void desenhaBotoesCalib() {
  boolean habil = fonteViva() && !calibrando;
  textFont(fMono);
  textAlign(CENTER, CENTER);

  for (int i = 0; i < 3; i++) {
    for (int k = 0; k < 2; k++) {
      boolean max = (k == 1);
      float[] r = retBotaoCalib(i, max);
      boolean ativo = (amostraEixo == i && amostraMax == max);
      boolean hover = habil && dentroDe(r, mouseX, mouseY);

      stroke(ativo ? AMBER_600 : BORDA);
      strokeWeight(1);
      if (ativo)       fill(AMBER_500);
      else if (!habil) fill(#EEF3F0);
      else if (hover)  fill(GREEN_100);
      else             fill(CARD);
      rect(r[0], r[1], r[2], r[3], 8);
      noStroke();

      String sinal = max ? "+" : "-";
      String txt;
      if (ativo) {
        txt = sinal + " " + amostraN + "/" + AMOSTRAS_CALIB;
      } else {
        float v = max ? norm[i].max : norm[i].min;
        boolean valido = !Float.isInfinite(v) && !Float.isNaN(v);
        txt = sinal + " " + (valido ? str(round(v)) : (max ? "max" : "min"));
      }
      if (ativo)      fill(#3A2A06);
      else if (habil) fill(INK);
      else            fill(MUTED);
      text(txt, r[0] + r[2] / 2, r[1] + r[3] / 2 - 1);

      if (ativo) {
        fill(#3A2A06);
        rect(r[0] + 6, r[1] + r[3] - 5,
             (r[2] - 12) * amostraN / float(AMOSTRAS_CALIB), 2, 1);
      }
    }
  }
}
