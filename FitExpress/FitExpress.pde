// ============================================================
// Fit Express - totem de pedidos sem toque, inteiro em Processing
//
// O Arduino roda o firmware original (arduino/totem/totem.ino) e manda
// so tres contagens cruas por linha, a 115200:
//
//     12480 3312 7936
//
// Toda a inteligencia mora aqui: calibracao (Sensors + Calibration),
// navegacao por taxa (Navigation) e as 5 telas (Screens).
//
// ------------------------------------------------------------
// TECLADO
// ------------------------------------------------------------
//   <- / ->    eixo X   (segure; o cursor anda e repete)
//   ^  / v     eixo Y
//   s          eixo Z para baixo  = CONFIRMAR
//   w          eixo Z para cima   = DESFAZER / VOLTAR
//
//   C (segurar) calibra: varra a mao por todo o alcance de cada placa
//   A           varredura de calibracao automatica (com firmware falso)
//   R           reinicia a calibracao
//   L           recarrega a calibracao do disco
//   M           liga/desliga o firmware falso (teclado)
//   P           troca de porta serial
//   H           mostra/esconde a ajuda de teclas
//
// Sem Arduino na porta, o sketch cai sozinho no firmware falso.
// ============================================================

import processing.serial.*;

// ---------------- telas ----------------
static final int TELA_INICIO = 0;
static final int TELA_CARDAPIO = 1;
static final int TELA_REVISAO = 2;
static final int TELA_PAGAMENTO = 3;
static final int TELA_CONFIRMACAO = 4;

int tela = TELA_INICIO;

// ---------------- cardapio ----------------
final int COLS = 3;
final int LINHAS = 3;
final int N = 9;

String[] nomes = {
  "Bowl de Quinoa com Frango", "Wrap Integral de Grao-de-Bico", "Salada Caesar Fit",
  "Burger Vegetal", "Espetinho de Tofu Grelhado", "Suco Verde Detox",
  "Agua de Coco Natural", "Mix de Castanhas", "Iogurte com Granola e Frutas"
};
float[] precos = { 24.90, 19.90, 22.90, 23.90, 18.90, 12.90, 8.90, 9.90, 14.90 };

int[] qtd = new int[N];
PImage[] icones = new PImage[N];

// ---------------- pagamento ----------------
final String[] METODOS = { "credito", "debito", "pix", "dinheiro" };
final String[] METODOS_LABEL = {
  "Cartao de Credito", "Cartao de Debito", "Pix", "Dinheiro"
};
PImage[] iconesPag = new PImage[4];
PImage iconeCheck, iconeLogo;
String formaEscolhida = "";

// ---------------- pedido fechado ----------------
String numeroPedido = "---";
float totalPago = 0;

// ---------------- fonte de dados ----------------
// Indice INICIAL em Serial.list(). Nao ha como identificar o Arduino
// pelo nome no Windows (a lista sai como COM4, COM5, ...), entao isto e
// um palpite: a tecla P percorre as portas em tempo de execucao, e se a
// porta escolhida ficar muda o sketch cai sozinho no firmware falso.
final int PORTA_SERIAL = 1;
final int BAUD = 115200;
final int SILENCIO_ATE_FALLBACK_MS = 4000;

Serial serial;
boolean usandoSerial = false;
int portaAtual = PORTA_SERIAL;
int serialAbertaEm = 0;
boolean jaCaiuNoFake = false;

// ---------------- navegacao ----------------
Navigator nav;

// ---------------- aviso + ajuda ----------------
String aviso = "";
int avisoAte = 0;
boolean mostrarAjuda = false;   // tecle H para mostrar as teclas

// ============================================================
void setup() {
  // ---- TAMANHO DA JANELA ----
  // Troque os dois numeros aqui. O Processing exige LITERAIS em size()
  // (o preprocessador le os valores do codigo-fonte), entao nao da para
  // usar variavel. O layout e proporcional, so respeite um minimo de
  // ~1100 x 700 - abaixo disso o cardapio fica com os cartoes muito
  // estreitos. Para o totem, comente o size() e descomente o
  // fullScreen().
  size(1280, 800);
  // fullScreen();
  smooth(4);
  frameRate(60);

  carregaFontes();
  carregaImagens();

  iniciaSensores();
  iniciaAlvos();
  nav = new Navigator();

  carregaCalibracao();
  abreSerial();
  if (!usandoSerial) fakeLiga();   // sem Arduino, vai de teclado

  irPara(TELA_INICIO);
}

