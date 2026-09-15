/**
 * app.js — Fit Express
 * ----------------------------------------------------------------------
 * Telas (início → cardápio → revisão → pagamento → confirmação),
 * carrinho e checkout.
 *
 * A navegação por gestos vive em navigation.js (controle por TAXA): os
 * eixos são comandos de movimento, não coordenadas. Aqui só declaramos,
 * por tela, um MAPA DE FOCO — linhas de alvos focáveis — e o motor cuida
 * de mover, repetir, confirmar e voltar. Consequência prática: a tela de
 * pagamento passou a ter navegação sem uma linha de código específica.
 *
 * tracking.js (a matemática portada do Processing) não foi tocada.
 * ----------------------------------------------------------------------
 */

// ---------------------------------------------------------------------
// Dados do cardápio
// ---------------------------------------------------------------------
const MENU_ITEMS = [
  { id: "quinoa-bowl", emoji: "🥣", name: "Bowl de Quinoa com Frango", price: 24.9 },
  { id: "wrap-grao",   emoji: "🌯", name: "Wrap Integral de Grão-de-Bico", price: 19.9 },
  { id: "salada-fit",  emoji: "🥗", name: "Salada Caesar Fit", price: 22.9 },
  { id: "burger-veg",  emoji: "🍔", name: "Burger Vegetal", price: 23.9 },
  { id: "tofu-esp",    emoji: "🍢", name: "Espetinho de Tofu Grelhado", price: 18.9 },
  { id: "suco-verde",  emoji: "🥤", name: "Suco Verde Detox", price: 12.9 },
  { id: "agua-coco",   emoji: "🥥", name: "Água de Coco Natural", price: 8.9 },
  { id: "mix-castanha",emoji: "🥜", name: "Mix de Castanhas", price: 9.9 },
  { id: "iogurte",     emoji: "🍓", name: "Iogurte com Granola e Frutas", price: 14.9 },
];

const GRID_COLS = 3;
const GRID_ROWS = 3;

// ---------------------------------------------------------------------
// Estado global
// ---------------------------------------------------------------------
const state = {
  screen: "start",
  cart: {},        // { itemId: qty }
  paymentMethod: null,
  simMode: false,
};

const link = new ArduinoLink();       // hardware real, via Web Serial
const fake = new FakeArduinoLink();   // firmware falso, via teclado
const tracker = new Tracker();        // pipeline portado do Processing
const nav = new Navigator();          // navegação por taxa

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
const formatBRL = (value) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function byId(id) {
  return document.getElementById(id);
}

function cartEntries() {
  return Object.entries(state.cart)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({ item: MENU_ITEMS.find((i) => i.id === id), qty }));
}

function cartTotal() {
  return cartEntries().reduce((sum, { item, qty }) => sum + item.price * qty, 0);
}

// =====================================================================
// MAPAS DE FOCO
// =====================================================================
// Cada tela é uma matriz de linhas de alvos. O motor move com clamp nas
// bordas (sem ciclo) e aceita diagonal quando X e Y saem do centro juntos.

/** Alvo de botão simples. */
function buttonTarget(key, elementId, confirm) {
  return { key, element: () => byId(elementId), confirm, secondary: null };
}

/**
 * Alvo de item do cardápio: Z0 adiciona, Z2 remove uma unidade.
 *
 * `secondary()` devolve `true` quando de fato desfez algo. É isso que
 * permite a regra única do Z2 (ver `nav.onSecondary`): item com
 * quantidade 0 não tem o que desfazer, então devolve `false`.
 */
function itemTarget(index) {
  const item = MENU_ITEMS[index];
  const key = "item-" + item.id;
  return {
    key,
    element: () => document.querySelector('[data-focus-key="' + key + '"]'),
    confirm: () => addToCart(item.id),
    secondary: () => removeFromCart(item.id),
  };
}

/**
 * Alvo de forma de pagamento: Z0 escolhe, Z2 desmarca.
 *
 * O Z2 é **escopo do alvo**, igual ao do cardápio: ele só desmarca a forma
 * que está em foco. Apontando para uma forma que não é a escolhida não há
 * nada a desfazer *neste alvo* — devolve `false` e o Z2 vira "voltar".
 * Antes isto era escopo de tela, então Z2 apontando para o Pix limpava o
 * Crédito: agia sobre um alvo que não estava sendo apontado.
 */
