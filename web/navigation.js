/**
 * navigation.js
 * ----------------------------------------------------------------------
 * Motor de navegação por TAXA (rate control), não por posição absoluta.
 *
 * Antes: ixyz[0] era a coluna e ixyz[1] era a linha — a grade tinha que
 * ter exatamente 3x3 porque o sensor tem exatamente 3 zonas por eixo. Era
 * por isso que a tela de pagamento (4 opções) não tinha navegação nenhuma:
 * não existe mapeamento de 3 zonas para 4 alvos.
 *
 * Agora os eixos são COMANDOS, e o layout pode ter qualquer tamanho:
 *
 *   X: 0 = move para a esquerda | 1 = parado | 2 = move para a direita
 *   Y: 0 = move para cima       | 1 = parado | 2 = move para baixo
 *   Z: 0 = confirmar            | 1 = nada   | 2 = ação secundária/voltar
 *
 * ASSIMETRIA DELIBERADA ENTRE X/Y E Z
 * -----------------------------------
 * X e Y REPETEM enquanto a mão fica na zona (como tecla segurada): primeiro
 * passo depois de DWELL_XY_MS, os seguintes a cada REPEAT_XY_MS.
 *
 * Z dispara UMA ÚNICA VEZ por entrada na zona e só rearma quando a mão
 * volta para Z1. Se Z repetisse igual a X/Y, uma mão parada perto da placa
 * atravessaria "Concluir Pedido" -> "Prosseguir para Pagamento" ->
 * "Concluir Compra" em três tiques, fechando um pedido real sozinha.
 *
 * Nada aqui mexe em tracking.js: a matemática portada do Processing
 * continua intacta. Só a INTERPRETAÇÃO de ixyz muda.
 * ----------------------------------------------------------------------
 */

// ======================================================================
// Constantes de tempo — todas ajustáveis
// ======================================================================

/** Tempo que a mão precisa ficar em X0/X2/Y0/Y2 antes do PRIMEIRO passo. */
const DWELL_XY_MS = 2000;

/** Tempo na zona Z0/Z2 antes de acionar. Separado do XY de propósito:
 *  confirmar pode querer ser mais lento (menos falso positivo) do que
 *  navegar, ou o contrário. Hoje os dois valem o mesmo. */
const DWELL_Z_MS = 2000;

/** Repetição de X/Y enquanto a mão permanece fora do centro. Menor que o
 *  dwell inicial, senão atravessar 3 colunas levaria 3 x DWELL_XY_MS. */
const REPEAT_XY_MS = 1500;

// ======================================================================
// Histerese — IMPLEMENTADA, MAS DESLIGADA
// ======================================================================
// Com CUTOFF = 0.2 a zona morta ocupa de 0.2 a 0.8 do curso, que é folga
// de sobra; ligar isso só faz sentido se aparecer tremor na fronteira
// gerando passos espúrios (em rate control um flicker de fronteira não
// só pisca o destaque — ele injeta movimento).
// Para ligar: HYSTERESIS_ENABLED = true.
const HYSTERESIS_ENABLED = false;
const HYSTERESIS_MARGIN = 0.04;

// ======================================================================
const AXIS_X = 0;
const AXIS_Y = 1;
const AXIS_Z = 2;

const ZONE_LOW = 0;
const ZONE_IDLE = 1;
const ZONE_HIGH = 2;

const Z_CONFIRM_ZONE = ZONE_LOW;   // mão PERTO da placa Z
const Z_SECONDARY_ZONE = ZONE_HIGH; // mão LONGE da placa Z

/** Quanto tempo sem quadros até considerar a fonte de dados parada. */
const STALE_FRAME_MS = 500;