void abreSerial() {
  String[] portas = Serial.list();
  println("portas seriais:");
  for (int i = 0; i < portas.length; i++) println("  [" + i + "] " + portas[i]);
  abrePorta(portaAtual);
}

void abrePorta(int indice) {
  String[] portas = Serial.list();
  if (portas.length == 0) {
    println("nenhuma porta serial -> firmware falso");
    usandoSerial = false;
    return;
  }
  portaAtual = constrain(indice, 0, portas.length - 1);
  if (serial != null) {
    try { serial.stop(); } catch (Exception e) { }
    serial = null;
  }
  try {
    serial = new Serial(this, portas[portaAtual], BAUD);
    serial.clear();
    usandoSerial = true;
    serialAbertaEm = millis();
    jaCaiuNoFake = false;
    println("lendo " + portas[portaAtual] + " @ " + BAUD);
    mostra("porta " + portas[portaAtual]);
  }
  catch (Exception e) {
    println("nao abriu " + portas[portaAtual] + " -> " + e.getMessage());
    usandoSerial = false;
    mostra("nao abriu " + portas[portaAtual]);
  }
}

/** Percorre as portas disponiveis (tecla P). */
void proximaPorta() {
  String[] portas = Serial.list();
  if (portas.length == 0) { mostra("nenhuma porta serial"); return; }
  abrePorta((portaAtual + 1) % portas.length);
}

/**
 * Se a porta aberta nao mandar nada, cai no firmware falso em vez de
 * deixar a tela morta. Com o indice de porta sendo um palpite, isto
 * acontece sempre que o Arduino esta em outra COM.
 */
void verificaSilencio() {
  if (!usandoSerial || fakeAtivo || jaCaiuNoFake) return;
  if (millis() - serialAbertaEm < SILENCIO_ATE_FALLBACK_MS) return;
  if (!nav.fonteParada()) return;   // esta chegando dado, tudo bem
  jaCaiuNoFake = true;
  fakeLiga();
  mostra("porta muda - firmware falso ligado (P troca de porta)");
}

void carregaImagens() {
  for (int i = 0; i < N; i++) icones[i] = carregaIcone(str(i), -1);
  iconesPag[0] = carregaIcone("pay-credito", 9);
  iconesPag[1] = carregaIcone("pay-debito", 10);
  iconesPag[2] = carregaIcone("pay-pix", 11);
  iconesPag[3] = carregaIcone("pay-dinheiro", 12);
  iconeCheck = carregaIcone("check", 13);
  iconeLogo = carregaIcone("logo", 14);
}

/** Tenta img/<nome>.png e, se nao existir, img/<indice>.png.
 *  Devolve null quando nenhum existe - o desenho usa placeholder. */
PImage carregaIcone(String nome, int indiceAlternativo) {
  String[] tentativas = (indiceAlternativo < 0)
    ? new String[] { "img/" + nome + ".png" }
    : new String[] { "img/" + nome + ".png", "img/" + indiceAlternativo + ".png" };
  for (int i = 0; i < tentativas.length; i++) {
    File f = new File(dataPath(tentativas[i]));
    if (f.exists()) {
      PImage img = loadImage(tentativas[i]);
      if (img != null && img.width > 0) return img;
    }
  }
  return null;
}

// ============================================================
void draw() {
  background(BG);

  leFonteDeDados();
  verificaSilencio();
  fakeRodaVarredura();
  fakeRoda();

  desenhaCabecalho();
  desenhaTela();
  desenhaHud();
  if (mostrarAjuda) desenhaAjuda();
  else desenhaLembreteAjuda();
  desenhaAviso();
}

// ------------------------------------------------------------
// Entrada de dados
// ------------------------------------------------------------
void leFonteDeDados() {
  if (!usandoSerial || serial == null) return;
  // drena tudo que chegou desde o quadro anterior
  String linha = serial.readStringUntil('\n');
  while (linha != null) {
    processaLinhaSerial(linha);
    linha = serial.readStringUntil('\n');
  }
}

