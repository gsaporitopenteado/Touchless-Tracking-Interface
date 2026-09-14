/**
 * app.js — Fit Express
 * ----------------------------------------------------------------------
 * Controlador da interface: telas (início → cardápio → revisão →
 * pagamento → confirmação), carrinho e checkout.
 *
 * O que mudou em relação à versão anterior: o cursor NÃO é mais movido
 * por eventos de passo vindos do firmware (`moveH: "RIGHT"`). O firmware
 * real (arduino/totem/totem.ino) não emite nada disso — ele só manda três
 * contagens brutas. Quem transforma isso em posição é tracking.js, o
 * porte do sketch Processing, e ele devolve uma posição ABSOLUTA na
 * grade 3x3x3 (`ixyz`). Então o cursor é atribuído, não incrementado.
 *
 *   ixyz[0] (X) -> coluna  (movimento horizontal na tela)
 *   ixyz[1] (Y) -> linha   (movimento vertical na tela)
 *   ixyz[2] (Z) -> confirmar / cancelar
 * ----------------------------------------------------------------------
 */

// ---------------------------------------------------------------------
// Dados do cardápio (grade 3x3 — combina com a lógica de cursor 2D)
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

// Z: qual índice da grade significa o quê. O eixo Z não é invertido
// (FLIP[2] === false), e o pipeline devolve 0 quando a mão está PERTO da
// placa. Abaixar a mão sobre a placa Z = confirmar, levantar = cancelar,
// exatamente como descrito no README original.
const Z_CONFIRM_INDEX = 0;
const Z_CANCEL_INDEX = 2;
// Quantos quadros a mão precisa ficar na zona antes do evento disparar.
// A ~10 Hz do totem.ino, 3 quadros = ~300 ms — o suficiente para não
// disparar quando a mão só passa pela zona a caminho de outra.
const Z_DWELL_FRAMES = 3;

// ---------------------------------------------------------------------
// Estado global
// ---------------------------------------------------------------------
const state = {
  screen: "start",
  cursorRow: 0,
  cursorCol: 0,
  cart: {},        // { itemId: qty }
  paymentMethod: null,
  paymentFocus: 0, // forma de pagamento em foco (navegação por X/Y)
  simMode: false,
};

const link = new ArduinoLink();       // hardware real, via Web Serial
const fake = new FakeArduinoLink();   // firmware falso, via teclado
const tracker = new Tracker();        // porte do pipeline do Processing

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
const formatBRL = (value) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function cartEntries() {
  return Object.entries(state.cart)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({ item: MENU_ITEMS.find((i) => i.id === id), qty }));
}

function cartTotal() {
  return cartEntries().reduce((sum, { item, qty }) => sum + item.price * qty, 0);
}

function currentItem() {
  const index = state.cursorRow * GRID_COLS + state.cursorCol;
  return MENU_ITEMS[index];
}

function paymentButtons() {
  return Array.from(document.querySelectorAll(".payment-option"));
}

// ---------------------------------------------------------------------
// Navegação entre telas
// ---------------------------------------------------------------------
function showScreen(name) {
  state.screen = name;
  document.querySelectorAll(".screen").forEach((el) => {
    el.hidden = el.dataset.screen !== name;
  });
  if (name === "menu") renderMenu();
  if (name === "review") renderReview();
  if (name === "payment") renderPayment();
}

// ---------------------------------------------------------------------
// Renderização: Cardápio
// ---------------------------------------------------------------------
function renderMenu() {
  const grid = document.getElementById("menuGrid");
  grid.innerHTML = "";

  MENU_ITEMS.forEach((item, index) => {
    const row = Math.floor(index / GRID_COLS);
    const col = index % GRID_COLS;
    const qty = state.cart[item.id] || 0;

    const card = document.createElement("div");
    card.className = "menu-item" + (row === state.cursorRow && col === state.cursorCol ? " cursor" : "");
    card.innerHTML = `
      ${qty > 0 ? `<span class="qty-badge">${qty}</span>` : ""}
      <div class="emoji">${item.emoji}</div>
      <h3>${item.name}</h3>
      <div class="price">${formatBRL(item.price)}</div>
    `;
    // clique com o mouse também funciona (acessibilidade / fallback)
    card.addEventListener("click", () => {
      state.cursorRow = row;
      state.cursorCol = col;
      addToCart(item.id);
    });
    grid.appendChild(card);
  });

  renderCartPanel();
}

function renderCartPanel() {
  const list = document.getElementById("cartList");
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

  document.getElementById("cartTotal").textContent = formatBRL(cartTotal());
  document.getElementById("btnFinishOrder").disabled = entries.length === 0;
}

