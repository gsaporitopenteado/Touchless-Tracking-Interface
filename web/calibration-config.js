/**
 * calibration-config.js
 * ----------------------------------------------------------------------
 * Calibração FIXA dos sensores, obtida uma única vez fora do navegador —
 * rodando o utilitário Processing em
 * /calibration-tool/calibration_tool.pde (ver README.md, seção
 * "Calibração (branch calibracao-processing)") — ou o sketch original
 * TicTacToe3D.pde do projeto.
 *
 * Roteiro: abra o utilitário, segure o botão esquerdo do mouse e mova a
 * mão de ponta a ponta sobre as 3 placas (bem perto e bem longe de cada
 * uma), depois pressione 'p'. Substitua os valores abaixo pelo trecho que
 * aparecer no console.
 *
 * ⚠️ Os valores abaixo são placeholders — calibre e substitua antes do
 * uso real. Sem isso, os 3 eixos vão ficar sempre "no meio" (zona morta).
 * ----------------------------------------------------------------------
 */
const FIXED_CALIBRATION = {
  x: { min: 0, max: 1000 },
  y: { min: 0, max: 1000 },
  z: { min: 0, max: 1000 },
};
