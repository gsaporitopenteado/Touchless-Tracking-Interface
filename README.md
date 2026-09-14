# Fit Express — Interface Touchless para Pedidos de Fast Food Saudável

Sistema de autoatendimento sem toque: o cliente navega pelo cardápio e monta
o pedido movendo a mão sobre três placas de alumínio (sensores capacitivos
X/Y/Z), usando o firmware **original e não modificado** do projeto
[A Touchless 3D Tracking Interface (Make:)](https://makezine.com/projects/a-touchless-3d-tracking-interface/)
([repositório original](https://github.com/Make-Magazine/3DInterface), autor
do firmware: Kyle McDonald). Este projeto usa apenas o plano 2D (X/Y para
navegar, Z para confirmar/cancelar) e adiciona um fluxo completo de pedido:
**seleção → revisão → pagamento → confirmação com número de retirada**.

## Estrutura do projeto

```
firmware/_3DInterface/_3DInterface.ino     # firmware ORIGINAL do Arduino (sem alterações)
calibration-tool/calibration_tool.pde      # utilitário Processing p/ descobrir os limites de calibração (só nesta branch)
web/index.html, style.css, app.js          # front-end do totem (telas, carrinho, checkout)
web/serial.js                              # leitura da porta serial (Web Serial API)
web/sensors.js                             # calibração/normalização + getPosition (porta do Processing original)
web/calibration-config.js                  # calibração FIXA (min/max por eixo) usada nesta branch
```

## Branches deste repositório

Este `main` traz a base comum (firmware original + front-end). A forma como
a **calibração** dos sensores é feita muda entre duas branches:

| Branch | Calibração |
|---|---|
| `calibracao-web` | Feita **no próprio site** (botão "Calibrar" no front-end web, em JavaScript) |
| `calibracao-processing` | Feita **uma única vez no Processing** (utilitário `calibration-tool/calibration_tool.pde`), com os valores min/max colados num arquivo de configuração do front-end |

Veja a seção [Calibração](#calibração) para o porquê disso ser necessário.

## Hardware (conforme o esquemático do projeto)

```
        5V
         │
   ┌─────┼─────┬─────┐
 220kΩ  220kΩ  220kΩ  (uma para cada placa)
   │     │     │
   ●─────┴─    │           ● = nó de cada eixo
   │           │
 10kΩ        10kΩ  10kΩ
   │           │     │
 PIN 8       PIN 9  PIN 10
   │           │     │
 X PLATE    Y PLATE  Z PLATE
```

- **Pino 8 → placa X**, **Pino 9 → placa Y**, **Pino 10 → placa Z**, cada um
  com resistor de 10kΩ em série até a placa.
- Um resistor de 220kΩ liga 5V ao mesmo nó de cada placa (pull-up).
- As placas são de papelão revestido com papel alumínio, isoladas entre si.

## Firmware — original, sem modificações

`firmware/_3DInterface/_3DInterface.ino` é uma cópia **verbatim** do firmware
do projeto original (por Kyle McDonald, via
[instructables.com/id/DIY-3D-Controller](http://www.instructables.com/id/DIY-3D-Controller/)
e o repositório [Make-Magazine/3DInterface](https://github.com/Make-Magazine/3DInterface)).
Não alteramos nada nele — nem os pinos, nem a lógica de leitura.

**Princípio de leitura:** para cada pino (8=X, 9=Y, 10=Z), o firmware
descarrega o nó (`OUTPUT LOW`) e libera o pino (`INPUT`), contando quantas
iterações de um laço são necessárias até o pino ler `HIGH` de novo (o
resistor de 220kΩ recarrega o nó através da capacitância placa+mão). Isso é
repetido o quanto der dentro de uma janela de tempo fixa (`refresh`, cerca de
40ms), e o firmware manda a média de iterações por ciclo. Mais capacitância
(mão mais perto) = recarga mais lenta = número menor de iterações no mesmo
tempo — não é um valor de distância em unidade física, é um número bruto
proporcional à proximidade, sem escala fixa.

**Saída serial (115200 baud):** uma linha de texto por ciclo, com os 3
valores brutos separados por espaço, **sem calibração nem unidade**:

```
1234 5678 910
```

### Gravando o firmware

1. Abra `firmware/_3DInterface/_3DInterface.ino` na Arduino IDE.
2. Selecione a placa (Uno/Nano/Mega) e a porta serial correspondente.
3. Se você estiver fora da América do Norte/Japão, confira a linha
   `#define mains 50` (rede elétrica de 50Hz — já é o padrão do arquivo,
   correto para o Brasil). Só mude para `60` em países de 60Hz.
4. Faça upload. Não é necessário abrir o Serial Monitor para calibrar — a
   calibração acontece no PC (ver abaixo), não no Arduino.

## Calibração

Como o firmware manda só números brutos sem escala, alguém do lado do PC
precisa descobrir o mínimo e o máximo que cada eixo produz (mão longe da
placa vs. mão encostada) para converter isso em uma posição útil — exatamente
como o sketch Processing original (`TicTacToe3D.pde` + `Normalize.pde` +
`MomentumAverage.pde`) faz: guarda o menor e o maior valor já vistos por
eixo, normaliza a leitura atual para uma escala de 0 a 1 entre esses limites,
suaviza com uma média móvel, e divide o resultado em 3 zonas discretas
(`getPosition`) — exatamente os limiares 10/20 (de 0 a 30) pedidos na
especificação deste projeto.

`web/sensors.js` é uma porta fiel desse algoritmo para JavaScript
(`Normalize`, `MomentumAverage`, `getPosition`). O que muda entre as duas
branches é **de onde vêm os limites min/max**:

- **`calibracao-web`**: um botão "Calibrar" no próprio site ativa a mesma
  ideia do Processing original (lá, você segura o botão esquerdo do mouse e
  move a mão pelas 3 placas para "ensinar" os limites) — aqui, ativado o modo
  calibração, mova a mão de ponta a ponta em X, Y e Z; os limites ficam
  salvos no navegador (`localStorage`) e não precisam ser refeitos a cada
  vez que o site é aberto (só quando a calibração parecer errada).
- **`calibracao-processing`** *(esta branch)*: em vez de rodar o jogo
  `TicTacToe3D` completo só para calibrar, use o utilitário dedicado
  `calibration-tool/calibration_tool.pde` (mesma técnica do
  `Normalize.pde` original, só que isolada num sketch pequeno):
  1. Abra `calibration_tool.pde` no Processing e ajuste `PORT_INDEX` para
     a porta serial do seu Arduino (a lista de portas aparece no console
     ao rodar).
  2. Rode o sketch. Segure o botão **esquerdo do mouse** e mova a mão de
     ponta a ponta sobre as 3 placas (bem perto e bem longe de cada uma).
  3. Solte o mouse e pressione **`p`** — o console imprime um trecho pronto
     para colar, por exemplo:
     ```js
     const FIXED_CALIBRATION = {
       x: { min: 118, max: 942 },
       y: { min: 96, max: 887 },
       z: { min: 130, max: 910 },
     };
     ```
  4. Cole esse trecho substituindo o conteúdo de `web/calibration-config.js`.
  5. Se a leitura parecer errada (zona morta deslocada, cursor não chega
     nas pontas), pressione **`r`** no utilitário para reiniciar e calibre
     de novo — não precisa recompilar nem tocar no firmware.

  O front-end web carrega esses limites fixos ao iniciar (sem nenhuma
  calibração acontecendo no navegador) — a tela inicial mostra a faixa
  carregada para conferência.

## Rodando o front-end

A Web Serial API exige um **contexto seguro** (HTTPS ou `http://localhost`)
e um navegador **Chrome ou Edge** — `file://` costuma ser bloqueado. Sirva a
pasta `web/` com qualquer servidor estático simples, por exemplo:

```bash
cd web
python3 -m http.server 8080
```

Depois abra `http://localhost:8080` no Chrome.

### Fluxo de uso

1. **Início** — clique em **Conectar ao Arduino** (a Web Serial API abre um
   seletor de porta nativo do navegador) ou ative o **Modo simulação** para
   testar com o teclado (setas movem o cursor, `Espaço` adiciona o item,
   `Backspace` remove) sem precisar do hardware.
2. **Cardápio** — a posição da mão em X/Y posiciona o cursor diretamente na
   grade 3x3 de itens (mesma ideia do `ixyz[]` do sketch original); abaixe a
   mão sobre a placa Z para adicionar o item destacado ao pedido, levante
   para remover. O painel lateral mostra o carrinho, o total e as leituras
   dos sensores (normalizadas e brutas) em tempo real. Clique em **Concluir
   Pedido** (ação manual, não por gesto) para seguir.
3. **Revisão** — confira os itens e o total; pode **Voltar ao Cardápio** ou
   **Prosseguir para Pagamento**.
4. **Pagamento** — escolha a forma de pagamento (Crédito, Débito, Pix ou
   Dinheiro) e **Conclua a Compra**.
5. **Confirmação** — mostra o número do pedido e o resumo para retirada no
   balcão. **Novo Pedido** reinicia o fluxo.

## Lógica de posicionamento (especificação)

Origem no encontro das 3 placas; eixos conceitualmente de 0 a 30, reduzidos
pelo `getPosition` a 3 zonas (0/1/2) por eixo:

| Eixo | Zona morta (posição 1) | Posição 0 (`< 10`) | Posição 2 (`> 20`) |
|---|---|---|---|
| X | parado na horizontal | move para a **direita** | move para a **esquerda** |
| Y | parado na vertical | move para **cima** | move para **baixo** |
| Z | sem mudança de seleção | **desseleciona** o item | **seleciona** o item |

X e Y são tratados como posição **absoluta** na grade 3x3 do cardápio (a
mesma abordagem do `getPosition`/`ixyz[]` do `TicTacToe3D.pde`); Z dispara
por **borda** (uma vez a cada cruzamento de zona), para não repetir o
gesto enquanto a mão permanece parada.

## Possíveis próximos passos

- Adicionar categorias (pratos/bebidas/sobremesas) com abas navegáveis pelo
  plano XZ/YZ, caso o cardápio cresça além de 9 itens.
- Persistir o histórico de pedidos (número sequencial real) em vez do
  número aleatório usado na tela de confirmação.
- Reavaliar `CUTOFF_LOW`/`CUTOFF_HIGH` em `sensors.js` (hoje 1/3 e 2/3, para
  bater com os limiares 10/20 de 0-30 da especificação) caso a resposta dos
  sensores peça uma zona morta maior ou menor.