// ---------------------------------------------------------------------
// Renderização: Revisão
// ---------------------------------------------------------------------
function renderReview() {
  const list = document.getElementById("reviewList");
  list.innerHTML = cartEntries()
    .map(
      ({ item, qty }) => `
      <li><span>${qty}x ${item.name}</span><span>${formatBRL(item.price * qty)}</span></li>
    `
    )
    .join("");
  document.getElementById("reviewTotal").textContent = formatBRL(cartTotal());
}

// ---------------------------------------------------------------------
// Renderização: Pagamento
// ---------------------------------------------------------------------
function renderPayment() {
  document.getElementById("paymentTotal").textContent = formatBRL(cartTotal());
  paymentButtons().forEach((btn, i) => {
    btn.classList.toggle("selected", btn.dataset.method === state.paymentMethod);
    btn.classList.toggle("cursor", i === state.paymentFocus);
  });
  document.getElementById("btnConfirmPurchase").disabled = !state.paymentMethod;
}

// ---------------------------------------------------------------------
// Ações do carrinho (disparadas pelo gesto Z ou por clique)
// ---------------------------------------------------------------------
function addToCart(itemId) {
  state.cart[itemId] = (state.cart[itemId] || 0) + 1;
  if (state.screen === "menu") renderMenu();
}

function removeFromCart(itemId) {
  if (!state.cart[itemId]) return;
  state.cart[itemId] -= 1;
  if (state.cart[itemId] <= 0) delete state.cart[itemId];
  if (state.screen === "menu") renderMenu();
}

// ---------------------------------------------------------------------
// X / Y -> posição absoluta na tela
// ---------------------------------------------------------------------
function applyPosition(ixyz) {
  const ix = ixyz[0];
  const iy = ixyz[1];

  if (state.screen === "menu") {
    const col = Math.min(GRID_COLS - 1, ix);
    const row = Math.min(GRID_ROWS - 1, iy);
    if (col === state.cursorCol && row === state.cursorRow) return;
    state.cursorCol = col;
    state.cursorRow = row;
    renderMenu();
    return;
  }

  if (state.screen === "payment") {
    // 4 formas de pagamento numa grade 2x2: as três posições de cada eixo
    // são achatadas para duas (o índice 2 cai no 1).
    const col = Math.min(1, ix);
    const row = Math.min(1, iy);
    const focus = row * 2 + col;
    if (focus === state.paymentFocus) return;
    state.paymentFocus = focus;
    renderPayment();
  }
}

// ---------------------------------------------------------------------
// Z -> confirmar / cancelar, com detecção de borda + permanência
// ---------------------------------------------------------------------
let zZone = 1;
let zFrames = 0;
let zFired = false;

function handleZ(iz) {
  if (iz !== zZone) {
    zZone = iz;
    zFrames = 0;
    zFired = false;
  }
  zFrames++;

  if (zZone !== Z_CONFIRM_INDEX && zZone !== Z_CANCEL_INDEX) return; // zona neutra
  if (zFired || zFrames < Z_DWELL_FRAMES) return;

  zFired = true;
  if (zZone === Z_CONFIRM_INDEX) onConfirm();
  else onCancel();
}

function onConfirm() {
  switch (state.screen) {
    case "start":
      if (!document.getElementById("btnStartOrder").disabled) showScreen("menu");
      break;
    case "menu":
      addToCart(currentItem().id);
      break;
    case "review":
      showScreen("payment");
      break;
    case "payment": {
      const btn = paymentButtons()[state.paymentFocus];
      if (!btn) break;
      // Primeiro confirm escolhe a forma de pagamento; confirmar de novo
      // sobre a forma já escolhida fecha a compra.
      if (state.paymentMethod === btn.dataset.method) confirmPurchase();
      else {
        state.paymentMethod = btn.dataset.method;
        renderPayment();
      }
      break;
    }
    case "confirmation":
      newOrder();
      break;
  }
}

function onCancel() {
  switch (state.screen) {
    case "menu":
      removeFromCart(currentItem().id);
      break;
    case "review":
      showScreen("menu");
      break;
    case "payment":
      showScreen("review");
      break;
  }
}

// ---------------------------------------------------------------------
// Painel de depuração dos sensores
// ---------------------------------------------------------------------
const AXIS_LABELS = ["X", "Y", "Z"];

function updateSensorDebug(snap) {
  AXIS_LABELS.forEach((axis, i) => {
    // barra do cardápio (o progress do HTML original tem max="30")
    const bar = document.getElementById("bar" + axis);
    if (bar) {
      bar.value = snap.smooth[i] * 30;
      document.getElementById("val" + axis).textContent = snap.smooth[i].toFixed(2);
    }
    // painel de calibração da tela inicial
    const calBar = document.getElementById("calBar" + axis);
    if (calBar) {
      calBar.value = snap.smooth[i];
      document.getElementById("calVal" + axis).textContent =
        snap.raw[i] + " -> " + snap.smooth[i].toFixed(2);
    }
  });

  const cellText =
    "célula  X" + snap.ixyz[0] + "  Y" + snap.ixyz[1] + "  Z" + snap.ixyz[2];
  const cellMenu = document.getElementById("cellReadout");
  if (cellMenu) cellMenu.textContent = cellText;
  const cellCal = document.getElementById("calibCell");
  if (cellCal) cellCal.textContent = cellText;
}

