# Fit Express — Interface Touchless para Pedidos de Fast Food Saudável

Sistema de autoatendimento sem toque: o cliente navega pelo cardápio e monta
o pedido movendo a mão sobre três placas de alumínio (sensores capacitivos
X/Y/Z), inspirado no projeto [A Touchless 3D Tracking Interface (Make:)](https://makezine.com/projects/a-touchless-3d-tracking-interface/)
([código original](https://github.com/Make-Magazine/3DInterface)). O fluxo
completo de pedido é **seleção → revisão → pagamento → confirmação com
número de retirada**.

## Arquitetura (importante)

Toda a inteligência mora no **PC**, não no Arduino.

```
arduino/totem/totem.ino          web/serial.js        web/tracking.js       web/app.js
   (NAO ALTERAR)                                      (porte do Processing)
┌────────────────────┐        ┌───────────────┐     ┌──────────────────┐   ┌──────────────┐
│ mede o tempo de    │  USB   │ Web Serial:   │     │ Normalize        │   │ ixyz[0] X →  │
│ carga de cada pino │ ─────> │ quebra linhas │ ──> │ MomentumAverage  │──>│   coluna     │
│ e imprime 3 conta- │ 115200 │ e converte em │raw  │ getPosition      │   │ ixyz[1] Y →  │
│ gens cruas por     │        │ [x, y, z]     │     │       ↓          │   │   linha      │
│ linha              │        └───────────────┘     │ ixyz = 0|1|2 por │   │ ixyz[2] Z →  │
│ "12480 3312 7936"  │                              │ eixo (grade 3³)  │   │  confirma /  │
└────────────────────┘                              └──────────────────┘   │  cancela     │
                                                                           └──────────────┘
```

O firmware é deliberadamente "burro": ele não calibra, não mapeia para
0–30 e não emite eventos de gesto. É exatamente por isso que ele funciona —
e é a mesma saída que o sketch Processing `TicTacToe3D` consome.

### O porte do Processing

`web/tracking.js` é uma tradução **literal**, linha por linha, de:

| Origem (Processing) | Destino (JS) |
|---|---|
| `TicTacToe3D/Normalize.pde` | `class Normalize` |
| `TicTacToe3D/MomentumAverage.pde` | `class MomentumAverage` |
| `TicTacToe3D/TicTacToe3D.pde` → `getPosition()` | `getPosition()` |
| `TicTacToe3D/TicTacToe3D.pde` → `updateSerial()` | `Tracker.update()` |

A matemática **não foi alterada nem "corrigida"**, porque é essa versão que
já foi validada no hardware real. Foram preservados de propósito, inclusive:

- o `return 1` quando `normalized == 0` (antes de calibrar, todo eixo lê 1);
- os dois filtros com taxas diferentes (`0.01` para a câmera lenta, `0.15`
  para a posição responsiva);
- o `flip = {false, true, false}` — só o eixo Y é invertido;
- o `(int) x * div` do ramo `div != 3`, que em Java significa
  `((int) x) * div` (ramo morto com `div == 3`, mantido idêntico);
- os cortes `cutoff = 0.2` / `1 - cutoff` que definem as três células.

O único acréscimo nosso é `Tracker.isCalibrated`, que o sketch não
precisava: a interface precisa de um portão ("já pode começar o pedido?").
Ele exige uma razão `max/min ≥ 1.5` por eixo, porque só `min != max` não
serve — o ruído do sensor garante valores diferentes mesmo com a mão parada.

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

**Princípio de leitura:** cada pino descarrega o nó (modo `OUTPUT LOW`) e
depois é liberado (`INPUT`, alta impedância). O resistor de 220kΩ recarrega o
nó até o pino ler `HIGH`; o tempo até isso acontecer é maior quanto mais perto
a mão estiver da placa (mais capacitância = carga mais lenta). O firmware usa
esse tempo como leitura bruta de cada eixo — é a técnica de "charge transfer"
usada em sensores capacitivos caseiros, e dispensa pinos de emissor/receptor.

> ⚠️ **Somente Uno / Nano (ATmega328P).** O `totem.ino` acessa `PORTB`/`PINB`
> direto, com as máscaras `B00000001`/`B00000010`/`B00000100` — isso só
> corresponde aos pinos 8/9/10 no ATmega328P. Num Mega2560 esses pinos
> ficam em outras portas e as leituras saem erradas. Ele também usa
> `timer0_overflow_count`, que é específico do core AVR.

## Gravando o firmware

1. Abra `arduino/totem/totem.ino` na Arduino IDE.
2. Selecione Arduino Uno (ou Nano) e a porta serial correspondente.
3. Faça upload. Não há nada para configurar nem calibrar aqui.

Para conferir o sinal cru fora do navegador, existe
`totem/read_serial.py` (`python read_serial.py --list` mostra as portas).

### Saída do firmware

Uma linha por ciclo, três inteiros separados por espaço — as contagens dos
pinos 8, 9 e 10:

```
12480 3312 7936
```

A taxa é de **~10 Hz**, não 33 Hz: o `refresh` do sketch é
`2 * 1000000 / 60` ≈ 33 ms **por eixo**, e são três eixos por linha. Isso é
suficiente para navegar numa grade, mas é o motivo de `Z_DWELL_FRAMES` ser
contado em poucos quadros.

## Rodando o front-end

A Web Serial API exige um **contexto seguro** (HTTPS ou `http://localhost`)
e um navegador **Chrome ou Edge** — `file://` costuma ser bloqueado. Sirva a
pasta `web/`:

```bash
cd web
python -m http.server 8080
```

Depois abra `http://localhost:8080` no Chrome.

### Fluxo de uso

1. **Início** — clique em **Conectar ao Arduino** (a Web Serial API abre um
   seletor de porta nativo) ou marque **Firmware falso** para testar pelo
   teclado, sem hardware.
2. **Calibração** (obrigatória) — **segure** o botão *Definir limites* (ou a
   barra de espaço) e varra a mão por todo o alcance de cada placa, do
   encosto até fora de alcance. Isso é o equivalente exato do
   `mousePressed && mouseButton == LEFT` do sketch Processing: enquanto o
   botão está pressionado, `Normalize.note()` aprende o mín/máx de cada
   eixo. O painel mostra a contagem crua, o valor suavizado e a célula atual.
   *Iniciar Pedido* só libera quando os três eixos tiverem uma faixa
   utilizável. *Reiniciar calibração* equivale ao botão direito do mouse no
   sketch (`reset()`).
3. **Cardápio** — mova a mão em X/Y para percorrer os 9 itens; abaixe a mão
   sobre a placa Z para **adicionar** o item em foco, levante para
   **remover**. Para adicionar o mesmo item duas vezes, volte à **zona
   neutra** entre as duas confirmações — varrer direto para o extremo oposto
   passa pela zona de cancelar e remove o item.
4. **Revisão** — Z confirma (segue para pagamento), Z cancela (volta ao
   cardápio).
5. **Pagamento** — X/Y movem o foco entre as 4 formas; a primeira
   confirmação escolhe a forma em foco, a segunda (sobre a forma já
   escolhida) fecha a compra. Z cancela volta para a revisão.
6. **Confirmação** — mostra o número do pedido. Z confirma inicia um novo.

Todos os botões continuam clicáveis com o mouse, como fallback.

## Firmware falso (teste sem hardware)

`web/fake-firmware.js` expõe **a mesma interface pública** de
`ArduinoLink` (`connect`, `disconnect`, `isConnected`, eventos
`connect`/`disconnect`/`data`/`error`), então `app.js` trata os dois de
forma idêntica — só troca qual objeto está plugado.

O ponto central: ele **não** emite posições nem índices de grade. Ele emite
**contagens brutas**, como o `totem.ino`. Assim o teclado exercita o
pipeline real inteiro — inclusive a calibração — e não um atalho que pula
justamente a parte que precisa ser testada.

| Tecla | Efeito |
|---|---|
| `←` / `→` | eixo X — coluna à esquerda / à direita |
| `↑` / `↓` | eixo Y — linha de cima / de baixo |
| `w` / `s` | eixo Z — levanta (cancelar) / abaixa (confirmar) |

Cada toque move a "mão virtual" em `FAKE_STEP` (0.08 de um curso 0–1);
**manter a tecla pressionada** usa a repetição do teclado e varre o eixo em
cerca de um segundo, que é como se faz a varredura de calibração.

O modelo é o inverso do que o `Normalize` desfaz. Como o sketch usa
`sqrt(1 / normalized)`, ele assume capacitância ∝ 1/d²; então o firmware
falso gera:

```
raw(d) = BASELINE + SCALE / d²,   d = DMIN + u * (DMAX - DMIN)
```

`DMAX = 2.6` foi escolhido para que, depois de uma varredura completa, as
três células fiquem com faixas de tamanho parecido (~28% / ~43% / ~30% do
curso de `u`). Há também ±0.4% de ruído, para o comportamento se parecer
com um sensor de verdade.

## Mapeamento de posição

Origem no encontro das 3 placas. O pipeline devolve uma posição
**absoluta** por eixo — `0`, `1` ou `2` — e não eventos de passo. Logo o
cursor é **atribuído**, nunca incrementado: não há zona morta, taxa de
repetição nem risco de dessincronizar com a mão.

| Eixo | `0` | `1` | `2` |
|---|---|---|---|
| X (`ixyz[0]`) | coluna esquerda | coluna central | coluna direita |
| Y (`ixyz[1]`) | linha de cima | linha central | linha de baixo |
| Z (`ixyz[2]`) | **confirmar** (mão na placa) | neutro | **cancelar** (mão longe) |

O eixo Z usa detecção de **borda** com permanência (`Z_DWELL_FRAMES = 3`,
≈300 ms a 10 Hz): o evento dispara uma única vez por entrada na zona, e só
rearma quando a mão volta à zona neutra. Isso evita que a mão de passagem
dispare uma confirmação e que uma mão parada repita o evento a cada quadro.

Enquanto a calibração está ativa, os eventos de Z ficam suspensos (os
limites mudam a cada quadro, então os índices oscilam) — só o cursor
continua acompanhando.

## Ajustes finos

| Constante | Arquivo | Efeito |
|---|---|---|
| `Z_DWELL_FRAMES` | `app.js` | quanto tempo a mão fica na zona antes de confirmar |
| `CUTOFF` | `tracking.js` | largura da célula central (⚠️ vem do sketch) |
| `MomentumAverage(0.15)` | `tracking.js` | responsividade × tremor (⚠️ vem do sketch) |
| `MIN_CALIBRATION_RATIO` | `tracking.js` | rigor do portão de calibração |
| `FAKE_STEP`, `FAKE_DMAX` | `fake-firmware.js` | só o firmware falso |

As linhas marcadas com ⚠️ fazem parte do porte validado — mexer nelas
significa divergir do comportamento já testado no hardware.

## Pasta `firmware/` (obsoleta)

`firmware/touchless_interface/` é a **tentativa antiga**, que fazia
calibração e lógica de gesto dentro do Arduino e emitia JSON. Ela não
funcionou no hardware e **não é mais usada por nada** — o front-end fala
com `arduino/totem/totem.ino`. Está mantida apenas como registro; pode ser
removida.

## Possíveis próximos passos

- Persistir a calibração em `localStorage`, para não repetir a varredura a
  cada recarga da página.
- Persistir o histórico de pedidos (número sequencial real) em vez do
  número aleatório da tela de confirmação.
- Adicionar categorias (pratos/bebidas/sobremesas) com abas, caso o
  cardápio cresça além de 9 itens.