function paymentTarget(method) {
  const key = "pay-" + method;
  return {
    key,
    element: () =>
      document.querySelector('.payment-option[data-method="' + method + '"]'),
    confirm: () => {
      state.paymentMethod = method;
      renderPayment();
    },
    secondary: () => {
      if (state.paymentMethod !== method) return false;
      state.paymentMethod = null;
      renderPayment(); // reflete o desmarque e volta a bloquear Concluir Compra
      return true;
    },
  };
}

// "Concluir Pedido" ocupa a 4ª coluna inteira — a MESMA referência nas 3
// linhas. Assim a linha de origem é lembrada de graça: saindo de [1][3]
// para a esquerda você volta para [1][2], sem nenhum `lastRow` guardado.
const TARGET_FINISH = buttonTarget("finish", "btnFinishOrder", () => {
  if (cartEntries().length > 0) showScreen("review");
});

function menuMap() {
  const rows = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    const row = [];
    for (let c = 0; c < GRID_COLS; c++) row.push(itemTarget(r * GRID_COLS + c));
    row.push(TARGET_FINISH);
    rows.push(row);
  }
  return rows;
}

const FOCUS_MAPS = {
  start: () => [
    [
      buttonTarget("start-order", "btnStartOrder", () => {
        if (!byId("btnStartOrder").disabled) showScreen("menu");
      }),
    ],
  ],

  menu: menuMap,

  review: () => [
    [
      buttonTarget("back-menu", "btnBackToMenu", () => showScreen("menu")),
      buttonTarget("to-payment", "btnGoToPayment", () => showScreen("payment")),
    ],
  ],

  // 2x2 de formas de pagamento + uma linha de ações: 3 linhas x 2 colunas.
  payment: () => [
    [paymentTarget("credito"), paymentTarget("debito")],
    [paymentTarget("pix"), paymentTarget("dinheiro")],
    [
      buttonTarget("back-review", "btnBackToReview", () => showScreen("review")),
      buttonTarget("confirm-purchase", "btnConfirmPurchase", confirmPurchase),
    ],
  ],

  confirmation: () => [
    [buttonTarget("new-order", "btnNewOrder", startNewOrder)],
  ],
};

/** Foco inicial por tela: o cardápio começa no centro da grade. */
const INITIAL_FOCUS = {
  menu: { row: 1, col: 1 },
};

/**
 * Para onde o Z2 "volta" em cada tela, quando o alvo focado não tinha nada
 * a desfazer. Telas ausentes daqui simplesmente não têm voltar (o cardápio
 * é o início do pedido; a confirmação já fechou a compra).
 */
const SCREEN_BACK = {
  review: () => showScreen("menu"),
  payment: () => showScreen("review"),
};

// ---------------------------------------------------------------------
// Navegação entre telas
// ---------------------------------------------------------------------
function showScreen(name) {
  state.screen = name;
  document.querySelectorAll(".screen").forEach((el) => {
    el.hidden = el.dataset.screen !== name;
  });

  const build = FOCUS_MAPS[name];
  nav.setMap(build ? build() : [[]], INITIAL_FOCUS[name]);

  if (name === "menu") renderMenu();
  if (name === "review") renderReview();
  if (name === "payment") renderPayment();

  paintFocus();
}

// ---------------------------------------------------------------------
// Renderização: Cardápio
// ---------------------------------------------------------------------
function renderMenu() {
  const grid = byId("menuGrid");
  grid.innerHTML = "";

  MENU_ITEMS.forEach((item) => {
    const qty = state.cart[item.id] || 0;
    const card = document.createElement("div");
    card.className = "menu-item";
    // key estável: o destaque é aplicado por paintFocus(), não aqui, para
    // que re-renderizar a grade não perca o foco.
    card.dataset.focusKey = "item-" + item.id;
    card.innerHTML = `
      ${qty > 0 ? `<span class="qty-badge">${qty}</span>` : ""}
      <div class="emoji">${item.emoji}</div>
      <h3>${item.name}</h3>
      <div class="price">${formatBRL(item.price)}</div>
    `;
    // clique com o mouse também funciona (acessibilidade / fallback)
    card.addEventListener("click", () => {
      nav.focusKey("item-" + item.id);
      addToCart(item.id);
    });
    grid.appendChild(card);
  });

  renderCartPanel();
  paintFocus(); // o innerHTML acima destruiu o destaque anterior
}

