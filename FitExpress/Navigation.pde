// ============================================================
// Navigation.pde - navegacao por TAXA (rate control)
//
// Porte do navigation.js da versao web. Os eixos nao sao coordenadas,
// sao COMANDOS - e por isso o layout pode ter qualquer tamanho (o
// cardapio aqui tem 3x4, nao 3x3).
//
//   X: 0 = move para a esquerda | 1 = parado | 2 = move para a direita
//   Y: 0 = move para cima       | 1 = parado | 2 = move para baixo
//   Z: 0 = confirmar            | 1 = nada   | 2 = desfazer/voltar
//
// ASSIMETRIA DELIBERADA ENTRE X/Y E Z
// -----------------------------------
// X e Y REPETEM enquanto a mao fica fora do centro, como tecla
// segurada: primeiro passo depois de DWELL_XY_MS, os seguintes a cada
// REPEAT_XY_MS.
//
// Z dispara UMA UNICA VEZ por entrada na zona e so rearma quando a mao
// volta para Z1. Se Z repetisse igual a X/Y, uma mao parada perto da
// placa atravessaria "Concluir Pedido" -> "Prosseguir para Pagamento"
// -> "Concluir Compra" em tres tiques, fechando um pedido sozinha.
// ============================================================

// ---- constantes de tempo (as mesmas da versao web) ----

/** Tempo parado em X0/X2/Y0/Y2 antes do PRIMEIRO passo. */
final int DWELL_XY_MS = 2000;

/** Tempo em Z0/Z2 antes de acionar. Separado do XY de proposito:
 *  confirmar pode querer ser mais lento (menos falso positivo) do que
 *  navegar, ou o contrario, sem que um afete o outro. */
final int DWELL_Z_MS = 2000;

/** Repeticao de X/Y enquanto a mao permanece fora do centro. Menor que
 *  o dwell inicial, senao atravessar 3 colunas levaria 3x o dwell. */
final int REPEAT_XY_MS = 1000;

// ---- histerese: IMPLEMENTADA, MAS DESLIGADA ----
// Com CUTOFF = 0.2 a zona morta ja ocupa 60% do curso. Ligar isso so
// faz sentido se aparecer tremor na fronteira: em controle por taxa um
// flicker de fronteira nao apenas pisca o destaque, ele INJETA passos.
// Para ligar, troque para true.
final boolean HISTERESE_LIGADA = false;
final float HISTERESE_MARGEM = 0.04;

// ---- zonas ----
static final int ZONA_BAIXA = 0;
static final int ZONA_NEUTRA = 1;
static final int ZONA_ALTA = 2;

static final int Z_ZONA_CONFIRMAR = ZONA_BAIXA; // mao PERTO da placa Z
static final int Z_ZONA_DESFAZER  = ZONA_ALTA;  // mao LONGE da placa Z

/** Sem quadros por mais que isso, a fonte de dados esta parada. */
final int QUADRO_VELHO_MS = 500;

// ---- tipos de alvo ----
static final int T_ITEM = 0;      // item do cardapio
static final int T_ACAO = 1;      // botao
static final int T_PAGAMENTO = 2; // forma de pagamento

// ============================================================
// Um alvo focavel.
//
// `bx/by/bw/bh` sao preenchidos pelo desenho a cada quadro: e assim
// que a moldura de foco e a barra de dwell sabem onde se desenhar,
// sem a navegacao precisar saber nada de layout.
// ============================================================
class Target {
  int kind;
  String key;
  String label = "";
  int item = -1;         // indice no cardapio (T_ITEM)
  String method = "";    // forma de pagamento (T_PAGAMENTO)
  int estilo = BTN_PRIMARIO;
  int seta = 0;          // -1 seta a esquerda, +1 a direita
  float bx, by, bw, bh;  // retangulo na tela
  float braio = RAIO;

  Target(int kind, String key) {
    this.kind = kind;
    this.key = key;
  }

  /** Chamado pelo desenho a cada quadro. Nome nao e `rect` de proposito:
   *  dentro da classe isso sombrearia o rect() do Processing. */
  void setRect(float x, float y, float w, float h, float r) {
    bx = x; by = y; bw = w; bh = h; braio = r;
  }
}

// ============================================================
// Navigator
// ============================================================
class Navigator {
  Target[][] mapa = new Target[0][0];
  int linha = 0, coluna = 0;

  int[] zonas = { ZONA_NEUTRA, ZONA_NEUTRA, ZONA_NEUTRA };
  float[] valores = { 0, 0, 0 };
  int ultimoQuadro = -999999;

  // estado por eixo
  int[] axZona = { ZONA_NEUTRA, ZONA_NEUTRA, ZONA_NEUTRA };
  int[] axProximo = { 0, 0, 0 };   // millis do proximo passo
  int[] axJanela = { DWELL_XY_MS, DWELL_XY_MS, DWELL_XY_MS };
  boolean[] axAtivo = { false, false, false };

  int zDesde = 0;
  boolean zArmado = true;

  Navigator() { reset(0); }

  // ----------------------------------------------------------
  // Mapa de foco
  // ----------------------------------------------------------
  /** Linhas podem ter tamanhos diferentes: mover na vertical para uma
   *  linha mais curta fixa a coluna no ultimo indice valido. */
  void setMapa(Target[][] m, int linhaInicial, int colunaInicial) {
    mapa = (m == null || m.length == 0) ? new Target[0][0] : m;
    linha = mapa.length == 0 ? 0 : constrain(linhaInicial, 0, mapa.length - 1);
    int len = mapa.length == 0 ? 0 : mapa[linha].length;
    coluna = len == 0 ? 0 : constrain(colunaInicial, 0, len - 1);
  }

