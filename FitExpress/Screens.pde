// ============================================================
// Screens.pde - mapas de foco e desenho de cada tela
//
// Cada tela declara uma matriz de alvos focaveis; o Navigator cuida de
// mover, repetir, confirmar e desfazer. E por isso que a tela de
// pagamento tem navegacao sem uma linha de codigo especifica para ela.
// ============================================================

// ------------------------------------------------------------
// Alvos compartilhados
// ------------------------------------------------------------

/** "Concluir Pedido" ocupa a 4a coluna inteira do cardapio - a MESMA
 *  referencia nas 3 linhas. Assim a linha de origem e lembrada de
 *  graca: saindo de [1][3] para a esquerda voce volta para [1][2], sem
 *  nenhum `ultimaLinha` guardado. */
Target alvoConcluirPedido;

Target novoAcao(String key, String label, int estilo, int seta) {
  Target t = new Target(T_ACAO, key);
  t.label = label;
  t.estilo = estilo;
  t.seta = seta;
  return t;
}

void iniciaAlvos() {
  alvoConcluirPedido = novoAcao("finish", "Concluir Pedido", BTN_PRIMARIO, 0);
}

// ------------------------------------------------------------
// Mapas de foco
// ------------------------------------------------------------
Target[][] mapaInicio() {
  Target t = novoAcao("start-order", "Iniciar Pedido", BTN_CTA, +1);
  return new Target[][] { { t } };
}

Target[][] mapaCardapio() {
  Target[][] m = new Target[LINHAS][COLS + 1];
  for (int r = 0; r < LINHAS; r++) {
    for (int c = 0; c < COLS; c++) {
      Target t = new Target(T_ITEM, "item-" + (r * COLS + c));
      t.item = r * COLS + c;
      m[r][c] = t;
    }
    m[r][COLS] = alvoConcluirPedido;  // mesma referencia nas 3 linhas
  }
  return m;
}

Target[][] mapaRevisao() {
  return new Target[][] { {
    novoAcao("back-menu", "Voltar ao Cardapio", BTN_SECUNDARIO, -1),
    novoAcao("to-payment", "Prosseguir para Pagamento", BTN_PRIMARIO, +1)
  } };
}

Target[][] mapaPagamento() {
  Target[] pg = new Target[4];
  for (int i = 0; i < 4; i++) {
    Target t = new Target(T_PAGAMENTO, "pay-" + METODOS[i]);
    t.method = METODOS[i];
    t.label = METODOS_LABEL[i];
    pg[i] = t;
  }
  return new Target[][] {
    { pg[0], pg[1] },
    { pg[2], pg[3] },
    { novoAcao("back-review", "Voltar", BTN_SECUNDARIO, -1),
      novoAcao("confirm-purchase", "Concluir Compra", BTN_CTA, 0) }
  };
}

Target[][] mapaConfirmacao() {
  return new Target[][] { { novoAcao("new-order", "Novo Pedido", BTN_PRIMARIO, 0) } };
}

// ------------------------------------------------------------
// Troca de tela
// ------------------------------------------------------------
void irPara(int novaTela) {
  tela = novaTela;
  switch (tela) {
    case TELA_INICIO:
      nav.setMapa(mapaInicio(), 0, 0);
      break;
    case TELA_CARDAPIO:
      nav.setMapa(mapaCardapio(), 1, 1);   // comeca no centro da grade
      break;
    case TELA_REVISAO:
      nav.setMapa(mapaRevisao(), 0, 0);
      break;
    case TELA_PAGAMENTO:
      nav.setMapa(mapaPagamento(), 0, 0);
      break;
    case TELA_CONFIRMACAO:
      nav.setMapa(mapaConfirmacao(), 0, 0);
      break;
  }
}

// ============================================================
// Desenho
// ============================================================
void desenhaTela() {
  switch (tela) {
    case TELA_INICIO:      desenhaInicio(); break;
    case TELA_CARDAPIO:    desenhaCardapio(); break;
    case TELA_REVISAO:     desenhaRevisao(); break;
    case TELA_PAGAMENTO:   desenhaPagamento(); break;
    case TELA_CONFIRMACAO: desenhaConfirmacao(); break;
  }
}

/** Desenha o alvo (se for um botao) e depois a moldura de foco e a
 *  barra de dwell, se ele estiver em foco. */
void desenhaAlvoBotao(Target t, float x, float y, float w, float h) {
  t.setRect(x, y, w, h, h / 2);
  boolean ok = alvoHabilitado(t);
  botao(x, y, w, h, t.label, t.estilo, ok, t.seta);
  decoraFoco(t);
}