function renderCartPanel() {
  const list = byId("cartList");
  const entries = cartEntries();

  list.innerHTML = entries.length
    ? entries
        .map(
          ({ item, qty }) => `
        <li><span>${qty}x ${item.name}</span><span>${formatBRL(item.price * qty)}</span></li>
      `
        )
        .join("")
    : `<li class="cart-empty">Nenhum item selecionado ainda</li>`;

  byId("cartTotal").textContent = formatBRL(cartTotal());
  byId("btnFinishOrder").disabled = entries.length === 0;
}

// ---------------------------------------------------------------------
// Renderização: Revisão
// ---------------------------------------------------------------------
function renderReview() {
  byId("reviewList").innerHTML = cartEntries()
    .map(
      ({ item, qty }) => `
      <li><span>${qty}x ${item.name}</span><span>${formatBRL(item.price * qty)}</span></li>
    `
    )
    .join("");
  byId("reviewTotal").textContent = formatBRL(cartTotal());
}

// ---------------------------------------------------------------------
// Renderização: Pagamento
// ---------------------------------------------------------------------
function renderPayment() {
  byId("paymentTotal").textContent = formatBRL(cartTotal());
  document.querySelectorAll(".payment-option").forEach((btn) => {
    btn.classList.toggle("selected", btn.dataset.method === state.paymentMethod);
  });
  byId("btnConfirmPurchase").disabled = !state.paymentMethod;
}

// ---------------------------------------------------------------------
// Ações do carrinho
// ---------------------------------------------------------------------
function addToCart(itemId) {
  state.cart[itemId] = (state.cart[itemId] || 0) + 1;
  if (state.screen === "menu") renderMenu();
}

/** @returns {boolean} true se realmente removeu uma unidade. */
function removeFromCart(itemId) {
  if (!state.cart[itemId]) return false;
  state.cart[itemId] -= 1;
  if (state.cart[itemId] <= 0) delete state.cart[itemId];
  if (state.screen === "menu") renderMenu();
  return true;
}

// =====================================================================
// Destaque do foco + indicador de permanência (dwell)
// =====================================================================
function paintFocus() {
  document.querySelectorAll(".cursor").forEach((el) => {
    el.classList.remove("cursor", "dwell-confirm", "dwell-secondary");
    el.style.removeProperty("--dwell");
  });
  const target = nav.focused();
  const el = target && target.element ? target.element() : null;
  if (el) el.classList.add("cursor");
}

const HUD_ARROWS_X = ["◀", "■", "▶"];
const HUD_ARROWS_Y = ["▲", "■", "▼"];
const HUD_Z_LABELS = ["confirmar", "—", "voltar"];

function paintHudAxis(id, glyph, value, zone, progress) {
  const box = byId(id);
  if (!box) return;
  box.querySelector(".hud-dir").textContent = glyph;
  box.querySelector(".hud-val").textContent = value.toFixed(2);
  box.querySelector(".hud-fill").style.width = (progress * 100).toFixed(1) + "%";
  box.classList.toggle("active", zone !== 1);
}

/**
 * Loop de pintura separado do loop de dados: o Arduino manda ~10 quadros
 * por segundo, o que faria a barra de dwell andar aos saltos de 100ms.
 * A lógica continua rodando só nos quadros do sensor; aqui só desenhamos.
 */
function paintLoop() {
  const stale = nav.isStale;
  const zProgress = nav.zProgress();

  const target = nav.focused();
  const el = target && target.element ? target.element() : null;
  if (el) {
    el.style.setProperty("--dwell", zProgress);
    el.classList.toggle("dwell-confirm", zProgress > 0 && nav.zones[2] === 0);
    el.classList.toggle("dwell-secondary", zProgress > 0 && nav.zones[2] === 2);
  }

  const z = stale ? [1, 1, 1] : nav.zones;
  paintHudAxis("hudX", HUD_ARROWS_X[z[0]], nav.values[0], z[0], nav.moveProgress(0));
  paintHudAxis("hudY", HUD_ARROWS_Y[z[1]], nav.values[1], z[1], nav.moveProgress(1));
  paintHudAxis("hudZ", HUD_Z_LABELS[z[2]], nav.values[2], z[2], zProgress);

  requestAnimationFrame(paintLoop);
}
requestAnimationFrame(paintLoop);

// ---------------------------------------------------------------------
// Painel de depuração dos sensores
// ---------------------------------------------------------------------
const AXIS_LABELS = ["X", "Y", "Z"];

