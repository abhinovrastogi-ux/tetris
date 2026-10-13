"use strict";

const COLS = 10;
const ROWS = 20;
const CELL = 30;
const LOCK_DELAY = 500;
const MAX_LOCK_RESETS = 15;

const PIECES = {
  I: { color: "#56d7e8", cells: [[1, 0], [1, 1], [1, 2], [1, 3]] },
  J: { color: "#7188ff", cells: [[0, 0], [1, 0], [1, 1], [1, 2]] },
  L: { color: "#ffad5c", cells: [[0, 2], [1, 0], [1, 1], [1, 2]] },
  O: { color: "#f7d75c", cells: [[0, 1], [0, 2], [1, 1], [1, 2]] },
  S: { color: "#72df9a", cells: [[0, 1], [0, 2], [1, 0], [1, 1]] },
  T: { color: "#be8aff", cells: [[0, 1], [1, 0], [1, 1], [1, 2]] },
  Z: { color: "#ff7187", cells: [[0, 0], [0, 1], [1, 1], [1, 2]] },
};
const PIECE_NAMES = Object.keys(PIECES);

const JLSTZ_KICKS = {
  "0>1": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "1>0": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  "1>2": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  "2>1": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "2>3": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  "3>2": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "3>0": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "0>3": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
};
const I_KICKS = {
  "0>1": [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  "1>0": [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  "1>2": [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
  "2>1": [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  "2>3": [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  "3>2": [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  "3>0": [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  "0>3": [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
};
const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");
const holdCanvas = document.getElementById("hold-canvas");
const holdCtx = holdCanvas.getContext("2d");
const nextCanvas = document.getElementById("next-canvas");
const nextCtx = nextCanvas.getContext("2d");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayMessage = document.getElementById("overlay-message");
const overlayIcon = document.getElementById("overlay-icon");
const overlayButton = document.getElementById("overlay-button");
const startButton = document.getElementById("start-button");
const pauseButton = document.getElementById("pause-button");
const soundButton = document.getElementById("sound-button");

let board;
let queue;
let current;
let heldPiece;
let holdUsed;
let score;
let totalLines;
let level;
let combo;
let backToBack;
let gravityAccumulator;
let lockElapsed;
let lockResets;
let elapsedMs;
let bestScore = loadBestScore();
let gameState = "ready";
let soundEnabled = true;
let audioContext;
let lastFrameTime = 0;
let lastClockSecond = -1;
let lineFlash = 0;
const heldKeys = new Set();

function loadBestScore() {
  try {
    const saved = Number(window.localStorage.getItem("stackline-best-score"));
    return Number.isFinite(saved) && saved > 0 ? Math.floor(saved) : 0;
  } catch (error) {
    console.warn("Could not read the saved high score.", error);
    return 0;
  }
}

function saveBestScore() {
  try {
    window.localStorage.setItem("stackline-best-score", String(bestScore));
  } catch (error) {
    console.warn("Could not save the high score.", error);
  }
}

function rotateMatrix(matrix) {
  return matrix.map((_, row) => matrix.map((line) => line[row]).reverse());
}

function getMatrix(name, rotation) {
  let matrix = Array.from({ length: 4 }, () => Array(4).fill(false));
  for (const [row, col] of PIECES[name].cells) matrix[row][col] = true;
  for (let turn = 0; turn < rotation; turn += 1) matrix = rotateMatrix(matrix);
  return matrix;
}

function makePiece(name) {
  return { name, rotation: 0, matrix: getMatrix(name, 0), x: 3, y: -1 };
}

function refillQueue() {
  const bag = [...PIECE_NAMES];
  for (let index = bag.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [bag[index], bag[other]] = [bag[other], bag[index]];
  }
  queue.push(...bag);
}

function ensureQueue() {
  while (queue.length < 7) refillQueue();
}

function spawnPiece() {
  ensureQueue();
  current = makePiece(queue.shift());
  holdUsed = false;
  gravityAccumulator = 0;
  lockElapsed = 0;
  lockResets = 0;
  if (!fits(current.matrix, current.x, current.y)) endGame();
  updateUI();
}

function fits(matrix, offsetX, offsetY) {
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      if (!matrix[row][col]) continue;
      const x = offsetX + col;
      const y = offsetY + row;
      if (x < 0 || x >= COLS || y >= ROWS) return false;
      if (y >= 0 && board[y][x]) return false;
    }
  }
  return true;
}

function isGrounded() {
  return current && !fits(current.matrix, current.x, current.y + 1);
}

function resetLockAfterAction(wasGrounded) {
  if (wasGrounded && lockResets < MAX_LOCK_RESETS) {
    lockElapsed = 0;
    lockResets += 1;
  }
}

function movePiece(dx, dy) {
  if (gameState !== "playing" || !current || !fits(current.matrix, current.x + dx, current.y + dy)) return false;
  const wasGrounded = isGrounded();
  current.x += dx;
  current.y += dy;
  resetLockAfterAction(wasGrounded);
  if (dy > 0) lockElapsed = 0;
  if (dx !== 0) playTone(205, 0.028, "triangle", 0, 0.014);
  return true;
}

function rotatePiece(direction) {
  if (gameState !== "playing" || !current || current.name === "O") return;
  const from = current.rotation;
  const to = (from + direction + 4) % 4;
  const matrix = getMatrix(current.name, to);
  const table = current.name === "I" ? I_KICKS : JLSTZ_KICKS;
  const kicks = table[`${from}>${to}`];
  const wasGrounded = isGrounded();
  for (const [kickX, kickY] of kicks) {
    if (fits(matrix, current.x + kickX, current.y + kickY)) {
      current.x += kickX;
      current.y += kickY;
      current.rotation = to;
      current.matrix = matrix;
      resetLockAfterAction(wasGrounded);
      playTone(260, 0.045, "triangle");
      return;
    }
  }
}

function holdCurrentPiece() {
  if (gameState !== "playing" || !current || holdUsed) return;
  const outgoing = current.name;
  if (heldPiece) {
    current = makePiece(heldPiece);
    heldPiece = outgoing;
    if (!fits(current.matrix, current.x, current.y)) {
      endGame();
      return;
    }
  } else {
    heldPiece = outgoing;
    spawnPiece();
  }
  holdUsed = true;
  gravityAccumulator = 0;
  lockElapsed = 0;
  lockResets = 0;
  playTone(380, 0.06, "sine");
  updateUI();
}

function hardDrop() {
  if (gameState !== "playing" || !current) return;
  let distance = 0;
  while (fits(current.matrix, current.x, current.y + 1)) {
    current.y += 1;
    distance += 1;
  }
  score += distance * 2;
  lockPiece(true);
}

function softDrop() {
  if (gameState !== "playing" || !current) return;
  if (movePiece(0, 1)) {
    score += 1;
    gravityAccumulator = 0;
    updateUI();
  }
}

function lockPiece(hardDrop = false) {
  if (!current) return;
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      if (!current.matrix[row][col]) continue;
      const x = current.x + col;
      const y = current.y + row;
      if (y < 0) {
        endGame();
        return;
      }
      board[y][x] = current.name;
    }
  }
  playTone(hardDrop ? 110 : 145, hardDrop ? 0.12 : 0.075, "triangle", 0, 0.045);

  let cleared = 0;
  board = board.filter((row) => {
    if (row.every(Boolean)) {
      cleared += 1;
      return false;
    }
    return true;
  });
  while (board.length < ROWS) board.unshift(Array(COLS).fill(null));

  if (cleared > 0) {
    combo += 1;
    const newLevel = Math.floor(totalLines / 10) + 1;
    const linePoints = LINE_SCORES[cleared] * newLevel;
    const isTetris = cleared === 4;
    const difficultClear = isTetris;
    const bonus = combo > 0 ? combo * 50 * newLevel : 0;
    score += (backToBack && difficultClear ? Math.floor(linePoints * 0.5) : linePoints) + bonus;
    if (difficultClear) backToBack = true;
    else backToBack = false;
    totalLines += cleared;
    level = Math.floor(totalLines / 10) + 1;
    lineFlash = 140;
    for (let index = 0; index < cleared; index += 1) {
      playTone(520 + index * 110, 0.11, "sine", index * 0.075);
    }
  } else {
    combo = -1;
  }

  if (score > bestScore) {
    bestScore = score;
    saveBestScore();
  }
  current = null;
  spawnPiece();
  updateUI();
}

function startGame() {
  if (gameState === "playing") return;
  if (gameState === "paused") {
    resumeGame();
    return;
  }
  board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  queue = [];
  refillQueue();
  current = null;
  heldPiece = null;
  holdUsed = false;
  score = 0;
  totalLines = 0;
  level = 1;
  combo = -1;
  backToBack = false;
  gravityAccumulator = 0;
  lockElapsed = 0;
  lockResets = 0;
  elapsedMs = 0;
  lastClockSecond = -1;
  gameState = "playing";
  overlay.hidden = true;
  pauseButton.disabled = false;
  pauseButton.textContent = "Ⅱ  Pause";
  document.getElementById("status-label").textContent = "PLAYING";
  spawnPiece();
  updateUI();
  playTone(440, 0.08, "sine");
}

function pauseGame() {
  if (gameState !== "playing") return;
  gameState = "paused";
  heldKeys.clear();
  overlay.hidden = false;
  overlayIcon.textContent = "Ⅱ";
  overlayTitle.textContent = "Take a breather.";
  overlayMessage.textContent = "Your board is right where you left it.";
  overlayButton.textContent = "Resume game";
  pauseButton.textContent = "▶  Resume";
  document.getElementById("status-label").textContent = "PAUSED";
  playTone(300, 0.06, "sine");
}

function resumeGame() {
  if (gameState !== "paused") return;
  gameState = "playing";
  overlay.hidden = true;
  pauseButton.textContent = "Ⅱ  Pause";
  document.getElementById("status-label").textContent = "PLAYING";
  lastFrameTime = performance.now();
}

function endGame() {
  gameState = "over";
  current = null;
  heldKeys.clear();
  overlay.hidden = false;
  overlayIcon.textContent = "↻";
  overlayTitle.textContent = "That's a wrap.";
  overlayMessage.textContent = `You scored ${score.toLocaleString()} points and cleared ${totalLines} ${totalLines === 1 ? "line" : "lines"}.`;
  overlayButton.textContent = "Play again";
  pauseButton.disabled = true;
  pauseButton.textContent = "Ⅱ  Pause";
  document.getElementById("status-label").textContent = "GAME OVER";
  if (score > bestScore) {
    bestScore = score;
    saveBestScore();
  }
  updateUI();
  playTone(150, 0.32, "sawtooth");
}

function getGravityInterval() {
  return Math.max(75, 1000 * (0.8 ** (level - 1)));
}

function update(delta) {
  if (gameState !== "playing" || !current) return;
  elapsedMs += delta;
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds !== lastClockSecond) {
    lastClockSecond = seconds;
    document.getElementById("time").textContent =
      `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }

  if (heldKeys.has("ArrowDown")) {
    gravityAccumulator += delta;
    while (gravityAccumulator >= 38 && current) {
      gravityAccumulator -= 38;
      if (movePiece(0, 1)) {
        score += 1;
      } else {
        break;
      }
    }
  } else {
    gravityAccumulator += delta;
    const interval = getGravityInterval();
    while (gravityAccumulator >= interval && current) {
      gravityAccumulator -= interval;
      if (!movePiece(0, 1)) break;
    }
  }

  if (isGrounded()) {
    lockElapsed += delta;
    if (lockElapsed >= LOCK_DELAY) lockPiece();
  } else {
    lockElapsed = 0;
  }
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function drawBlock(context, x, y, size, color, alpha = 1) {
  const inset = Math.max(1, size * 0.055);
  const left = x + inset;
  const top = y + inset;
  const side = size - inset * 2;
  context.save();
  context.globalAlpha = alpha;
  roundedRect(context, left, top, side, side, Math.max(2, size * 0.16));
  context.fillStyle = color;
  context.fill();
  context.strokeStyle = "rgba(255,255,255,.27)";
  context.lineWidth = Math.max(0.7, size * 0.035);
  context.stroke();
  context.beginPath();
  context.moveTo(left + size * 0.16, top + size * 0.19);
  context.lineTo(left + side - size * 0.16, top + size * 0.19);
  context.strokeStyle = "rgba(255,255,255,.34)";
  context.lineWidth = Math.max(0.7, size * 0.045);
  context.stroke();
  context.restore();
}

function drawBoard() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0b101b";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(159,177,211,.075)";
  ctx.lineWidth = 1;
  for (let col = 0; col <= COLS; col += 1) {
    ctx.beginPath();
    ctx.moveTo(col * CELL + 0.5, 0);
    ctx.lineTo(col * CELL + 0.5, canvas.height);
    ctx.stroke();
  }
  for (let row = 0; row <= ROWS; row += 1) {
    ctx.beginPath();
    ctx.moveTo(0, row * CELL + 0.5);
    ctx.lineTo(canvas.width, row * CELL + 0.5);
    ctx.stroke();
  }

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const name = board[row][col];
      if (name) drawBlock(ctx, col * CELL, row * CELL, CELL, PIECES[name].color);
    }
  }
  if (current) {
    let ghostY = current.y;
    while (fits(current.matrix, current.x, ghostY + 1)) ghostY += 1;
    drawPiece(ctx, current, ghostY, 0.22);
    drawPiece(ctx, current, current.y);
  }
  if (lineFlash > 0) {
    ctx.fillStyle = `rgba(179,255,247,${(lineFlash / 140) * 0.12})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function drawPiece(context, piece, yPosition, alpha = 1) {
  const color = PIECES[piece.name].color;
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      if (!piece.matrix[row][col]) continue;
      const x = piece.x + col;
      const y = yPosition + row;
      if (y >= 0) drawBlock(context, x * CELL, y * CELL, CELL, color, alpha);
    }
  }
}

function drawMiniPiece(context, name, centerY, cellSize = 15, centerX = context.canvas.width / 2) {
  if (!name) return;
  const cells = PIECES[name].cells;
  const minRow = Math.min(...cells.map(([row]) => row));
  const maxRow = Math.max(...cells.map(([row]) => row));
  const minCol = Math.min(...cells.map(([, col]) => col));
  const maxCol = Math.max(...cells.map(([, col]) => col));
  const width = (maxCol - minCol + 1) * cellSize;
  const height = (maxRow - minRow + 1) * cellSize;
  const startX = centerX - width / 2;
  const startY = centerY - height / 2;
  for (const [row, col] of cells) {
    drawBlock(context, startX + (col - minCol) * cellSize, startY + (row - minRow) * cellSize,
      cellSize, PIECES[name].color);
  }
}

function drawMiniBoards() {
  holdCtx.clearRect(0, 0, holdCanvas.width, holdCanvas.height);
  drawMiniPiece(holdCtx, heldPiece, holdCanvas.height / 2, 16);

  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  for (let index = 0; index < 5; index += 1) {
    const slotCenter = (index + 0.5) * (nextCanvas.width / 5);
    drawMiniPiece(nextCtx, queue[index], nextCanvas.height / 2, 5, slotCenter);
  }
}

function updateUI() {
  document.getElementById("score").textContent = score.toLocaleString();
  document.getElementById("best-score").textContent = bestScore.toLocaleString();
  document.getElementById("level").textContent = String(level);
  document.getElementById("lines").textContent = String(totalLines);
  soundButton.setAttribute("aria-pressed", String(soundEnabled));
  soundButton.textContent = soundEnabled ? "♫  Sound on" : "♫  Sound off";
  drawMiniBoards();
}

function playTone(frequency, duration, type, startDelay = 0, volume = 0.035) {
  if (!soundEnabled) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioContext) audioContext = new AudioContextClass();
    if (audioContext.state === "suspended") audioContext.resume();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const startTime = audioContext.currentTime + startDelay;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startTime);
    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + duration);
  } catch (error) {
    console.warn("Could not play game audio.", error);
  }
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  updateUI();
  if (soundEnabled) playTone(440, 0.08, "sine");
}