void processaLinhaSerial(String linha) {
  String[] p = splitTokens(trim(linha), " ,\t");
  if (p.length != 3) return;   // linha truncada (comum no reset da placa)

  float[] raw = new float[3];
  for (int i = 0; i < 3; i++) {
    raw[i] = float(p[i]);
    if (Float.isNaN(raw[i])) return;
  }

  // chegou dado de verdade: o firmware falso sai da frente
  if (fakeAtivo) {
    fakeDesliga();
    mostra("dados reais chegando - firmware falso desligado");
  }
  processaQuadro(raw);
}

// ============================================================
// Acoes do Navigator
// ============================================================

/** Z0 - acao primaria do alvo em foco. */
void onConfirmar(Target t) {
  if (t == null) return;
  switch (t.kind) {
    case T_ITEM:
      adicionaItem(t.item);
      break;
    case T_PAGAMENTO:
      formaEscolhida = t.method;
      mostra("forma: " + t.label);
      break;
    case T_ACAO:
      executaAcao(t.key);
      break;
  }
}

/**
 * Z2 - A REGRA DO DESFAZER (uma so, para todas as telas)
 * ------------------------------------------------------
 * Z2 pede ao alvo em FOCO para se desfazer. Se aquele alvo nao tinha
 * nada a desfazer, Z2 sai da tela.
 *
 * Isso mantem o Z2 sempre no escopo do que esta sendo apontado:
 *
 *   cardapio, item com quantidade > 0  -> remove uma unidade
 *   cardapio, item com quantidade 0    -> nada a desfazer; o cardapio
 *                                         nao tem voltar, nada acontece
 *   pagamento, forma em foco escolhida -> desmarca
 *   pagamento, forma em foco NAO       -> nada a desfazer neste alvo,
 *     escolhida                           volta a revisao sem mexer na
 *                                         escolha atual
 *   revisao / botoes                   -> volta uma tela
 */
void onDesfazer(Target t) {
  if (desfazAlvo(t)) return;
  voltaTela();
}

boolean desfazAlvo(Target t) {
  if (t == null) return false;
  if (t.kind == T_ITEM) return removeItem(t.item);
  if (t.kind == T_PAGAMENTO) {
    if (!t.method.equals(formaEscolhida)) return false;
    formaEscolhida = "";
    mostra("forma de pagamento desmarcada");
    return true;
  }
  return false;   // botoes nao tem nada a desfazer
}

/** Telas ausentes daqui nao tem voltar: o cardapio e o inicio do
 *  pedido, e a confirmacao ja fechou a compra. */
void voltaTela() {
  if (tela == TELA_REVISAO) irPara(TELA_CARDAPIO);
  else if (tela == TELA_PAGAMENTO) irPara(TELA_REVISAO);
}

void executaAcao(String key) {
  if (key.equals("start-order")) {
    if (podeIniciar()) irPara(TELA_CARDAPIO);
  } else if (key.equals("finish")) {
    if (temItens()) irPara(TELA_REVISAO);
    else mostra("escolha ao menos um item");
  } else if (key.equals("back-menu")) {
    irPara(TELA_CARDAPIO);
  } else if (key.equals("to-payment")) {
    irPara(TELA_PAGAMENTO);
  } else if (key.equals("back-review")) {
    irPara(TELA_REVISAO);
  } else if (key.equals("confirm-purchase")) {
    if (formaEscolhida.length() > 0) fechaCompra();
    else mostra("escolha uma forma de pagamento");
  } else if (key.equals("new-order")) {
    novoPedido();
  }
}

boolean alvoHabilitado(Target t) {
  if (t == null) return false;
  if (t.key.equals("start-order")) return podeIniciar();
  if (t.key.equals("finish")) return temItens();
  if (t.key.equals("confirm-purchase")) return formaEscolhida.length() > 0;
  return true;
}

// ============================================================
// Pedido
// ============================================================
void adicionaItem(int i) {
  qtd[i]++;
  mostra("+ " + nomes[i]);
}

boolean removeItem(int i) {
  if (qtd[i] <= 0) return false;
  qtd[i]--;
  mostra("- " + nomes[i]);
  return true;
}

boolean temItens() {
  for (int i = 0; i < N; i++) if (qtd[i] > 0) return true;
  return false;
}

int qtdItensDistintos() {
  int n = 0;
  for (int i = 0; i < N; i++) if (qtd[i] > 0) n++;
  return n;
}

float totalPedido() {
  float t = 0;
  for (int i = 0; i < N; i++) t += qtd[i] * precos[i];
  return t;
}

