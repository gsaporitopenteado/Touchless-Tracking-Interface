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
arduino/totem/totem.ino      web/serial.js     web/tracking.js   web/navigation.js + app.js
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
python serve.py          # porta 8080; use "python serve.py 9000" para outra
```

Depois abra `http://localhost:8080` no Chrome.

### Por que `serve.py` e não `python -m http.server`

Porque `http.server` deixa o Chrome guardar os `.js` em cache. Você edita
uma constante (`DWELL_Z_MS`, digamos), reinicia o servidor, recarrega a
página — **e nada muda**, porque o arquivo velho está no cache do
*navegador*, não do servidor. Reiniciar o servidor não tem como resolver
isso. O `serve.py` manda `Cache-Control: no-store` em tudo, então cada
recarga busca os arquivos de novo.

Se preferir continuar com `python -m http.server`, então depois de editar
qualquer `.js` faça um **recarregamento forçado**: `Ctrl+Shift+R` (ou
`Ctrl+F5`). Ou deixe o DevTools aberto com *Network → Disable cache*
marcado, que vale enquanto o DevTools estiver aberto.

**Como conferir qual valor está rodando de verdade:** abra o console do
navegador (F12) e digite o nome da constante:

```js
DWELL_XY_MS    // 2000
DWELL_Z_MS     // 2000
REPEAT_XY_MS   // 1000
```

São constantes globais, então o console mostra o valor que a página
realmente carregou. Se aparecer o valor antigo, é cache — não é o código.

### Fluxo de uso

1. **Início** — clique em **Conectar ao Arduino** ou marque **Firmware
   falso** para testar pelo teclado.
2. **Calibração** (obrigatória) — **segure** *Definir limites* (ou a barra
   de espaço) e varra a mão por todo o alcance de cada placa. Equivale ao
   `mousePressed && mouseButton == LEFT` do sketch Processing. A navegação
   fica congelada durante a varredura e os temporizadores são zerados no
   fim — sem isso, terminar a varredura com a mão dentro de Z0 deixaria o
   eixo travado esperando você "sair e voltar" antes do primeiro confirmar.
3. **Cardápio** — X/Y movem o cursor pela grade 3x4; Z0 adiciona o item em
   foco, Z2 remove. A 4a coluna é *Concluir Pedido*: vá para a direita até
   o fim e confirme com Z0.
4. **Revisão** — X move entre *Voltar ao Cardápio* e *Prosseguir para
   Pagamento*; Z0 aciona o que está em foco, Z2 volta ao cardápio.