function updateSensorDebug(snap) {
  AXIS_LABELS.forEach((axis, i) => {
    const bar = byId("bar" + axis);
    if (bar) {
      bar.value = snap.smooth[i] * 30; // o progress do HTML tem max="30"
      byId("val" + axis).textContent = snap.smooth[i].toFixed(2);
    }
    const calBar = byId("calBar" + axis);
    if (calBar) {
      calBar.value = snap.smooth[i];
      byId("calVal" + axis).textContent =
        snap.raw[i] + " -> " + snap.smooth[i].toFixed(2);
    }
  });

  const cellText =
    "zona  X" + snap.ixyz[0] + "  Y" + snap.ixyz[1] + "  Z" + snap.ixyz[2];
  const cellMenu = byId("cellReadout");
  if (cellMenu) cellMenu.textContent = cellText;
  const cellCal = byId("calibCell");
  if (cellCal) cellCal.textContent = cellText;
}

// ---------------------------------------------------------------------
// Um quadro do pipeline
// ---------------------------------------------------------------------
tracker.addEventListener("frame", (e) => {
  const snap = e.detail;
  updateSensorDebug(snap);

  // Durante a varredura de calibração os limites mudam a cada quadro, então
  // as zonas oscilam. Congelamos a navegação e mantemos os temporizadores
  // zerados — é isso que evita terminar a calibração já "dentro" de Z0.
  if (snap.calibrating) {
    nav.reset();
    return;
  }

  nav.update(snap);
});

nav.onFocus = () => paintFocus();

nav.onConfirm = (target) => {
  if (target && target.confirm) target.confirm();
};

/**
 * A REGRA DO Z2 (uma só, para todas as telas)
 * -------------------------------------------
 * Z2 pede ao alvo em FOCO para se desfazer. Se o alvo não tinha nada a
 * desfazer (devolveu falso, ou não tem ação secundária), Z2 sai da tela.
 *
 * Isso mantém o Z2 sempre no escopo do que está sendo apontado:
 *
 *   cardápio, item com quantidade > 0  -> remove uma unidade
 *   cardápio, item com quantidade 0    -> nada a desfazer; cardápio não tem
 *                                         voltar, então nada acontece
 *   pagamento, forma em foco escolhida -> desmarca
 *   pagamento, forma em foco NÃO       -> nada a desfazer neste alvo, então
 *     escolhida                           volta à revisão (sem mexer na
 *                                         escolha atual)
 *   revisão / botões                   -> volta uma tela
 */
nav.onSecondary = (target) => {
  if (target && target.secondary && target.secondary() === true) return;
  const back = SCREEN_BACK[state.screen];
  if (back) back();
};

// ---------------------------------------------------------------------
// Calibração — equivalente ao `mousePressed && mouseButton == LEFT` do
// sketch: enquanto o botão está pressionado, os limites são aprendidos.
// ---------------------------------------------------------------------
const btnCalibrate = byId("btnCalibrate");

btnCalibrate.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  tracker.startCalibration();
});

function endCalibration() {
  if (tracker.calibrating) tracker.stopCalibration();
}

window.addEventListener("pointerup", endCalibration);
window.addEventListener("pointercancel", endCalibration);

// Segurar a barra de espaço faz o mesmo, para quem calibra longe do mouse.
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && state.screen === "start" && !e.repeat) {
    e.preventDefault();
    tracker.startCalibration();
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") endCalibration();
});

tracker.addEventListener("calibration", () => {
  btnCalibrate.classList.toggle("calibrating", tracker.calibrating);

  if (!tracker.calibrating) {
    nav.reset();
    // A varredura pelo teclado termina com a mão virtual num extremo;
    // devolvê-la ao centro deixa Z em Z1 (neutro), pronto para o primeiro
    // confirmar — sem precisar "sair e voltar" antes de selecionar.
    if (fake.isConnected) fake.recenter();
  }

  const hint = byId("calibHint");
  if (tracker.calibrating) {
    hint.textContent =
      "Definindo limites — mova a mão por todo o alcance de cada placa, do encosto até fora de alcance.";
  } else if (tracker.isCalibrated) {
    hint.textContent =
      "Limites: " +
      tracker
        .bounds()
        .map((b, i) => AXIS_LABELS[i] + " " + b.min + "–" + b.max)
        .join("   ·   ");
  } else {
    hint.textContent =
      "Ainda sem calibração: segure o botão (ou a barra de espaço) e varra a mão por todo o alcance das três placas.";
  }
  updateStartGate();
});

byId("btnResetCalib").addEventListener("click", () => {
  tracker.reset();
  nav.reset();
});