void fechaCompra() {
  totalPago = totalPedido();
  // Mesmo criterio da versao web: sorteio de 3 digitos. Nao e
  // sequencial nem unico - com 900 valores possiveis, a chance de dois
  // clientes tirarem o mesmo numero passa de 50% em ~35 pedidos.
  numeroPedido = str(floor(random(100, 1000)));
  irPara(TELA_CONFIRMACAO);
}

void novoPedido() {
  for (int i = 0; i < N; i++) qtd[i] = 0;
  formaEscolhida = "";
  totalPago = 0;
  // Fluxo de totem: o proximo cliente cai direto no cardapio. Mas a
  // tela inicial e o unico lugar que explica calibracao, entao se a
  // fonte caiu ou a calibracao se perdeu, volta para la.
  irPara(podeIniciar() ? TELA_CARDAPIO : TELA_INICIO);
}

boolean fonteViva() {
  return (usandoSerial && !nav.fonteParada()) || fakeAtivo;
}

boolean podeIniciar() {
  return fonteViva() && calibrado();
}

// ============================================================
// Teclado
// ============================================================
void keyPressed() {
  // calibracao e utilitarios
  if (key == 'c' || key == 'C') { iniciaCalibracao(); return; }
  if (key == 'a' || key == 'A') { fakeIniciaVarredura(); return; }
  if (key == 'r' || key == 'R') { reiniciaCalibracao(); return; }
  if (key == 'l' || key == 'L') { carregaCalibracao(); return; }
  if (key == 'h' || key == 'H') { mostrarAjuda = !mostrarAjuda; return; }
  if (key == 'p' || key == 'P') { proximaPorta(); return; }
  if (key == 'm' || key == 'M') {
    if (fakeAtivo) { fakeDesliga(); mostra("firmware falso desligado"); }
    else fakeLiga();
    return;
  }

  // eixos do firmware falso
  if (key == CODED) {
    if (keyCode == LEFT) tEsq = true;
    if (keyCode == RIGHT) tDir = true;
    if (keyCode == UP) tCima = true;
    if (keyCode == DOWN) tBaixo = true;
  }
  if (key == 's' || key == 'S') tZperto = true;
  if (key == 'w' || key == 'W') tZlonge = true;
}

void keyReleased() {
  if (key == 'c' || key == 'C') { terminaCalibracao(); return; }

  if (key == CODED) {
    if (keyCode == LEFT) tEsq = false;
    if (keyCode == RIGHT) tDir = false;
    if (keyCode == UP) tCima = false;
    if (keyCode == DOWN) tBaixo = false;
  }
  if (key == 's' || key == 'S') tZperto = false;
  if (key == 'w' || key == 'W') tZlonge = false;
}

// ------------------------------------------------------------
// Mouse: clicar num alvo foca e confirma (fallback / acessibilidade)
// ------------------------------------------------------------
void mousePressed() {
  Target[][] m = nav.mapa;
  for (int r = 0; r < m.length; r++) {
    for (int c = 0; c < m[r].length; c++) {
      Target t = m[r][c];
      if (t == null || t.bw <= 0) continue;
      if (mouseX >= t.bx && mouseX <= t.bx + t.bw &&
          mouseY >= t.by && mouseY <= t.by + t.bh) {
        nav.linha = r;
        nav.coluna = c;
        if (mouseButton == LEFT) onConfirmar(t);
        else onDesfazer(t);
        return;
      }
    }
  }
}