function performAction(action) {
  if (action === "start") return startGame();
  if (action === "pause") return gameState === "paused" ? resumeGame() : pauseGame();
  if (gameState !== "playing") return;
  if (action === "left") movePiece(-1, 0);
  else if (action === "right") movePiece(1, 0);
  else if (action === "down") softDrop();
  else if (action === "rotate") rotatePiece(1);
  else if (action === "rotate-left") rotatePiece(-1);
  else if (action === "drop") hardDrop();
  else if (action === "hold") holdCurrentPiece();
}

function frame(timestamp) {
  const delta = lastFrameTime ? Math.min(timestamp - lastFrameTime, 50) : 0;
  lastFrameTime = timestamp;
  update(delta);
  lineFlash = Math.max(0, lineFlash - delta);
  drawBoard();
  requestAnimationFrame(frame);
}

overlayButton.addEventListener("click", () => {
  if (gameState === "paused") resumeGame();
  else startGame();
});
startButton.addEventListener("click", startGame);
pauseButton.addEventListener("click", () => performAction("pause"));
soundButton.addEventListener("click", toggleSound);

let repeatTimer;
let directionHandled = false;
for (const button of document.querySelectorAll(".touch-controls [data-action]")) {
  const action = button.dataset.action;
  if (action === "left" || action === "right" || action === "down") {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      directionHandled = true;
      performAction(action);
      window.clearInterval(repeatTimer);
      repeatTimer = window.setInterval(() => performAction(action), action === "down" ? 45 : 115);
      button.setPointerCapture(event.pointerId);
    });
    button.addEventListener("pointerup", () => window.clearInterval(repeatTimer));
    button.addEventListener("pointercancel", () => window.clearInterval(repeatTimer));
    button.addEventListener("lostpointercapture", () => window.clearInterval(repeatTimer));
  }
  button.addEventListener("click", () => {
    if (action === "left" || action === "right" || action === "down") {
      if (directionHandled) {
        directionHandled = false;
        return;
      }
    } else if (action === "sound") {
      toggleSound();
      return;
    }
    performAction(action);
  });
}
window.addEventListener("blur", () => {
  window.clearInterval(repeatTimer);
  heldKeys.clear();
});