5. **Pagamento** — X/Y percorrem as 4 formas e a linha de ações; Z0 escolhe
   a forma em foco e, sobre *Concluir Compra*, fecha o pedido. Z2 **sobre a
   forma escolhida** a desmarca; em qualquer outro alvo, volta à revisão sem
   mexer na escolha (ver [A regra do Z2](#a-regra-do-z2)).
6. **Confirmação** — mostra o número do pedido; Z0 inicia um novo pedido,
   voltando **direto ao cardápio** (fluxo de totem: o próximo cliente já
   começa a escolher). Se nesse momento a fonte de dados tiver caído ou a
   calibração se perdido, cai na tela inicial em vez do cardápio — ela é o
   único lugar com *Conectar* e *Definir limites*.

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
| `w` / `s` | eixo Z — levanta (ação secundária) / abaixa (confirmar) |

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

## Navegação: controle por TAXA, não por posição

Antes, `ixyz[0]` **era** a coluna e `ixyz[1]` **era** a linha. Isso amarrava o
layout à resolução do sensor: a grade tinha que ter exatamente 3x3 porque o
sensor tem exatamente 3 zonas por eixo. Foi por isso que a tela de pagamento
(4 opções) ficou sem navegação nenhuma — não existe mapeamento de 3 zonas
para 4 alvos.

Agora os eixos são **comandos**, e o layout pode ter qualquer tamanho:

| Eixo | Zona 0 | Zona 1 | Zona 2 |
|---|---|---|---|
| X | move para a **esquerda** | parado | move para a **direita** |
| Y | move para **cima** | parado | move para **baixo** |
| Z | **confirmar** (mão na placa) | nada | **ação secundária** (mão longe) |

- **Sem comportamento cíclico**: na borda, o cursor para. Isso importa mais
  aqui do que no modelo anterior — com repetição automática, uma grade
  cíclica deixaria uma mão esquecida girando o cardápio para sempre.
- **Diagonal funciona**: X e Y têm temporizadores independentes, então sair
  do centro nos dois ao mesmo tempo faz os dois expirarem juntos. Entrando
  em momentos diferentes sai uma escadinha — imperceptível na prática.

### A assimetria entre X/Y e Z (importante)

**X e Y repetem** enquanto a mão fica fora do centro, como tecla segurada:
primeiro passo depois de `DWELL_XY_MS`, os seguintes a cada `REPEAT_XY_MS`.

**Z dispara uma única vez por entrada na zona** e só rearma quando a mão
volta para Z1. Isso não é detalhe: se Z repetisse igual a X/Y, uma mão
parada perto da placa atravessaria *Concluir Pedido* -> *Prosseguir para
Pagamento* -> *Concluir Compra* em três tiques, fechando um pedido real
sozinha.

### Onde deixar a zona morta — é decisão de calibração

Como Z1 (o centro) é a única zona inerte, **a posição em que a mão
naturalmente descansa tem que cair em Z1**. Na prática: ao calibrar o eixo
Z, use como extremo "longe" a altura confortável de sobrevoo, **não** a mão
ausente. Aí sobrevoar lê Z1, abaixar lê Z0 (confirmar) e levantar lê Z2.
Se a zona morta cair no lugar errado, a interface fica acionando sozinha —
e isso se resolve recalibrando, não mexendo no código.

### Mapas de foco

Cada tela declara uma matriz de alvos focáveis e o motor cuida do resto:

| Tela | Mapa |
|---|---|
| início | 1 x 1 (Iniciar Pedido) |
| cardápio | **3 x 4** — 9 itens + a coluna de *Concluir Pedido* |
| revisão | 1 x 2 (Voltar, Prosseguir) |
| pagamento | 3 x 2 — 2x2 de formas + linha de ações |
| confirmação | 1 x 1 (Novo Pedido) |

No cardápio, a 4a coluna é a **mesma referência de alvo** nas três linhas.
Isso resolve de graça a pergunta "voltando do botão, para qual linha eu
vou?": saindo de `[1][3]` para a esquerda você cai em `[1][2]` — a linha de
origem é lembrada sem nenhum `lastRow` guardado.

Linhas podem ter tamanhos diferentes; mover na vertical para uma linha mais
curta fixa a coluna no último índice válido.

### A regra do Z2

Uma regra só, para todas as telas:

> **Z2 pede ao alvo em FOCO para se desfazer. Se aquele alvo não tinha nada
> a desfazer, Z2 sai da tela.**

O detalhe que importa é o **escopo**: Z2 só age sobre o que está sendo
apontado. Nunca sobre outro alvo.

| Tela | Alvo em foco | Z2 faz |
|---|---|---|
| cardápio | item com quantidade > 0 | remove uma unidade |
| cardápio | item com quantidade 0 | nada a desfazer → cardápio não tem voltar → **nada** |
| cardápio | *Concluir Pedido* | nada a desfazer → **nada** |
| pagamento | a forma **escolhida** | desmarca (e volta a bloquear *Concluir Compra*) |
| pagamento | uma forma **não** escolhida | nada a desfazer *neste alvo* → volta à revisão, **sem** mexer na escolha |
| pagamento | *Voltar* / *Concluir Compra* | volta à revisão |
| revisão | qualquer botão | volta ao cardápio |
| confirmação | *Novo Pedido* | nada (a compra já fechou) |

Mecanicamente, `secondary()` do alvo devolve `true` quando desfez algo; se
devolver `false` (ou o alvo não tiver ação secundária), o Z2 cai no voltar
da tela.

Apontando para a forma que já está escolhida, isso dá naturalmente o
comportamento de **dois estágios**: o primeiro Z2 desmarca, o segundo (agora
sem nada escolhido naquele alvo) volta à revisão.

> Duas versões anteriores erraram aqui, e vale registrar por quê. A primeira
> fazia Z2 sair da tela de pagamento direto — inconsistente, porque no
> cardápio Z2 desfaz e ali ele abandonava o passo inteiro. A segunda passou
> a desmarcar, mas em **escopo de tela**: apontando para o Pix, Z2 limpava o
> Crédito — agia sobre um alvo que não estava sendo apontado. A regra de
> escopo de alvo acima resolve as duas.

### Feedback na tela

Como o cursor agora é **estado que não se autocorrige** (um eixo travado
caminha até a borda e fica lá), a interface mostra o porquê:

- HUD no cabeçalho com a direção ativa de cada eixo, o valor normalizado e
  uma barrinha do temporizador — visível em todas as telas.
- Barra de permanência no alvo focado, enchendo durante `DWELL_Z_MS`
  (verde para confirmar, vermelho para a ação secundária).
- Os painéis de leitura bruta/normalizada continuam onde estavam.

## Ajustes finos

| Constante | Arquivo | Efeito |
|---|---|---|
| `DWELL_XY_MS` (500) | `navigation.js` | tempo parado antes do **primeiro** passo de X/Y |
| `REPEAT_XY_MS` (350) | `navigation.js` | intervalo da repetição enquanto a mão fica fora do centro |
| `DWELL_Z_MS` (500) | `navigation.js` | tempo na zona antes de confirmar / ação secundária |
| `HYSTERESIS_ENABLED` (false) | `navigation.js` | histerese de fronteira — ver abaixo |
| `CUTOFF` | `tracking.js` | largura da zona morta (vem do sketch) |
| `MomentumAverage(0.15)` | `tracking.js` | responsividade x tremor (vem do sketch) |
| `MIN_CALIBRATION_RATIO` | `tracking.js` | rigor do portão de calibração |
| `FAKE_STEP`, `FAKE_DMAX` | `fake-firmware.js` | só o firmware falso |

Depois de mudar qualquer uma delas, recarregue com `serve.py` (ou force o
recarregamento) — ver [Rodando o front-end](#rodando-o-front-end).

As linhas de `tracking.js` fazem parte do porte validado — mexer nelas
significa divergir do comportamento já testado no hardware.

`DWELL_XY_MS` e `DWELL_Z_MS` são constantes separadas de propósito, ainda que
hoje valham o mesmo: confirmar pode querer ser mais lento que navegar (menos
falso positivo), ou o contrário, sem que uma mudança afete a outra.

### Histerese (implementada, desligada)

`HYSTERESIS_ENABLED = false`. Com `CUTOFF = 0.2` a zona morta ocupa de 0.2 a
0.8 do curso, que é folga de sobra; ligar só faz sentido se aparecer tremor
na fronteira. Vale saber que, em controle por taxa, um flicker de fronteira
não só pisca o destaque — ele **injeta passos**. Se isso acontecer, mude a
constante para `true` (a margem é `HYSTERESIS_MARGIN`, 0.04).

Detalhe medido: com a mão voltando ao centro, o EMA leva ~300 ms para sair
da zona, e `REPEAT_XY_MS` é 350 ms — ou seja, hoje **não** sobra passo
fantasma, mas a margem é estreita. Baixar `REPEAT_XY_MS` para menos de
~300 ms passa a produzir um passo extra por movimento.

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
