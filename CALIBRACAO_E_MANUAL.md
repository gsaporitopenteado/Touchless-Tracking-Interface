# Fit Express: manual do usuário

## 1. Visão geral

No Fit Express o cliente monta o pedido movendo a mão sobre **três placas**, sem tocar na tela.

| Placa | Função |
|---|---|
| **X** | move o destaque para a esquerda e para a direita |
| **Y** | move o destaque para cima e para baixo |
| **Z** | confirma ou desfaz |

O pedido passa pelas telas **Início → Cardápio → Revisão → Pagamento → Confirmação**. Na Confirmação o cliente recebe o número de retirada.

## 2. Colocando o sistema no ar

1. Conecte o Arduino ao computador pelo USB.
2. Abra o arquivo `FitExpress/FitExpress.pde` no Processing e rode o sketch.
3. O sistema abre sozinho a porta serial e carrega a última calibração salva.
4. Confira o cabeçalho. Se não aparecer **"Arduino conectado"**, tecle **P** até cair na porta certa. A lista de portas aparece no console do Processing.

O botão **Iniciar Pedido** só fica liberado com o Arduino conectado **e** os três eixos calibrados (ver a [seção 7](#7-calibração)).

## 3. Gestos

| Eixo | Mão **perto** da placa | Mão no meio | Mão **longe** da placa |
|---|---|---|---|
| **X** | move para a esquerda | parado | move para a direita |
| **Y** | move para baixo | parado | move para cima |
| **Z** | **confirmar** | nada | **desfazer / voltar** |

**Tempo de permanência.** Um gesto só age depois que a mão fica parada na posição por um tempo mínimo. Isso evita acionar algo sem querer.

| Ação | Tempo |
|---|---|
| Primeiro passo em X ou Y | 5 s |
| Passos seguintes, com a mão ainda fora do meio | a cada 4 s |
| Confirmar ou desfazer (Z) | 5 s |

A barrinha de cada caixa do HUD, no pé da tela, mostra quanto falta.

Regras importantes:

- **X e Y repetem.** Enquanto a mão fica fora do meio, o destaque continua andando. Para parar, volte a mão ao meio.
- **Diagonal.** Tirar a mão do meio em X e em Y ao mesmo tempo move na diagonal.
- **Z age uma vez só.** Depois de confirmar ou desfazer, volte a mão ao meio para poder usar Z de novo. Assim uma mão parada sobre a placa não atravessa várias telas seguidas.
- **Bordas.** O destaque para nas bordas da tela; ele não dá a volta.

## 4. O que cada ação faz em cada tela

| Tela | Alvo em destaque | Z perto (confirmar) | Z longe (desfazer) |
|---|---|---|---|
| **Início** | Iniciar Pedido | começa o pedido, se liberado | nada |
| **Cardápio** (9 itens + coluna "Concluir Pedido") | um item | **adiciona 1 unidade** | **remove 1 unidade**; se a quantidade é 0, nada acontece |
| | Concluir Pedido | vai para a Revisão, se houver algum item | nada |
| **Revisão** | Voltar ao Cardápio / Prosseguir para Pagamento | executa o botão | volta ao Cardápio |
| **Pagamento** (4 formas + botões) | uma forma de pagamento | **escolhe** essa forma | desmarca, se essa for a forma escolhida; senão volta à Revisão |
| | Voltar / Concluir Compra | executa o botão (Concluir Compra exige uma forma escolhida) | volta à Revisão |
| **Confirmação** | Novo Pedido | recomeça no Cardápio para o próximo cliente | nada |

**Regra geral do desfazer:** Z longe tenta desfazer algo no alvo em destaque. Se ali não há nada a desfazer, ele volta uma tela, nas telas que têm "voltar".

**Mouse** (apoio e acessibilidade):
- **Clique esquerdo** num alvo: destaca e confirma.
- **Clique direito** num alvo: destaca e desfaz.

## 5. Lendo a tela

**Cabeçalho**, à direita:

| Indicador | Significado |
|---|---|
| ● verde "Arduino conectado" | dados chegando normalmente |
| ● vermelho "Sem fonte de dados" | nada chegando pela porta serial |

**HUD dos eixos**, no pé da tela, com uma caixa por eixo:

| Elemento | Significado |
|---|---|
| Letra | X, Y ou Z |
| Direção | `<< esq` / `dir >>`, `^^ cima` / `vv baixo`, `confirmar` / `desfazer`; `--` = mão no meio |
| Número (0,00 a 1,00) | posição da mão no eixo, já suavizada |
| Barrinha | tempo que falta para o próximo passo ou acionamento |
| Cor âmbar | o eixo está fora do meio e vai agir |

A linha **`bruto`**, à esquerda do HUD, mostra em tempo real as três leituras cruas dos sensores.

Os botões **−** e **+** em cima de cada caixa servem para calibrar (ver a [seção 7](#7-calibração)).

**Teclas:**

| Tecla | Ação |
|---|---|
| P | troca de porta serial |
| H | mostra ou esconde a barra de ajuda |

## 6. Solução de problemas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| **Iniciar Pedido** não libera | Arduino desconectado, ou algum eixo sem calibração | Confira o cabeçalho. Calibre os eixos cujos botões mostram `min`/`max` em vez de números |
| Cabeçalho não mostra "Arduino conectado" | porta serial errada | Tecle **P** até achar a porta certa |
| Cursor anda sozinho com a mão parada | a mão está perto do limite entre duas posições | Mova a mão com mais clareza para o meio ou para o extremo; se continuar, recalibre o eixo |
| Cursor anda ou Z age sem ninguém na frente | sem mão, a placa entende "mão longe" | Comportamento conhecido do sensor |
| Z confirmou logo depois de calibrar o **+** de Z | a mão ficou encostada na placa depois da medição | Afaste a mão assim que o botão chegar a `10/10` |

## 7. Calibração

A calibração é feita **dentro do app**, com dois botões em cima de cada eixo (X, Y e Z) no HUD:

| Botão | Define | Posição da mão |
|---|---|---|
| **−** | o **mínimo** do intervalo do eixo | **longe** da placa |
| **+** | o **máximo** do intervalo do eixo | **encostada** na placa |

Para cada eixo:

1. Afaste a mão da placa e clique em **−**. Mantenha a mão parada por cerca de 1 segundo, enquanto o botão conta de `1/10` até `10/10`.
2. Encoste a mão na placa e clique em **+**. Mantenha a mão parada por cerca de 1 segundo.
3. No eixo Z, afaste a mão logo em seguida, para não confirmar nada sem querer.

Cada medição faz a **média de 10 leituras**. Enquanto ela acontece, a navegação fica pausada. Ao terminar, o botão passa a mostrar o valor gravado e uma mensagem informa o resultado:

| Mensagem | Significado |
|---|---|
| `... - salvo` | valor aceito; os três eixos estão calibrados e a calibração foi salva |
| `... - calibracao ainda incompleta` | valor aceito, mas ainda falta calibrar algum limite |
| `... recusado: span ...` | o mínimo e o máximo ficariam próximos demais; nada foi alterado. Repita com a mão bem longe (−) ou bem encostada (+) |

- **Cancelar:** para interromper uma medição, clique de novo no botão que está medindo (âmbar).
- **Quando salva:** a calibração é salva automaticamente assim que os três eixos ficam válidos, e é carregada de novo na próxima vez que o sistema abrir.