// ---------------------------------------------------------------------
// Conexão — ArduinoLink e FakeArduinoLink têm a mesma interface
// ---------------------------------------------------------------------
function wireLink(source, statusKind, statusText) {
  source.addEventListener("data", (e) => tracker.update(e.detail.raw));
  source.addEventListener("connect", () => {
    setSensorStatus(statusKind, statusText);
    nav.reset();
    updateStartGate();
  });
  source.addEventListener("disconnect", () => {
    setSensorStatus("offline", "Sensores desconectados");
    updateStartGate();
  });
  source.addEventListener("error", (e) => {
    console.error("Erro na fonte de dados:", e.detail);
    setSensorStatus("offline", "Erro na conexão — reconecte");
  });
}

wireLink(link, "online", "Arduino conectado");
wireLink(fake, "sim", "Firmware falso (teclado) ativo");

function anySourceConnected() {
  return link.isConnected || fake.isConnected;
}

/** O pedido só começa com uma fonte conectada E a calibração feita. */
function updateStartGate() {
  const btnStart = byId("btnStartOrder");
  const btnConnect = byId("btnConnect");
  btnStart.disabled = !(anySourceConnected() && tracker.isCalibrated);

  btnConnect.disabled = link.isConnected;
  btnConnect.textContent = link.isConnected
    ? "🔌 Conectado"
    : "🔌 Conectar ao Arduino";
  btnCalibrate.disabled = !anySourceConnected();

  const hint = byId("startHint");
  if (!anySourceConnected()) {
    hint.textContent = "Conecte o Arduino ou ative o firmware falso para continuar.";
  } else if (!tracker.isCalibrated) {
    hint.textContent =
      "Falta calibrar: segure Definir limites e varra a mão pelas três placas.";
  } else {
    hint.textContent = "Pronto! Abaixe a mão sobre a placa Z (ou clique) para iniciar.";
  }
}

function setSensorStatus(kind, text) {
  const dot = byId("sensorDot");
  dot.classList.remove("online", "sim");
  if (kind === "online") dot.classList.add("online");
  if (kind === "sim") dot.classList.add("sim");
  byId("sensorStatusText").textContent = text;
}

// ---------------------------------------------------------------------
// Firmware falso (teclado): setas para X/Y, w/s para Z
// ---------------------------------------------------------------------
byId("chkSimMode").addEventListener("change", async (e) => {
  state.simMode = e.target.checked;
  if (state.simMode) await fake.connect();
  else await fake.disconnect();
});

// ---------------------------------------------------------------------
// Botões de navegação e ações de UI (mouse continua funcionando)
// ---------------------------------------------------------------------
byId("btnConnect").addEventListener("click", async () => {
  try {
    await link.connect();
  } catch (err) {
    alert(err.message);
  }
});

byId("btnStartOrder").addEventListener("click", () => showScreen("menu"));
byId("btnFinishOrder").addEventListener("click", () => showScreen("review"));
byId("btnBackToMenu").addEventListener("click", () => showScreen("menu"));
byId("btnGoToPayment").addEventListener("click", () => showScreen("payment"));
byId("btnBackToReview").addEventListener("click", () => showScreen("review"));

document.querySelectorAll(".payment-option").forEach((btn) => {
  btn.addEventListener("click", () => {
    nav.focusKey("pay-" + btn.dataset.method);
    state.paymentMethod = btn.dataset.method;
    renderPayment();
    paintFocus();
  });
});

function confirmPurchase() {
  if (!state.paymentMethod) return;
  const orderNumber = String(Math.floor(100 + Math.random() * 900));
  byId("orderNumber").textContent = orderNumber;
  byId("confirmationList").innerHTML = byId("reviewList").innerHTML;
  byId("confirmationTotal").textContent = formatBRL(cartTotal());
  showScreen("confirmation");
}

function startNewOrder() {
  state.cart = {};
  state.paymentMethod = null;
  // Fluxo de totem: o proximo cliente cai direto no cardapio, sem passar
  // pela tela inicial. Mas a tela inicial e o unico lugar com "Conectar" e
  // "Definir limites" — entao se a fonte caiu ou a calibracao se perdeu,
  // voltamos para la, para nao ficar preso num cardapio que nao responde.
  const ready = anySourceConnected() && tracker.isCalibrated;
  showScreen(ready ? "menu" : "start");
}

byId("btnConfirmPurchase").addEventListener("click", confirmPurchase);
byId("btnNewOrder").addEventListener("click", startNewOrder);

// estado inicial
showScreen("start");
updateStartGate();