void decoraFoco(Target t) {
  if (nav.focado() != t) return;
  molduraFoco(t.bx, t.by, t.bw, t.bh, t.braio);
  barraDwell(t.bx, t.by, t.bw, t.bh, t.braio,
             nav.progressoZ(), nav.zonaVisivel(2));
}

// ------------------------------------------------------------
// TELA: inicio
// ------------------------------------------------------------
void desenhaInicio() {
  float w = larguraCartao(560), h = alturaCartao(430);
  float x = (width - w) / 2, y = TOPO + 6;
  cartao(x, y, w, h);

  fill(INK);
  textFont(fBig);
  textAlign(CENTER, TOP);
  text("Bem-vindo(a) ao Fit Express", x + 30, y + 30, w - 60, 40);

  fill(MUTED);
  textFont(fReg);
  text("Monte seu pedido apenas movendo a mao. Sem toque, sem contato.",
       x + 40, y + 74, w - 80, 50);

  // instrucoes
  String[] linhas = {
    "Mova a mao em X e Y para andar pela tela",
    "Abaixe a mao sobre a placa Z para confirmar",
    "Levante a mao da placa Z para desfazer ou voltar"
  };
  float iy = y + 132;
  for (int i = 0; i < linhas.length; i++) {
    noStroke();
    fill(GREEN_100);
    rect(x + 40, iy, w - 80, 44, 12);
    fill(GREEN_600);
    ellipse(x + 64, iy + 22, 10, 10);
    fill(INK);
    textFont(fReg);
    textAlign(LEFT, CENTER);
    text(linhas[i], x + 84, iy + 21);
    iy += 52;
  }

  // estado da calibracao
  textAlign(CENTER, TOP);
  if (!fonteViva()) {
    fill(RED_500);
    textFont(fBold);
    text("Sem fonte de dados. Tecle M para o firmware falso.",
         x + 30, iy + 6, w - 60, 40);
  } else if (!calibrado()) {
    fill(AMBER_600);
    textFont(fBold);
    text("Falta calibrar: segure C e varra a mao pelas 3 placas\n(ou - e + em cima de cada eixo; A = varredura automatica)",
         x + 30, iy + 6, w - 60, 46);
  } else {
    fill(GREEN_700);
    textFont(fReg);
    text("Calibrado. Abaixe a mao sobre a placa Z para iniciar.",
         x + 30, iy + 10, w - 60, 40);
  }

  Target t = nav.focado();
  if (t != null) desenhaAlvoBotao(t, x + w/2 - 130, y + h - 76, 260, 52);
}

// ------------------------------------------------------------
// TELA: cardapio (3x4 - 9 itens + a coluna de Concluir Pedido)
// ------------------------------------------------------------
void desenhaCardapio() {
  // tudo proporcional: mudar o size() no setup nao quebra o layout
  float marg = max(24, width * 0.028);
  float gap = max(10, width * 0.0125);
  float painel = constrain(width * 0.26, 250, 380);   // painel do carrinho
  float colAcao = constrain(width * 0.15, 140, 220);  // 4a coluna
  float areaW = width - painel - marg * 3 - colAcao - gap;
  float cw = (areaW - gap * (COLS - 1)) / COLS;
  float ch = (height - TOPO - RODAPE - gap * (LINHAS - 1)) / LINHAS;

  Target[][] m = nav.mapa;

  for (int r = 0; r < LINHAS; r++) {
    for (int c = 0; c < COLS; c++) {
      int i = r * COLS + c;
      float x = marg + c * (cw + gap);
      float y = TOPO + r * (ch + gap);
      Target t = m[r][c];
      t.setRect(x, y, cw, ch, RAIO);

      cartao(x, y, cw, ch);

      // posicoes proporcionais a ch: com a janela mais baixa os cartoes
      // encurtam, e com valores fixos o preco subia por cima do nome
      float icoS = constrain(ch * 0.30, 34, 56);
      icone(icones[i], x + cw/2 - icoS/2, y + ch * 0.09, icoS, null);

      fill(INK);
      textFont(fBold);
      textAlign(CENTER, TOP);
      text(nomes[i], x + 10, y + ch * 0.44, cw - 20, ch * 0.34);

      fill(GREEN_700);
      text(brl(precos[i]), x + 10, y + ch - 34, cw - 20, 26);

      if (qtd[i] > 0) {
        noStroke();
        fill(GREEN_600);
        ellipse(x + cw - 24, y + 24, 28, 28);
        fill(255);
        textFont(fBold);
        textAlign(CENTER, CENTER);
        text(qtd[i], x + cw - 24, y + 23);
      }

      decoraFoco(t);
    }
  }

  // 4a coluna: Concluir Pedido, ocupando a altura das 3 linhas
  float ax = marg + COLS * (cw + gap);
  float ay = TOPO;
  float ah = LINHAS * ch + (LINHAS - 1) * gap;
  Target ta = alvoConcluirPedido;
  ta.setRect(ax, ay, colAcao, ah, RAIO);

  cartao(ax, ay, colAcao, ah);
  boolean podeConcluir = temItens();
  noStroke();
  fill(podeConcluir ? GREEN_600 : lerpColor(GREEN_600, BG, 0.62));
  rect(ax, ay, colAcao, ah, RAIO);
  fill(255);
  textFont(fBig);
  textAlign(CENTER, CENTER);
  text("Concluir\nPedido", ax + 12, ay + ah/2 - 24, colAcao - 24, 60);
  if (!podeConcluir) {
    fill(255, 200);
    textFont(fReg);
    text("escolha ao menos\num item", ax + 14, ay + ah/2 + 44, colAcao - 28, 44);
  }
  decoraFoco(ta);

  desenhaCarrinho(width - painel - marg, TOPO, painel,
                  height - TOPO - RODAPE);
}

