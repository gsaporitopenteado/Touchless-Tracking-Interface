// ============================================================
// FakeFirmware.pde - firmware falso, para testar sem hardware
//
// O ponto central: isto NAO emite posicoes nem zonas. Emite CONTAGENS
// CRUAS, como o arduino/totem/totem.ino faz. Assim o teclado exercita
// o pipeline inteiro - Normalize, MomentumAverage, getPosition e a
// calibracao - e nao um atalho que pula justamente a parte que precisa
// ser testada.
//
// TECLADO
//   <- / ->   eixo X   (segure: o cursor anda e repete)
//   ^  / v    eixo Y
//   s / w     eixo Z   (s = abaixa = confirmar, w = levanta = desfazer)
//
// Diferente da versao web, aqui a tecla e SEGURADA: enquanto estiver
// pressionada a mao virtual caminha para aquele extremo, e ao soltar
// ela volta para o centro. E mais fiel ao gesto real ("a mao fica na
// zona") e tira a necessidade de apertar a tecla varias vezes.
//
// MODELO FISICO
// A contagem do totem.ino cresce com a capacitancia, e a capacitancia
// cresce quando a mao se aproxima da placa. O Normalize desfaz isso com
// sqrt(1/n), o que implica capacitancia ~ 1/d^2. Usamos o mesmo modelo
// na direcao inversa:
//
//     raw(d) = BASE[i] + ESCALA[i] / d^2,   d = DMIN + u * (DMAX - DMIN)
//
// onde u e a mao virtual, de 0 (encostada) a 1 (longe). DMAX = 2.6 foi
// escolhido para que, depois de uma varredura completa, as tres zonas
// fiquem com faixas de tamanho parecido (~28% / ~43% / ~30% do curso).
//
// ESCALA DAS CONTAGENS: POR QUE ISTO E POR EIXO AGORA
// ---------------------------------------------------
// Ate entao BASE e ESCALA eram escalares (1200 e 24000), cobrindo de
// 1200 a 25200 contagens - um span de 24000. A bancada mostrou que o
// hardware real entrega span de 373 / 238 / 190, sessenta vezes menos:
// no totem.ino ~98% da contagem e offset fixo (capacitancia do pino e
// overhead do laco), e a mao mexe so nos ~2% restantes.
//
// Um firmware falso sessenta vezes mais generoso que a placa nao testa
// o que precisa ser testado - ele mascara justamente as margens
// apertadas. Pior, ele obrigava o calib.json a servir a duas faixas
// incompativeis: a calibracao real saturava o teclado e vice-versa.
//
// Os valores abaixo saem das medicoes de bancada (mao fora = min, mao
// encostada na placa = max):
//
//     eixo    min      max     span
//     X     14567    14940      373
//     Y     14555    14793      238
//     Z     13880    14070      190
//
// Resolvendo raw(u=1) = min e raw(u=0) = max para cada eixo:
//     ESCALA = span / (1 - 1/DMAX^2),   BASE = min - ESCALA / DMAX^2
// ============================================================

final float[] FAKE_ESCALA = { 438, 279, 223 };
final float[] FAKE_BASE   = { 14502, 14514, 13847 };
final float FAKE_DMIN = 1.0;
final float FAKE_DMAX = 2.6;

/** Ruido ADITIVO em contagens, por eixo: random(-A, +A) uniforme, com
 *  A = desvio * sqrt(3) medido com a mao fora de alcance (desvios de
 *  8.0 / 18.0 / 14.4 contagens).
 *
 *  Era multiplicativo (+-0.4%), o que sobre 14500 contagens dariam
 *  +-58 - quinze por cento do span de X e mais que um quarto do de Z.
 *  Em contagem absoluta o ruido nao escala com o offset, entao
 *  multiplicativo e o modelo errado aqui. */
final float[] FAKE_RUIDO = { 14, 31, 25 };

final int   FAKE_INTERVALO_MS = 100; // ~10 Hz, igual ao totem.ino real

/** Velocidade da mao virtual, em unidades de u por segundo. O curso
 *  inteiro em ~0.4s: rapido como um gesto, mas continuo o bastante
 *  para o EMA ver uma rampa e nao um salto. */
final float FAKE_VELOCIDADE = 2.5;

boolean fakeAtivo = false;

float[] fakeU = { 0.5, 0.5, 0.5 };      // posicao da mao virtual
float[] fakeAlvo = { 0.5, 0.5, 0.5 };   // para onde ela esta indo
int fakeUltimoEmit = 0;
int fakeUltimoPasso = 0;

// teclas seguradas
boolean tEsq, tDir, tCima, tBaixo, tZperto, tZlonge;

void fakeLiga() {
  fakeAtivo = true;
  fakeRecentra();
  fakeUltimoPasso = millis();
  mostra("firmware falso (teclado) ativo");
}