document.addEventListener("keydown", (event) => {
  const key = event.key;
  if (["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", " "].includes(key)) event.preventDefault();
  if (key === "Enter" && gameState !== "playing") {
    startGame();
    return;
  }
  if (key === "p" || key === "P" || key === "Escape") {
    if (!event.repeat) performAction("pause");
    return;
  }
  if (gameState !== "playing") return;
  if (key === "ArrowDown") {
    heldKeys.add("ArrowDown");
    if (!event.repeat) softDrop();
  } else if (key === "ArrowLeft") {
    movePiece(-1, 0);
  } else if (key === "ArrowRight") {
    movePiece(1, 0);
  } else if (key === "ArrowUp" || key === "x" || key === "X") {
    if (!event.repeat) rotatePiece(1);
  } else if (key === "z" || key === "Z") {
    if (!event.repeat) rotatePiece(-1);
  } else if (key === " ") {
    if (!event.repeat) hardDrop();
  } else if (key === "c" || key === "C" || key === "Shift") {
    if (!event.repeat) holdCurrentPiece();
  }
});

document.addEventListener("keyup", (event) => {
  heldKeys.delete(event.key);
});

let touchStart;
canvas.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "touch") return;
  touchStart = { x: event.clientX, y: event.clientY };
});
canvas.addEventListener("pointerup", (event) => {
  if (!touchStart || event.pointerType !== "touch") return;
  const dx = event.clientX - touchStart.x;
  const dy = event.clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) < 18 && Math.abs(dy) < 18) rotatePiece(1);
  else if (Math.abs(dx) > Math.abs(dy)) {
    const steps = Math.max(1, Math.min(5, Math.floor(Math.abs(dx) / 34)));
    for (let index = 0; index < steps; index += 1) movePiece(dx > 0 ? 1 : -1, 0);
  } else if (dy > 0) {
    softDrop();
  } else {
    hardDrop();
  }
});
canvas.addEventListener("pointercancel", () => { touchStart = null; });

board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
queue = [];
refillQueue();
score = 0;
totalLines = 0;
level = 1;
combo = -1;
heldPiece = null;
updateUI();
requestAnimationFrame(frame);
