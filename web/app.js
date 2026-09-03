/**
 * app.js — Fit Express
 * ----------------------------------------------------------------------
 * Controlador da interface: telas (início → cardápio → revisão →
 * pagamento → confirmação), cursor do cardápio movido pelos eventos do
 * Arduino (moveH/moveV/gesture vindos de serial.js), carrinho e checkout.
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

// ---------------------------------------------------------------------
// Estado global
// ---------------------------------------------------------------------
const state = {
  screen: "start",
  cursorRow: 0,
  cursorCol: 0,
  cart: {},        // { itemId: qty }
  paymentMethod: null,
  simMode: false,
};

const link = new ArduinoLink();

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
  document.querySelectorAll(".payment-option").forEach((btn) => {
    btn.classList.toggle("selected", btn.dataset.method === state.paymentMethod);
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
// Movimento do cursor no grid (disparado pelos eventos moveH/moveV)
// ---------------------------------------------------------------------
function moveCursor(dir) {
  if (state.screen !== "menu") return;

  if (dir === "LEFT") state.cursorCol = Math.max(0, state.cursorCol - 1);
  if (dir === "RIGHT") state.cursorCol = Math.min(GRID_COLS - 1, state.cursorCol + 1);
  if (dir === "UP") state.cursorRow = Math.max(0, state.cursorRow - 1);
  if (dir === "DOWN") state.cursorRow = Math.min(GRID_ROWS - 1, state.cursorRow + 1);

  renderMenu();
}

// ---------------------------------------------------------------------
// Painel de depuração dos sensores (barras X/Y/Z)
// ---------------------------------------------------------------------
function updateSensorDebug(x, y, z) {
  const barX = document.getElementById("barX");
  const barY = document.getElementById("barY");
  const barZ = document.getElementById("barZ");
  if (!barX) return; // painel só existe na tela de cardápio
  barX.value = x; document.getElementById("valX").textContent = x.toFixed(1);
  barY.value = y; document.getElementById("valY").textContent = y.toFixed(1);
  barZ.value = z; document.getElementById("valZ").textContent = z.toFixed(1);
}

// ---------------------------------------------------------------------
// Eventos vindos do Arduino (via serial.js)
// ---------------------------------------------------------------------
function handleSensorFrame(data) {
  if (typeof data.x === "number") {
    updateSensorDebug(data.x, data.y, data.z);
  }
  if (data.moveH && data.moveH !== "NONE") moveCursor(data.moveH);
  if (data.moveV && data.moveV !== "NONE") moveCursor(data.moveV);

  if (data.gesture === "SELECT") addToCart(currentItem().id);
  else if (data.gesture === "DESELECT") removeFromCart(currentItem().id);
}

link.addEventListener("data", (e) => handleSensorFrame(e.detail));

link.addEventListener("connect", () => {
  setSensorStatus("online", "Arduino conectado");
  document.getElementById("btnStartOrder").disabled = false;
  document.getElementById("startHint").textContent = "Pronto! Toque em Iniciar Pedido.";
  document.getElementById("btnConnect").textContent = "🔌 Conectado";
  document.getElementById("btnConnect").disabled = true;
});

link.addEventListener("disconnect", () => {
  setSensorStatus("offline", "Arduino desconectado");
  document.getElementById("btnConnect").textContent = "🔌 Conectar ao Arduino";
  document.getElementById("btnConnect").disabled = false;
  if (!state.simMode) document.getElementById("btnStartOrder").disabled = true;
});

link.addEventListener("error", (e) => {
  console.error("Erro na conexão serial:", e.detail);
  setSensorStatus("offline", "Erro na conexão — reconecte");
});

function setSensorStatus(kind, text) {
  const dot = document.getElementById("sensorDot");
  dot.classList.remove("online", "sim");
  if (kind === "online") dot.classList.add("online");
  if (kind === "sim") dot.classList.add("sim");
  document.getElementById("sensorStatusText").textContent = text;
}

// ---------------------------------------------------------------------
// Modo simulação por teclado (setas = mover cursor, espaço = selecionar,
// backspace = desselecionar) — útil para testar sem o Arduino conectado.
// ---------------------------------------------------------------------
document.getElementById("chkSimMode").addEventListener("change", (e) => {
  state.simMode = e.target.checked;
  if (state.simMode) {
    setSensorStatus("sim", "Modo simulação (teclado) ativo");
    document.getElementById("btnStartOrder").disabled = false;
    document.getElementById("startHint").textContent =
      "Modo simulação ativo: use as setas, espaço (adicionar) e backspace (remover).";
  } else if (!link.isConnected) {
    setSensorStatus("offline", "Arduino desconectado");
    document.getElementById("btnStartOrder").disabled = true;
  }
});

document.addEventListener("keydown", (e) => {
  if (!state.simMode || state.screen !== "menu") return;
  const keyMap = {
    ArrowLeft: "LEFT",
    ArrowRight: "RIGHT",
    ArrowUp: "UP",
    ArrowDown: "DOWN",
  };
  if (keyMap[e.key]) {
    e.preventDefault();
    moveCursor(keyMap[e.key]);
  } else if (e.key === " ") {
    e.preventDefault();
    addToCart(currentItem().id);
  } else if (e.key === "Backspace") {
    e.preventDefault();
    removeFromCart(currentItem().id);
  }
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

document.querySelectorAll(".payment-option").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.paymentMethod = btn.dataset.method;
    renderPayment();
  });
});

document.getElementById("btnConfirmPurchase").addEventListener("click", () => {
  const orderNumber = String(Math.floor(100 + Math.random() * 900));
  document.getElementById("orderNumber").textContent = orderNumber;
  document.getElementById("confirmationList").innerHTML = document.getElementById("reviewList").innerHTML;
  document.getElementById("confirmationTotal").textContent = formatBRL(cartTotal());
  showScreen("confirmation");
});

document.getElementById("btnNewOrder").addEventListener("click", () => {
  state.cart = {};
  state.paymentMethod = null;
  state.cursorRow = 0;
  state.cursorCol = 0;
  showScreen("start");
});