function clampIndex(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Um alvo focável. Quem monta o mapa (app.js) fornece:
 *   key       identificador estável (sobrevive a re-render do DOM)
 *   element() resolve o nó no DOM na hora de pintar
 *   confirm() ação de Z0
 *   secondary() ação de Z2 — opcional; sem ela, cai no "voltar" da tela
 */
class Navigator {
  constructor() {
    this.map = [[]];
    this.row = 0;
    this.col = 0;

    this.zones = [ZONE_IDLE, ZONE_IDLE, ZONE_IDLE];
    this.values = [0, 0, 0];
    this.lastFrameAt = 0;

    // callbacks, atribuídos por app.js
    this.onFocus = null;
    this.onConfirm = null;
    this.onSecondary = null;

    this.reset();
  }

  // -------------------------------------------------------------------
  // Mapa de foco
  // -------------------------------------------------------------------
  /**
   * @param map     array de linhas; cada linha é um array de alvos. As
   *                linhas podem ter tamanhos diferentes (ragged) — mover
   *                na vertical para uma linha mais curta fixa a coluna no
   *                último índice válido.
   * @param initial {row, col} opcional
   */
  setMap(map, initial) {
    this.map = map && map.length ? map : [[]];
    this.row = clampIndex(initial ? initial.row : 0, 0, this.map.length - 1);
    const len = this.map[this.row].length;
    this.col = clampIndex(initial ? initial.col : 0, 0, Math.max(0, len - 1));
  }

  focused() {
    const row = this.map[this.row];
    return row ? row[this.col] || null : null;
  }

  /** Move o foco para um alvo pela key (usado pelo clique de mouse). */
  focusKey(key) {
    for (let r = 0; r < this.map.length; r++) {
      for (let c = 0; c < this.map[r].length; c++) {
        if (this.map[r][c] && this.map[r][c].key === key) {
          this.row = r;
          this.col = c;
          return true;
        }
      }
    }
    return false;
  }

  // -------------------------------------------------------------------
  // Estado dos eixos
  // -------------------------------------------------------------------
  /** Zera temporizadores e rearma Z. Usado ao entrar/sair da calibração:
   *  sem isso, terminar a varredura com a mão dentro de Z0 deixa o eixo
   *  travado (foi exatamente o desconforto relatado no teclado). */
  reset(now) {
    const t = now === undefined ? Date.now() : now;
    this.axes = [
      { zone: ZONE_IDLE, nextAt: Infinity, span: DWELL_XY_MS },
      { zone: ZONE_IDLE, nextAt: Infinity, span: DWELL_XY_MS },
      { zone: ZONE_IDLE, since: t, armed: true },
    ];
    this.zones = [ZONE_IDLE, ZONE_IDLE, ZONE_IDLE];
  }

  /** Zona do eixo. Sem histerese, usa o ixyz do pipeline sem tocar nele. */
  _zoneFor(axis, snap) {
    if (!HYSTERESIS_ENABLED) return snap.ixyz[axis];

    const v = snap.smooth[axis];
    const lo = CUTOFF;      // 0.2 — vem de tracking.js
    const hi = 1 - CUTOFF;  // 0.8
    const h = HYSTERESIS_MARGIN;
    if (v < lo - h) return ZONE_LOW;
    if (v > lo + h && v < hi - h) return ZONE_IDLE;
    if (v > hi + h) return ZONE_HIGH;
    return this.zones[axis]; // dentro da margem: mantém a zona anterior
  }

  // -------------------------------------------------------------------
  // Um quadro do pipeline
  // -------------------------------------------------------------------
  update(snap, now) {
    const t = now === undefined ? Date.now() : now;
    this.lastFrameAt = t;
    this.values = snap.smooth.slice();

    const zx = this._zoneFor(AXIS_X, snap);
    const zy = this._zoneFor(AXIS_Y, snap);
    const zz = this._zoneFor(AXIS_Z, snap);
    this.zones = [zx, zy, zz];

    // X/Y: passos com repetição. Temporizadores independentes por eixo,
    // então mão em X0+Y2 ao mesmo tempo expira junto = diagonal.
    const dx = this._tickMove(AXIS_X, zx, t);
    const dy = this._tickMove(AXIS_Y, zy, t);
    if (dx !== 0 || dy !== 0) this._move(dx, dy);

    // Z: um disparo por entrada na zona.
    const action = this._tickZ(zz, t);
    if (action === 1) this._fire(this.onConfirm);
    else if (action === -1) this._fire(this.onSecondary);
  }

  _tickMove(axis, zone, now) {
    const st = this.axes[axis];
    if (zone !== st.zone) {
      st.zone = zone;
      st.span = DWELL_XY_MS;
      st.nextAt = zone === ZONE_IDLE ? Infinity : now + DWELL_XY_MS;
      return 0;
    }
    if (zone === ZONE_IDLE || now < st.nextAt) return 0;
    st.span = REPEAT_XY_MS;
    st.nextAt = now + REPEAT_XY_MS;
    return zone === ZONE_LOW ? -1 : +1;
  }

  _tickZ(zone, now) {
    const st = this.axes[AXIS_Z];
    if (zone !== st.zone) {
      st.zone = zone;
      st.since = now;
      st.armed = true;
      return 0;
    }
    if (zone === ZONE_IDLE) {
      st.armed = true; // voltar ao centro é o que rearma
      return 0;
    }
    if (!st.armed || now - st.since < DWELL_Z_MS) return 0;
    st.armed = false; // dispara uma vez só
    return zone === Z_CONFIRM_ZONE ? 1 : -1;
  }

  /** Movimento com clamp nas bordas — sem comportamento cíclico. */
  _move(dx, dy) {
    if (!this.map.length) return;
    const row = clampIndex(this.row + dy, 0, this.map.length - 1);
    const len = this.map[row].length;
    if (len === 0) return;
    const col = clampIndex(this.col + dx, 0, len - 1);
    if (row === this.row && col === this.col) return; // já na borda
    this.row = row;
    this.col = col;
    this._fire(this.onFocus);
  }

  _fire(cb) {
    if (cb) cb(this.focused(), this);
  }

  // -------------------------------------------------------------------
  // Leituras para o HUD
  // -------------------------------------------------------------------
  get isStale() {
    return Date.now() - this.lastFrameAt > STALE_FRAME_MS;
  }

  /** 0..1 — quanto falta para Z acionar. 0 quando neutro ou já disparado. */
  zProgress(now) {
    const t = now === undefined ? Date.now() : now;
    const st = this.axes[AXIS_Z];
    if (st.zone === ZONE_IDLE || !st.armed || this.isStale) return 0;
    return Math.min(1, (t - st.since) / DWELL_Z_MS);
  }

  /** 0..1 — quanto falta para o próximo passo de X ou Y. */
  moveProgress(axis, now) {
    const t = now === undefined ? Date.now() : now;
    const st = this.axes[axis];
    if (st.zone === ZONE_IDLE || st.nextAt === Infinity || this.isStale) return 0;
    return Math.min(1, Math.max(0, 1 - (st.nextAt - t) / st.span));
  }
}