// ---------------------------------------------------------------------
// Um quadro do pipeline (tracking.js)
// ---------------------------------------------------------------------
tracker.addEventListener("frame", (e) => {
  const snap = e.detail;
  updateSensorDebug(snap);
  applyPosition(snap.ixyz);
  // Durante a varredura de calibração os limites mudam a cada quadro,
  // então os índices oscilam. Não disparamos confirmar/cancelar nesse
  // intervalo — só seguimos o cursor.
  if (!snap.calibrating) handleZ(snap.ixyz[2]);
});

// ---------------------------------------------------------------------
// Calibração — equivalente ao `mousePressed && mouseButton == LEFT` do
// sketch: enquanto o botão está pressionado, os limites são aprendidos.
// ---------------------------------------------------------------------
const btnCalibrate = document.getElementById("btnCalibrate");

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
  const hint = document.getElementById("calibHint");
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

document.getElementById("btnResetCalib").addEventListener("click", () => {
  tracker.reset();
});

// ---------------------------------------------------------------------
// Conexão — ArduinoLink e FakeArduinoLink têm a mesma interface, então
// os dois são ligados ao pipeline exatamente do mesmo jeito.
// ---------------------------------------------------------------------
function wireLink(source, statusKind, statusText) {
  source.addEventListener("data", (e) => tracker.update(e.detail.raw));
  source.addEventListener("connect", () => {
    setSensorStatus(statusKind, statusText);
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
  const btnStart = document.getElementById("btnStartOrder");
  const btnConnect = document.getElementById("btnConnect");
  btnStart.disabled = !(anySourceConnected() && tracker.isCalibrated);

  btnConnect.disabled = link.isConnected;
  btnConnect.textContent = link.isConnected ? "🔌 Conectado" : "🔌 Conectar ao Arduino";
  btnCalibrate.disabled = !anySourceConnected();

  const hint = document.getElementById("startHint");
  if (!anySourceConnected()) {
    hint.textContent = "Conecte o Arduino ou ative o firmware falso para continuar.";
  } else if (!tracker.isCalibrated) {
    hint.textContent = "Falta calibrar: segure Definir limites e varra a mão pelas três placas.";
  } else {
    hint.textContent = "Pronto! Abaixe a mão sobre a placa Z (ou clique) para iniciar.";
  }
}

function setSensorStatus(kind, text) {
  const dot = document.getElementById("sensorDot");
  dot.classList.remove("online", "sim");
  if (kind === "online") dot.classList.add("online");
  if (kind === "sim") dot.classList.add("sim");
  document.getElementById("sensorStatusText").textContent = text;
}

// ---------------------------------------------------------------------
// Firmware falso (teclado): setas para X/Y, w/s para Z
// ---------------------------------------------------------------------
document.getElementById("chkSimMode").addEventListener("change", async (e) => {
  state.simMode = e.target.checked;
  if (state.simMode) await fake.connect();
  else await fake.disconnect();
});

// ---------------------------------------------------------------------
// Botões de navegação e ações de UI
// ---------------------------------------------------------------------
document.getElementById("btnConnect").addEventListener("click", async () => {
  try {
    await link.connect();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("btnStartOrder").addEventListener("click", () => showScreen("menu"));
document.getElementById("btnFinishOrder").addEventListener("click", () => showScreen("review"));
document.getElementById("btnBackToMenu").addEventListener("click", () => showScreen("menu"));
document.getElementById("btnGoToPayment").addEventListener("click", () => showScreen("payment"));
document.getElementById("btnBackToReview").addEventListener("click", () => showScreen("review"));

paymentButtons().forEach((btn, i) => {
  btn.addEventListener("click", () => {
    state.paymentFocus = i;
    state.paymentMethod = btn.dataset.method;
    renderPayment();
  });
});

function confirmPurchase() {
  const orderNumber = String(Math.floor(100 + Math.random() * 900));
  document.getElementById("orderNumber").textContent = orderNumber;
  document.getElementById("confirmationList").innerHTML =
    document.getElementById("reviewList").innerHTML;
  document.getElementById("confirmationTotal").textContent = formatBRL(cartTotal());
  showScreen("confirmation");
}

function newOrder() {
  state.cart = {};
  state.paymentMethod = null;
  state.paymentFocus = 0;
  state.cursorRow = 0;
  state.cursorCol = 0;
  showScreen("start");
}

document.getElementById("btnConfirmPurchase").addEventListener("click", confirmPurchase);
document.getElementById("btnNewOrder").addEventListener("click", newOrder);

// estado inicial dos botões / textos
updateStartGate();
