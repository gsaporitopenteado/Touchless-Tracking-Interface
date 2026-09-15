// ============================================================
// Theme.pde - cores, fontes e primitivas de desenho
//
// As cores sao as mesmas do style.css da versao web, para as duas
// versoes do totem ficarem visualmente iguais.
// ============================================================

final color GREEN_900 = #123524;
final color GREEN_700 = #1F6D43;
final color GREEN_600 = #2C8C56;
final color GREEN_500 = #38A862;
final color GREEN_100 = #E6F5EC;
final color AMBER_500 = #F2A93C;
final color AMBER_600 = #E0912A;
final color RED_500   = #E35B5B;
final color BG        = #F5FAF6;
final color CARD      = #FFFFFF;
final color BORDA     = #DBEADF;
final color INK       = #16241D;
final color MUTED     = #5C6D64;

final float RAIO = 18;   // raio dos cantos arredondados

PFont fReg, fBold, fBig, fHuge, fMono;

void carregaFontes() {
  fReg  = criaFonte("SansSerif", 17);
  fBold = criaFonte("SansSerif.bold", 17);
  fBig  = criaFonte("SansSerif.bold", 22);
  fHuge = criaFonte("SansSerif.bold", 48);
  fMono = criaFonte("Monospaced", 12);
}

PFont criaFonte(String nome, int tam) {
  try {
    return createFont(nome, tam);
  }
  catch (Exception e) {
    return createFont("SansSerif", tam);
  }
}

// ------------------------------------------------------------
// Sombra suave por baixo de um retangulo arredondado.
// ------------------------------------------------------------
void sombra(float x, float y, float w, float h, float r) {
  noStroke();
  for (int i = 7; i > 0; i--) {
    fill(18, 53, 36, 5);
    rect(x - i, y - i + 6, w + 2*i, h + 2*i, r + i);
  }
}

// ------------------------------------------------------------
// Cartao branco padrao.
// ------------------------------------------------------------
void cartao(float x, float y, float w, float h) {
  sombra(x, y, w, h, RAIO);
  noStroke();
  fill(CARD);
  rect(x, y, w, h, RAIO);
}

// ------------------------------------------------------------
// Moldura de foco: o mesmo destaque para item, botao ou forma de
// pagamento (equivalente da classe .cursor no CSS).
// ------------------------------------------------------------
void molduraFoco(float x, float y, float w, float h, float r) {
  noFill();
  // halo externo + anel solido: le bem tanto sobre cartao branco como
  // sobre botao verde, sem depender de contraste de uma cor so
  stroke(AMBER_500, 90);
  strokeWeight(9);
  rect(x - 3, y - 3, w + 6, h + 6, r + 3);
  stroke(AMBER_500);
  strokeWeight(3);
  rect(x, y, w, h, r);
  strokeWeight(1);
  noStroke();
}

// ------------------------------------------------------------
// Barra de permanencia (dwell): enche durante DWELL_Z_MS no alvo
// em foco. Verde para confirmar, vermelho para a acao secundaria.
// Equivalente do ::after com --dwell no CSS.
// ------------------------------------------------------------
void barraDwell(float x, float y, float w, float h, float r,
                float progresso, int zonaZ) {
  if (progresso <= 0) return;
  noStroke();
  fill(zonaZ == Z_ZONA_CONFIRMAR ? GREEN_600 : RED_500);
  float bw = max(r, w * progresso);
  rect(x, y + h - 5, bw, 5, 0, 0, r, r);
}

// ------------------------------------------------------------
// Botao. `destaque` escolhe entre primario (verde), secundario
// (verde claro) e chamada (ambar).
// ------------------------------------------------------------
static final int BTN_PRIMARIO = 0;
static final int BTN_SECUNDARIO = 1;
static final int BTN_CTA = 2;

void botao(float x, float y, float w, float h, String rotulo,
           int estilo, boolean habilitado, int seta) {
  noStroke();
  color fundo, texto;
  // O AMBAR E RESERVADO AO FOCO. Antes o botao de chamada (Iniciar
  // Pedido, Concluir Compra) era ambar tambem, e ficava impossivel
  // saber se o destaque era "este e o botao importante" ou "o cursor
  // esta aqui". Agora a chamada e um verde mais forte: uma cor, um
  // significado.
  if (estilo == BTN_SECUNDARIO) { fundo = GREEN_100; texto = GREEN_700; }
  else if (estilo == BTN_CTA)   { fundo = GREEN_700; texto = color(255); }
  else                          { fundo = GREEN_600; texto = color(255); }

  if (!habilitado) {
    fundo = lerpColor(fundo, BG, 0.62);
    texto = lerpColor(texto, BG, 0.45);
  }

  fill(fundo);
  rect(x, y, w, h, h / 2);

  fill(texto);
  textFont(fBold);
  textAlign(CENTER, CENTER);
  // caixa = o botao inteiro: text(s,x,y,w,h) RECORTA no retangulo, entao
  // uma caixa baixa some com o texto
  text(rotulo, x, y, w, h);

  // setas desenhadas, sem depender de fonte com glifo
  if (seta != 0) {
    float tw = textWidth(rotulo);
    float cy = y + h/2;
    float s = 6;
    fill(texto);
    if (seta < 0) {
      float cx = x + w/2 - tw/2 - 14;
      triangle(cx + s, cy - s, cx + s, cy + s, cx - s + 2, cy);
    } else {
      float cx = x + w/2 + tw/2 + 14;
      triangle(cx - s, cy - s, cx - s, cy + s, cx + s - 2, cy);
    }
  }
}

// ------------------------------------------------------------
// Icone com placeholder: se o PNG nao existir, desenha um quadrado
// tracejado com uma legenda, para o sketch rodar mesmo sem as
// imagens todas.
// ------------------------------------------------------------
void icone(PImage img, float x, float y, float s, String legenda) {
  if (img != null) {
    imageMode(CORNER);
    image(img, x, y, s, s);
    return;
  }
  noFill();
  stroke(BORDA);
  strokeWeight(2);
  rect(x, y, s, s, 8);
  line(x + 6, y + 6, x + s - 6, y + s - 6);
  line(x + s - 6, y + 6, x + 6, y + s - 6);
  strokeWeight(1);
  noStroke();
  if (legenda != null && legenda.length() > 0) {
    fill(MUTED);
    textFont(fMono);
    textAlign(CENTER, TOP);
    text(legenda, x + s/2, y + s + 3);
  }
}

// ------------------------------------------------------------
// Medidas que acompanham o tamanho da janela
// ------------------------------------------------------------
final float TOPO = 104;    // altura ocupada pelo cabecalho + folga
final float RODAPE = 96;   // espaco reservado ao HUD no pe da tela

/** Largura de um cartao centralizado, sem passar da janela. */
float larguraCartao(float preferida) {
  return min(preferida, width - 80);
}

/** Altura de um cartao centralizado, sem invadir o HUD. */
float alturaCartao(float preferida) {
  return min(preferida, height - TOPO - RODAPE);
}

// ------------------------------------------------------------
// Preco no formato brasileiro: R$ 12,90
// ------------------------------------------------------------
String brl(float v) {
  return "R$ " + nf(v, 0, 2).replace('.', ',');
}