// ============================================================
// Cabecalho, HUD, ajuda e aviso
// ============================================================
void desenhaCabecalho() {
  noStroke();
  fill(GREEN_900);
  rect(0, 0, width, 74);

  if (iconeLogo != null) {
    imageMode(CORNER);
    image(iconeLogo, 28, 19, 36, 36);
    fill(255);
    textFont(fBig);
    textAlign(LEFT, CENTER);
    text("Fit Express", 74, 36);
  } else {
    fill(255);
    textFont(fBig);
    textAlign(LEFT, CENTER);
    text("Fit Express", 32, 36);
  }

  String st;
  color dot;
  if (calibrando) {
    st = "CALIBRANDO - varra a mao pelas 3 placas";
    dot = AMBER_500;
  } else if (usandoSerial && !nav.fonteParada()) {
    st = "Arduino conectado";
    dot = GREEN_500;
  } else if (fakeAtivo) {
    st = "Firmware falso (teclado)";
    dot = AMBER_500;
  } else {
    st = "Sem fonte de dados";
    dot = RED_500;
  }

  textFont(fReg);
  textAlign(RIGHT, CENTER);
  fill(#CFE9DA);
  text(st, width - 32, 36);
  float larg = textWidth(st);
  noStroke();
  fill(dot);
  ellipse(width - 44 - larg, 36, 10, 10);
}

/** HUD dos eixos: mostra POR QUE o cursor esta se movendo.
 *
 *  Em controle por taxa o cursor e estado que nao se autocorrige - um
 *  eixo travado caminha ate a borda e fica la, sem nada na tela
 *  explicando. Daí o HUD. */
void desenhaHud() {
  String[] rotulos = { "X", "Y", "Z" };
  float bw = 132, bh = 40, gap = 10;
  float x0 = width / 2 - (bw * 3 + gap * 2) / 2;
  float y0 = height - 52;

  for (int i = 0; i < 3; i++) {
    float x = x0 + i * (bw + gap);
    int zona = nav.zonaVisivel(i);
    boolean ativo = (zona != ZONA_NEUTRA);
    float prog = (i == 2) ? nav.progressoZ() : nav.progressoMove(i);

    noStroke();
    fill(ativo ? AMBER_500 : #E3EDE7);
    rect(x, y0, bw, bh, 10);

    color tinta = ativo ? #3A2A06 : MUTED;
    fill(tinta);
    textFont(fBold);
    textAlign(LEFT, CENTER);
    text(rotulos[i], x + 10, y0 + bh/2 - 4);

    textFont(fReg);
    textAlign(LEFT, CENTER);
    text(setaDoEixo(i, zona), x + 28, y0 + bh/2 - 4);

    textFont(fMono);
    textAlign(RIGHT, CENTER);
    text(nf(nav.valores[i], 1, 2), x + bw - 10, y0 + bh/2 - 4);

    // barrinha do temporizador
    noStroke();
    fill(ativo ? #3A2A06 : BORDA, 90);
    rect(x + 10, y0 + bh - 9, bw - 20, 3, 2);
    fill(tinta);
    rect(x + 10, y0 + bh - 9, (bw - 20) * prog, 3, 2);
  }

  // leitura crua, para depuracao
  fill(MUTED);
  textFont(fMono);
  textAlign(LEFT, CENTER);
  text("bruto  " + int(bruto[0]) + "  " + int(bruto[1]) + "  " + int(bruto[2]),
       24, y0 + bh/2 - 4);
}

String setaDoEixo(int eixo, int zona) {
  if (zona == ZONA_NEUTRA) return "--";
  if (eixo == 0) return zona == ZONA_BAIXA ? "<< esq" : "dir >>";
  if (eixo == 1) return zona == ZONA_BAIXA ? "^^ cima" : "vv baixo";
  return zona == Z_ZONA_CONFIRMAR ? "confirmar" : "desfazer";
}

void desenhaAjuda() {
  String t = "setas: mover   s: confirmar   w: desfazer   "
           + "C(segurar): calibrar   A: calibrar auto   R: reiniciar   "
           + "M: firmware falso   P: trocar porta   H: esconder";
  textFont(fMono);
  float w = textWidth(t) + 24;
  noStroke();
  fill(255, 215);
  rect(width/2 - w/2, height - 88, w, 24, 8);
  fill(MUTED);
  textAlign(CENTER, CENTER);
  text(t, width/2, height - 77);
}

/** Com a barra de teclas escondida, sobra so este lembrete de canto -
 *  discreto, mas sem deixar as teclas indescobriveis. */
void desenhaLembreteAjuda() {
  fill(MUTED, 130);
  textFont(fMono);
  textAlign(RIGHT, BOTTOM);
  text("H: teclas", width - 16, height - 10);
}

void mostra(String s) {
  aviso = s;
  avisoAte = millis() + 1600;
}

void desenhaAviso() {
  if (millis() >= avisoAte) return;
  textFont(fBold);
  float w = textWidth(aviso) + 36;
  // na faixa livre entre o fim do conteudo (height - RODAPE) e o topo
  // do HUD: no topo da tela ele cobria o titulo dos cartoes
  float y = height - RODAPE + 4;
  noStroke();
  fill(GREEN_900, 235);
  rect(width/2 - w/2, y, w, 34, 10);
  fill(255);
  textAlign(CENTER, CENTER);
  text(aviso, width/2, y + 16);
}