void fakeDesliga() {
  fakeAtivo = false;
  tEsq = tDir = tCima = tBaixo = tZperto = tZlonge = false;
}

void fakeRecentra() {
  for (int i = 0; i < 3; i++) { fakeU[i] = 0.5; fakeAlvo[i] = 0.5; }
}

/** Converte as teclas seguradas em alvos para a mao virtual.
 *
 *  Atencao ao eixo Y: FLIP[1] == true, entao a mao PERTO da placa Y
 *  le zona 2 (baixo) e LONGE le zona 0 (cima). Por isso "cima" pede
 *  u = 1 e "baixo" pede u = 0 - o contrario de X. Foi exatamente essa
 *  inversao que confundiu os testes da versao web. */
void fakeAtualizaAlvos() {
  // Durante a varredura automatica quem manda em fakeAlvo e a
  // varredura. Sem isto os dois escrevem no mesmo quadro: a varredura
  // pede o extremo, este aqui devolve 0.5 logo em seguida, e a mao
  // virtual estaciona em u ~ 0.09..0.91 em vez de ir de ponta a ponta.
  // Com o span antigo de 24000 contagens sobrava faixa e ninguem viu;
  // com o span real de Z (190) isso derrubava o portao de calibracao.
  if (fakeVarrendo) return;

  // X: zona 0 (esquerda) = perto da placa = u 0
  if (tEsq && !tDir)      fakeAlvo[0] = 0.0;
  else if (tDir && !tEsq) fakeAlvo[0] = 1.0;
  else                    fakeAlvo[0] = 0.5;

  // Y: INVERTIDO - zona 0 (cima) = longe da placa = u 1
  if (tCima && !tBaixo)      fakeAlvo[1] = 1.0;
  else if (tBaixo && !tCima) fakeAlvo[1] = 0.0;
  else                       fakeAlvo[1] = 0.5;

  // Z: zona 0 (confirmar) = perto da placa = u 0
  if (tZperto && !tZlonge)      fakeAlvo[2] = 0.0;
  else if (tZlonge && !tZperto) fakeAlvo[2] = 1.0;
  else                          fakeAlvo[2] = 0.5;
}

/** Chamado a cada quadro do draw(): move a mao e emite no ritmo do
 *  firmware real. */
void fakeRoda() {
  if (!fakeAtivo) return;

  int agora = millis();
  float dt = (agora - fakeUltimoPasso) / 1000.0;
  fakeUltimoPasso = agora;
  dt = constrain(dt, 0, 0.1);   // protege contra pausas longas

  fakeAtualizaAlvos();
  for (int i = 0; i < 3; i++) {
    float passo = FAKE_VELOCIDADE * dt;
    if (abs(fakeAlvo[i] - fakeU[i]) <= passo) fakeU[i] = fakeAlvo[i];
    else fakeU[i] += (fakeAlvo[i] > fakeU[i]) ? passo : -passo;
  }

  if (agora - fakeUltimoEmit >= FAKE_INTERVALO_MS) {
    fakeUltimoEmit = agora;
    float[] raw = new float[3];
    for (int i = 0; i < 3; i++) raw[i] = fakeContagem(i, fakeU[i]);
    processaQuadro(raw);
  }
}

float fakeContagem(int eixo, float u) {
  float d = FAKE_DMIN + u * (FAKE_DMAX - FAKE_DMIN);
  float limpo = FAKE_BASE[eixo] + FAKE_ESCALA[eixo] / (d * d);
  return round(limpo + random(-FAKE_RUIDO[eixo], FAKE_RUIDO[eixo]));
}

/** Varredura automatica de calibracao, para nao precisar segurar C e
 *  as setas ao mesmo tempo. Chamada com a tecla A. */
boolean fakeVarrendo = false;
int fakeVarreduraInicio = 0;
final int FAKE_VARREDURA_MS = 2400;  // 800ms por eixo

void fakeIniciaVarredura() {
  if (!fakeAtivo) { mostra("varredura automatica so com o firmware falso"); return; }
  fakeVarrendo = true;
  fakeVarreduraInicio = millis();
  iniciaCalibracao();
}

void fakeRodaVarredura() {
  if (!fakeVarrendo) return;
  int t = millis() - fakeVarreduraInicio;
  if (t >= FAKE_VARREDURA_MS) {
    fakeVarrendo = false;
    terminaCalibracao();
    return;
  }
  // um eixo de cada vez, indo e voltando de ponta a ponta
  int eixo = constrain(t / 800, 0, 2);
  float fase = (t % 800) / 800.0;
  for (int i = 0; i < 3; i++) fakeAlvo[i] = 0.5;
  fakeAlvo[eixo] = (fase < 0.5) ? 0.0 : 1.0;
  // durante a varredura a mao anda mais rapido que o normal
  fakeU[eixo] = lerp(fakeU[eixo], fakeAlvo[eixo], 0.45);
}