void desenhaCarrinho(float px, float py, float pw, float ph) {
  cartao(px, py, pw, ph);

  fill(INK);
  textFont(fBig);
  textAlign(LEFT, TOP);
  text("Seu Pedido", px + 22, py + 18);

  float y = py + 58, total = 0;
  textFont(fReg);
  boolean vazio = true;
  for (int i = 0; i < N; i++) {
    if (qtd[i] == 0) continue;
    vazio = false;
    total += qtd[i] * precos[i];
    fill(INK);
    textAlign(LEFT, TOP);
    text(qtd[i] + "x " + nomes[i], px + 22, y, pw - 116, 40);
    fill(MUTED);
    textAlign(RIGHT, TOP);
    text(brl(qtd[i] * precos[i]), px + pw - 22, y);
    y += 40;
    stroke(BORDA);
    line(px + 22, y - 8, px + pw - 22, y - 8);
    noStroke();
  }
  if (vazio) {
    fill(MUTED);
    textAlign(CENTER, TOP);
    text("Nenhum item selecionado ainda", px + 22, y, pw - 44, 30);
  }

  float ty = py + ph - 96;
  stroke(BORDA);
  strokeWeight(2);
  line(px + 22, ty, px + pw - 22, ty);
  strokeWeight(1);
  noStroke();
  fill(INK);
  textFont(fBig);
  textAlign(LEFT, TOP);
  text("Total", px + 22, ty + 16);
  textAlign(RIGHT, TOP);
  text(brl(totalPedido()), px + pw - 22, ty + 16);
}

// ------------------------------------------------------------
// TELA: revisao
// ------------------------------------------------------------
void desenhaRevisao() {
  float w = larguraCartao(640), h = alturaCartao(470);
  float x = (width - w) / 2, y = TOPO;
  cartao(x, y, w, h);

  fill(INK);
  textFont(fBig);
  textAlign(LEFT, TOP);
  text("Revisar Pedido", x + 34, y + 28);

  float ly = y + 80;
  textFont(fReg);
  int mostrados = 0;
  for (int i = 0; i < N; i++) {
    if (qtd[i] == 0) continue;
    fill(INK);
    textAlign(LEFT, TOP);
    text(qtd[i] + "x " + nomes[i], x + 34, ly, w - 200, 30);
    fill(GREEN_700);
    textAlign(RIGHT, TOP);
    text(brl(qtd[i] * precos[i]), x + w - 34, ly);
    ly += 36;
    mostrados++;
    // a ultima linha nao leva risco: o total logo abaixo ja tem o seu
    if (mostrados < qtdItensDistintos()) {
      stroke(BORDA);
      line(x + 34, ly - 8, x + w - 34, ly - 8);
      noStroke();
    }
  }

  float ty = y + h - 150;
  stroke(BORDA);
  strokeWeight(2);
  line(x + 34, ty, x + w - 34, ty);
  strokeWeight(1);
  noStroke();
  fill(INK);
  textFont(fBig);
  textAlign(LEFT, TOP);
  text("Total", x + 34, ty + 16);
  textAlign(RIGHT, TOP);
  text(brl(totalPedido()), x + w - 34, ty + 16);

  Target[][] m = nav.mapa;
  float bw = (w - 34 * 2 - 20) / 2, bh = 52;
  desenhaAlvoBotao(m[0][0], x + 34, y + h - 72, bw, bh);
  desenhaAlvoBotao(m[0][1], x + 34 + bw + 20, y + h - 72, bw, bh);
}

