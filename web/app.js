/**
 * app.js — Fit Express
 * ----------------------------------------------------------------------
 * Controlador da interface: telas (início → cardápio → revisão →
 * pagamento → confirmação), carrinho e checkout.
 *
 * O firmware original (_3DInterface.ino) só manda os 3 valores brutos por
 * linha ("x y z\n") — a calibração (min/max por eixo) e a conversão para
 * posição discreta (getPosition, 0/1/2 por eixo) acontecem aqui, usando os
 * mesmos algoritmos do sketch Processing original (ver sensors.js).
 *
 * Mapeamento posição → grade do cardápio (3x3), conforme a especificação:
 *   eixo X: posição 0 (X<10) = direita | 1 = parado | 2 (X>20) = esquerda
 *   eixo Y: posição 0 (Y<10) = cima    | 1 = parado | 2 (Y>20) = baixo
 *   eixo Z: posição 0 (Z<10) = desseleciona | 1 = nada | 2 (Z>20) = seleciona
 * Como X e Y já chegam como uma posição absoluta de 0 a 2 (mesma ideia do
 * ixyz[] do TicTacToe3D.pde), o cursor do cardápio é posicionado
 * diretamente na grade 3x3, sem precisar de "passos" incrementais.
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

// Um AxisPipeline por eixo: Normalize (calibração min/max) + MomentumAverage
// (suavização) + getPosition (zona discreta 0/1/2). Ver sensors.js.
const axisX = new AxisPipeline(0.15);
const axisY = new AxisPipeline(0.15);
const axisZ = new AxisPipeline(0.15);

// Calibração FIXA (definida em calibration-config.js, obtida rodando o
// utilitário Processing em /calibration-tool/). Não há calibração ao vivo
// nesta branch — para recalibrar, rode o utilitário de novo e atualize
// FIXED_CALIBRATION.
axisX.normalize.setRange(FIXED_CALIBRATION.x.min, FIXED_CALIBRATION.x.max);
axisY.normalize.setRange(FIXED_CALIBRATION.y.min, FIXED_CALIBRATION.y.max);
axisZ.normalize.setRange(FIXED_CALIBRATION.z.min, FIXED_CALIBRATION.z.max);

let prevPosZ = 1; // começa na zona morta, para não disparar gesto ao ligar

document.getElementById("fixedCalibrationHint").textContent =
  `Calibração fixa carregada: X ${FIXED_CALIBRATION.x.min}–${FIXED_CALIBRATION.x.max} · ` +
  `Y ${FIXED_CALIBRATION.y.min}–${FIXED_CALIBRATION.y.max} · ` +
  `Z ${FIXED_CALIBRATION.z.min}–${FIXED_CALIBRATION.z.max} ` +
  `(edite web/calibration-config.js para recalibrar)`;

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
// Painel de depuração dos sensores (normalizado 0..1 + bruto)
// ---------------------------------------------------------------------
function updateSensorDebug(raw, norm) {
  const barX = document.getElementById("barX");
  if (!barX) return; // painel só existe na tela de cardápio

  barX.value = norm.x; document.getElementById("valX").textContent = norm.x.toFixed(2);
  document.getElementById("barY").value = norm.y; document.getElementById("valY").textContent = norm.y.toFixed(2);
  document.getElementById("barZ").value = norm.z; document.getElementById("valZ").textContent = norm.z.toFixed(2);
  document.getElementById("sensorRaw").textContent =
    `bruto: x=${raw.x} y=${raw.y} z=${raw.z}`;
}

// ---------------------------------------------------------------------
// Eventos vindos do Arduino (via serial.js): {x, y, z} brutos
// ---------------------------------------------------------------------
function handleSensorFrame(raw) {
  const posX = axisX.update(raw.x);
  const posY = axisY.update(raw.y);
  const posZ = axisZ.update(raw.z);

  updateSensorDebug(raw, {
    x: axisX.average.avg,
    y: axisY.average.avg,
    z: axisZ.average.avg,
  });

  // X/Y chegam como posição absoluta 0/1/2 -> cursor direto na grade 3x3
  if (state.screen === "menu") {
    state.cursorCol = (GRID_COLS - 1) - posX; // X<10(pos0)=direita -> col mais à direita
    state.cursorRow = posY;                    // Y<10(pos0)=cima   -> linha de cima
    renderMenu();
  }

  // Z dispara por borda (uma vez por cruzamento de zona), não a cada frame
  if (posZ !== prevPosZ) {
    if (posZ === 2) addToCart(currentItem().id); // Z > 20: seleciona
    else if (posZ === 0) removeFromCart(currentItem().id); // Z < 10: desseleciona
  }
  prevPosZ = posZ;
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
// Modo simulação por teclado — útil para testar sem o Arduino conectado.
// Esquema (consistente nas 4 telas do fluxo de pedido):
//   setas   -> mover cursor (Cardápio) / trocar forma de pagamento (Pagamento)
//   espaço  -> adicionar item destacado (simula Z > 20)          [Cardápio]
//   backspace -> remover item destacado (simula Z < 10)          [Cardápio]
//              -> voltar para a tela anterior                    [Revisão/Pagamento]
//   enter   -> avançar / confirmar a ação principal da tela      [todas]
// ---------------------------------------------------------------------
const PAYMENT_METHODS = ["credito", "debito", "pix", "dinheiro"];

function cyclePaymentMethod(delta) {
  const currentIndex = PAYMENT_METHODS.indexOf(state.paymentMethod);
  const nextIndex =
    currentIndex === -1
      ? 0
      : (currentIndex + delta + PAYMENT_METHODS.length) % PAYMENT_METHODS.length;
  state.paymentMethod = PAYMENT_METHODS[nextIndex];
  renderPayment();
}

document.getElementById("chkSimMode").addEventListener("change", (e) => {
  state.simMode = e.target.checked;
  if (state.simMode) {
    setSensorStatus("sim", "Modo simulação (teclado) ativo");
    document.getElementById("btnStartOrder").disabled = false;
    document.getElementById("startHint").textContent =
      "Modo simulação ativo: setas movem/escolhem, espaço adiciona, " +
      "backspace remove ou volta, enter avança ou confirma.";
  } else if (!link.isConnected) {
    setSensorStatus("offline", "Arduino desconectado");
    document.getElementById("btnStartOrder").disabled = true;
  }
});

document.addEventListener("keydown", (e) => {
  if (!state.simMode) return;

  if (state.screen === "menu") {
    const keyMap = { ArrowLeft: "LEFT", ArrowRight: "RIGHT", ArrowUp: "UP", ArrowDown: "DOWN" };
    if (keyMap[e.key]) {
      e.preventDefault();
      moveCursor(keyMap[e.key]);
    } else if (e.key === " ") {
      e.preventDefault();
      addToCart(currentItem().id);
    } else if (e.key === "Backspace") {
      e.preventDefault();
      removeFromCart(currentItem().id);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (cartEntries().length > 0) showScreen("review"); // = clicar em "Concluir Pedido"
    }
    return;
  }

  if (state.screen === "review") {
    if (e.key === "Enter") {
      e.preventDefault();
      showScreen("payment"); // = "Prosseguir para Pagamento"
    } else if (e.key === "Backspace") {
      e.preventDefault();
      showScreen("menu"); // = "Voltar ao Cardápio"
    }
    return;
  }

  if (state.screen === "payment") {
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      cyclePaymentMethod(-1);
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      cyclePaymentMethod(1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      confirmPurchase(); // = "Concluir Compra" (só age se já houver método escolhido)
    } else if (e.key === "Backspace") {
      e.preventDefault();
      showScreen("review"); // = "Voltar"
    }
    return;
  }

  if (state.screen === "confirmation" && e.key === "Enter") {
    e.preventDefault();
    startNewOrder(); // = "Novo Pedido"
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

function confirmPurchase() {
  if (!state.paymentMethod) return;
  const orderNumber = String(Math.floor(100 + Math.random() * 900));
  document.getElementById("orderNumber").textContent = orderNumber;
  document.getElementById("confirmationList").innerHTML = document.getElementById("reviewList").innerHTML;
  document.getElementById("confirmationTotal").textContent = formatBRL(cartTotal());
  showScreen("confirmation");
}

function startNewOrder() {
  state.cart = {};
  state.paymentMethod = null;
  state.cursorRow = 0;
  state.cursorCol = 0;
  showScreen("start");
}

document.getElementById("btnConfirmPurchase").addEventListener("click", confirmPurchase);
document.getElementById("btnNewOrder").addEventListener("click", startNewOrder);
