# Fit Express — Interface Touchless para Pedidos de Fast Food Saudável

Sistema de autoatendimento sem toque: o cliente navega pelo cardápio e monta
o pedido movendo a mão sobre três placas de alumínio (sensores capacitivos
X/Y/Z), inspirado no projeto [A Touchless 3D Tracking Interface (Make:)](https://makezine.com/projects/a-touchless-3d-tracking-interface/)
([código original](https://github.com/Make-Magazine/3DInterface)). Este
projeto usa apenas o plano 2D (X/Y para navegar, Z para confirmar/cancelar) e
adiciona um fluxo completo de pedido: **seleção → revisão → pagamento →
confirmação com número de retirada**.

## Estrutura do projeto

```
firmware/touchless_interface/touchless_interface.ino   # firmware do Arduino
web/index.html, style.css, app.js, serial.js            # front-end do totem
```

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
esse tempo (em microssegundos) como leitura bruta de cada eixo — é a mesma
técnica de "charge transfer" usada em sensores capacitivos caseiros, e
dispensa pinos extras de emissor/receptor.

> ⚠️ Os tempos brutos variam de acordo com o tamanho das placas, distância
> entre elas e o ambiente. **Calibre sempre** (próxima seção) antes do uso
> real — os valores padrão no firmware são só um ponto de partida.

## Gravando o firmware

1. Abra `firmware/touchless_interface/touchless_interface.ino` na Arduino IDE.
2. Selecione a placa (Uno/Nano/Mega) e a porta serial correspondente.
3. Faça upload.
4. Abra o Serial Monitor a **115200 baud** para calibrar.

### Calibração (via Serial Monitor, sem quebra de linha automática)

Para cada eixo, meça dois pontos: `NEAR` (mão tocando a placa) e `FAR` (mão
fora de alcance, ~30cm ou ausente):

| Comando | Ação |
|---|---|
| `xn` | grava NEAR do eixo X com a leitura atual |
| `xf` | grava FAR do eixo X com a leitura atual |
| `yn` / `yf` | idem para o eixo Y |
| `zn` / `zf` | idem para o eixo Z |
| `p` | imprime a calibração atual e as leituras brutas (para conferir) |
| `s` | salva a calibração na EEPROM (persiste após desligar) |
| `r` | restaura a calibração padrão de fábrica |

Roteiro sugerido: com a mão longe de todas as placas, digite `xf`, `yf`,
`zf`. Em seguida, encoste a mão em cada placa (uma de cada vez) e digite
`xn`, `yn`, `zn` respectivamente. Confira com `p` e finalize com `s`.

## Saída de dados do firmware

Uma linha JSON por ciclo (~33 Hz):

```json
{"x":18.4,"y":9.2,"z":24.7,"moveH":"RIGHT","moveV":"NONE","gesture":"SELECT"}
```

- `x`, `y`, `z`: posição estimada de 0 a 30 em cada eixo.
- `moveH` / `moveV`: evento de passo (`LEFT`/`RIGHT`/`UP`/`DOWN`/`NONE`),
  já com limitação de taxa (repete a cada ~350ms enquanto a mão permanece
  fora da zona morta 10–20).
- `gesture`: evento de borda (`SELECT`/`DESELECT`/`NONE`) — dispara uma
  única vez a cada cruzamento das zonas Z<10 ou Z>20.

Linhas de depuração da calibração começam com `#` e são ignoradas pelo
front-end.

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
2. **Cardápio** — mova a mão sobre X/Y para navegar entre os 9 itens da
   grade; abaixe a mão sobre Z para adicionar o item destacado ao pedido,
   levante para remover. O painel lateral mostra o carrinho, o total e as
   leituras brutas dos sensores em tempo real. Clique em **Concluir Pedido**
   (ação manual, não por gesto) para seguir.
3. **Revisão** — confira os itens e o total; pode **Voltar ao Cardápio** ou
   **Prosseguir para Pagamento**.
4. **Pagamento** — escolha a forma de pagamento (Crédito, Débito, Pix ou
   Dinheiro) e **Conclua a Compra**.
5. **Confirmação** — mostra o número do pedido e o resumo para retirada no
   balcão. **Novo Pedido** reinicia o fluxo.

## Lógica de posicionamento (especificação)

Origem no encontro das 3 placas; eixos de 0 a 30.

| Eixo | Zona morta | Abaixo (`< 10`) | Acima (`> 20`) |
|---|---|---|---|
| X | 10–20: parado na horizontal | move para a **direita** | move para a **esquerda** |
| Y | 10–20: parado na vertical | move para **cima** | move para **baixo** |
| Z | 10–20: sem mudança de seleção | **desseleciona** o item | **seleciona** o item |

Essa lógica está implementada inteiramente no firmware (não no front-end),
que só recebe os eventos já processados (`moveH`, `moveV`, `gesture`).

## Possíveis próximos passos

- Ajustar `MOVE_REPEAT_MS` e `SMOOTHING_ALPHA` no firmware conforme a
  sensibilidade desejada.
- Adicionar categorias (pratos/bebidas/sobremesas) com abas navegáveis pelo
  plano XZ/YZ, caso o cardápio cresça além de 9 itens.
- Persistir o histórico de pedidos (número sequencial real) em vez do
  número aleatório usado na tela de confirmação.