// ------------------------------------------------------------
// TELA: pagamento (3x2 - 2x2 de formas + linha de acoes)
// ------------------------------------------------------------
void desenhaPagamento() {
  float w = larguraCartao(640), h = alturaCartao(500);
  float x = (width - w) / 2, y = TOPO;
  cartao(x, y, w, h);

  fill(INK);
  textFont(fBig);
  textAlign(LEFT, TOP);
  text("Forma de Pagamento", x + 34, y + 26);

  Target[][] m = nav.mapa;
  float gap = 16;
  float bw = (w - 34 * 2 - gap) / 2, bh = 104;

  for (int r = 0; r < 2; r++) {
    for (int c = 0; c < 2; c++) {
      Target t = m[r][c];
      float bx = x + 34 + c * (bw + gap);
      float by = y + 76 + r * (bh + gap);
      t.setRect(bx, by, bw, bh, 14);

      boolean escolhida = t.method.equals(formaEscolhida);
      noStroke();
      fill(escolhida ? #D5EFE0 : GREEN_100);
      rect(bx, by, bw, bh, 14);
      if (escolhida) {
        noFill();
        stroke(GREEN_600);
        strokeWeight(2);
        rect(bx, by, bw, bh, 14);
        strokeWeight(1);
        noStroke();
      }

      int idx = r * 2 + c;
      icone(iconesPag[idx], bx + bw/2 - 20, by + 14, 40, null);
      fill(escolhida ? GREEN_700 : INK);
      textFont(fBold);
      textAlign(CENTER, TOP);
      text(t.label, bx + 10, by + 62, bw - 20, 36);

      decoraFoco(t);
    }
  }

  float ty = y + 76 + 2 * (bh + gap) + 8;
  stroke(BORDA);
  strokeWeight(2);
  line(x + 34, ty, x + w - 34, ty);
  strokeWeight(1);
  noStroke();
  fill(INK);
  textFont(fBig);
  textAlign(LEFT, TOP);
  text("Total a pagar", x + 34, ty + 16);
  textAlign(RIGHT, TOP);
  text(brl(totalPedido()), x + w - 34, ty + 16);

  float abw = (w - 34 * 2 - 20) / 2;
  desenhaAlvoBotao(m[2][0], x + 34, y + h - 72, abw, 52);
  desenhaAlvoBotao(m[2][1], x + 34 + abw + 20, y + h - 72, abw, 52);
}

// ------------------------------------------------------------
// TELA: confirmacao
// ------------------------------------------------------------
void desenhaConfirmacao() {
  float w = larguraCartao(560), h = alturaCartao(460);
  float x = (width - w) / 2, y = TOPO;
  cartao(x, y, w, h);

  if (iconeCheck != null) {
    icone(iconeCheck, x + w/2 - 32, y + 30, 64, null);
  } else {
    noStroke();
    fill(GREEN_600);
    ellipse(x + w/2, y + 62, 64, 64);
    stroke(255);
    strokeWeight(5);
    noFill();
    beginShape();
    vertex(x + w/2 - 14, y + 62);
    vertex(x + w/2 - 4, y + 72);
    vertex(x + w/2 + 15, y + 50);
    endShape();
    strokeWeight(1);
    noStroke();
  }

  fill(INK);
  textFont(fBig);
  textAlign(CENTER, TOP);
  text("Pedido Confirmado!", x + 30, y + 112, w - 60, 40);

  fill(MUTED);
  textFont(fReg);
  text("N. do pedido", x + 30, y + 156, w - 60, 26);

  fill(GREEN_700);
  textFont(fHuge);
  text(numeroPedido, x + 30, y + 182, w - 60, 66);

  fill(MUTED);
  textFont(fReg);
  text("Retire seu pedido no balcao informando este numero.",
       x + 40, y + 256, w - 80, 46);

  fill(INK);
  textFont(fBig);
  textAlign(LEFT, TOP);
  text("Total pago", x + 34, y + 306);
  textAlign(RIGHT, TOP);
  text(brl(totalPago), x + w - 34, y + 306);

  Target t = nav.focado();
  if (t != null) desenhaAlvoBotao(t, x + w/2 - 120, y + h - 76, 240, 52);
}