  Target focado() {
    if (mapa.length == 0) return null;
    if (linha < 0 || linha >= mapa.length) return null;
    Target[] l = mapa[linha];
    if (coluna < 0 || coluna >= l.length) return null;
    return l[coluna];
  }

  /** Move o foco para um alvo pela key (usado pelo mouse). */
  boolean focaKey(String key) {
    for (int r = 0; r < mapa.length; r++) {
      for (int c = 0; c < mapa[r].length; c++) {
        if (mapa[r][c] != null && mapa[r][c].key.equals(key)) {
          linha = r; coluna = c;
          return true;
        }
      }
    }
    return false;
  }

  // ----------------------------------------------------------
  // Estado dos eixos
  // ----------------------------------------------------------
  /** Zera temporizadores e rearma Z. Usado ao entrar/sair da
   *  calibracao: sem isso, terminar a varredura com a mao dentro de Z0
   *  deixa o eixo travado esperando voce "sair e voltar". */
  void reset(int agora) {
    for (int i = 0; i < 3; i++) {
      axZona[i] = ZONA_NEUTRA;
      axAtivo[i] = false;
      axJanela[i] = DWELL_XY_MS;
      zonas[i] = ZONA_NEUTRA;
    }
    zDesde = agora;
    zArmado = true;
  }

  /** Zona do eixo. Sem histerese, usa getPosition() sem tocar nele. */
  int zonaDe(int eixo, float v) {
    if (!HISTERESE_LIGADA) return getPosition(v);

    float lo = CUTOFF, hi = 1 - CUTOFF, h = HISTERESE_MARGEM;
    if (v < lo - h) return ZONA_BAIXA;
    if (v > lo + h && v < hi - h) return ZONA_NEUTRA;
    if (v > hi + h) return ZONA_ALTA;
    return zonas[eixo];  // dentro da margem: mantem a zona anterior
  }

  // ----------------------------------------------------------
  // Um quadro do pipeline
  // ----------------------------------------------------------
  void update(float[] suave, int agora) {
    ultimoQuadro = agora;
    for (int i = 0; i < 3; i++) valores[i] = suave[i];

    int zx = zonaDe(0, suave[0]);
    int zy = zonaDe(1, suave[1]);
    int zz = zonaDe(2, suave[2]);
    zonas[0] = zx; zonas[1] = zy; zonas[2] = zz;

    // X/Y: temporizadores independentes por eixo, entao sair do centro
    // nos dois ao mesmo tempo faz os dois expirarem juntos = diagonal.
    int dx = tickMove(0, zx, agora);
    int dy = tickMove(1, zy, agora);
    if (dx != 0 || dy != 0) move(dx, dy);

    // Z: um disparo por entrada na zona
    int acao = tickZ(zz, agora);
    if (acao == 1) onConfirmar(focado());
    else if (acao == -1) onDesfazer(focado());
  }

  int tickMove(int eixo, int zona, int agora) {
    if (zona != axZona[eixo]) {
      axZona[eixo] = zona;
      axJanela[eixo] = DWELL_XY_MS;
      axAtivo[eixo] = (zona != ZONA_NEUTRA);
      axProximo[eixo] = agora + DWELL_XY_MS;
      return 0;
    }
    if (zona == ZONA_NEUTRA) { axAtivo[eixo] = false; return 0; }
    if (agora < axProximo[eixo]) return 0;
    axJanela[eixo] = REPEAT_XY_MS;
    axProximo[eixo] = agora + REPEAT_XY_MS;
    return zona == ZONA_BAIXA ? -1 : +1;
  }

  int tickZ(int zona, int agora) {
    if (zona != axZona[2]) {
      axZona[2] = zona;
      zDesde = agora;
      zArmado = true;
      return 0;
    }
    if (zona == ZONA_NEUTRA) {
      zArmado = true;   // voltar ao centro e o que rearma
      return 0;
    }
    if (!zArmado || agora - zDesde < DWELL_Z_MS) return 0;
    zArmado = false;    // dispara uma vez so
    return zona == Z_ZONA_CONFIRMAR ? 1 : -1;
  }

  /** Movimento com clamp nas bordas - sem comportamento ciclico. */
  void move(int dx, int dy) {
    if (mapa.length == 0) return;
    int r = constrain(linha + dy, 0, mapa.length - 1);
    int len = mapa[r].length;
    if (len == 0) return;
    int c = constrain(coluna + dx, 0, len - 1);
    if (r == linha && c == coluna) return;  // ja estava na borda
    linha = r;
    coluna = c;
  }

  // ----------------------------------------------------------
  // Leituras para o HUD
  // ----------------------------------------------------------
  boolean fonteParada() {
    return millis() - ultimoQuadro > QUADRO_VELHO_MS;
  }

  /** 0..1 - quanto falta para Z acionar. 0 se neutro ou ja disparado. */
  float progressoZ() {
    if (axZona[2] == ZONA_NEUTRA || !zArmado || fonteParada()) return 0;
    return constrain((millis() - zDesde) / float(DWELL_Z_MS), 0, 1);
  }

  /** 0..1 - quanto falta para o proximo passo de X ou Y. */
  float progressoMove(int eixo) {
    if (!axAtivo[eixo] || fonteParada()) return 0;
    return constrain(1 - (axProximo[eixo] - millis()) / float(axJanela[eixo]), 0, 1);
  }

  int zonaVisivel(int eixo) {
    return fonteParada() ? ZONA_NEUTRA : zonas[eixo];
  }
}
