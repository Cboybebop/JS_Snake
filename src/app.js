const DIRECTIONS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
};

const OPPOSITE = {
  up: "down",
  down: "up",
  left: "right",
  right: "left"
};

const BOARD_PRESETS = {
  compact: { cols: 28, rows: 18 },
  balanced: { cols: 40, rows: 24 },
  arena: { cols: 52, rows: 30 }
};

const PLAYER_COLORS = ["#35d0ff", "#ff7f50", "#8fff76", "#f8d66d"];

const KEY_BINDINGS = [
  { up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"] },
  { up: ["w"], down: ["s"], left: ["a"], right: ["d"] },
  { up: ["i"], down: ["k"], left: ["j"], right: ["l"] },
  { up: ["t"], down: ["g"], left: ["f"], right: ["h"] }
];

const POWER_UP_TYPES = [
  {
    type: "speed",
    label: "Speed Burst",
    color: "#69f0cf",
    durationMs: 8000,
    scoreBonus: 8
  },
  {
    type: "multiplier",
    label: "x2 Points",
    color: "#ffd166",
    durationMs: 10000,
    scoreBonus: 8
  },
  {
    type: "shield",
    label: "Shield",
    color: "#73b7ff",
    durationMs: 0,
    scoreBonus: 10
  },
  {
    type: "freeze",
    label: "Freeze Rivals",
    color: "#79e7ff",
    durationMs: 6000,
    scoreBonus: 12
  },
  {
    type: "phase",
    label: "Phase Walk",
    color: "#ff94ca",
    durationMs: 6000,
    scoreBonus: 10
  }
];

function readRuntimeSupabaseConfig() {
  const runtime = window.SNAKE_CONFIG || {};
  const supabaseUrl = typeof runtime.supabaseUrl === "string" ? runtime.supabaseUrl.trim() : "";
  const supabaseAnonKey = typeof runtime.supabaseAnonKey === "string" ? runtime.supabaseAnonKey.trim() : "";
  const highscoresTable =
    typeof runtime.highscoresTable === "string" && runtime.highscoresTable.trim()
      ? runtime.highscoresTable.trim()
      : "snake_highscores";

  return {
    managed: Boolean(runtime.supabaseManaged && supabaseUrl && supabaseAnonKey),
    supabaseUrl,
    supabaseAnonKey,
    highscoresTable
  };
}

class HighscoreService {
  constructor() {
    this.localStorageKey = "snake.local.highscores.v1";
    this.remoteStorageKey = "snake.supabase.config.v1";
    this.config = this.loadRemoteConfig();
    this.client = null;
    this.initClient();
  }

  loadRemoteConfig() {
    const runtime = readRuntimeSupabaseConfig();
    let stored = {};

    try {
      const raw = localStorage.getItem(this.remoteStorageKey);
      stored = raw ? JSON.parse(raw) : {};
    } catch (error) {
      stored = {};
    }

    if (runtime.managed) {
      return runtime;
    }

    return {
      managed: false,
      supabaseUrl: stored.supabaseUrl || runtime.supabaseUrl || "",
      supabaseAnonKey: stored.supabaseAnonKey || runtime.supabaseAnonKey || "",
      highscoresTable: stored.highscoresTable || runtime.highscoresTable || "snake_highscores"
    };
  }

  saveRemoteConfig(nextConfig) {
    if (this.config.managed) {
      return;
    }

    this.config = {
      ...this.config,
      ...nextConfig,
      managed: false,
      highscoresTable: nextConfig.highscoresTable || this.config.highscoresTable || "snake_highscores"
    };

    try {
      localStorage.setItem(this.remoteStorageKey, JSON.stringify(this.config));
    } catch (error) {
      console.warn("Failed to persist Supabase config", error);
    }

    this.initClient();
  }

  initClient() {
    this.client = null;

    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      return;
    }

    if (!this.config.supabaseUrl || !this.config.supabaseAnonKey) {
      return;
    }

    try {
      this.client = window.supabase.createClient(this.config.supabaseUrl, this.config.supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      });
    } catch (error) {
      console.error("Supabase client init failed", error);
      this.client = null;
    }
  }

  readLocalState() {
    const fallback = { classic: [], versus: [] };

    try {
      const raw = localStorage.getItem(this.localStorageKey);
      if (!raw) {
        return fallback;
      }

      const parsed = JSON.parse(raw);
      return {
        classic: Array.isArray(parsed.classic) ? parsed.classic : [],
        versus: Array.isArray(parsed.versus) ? parsed.versus : []
      };
    } catch (error) {
      return fallback;
    }
  }

  writeLocalState(nextState) {
    try {
      localStorage.setItem(this.localStorageKey, JSON.stringify(nextState));
    } catch (error) {
      console.warn("Unable to write local highscores", error);
    }
  }

  getLocalScores(mode) {
    const state = this.readLocalState();
    return [...(state[mode] || [])]
      .sort((a, b) => b.score - a.score || Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0))
      .slice(0, 10);
  }

  saveLocalScore(entry) {
    const state = this.readLocalState();
    const bucket = Array.isArray(state[entry.mode]) ? state[entry.mode] : [];

    bucket.push(entry);
    bucket.sort((a, b) => b.score - a.score || Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0));

    state[entry.mode] = bucket.slice(0, 30);
    this.writeLocalState(state);
  }

  async getOnlineScores(mode, limit = 10) {
    if (!this.client) {
      return [];
    }

    try {
      const { data, error } = await this.client
        .from(this.config.highscoresTable)
        .select("name, score, mode, created_at, metadata")
        .eq("mode", mode)
        .order("score", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        throw error;
      }

      return data || [];
    } catch (error) {
      console.warn("Failed to load online highscores", error);
      return [];
    }
  }

  async saveOnlineScore(entry) {
    if (!this.client) {
      return { ok: false, reason: "supabase_not_configured" };
    }

    try {
      const payload = {
        name: entry.name,
        score: entry.score,
        mode: entry.mode,
        metadata: entry.metadata
      };

      const { error } = await this.client.from(this.config.highscoresTable).insert(payload);

      if (error) {
        throw error;
      }

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: error?.message || "insert_failed"
      };
    }
  }
}

function mountSupabasePanel() {
  const panelMount = document.getElementById("supabasePanelMount");
  const panelTemplate = document.getElementById("supabasePanelTemplate");

  if (!panelMount || !panelTemplate) {
    return;
  }

  if (readRuntimeSupabaseConfig().managed) {
    panelMount.replaceChildren();
    return;
  }

  panelMount.replaceChildren(panelTemplate.content.cloneNode(true));
}

mountSupabasePanel();

const ui = {
  canvas: document.getElementById("gameCanvas"),
  status: document.getElementById("gameStatus"),
  toast: document.getElementById("toast"),
  modeSelect: document.getElementById("modeSelect"),
  playerCountSelect: document.getElementById("playerCountSelect"),
  cpuCountSelect: document.getElementById("cpuCountSelect"),
  boardSizeSelect: document.getElementById("boardSizeSelect"),
  speedSelect: document.getElementById("speedSelect"),
  playerNameInput: document.getElementById("playerNameInput"),
  startBtn: document.getElementById("startBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  restartBtn: document.getElementById("restartBtn"),
  playerStats: document.getElementById("playerStats"),
  localScores: document.getElementById("localScores"),
  onlineScores: document.getElementById("onlineScores"),
  tabButtons: Array.from(document.querySelectorAll(".tab-btn")),
  supabasePanel: document.getElementById("supabasePanel"),
  supabaseFieldset: document.getElementById("supabaseFieldset"),
  supabaseHint: document.getElementById("supabaseHint"),
  supabaseUrl: document.getElementById("supabaseUrl"),
  supabaseKey: document.getElementById("supabaseKey"),
  supabaseTable: document.getElementById("supabaseTable"),
  saveSupabaseBtn: document.getElementById("saveSupabaseBtn"),
  supabaseStatus: document.getElementById("supabaseStatus"),
  mobileButtons: Array.from(document.querySelectorAll("#mobileControls button")),
  gameOverDialog: document.getElementById("gameOverDialog"),
  gameOverTitle: document.getElementById("gameOverTitle"),
  gameOverText: document.getElementById("gameOverText"),
  submitNameInput: document.getElementById("submitNameInput"),
  saveScoreBtn: document.getElementById("saveScoreBtn"),
  closeDialogBtn: document.getElementById("closeDialogBtn")
};

const ctx = ui.canvas.getContext("2d");
const highscores = new HighscoreService();

const game = {
  running: false,
  paused: false,
  mode: "classic",
  scoreTab: "local",
  boardPreset: "balanced",
  speedScale: 1,
  board: {
    cols: BOARD_PRESETS.balanced.cols,
    rows: BOARD_PRESETS.balanced.rows,
    cell: 16,
    width: 0,
    height: 0,
    offsetX: 0,
    offsetY: 0
  },
  snakes: [],
  food: null,
  powerUps: [],
  spawnPowerTimerMs: 0,
  lastTs: 0,
  frameId: null,
  pendingHighscore: null,
  session: null,
  gamepadDirTimestamps: new Map(),
  toastTimeoutId: null
};

init();

function init() {
  if (!ctx) {
    throw new Error("Unable to initialize 2D canvas context.");
  }

  restorePlayerName();
  hydrateSupabaseInputs();
  syncSupabasePanelState();
  bindEvents();
  applyModeConstraints();
  updateSupabaseStatus();
  resizeCanvas();
  draw(performance.now());
  void refreshScoreboards();
}
function bindEvents() {
  ui.startBtn.addEventListener("click", startGame);
  ui.restartBtn.addEventListener("click", restartGame);
  ui.pauseBtn.addEventListener("click", () => togglePause());

  ui.modeSelect.addEventListener("change", () => {
    applyModeConstraints();
    void refreshScoreboards();
  });

  ui.playerCountSelect.addEventListener("change", applyModeConstraints);
  ui.cpuCountSelect.addEventListener("change", applyModeConstraints);

  ui.boardSizeSelect.addEventListener("change", () => {
    if (!game.running) {
      updateBoardDimensions(ui.boardSizeSelect.value);
      resizeCanvas();
      draw(performance.now());
    }
  });

  ui.tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      game.scoreTab = button.dataset.tab;
      setScoreTab(game.scoreTab);
      void refreshScoreboards();
    });
  });

  if (ui.saveSupabaseBtn) {
    ui.saveSupabaseBtn.addEventListener("click", async () => {
      if (highscores.config.managed) {
        showToast("Supabase settings are managed by Netlify for this deployment.");
        return;
      }

      const config = {
        supabaseUrl: ui.supabaseUrl.value.trim(),
        supabaseAnonKey: ui.supabaseKey.value.trim(),
        highscoresTable: ui.supabaseTable.value.trim() || "snake_highscores"
      };

      highscores.saveRemoteConfig(config);
      updateSupabaseStatus();
      await refreshScoreboards();

      if (highscores.client) {
        showToast("Supabase settings saved.");
      } else {
        showToast("Remote highscores disabled. Missing URL or anon key.");
      }
    });
  }

  window.addEventListener("resize", () => {
    resizeCanvas();
    draw(performance.now());
  });

  window.addEventListener("keydown", onKeyDown);

  ui.mobileButtons.forEach((button) => {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const primary = getPrimaryHumanSnake();
      if (!primary) {
        return;
      }

      queueDirection(primary, button.dataset.dir);
    });
  });

  ui.saveScoreBtn.addEventListener("click", () => {
    void savePendingScore();
  });

  ui.closeDialogBtn.addEventListener("click", () => {
    closeGameOverDialog();
  });

  ui.gameOverDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeGameOverDialog();
  });

  window.addEventListener("gamepadconnected", (event) => {
    showToast(`Gamepad connected: ${event.gamepad.id}`);
  });

  window.addEventListener("gamepaddisconnected", () => {
    showToast("Gamepad disconnected");
  });
}

function restorePlayerName() {
  try {
    const saved = localStorage.getItem("snake.player.name.v1");
    if (saved) {
      ui.playerNameInput.value = saved;
      ui.submitNameInput.value = saved;
    }
  } catch (error) {
    // no-op
  }
}

function persistPlayerName(name) {
  try {
    localStorage.setItem("snake.player.name.v1", name);
  } catch (error) {
    // no-op
  }
}

function hydrateSupabaseInputs() {
  if (!ui.supabaseUrl || !ui.supabaseKey || !ui.supabaseTable) {
    return;
  }

  ui.supabaseUrl.value = highscores.config.supabaseUrl || "";
  ui.supabaseKey.value = highscores.config.supabaseAnonKey || "";
  ui.supabaseTable.value = highscores.config.highscoresTable || "snake_highscores";
}

function syncSupabasePanelState() {
  if (!ui.supabasePanel || !ui.supabaseFieldset || !ui.supabaseHint) {
    return;
  }

  ui.supabaseFieldset.disabled = false;
  ui.supabaseFieldset.setAttribute("aria-disabled", "false");
  ui.supabaseHint.textContent = "Optional. Enables shared online highscores.";
}

function updateSupabaseStatus() {
  if (!ui.supabaseStatus) {
    return;
  }

  if (highscores.client) {
    ui.supabaseStatus.textContent = `Remote highscores enabled (table: ${highscores.config.highscoresTable}).`;
  } else {
    ui.supabaseStatus.textContent = "No remote config saved.";
  }
}

function applyModeConstraints() {
  const mode = ui.modeSelect.value;

  if (mode === "classic") {
    ui.playerCountSelect.value = "1";
    ui.cpuCountSelect.value = "0";
    ui.playerCountSelect.disabled = true;
    ui.cpuCountSelect.disabled = true;
  } else {
    ui.playerCountSelect.disabled = false;
    ui.cpuCountSelect.disabled = false;

    if (Number(ui.playerCountSelect.value) < 2) {
      ui.playerCountSelect.value = "2";
    }

    const players = clampNumber(Number(ui.playerCountSelect.value), 2, 4);
    const maxCpu = Math.max(0, players - 1);

    Array.from(ui.cpuCountSelect.options).forEach((option) => {
      option.disabled = Number(option.value) > maxCpu;
    });

    if (Number(ui.cpuCountSelect.value) > maxCpu) {
      ui.cpuCountSelect.value = String(maxCpu);
    }
  }
}

function getSessionSettings() {
  applyModeConstraints();

  const mode = ui.modeSelect.value;
  let players = Number(ui.playerCountSelect.value) || 1;
  let cpu = Number(ui.cpuCountSelect.value) || 0;

  if (mode === "classic") {
    players = 1;
    cpu = 0;
  } else {
    players = clampNumber(players, 2, 4);
    cpu = clampNumber(cpu, 0, players - 1);
  }

  const boardPreset = Object.prototype.hasOwnProperty.call(BOARD_PRESETS, ui.boardSizeSelect.value)
    ? ui.boardSizeSelect.value
    : "balanced";

  const speedScale = Number(ui.speedSelect.value) || 1;
  const displayName = sanitizeName(ui.playerNameInput.value.trim() || "Player One");

  return {
    mode,
    players,
    cpu,
    boardPreset,
    speedScale,
    displayName
  };
}

function updateBoardDimensions(boardPreset) {
  const preset = BOARD_PRESETS[boardPreset] || BOARD_PRESETS.balanced;

  let cols = preset.cols;
  let rows = preset.rows;

  if (window.innerWidth < 900) {
    cols = Math.max(20, Math.floor(cols * 0.75));
    rows = Math.max(14, Math.floor(rows * 0.75));
  }

  if (window.innerWidth < 520) {
    cols = Math.max(16, Math.floor(cols * 0.65));
    rows = Math.max(12, Math.floor(rows * 0.65));
  }

  game.board.cols = cols;
  game.board.rows = rows;
}

function startGame() {
  const settings = getSessionSettings();
  game.session = settings;
  game.mode = settings.mode;
  game.boardPreset = settings.boardPreset;
  game.speedScale = settings.speedScale;

  persistPlayerName(settings.displayName);
  ui.submitNameInput.value = settings.displayName;

  updateBoardDimensions(settings.boardPreset);
  setupMatch(settings);

  game.running = true;
  game.paused = false;
  game.lastTs = 0;
  setStatus("Running");
  ui.pauseBtn.textContent = "Pause";

  closeGameOverDialog();

  if (game.frameId) {
    cancelAnimationFrame(game.frameId);
  }

  game.frameId = requestAnimationFrame(loop);
  showToast(`${settings.mode === "classic" ? "Classic" : "Versus"} match started.`);
}

function restartGame() {
  if (game.session) {
    startGame();
    return;
  }

  startGame();
}

function setupMatch(settings) {
  game.snakes = createSnakes(settings);
  game.food = null;
  game.powerUps = [];
  game.spawnPowerTimerMs = 0;
  game.pendingHighscore = null;
  game.gamepadDirTimestamps.clear();

  spawnFood();
  spawnPowerUp();
  resizeCanvas();
  updatePlayerStats();
  draw(performance.now());
}

function createSnakes(settings) {
  const spawns = [
    { x: Math.floor(game.board.cols * 0.2), y: Math.floor(game.board.rows * 0.5), direction: "right" },
    { x: Math.floor(game.board.cols * 0.8), y: Math.floor(game.board.rows * 0.5), direction: "left" },
    { x: Math.floor(game.board.cols * 0.5), y: Math.floor(game.board.rows * 0.22), direction: "down" },
    { x: Math.floor(game.board.cols * 0.5), y: Math.floor(game.board.rows * 0.78), direction: "up" }
  ];

  const humanCount = settings.players - settings.cpu;
  const snakes = [];

  for (let index = 0; index < settings.players; index += 1) {
    const isCpu = index >= humanCount;
    const spawn = spawns[index];
    const body = makeSpawnBody(spawn, 4);

    let name = `Player ${index + 1}`;
    if (isCpu) {
      name = `CPU ${index - humanCount + 1}`;
    } else if (index === 0) {
      name = settings.displayName;
    }

    snakes.push({
      id: index + 1,
      name,
      kind: isCpu ? "cpu" : "human",
      color: PLAYER_COLORS[index],
      keymap: isCpu ? null : KEY_BINDINGS[index],
      humanIndex: isCpu ? -1 : index,
      body,
      direction: spawn.direction,
      nextDirection: spawn.direction,
      lastHead: { ...body[0] },
      alive: true,
      grow: 0,
      score: 0,
      moveAccumulator: 0,
      effects: {
        speedUntil: 0,
        multiplierUntil: 0,
        slowUntil: 0,
        phaseUntil: 0,
        shieldCharges: 0
      }
    });
  }

  return snakes;
}

function makeSpawnBody(spawn, length) {
  const opposite = OPPOSITE[spawn.direction];
  const delta = DIRECTIONS[opposite];
  const body = [];

  for (let i = 0; i < length; i += 1) {
    const x = clampNumber(spawn.x + delta.x * i, 0, game.board.cols - 1);
    const y = clampNumber(spawn.y + delta.y * i, 0, game.board.rows - 1);
    body.push({ x, y });
  }

  return body;
}

function loop(timestamp) {
  if (!game.running) {
    return;
  }

  if (!game.lastTs) {
    game.lastTs = timestamp;
  }

  const dt = Math.min(64, timestamp - game.lastTs);
  game.lastTs = timestamp;

  if (!game.paused) {
    update(dt, timestamp);
  }

  draw(timestamp);
  game.frameId = requestAnimationFrame(loop);
}
function update(dt, now) {
  pollGamepads(now);

  game.spawnPowerTimerMs += dt;
  if (game.spawnPowerTimerMs >= 9000) {
    game.spawnPowerTimerMs = 0;
    if (game.powerUps.length < 3 && Math.random() > 0.1) {
      spawnPowerUp();
    }
  }

  game.powerUps = game.powerUps.filter((powerUp) => powerUp.expiresAt > now);

  for (const snake of game.snakes) {
    if (!snake.alive) {
      continue;
    }

    snake.moveAccumulator += dt;
    let safety = 0;

    while (snake.alive && snake.moveAccumulator >= getSnakeStepMs(snake, now) && safety < 6) {
      if (snake.kind === "cpu") {
        chooseCpuDirection(snake, now);
      }

      snake.moveAccumulator -= getSnakeStepMs(snake, now);
      stepSnake(snake, now);
      safety += 1;
    }
  }

  if (!game.food) {
    spawnFood();
  }

  checkGameOver();
  updatePlayerStats();
}

function getSnakeStepMs(snake, now) {
  let speed = game.speedScale;

  if (now < snake.effects.speedUntil) {
    speed *= 1.4;
  }

  if (now < snake.effects.slowUntil) {
    speed *= 0.68;
  }

  return Math.max(52, Math.round(138 / speed));
}

function stepSnake(snake, now) {
  const oldHead = { ...snake.body[0] };
  const phaseActive = now < snake.effects.phaseUntil;

  if (snake.nextDirection && OPPOSITE[snake.nextDirection] !== snake.direction) {
    snake.direction = snake.nextDirection;
  }

  const delta = DIRECTIONS[snake.direction];
  let nextHead = {
    x: oldHead.x + delta.x,
    y: oldHead.y + delta.y
  };

  if (isOutsideBoard(nextHead)) {
    if (phaseActive) {
      nextHead = wrapCell(nextHead);
    } else {
      if (consumeShield(snake)) {
        return;
      }

      snake.alive = false;
      showToast(`${snake.name} crashed into a wall.`);
      return;
    }
  }

  if (!phaseActive) {
    const collision = findBodyCollision(nextHead, snake);
    if (collision) {
      if (consumeShield(snake)) {
        return;
      }

      snake.alive = false;
      showToast(`${snake.name} hit ${collision.snake.name}.`);
      return;
    }
  }

  snake.lastHead = oldHead;
  snake.body.unshift(nextHead);

  let ateFood = false;
  if (game.food && sameCell(nextHead, game.food)) {
    ateFood = true;
    snake.grow += 2;
    addScore(snake, 10, now);
    spawnFood();

    if (Math.random() < 0.35 && game.powerUps.length < 3) {
      spawnPowerUp();
    }
  }

  const powerIndex = game.powerUps.findIndex((powerUp) => powerUp.x === nextHead.x && powerUp.y === nextHead.y);
  if (powerIndex >= 0) {
    const powerUp = game.powerUps.splice(powerIndex, 1)[0];
    applyPowerUp(snake, powerUp, now);
  }

  if (!ateFood) {
    if (snake.grow > 0) {
      snake.grow -= 1;
    } else {
      snake.body.pop();
    }
  }

  resolveHeadClashes(snake);
}

function findBodyCollision(cell, movingSnake) {
  for (const snake of game.snakes) {
    if (!snake.body.length) {
      continue;
    }

    const upperBound =
      snake.id === movingSnake.id && movingSnake.grow === 0 ? snake.body.length - 1 : snake.body.length;

    for (let i = 0; i < upperBound; i += 1) {
      const segment = snake.body[i];
      if (segment.x === cell.x && segment.y === cell.y) {
        return { snake, segmentIndex: i };
      }
    }
  }

  return null;
}

function resolveHeadClashes(currentSnake) {
  if (!currentSnake.alive) {
    return;
  }

  for (const otherSnake of game.snakes) {
    if (otherSnake.id === currentSnake.id || !otherSnake.alive) {
      continue;
    }

    const sameHead = sameCell(currentSnake.body[0], otherSnake.body[0]);
    const crossed =
      sameCell(currentSnake.body[0], otherSnake.lastHead) && sameCell(otherSnake.body[0], currentSnake.lastHead);

    if (!sameHead && !crossed) {
      continue;
    }

    const currentShielded = consumeShield(currentSnake);
    const otherShielded = consumeShield(otherSnake);

    if (!currentShielded) {
      currentSnake.alive = false;
    }

    if (!otherShielded) {
      otherSnake.alive = false;
    }

    if (!currentShielded || !otherShielded) {
      showToast("Head-on collision.");
    }
  }
}

function consumeShield(snake) {
  if (snake.effects.shieldCharges > 0) {
    snake.effects.shieldCharges -= 1;
    showToast(`${snake.name} blocked a hit.`);
    return true;
  }

  return false;
}

function addScore(snake, basePoints, now) {
  const multiplier = now < snake.effects.multiplierUntil ? 2 : 1;
  snake.score += basePoints * multiplier;
}

function applyPowerUp(snake, powerUp, now) {
  const definition = POWER_UP_TYPES.find((item) => item.type === powerUp.type);
  if (!definition) {
    return;
  }

  addScore(snake, definition.scoreBonus, now);

  switch (powerUp.type) {
    case "speed":
      snake.effects.speedUntil = Math.max(snake.effects.speedUntil, now + definition.durationMs);
      break;
    case "multiplier":
      snake.effects.multiplierUntil = Math.max(snake.effects.multiplierUntil, now + definition.durationMs);
      break;
    case "shield":
      snake.effects.shieldCharges += 1;
      break;
    case "freeze":
      for (const other of game.snakes) {
        if (other.id === snake.id || !other.alive) {
          continue;
        }

        other.effects.slowUntil = Math.max(other.effects.slowUntil, now + definition.durationMs);
      }
      break;
    case "phase":
      snake.effects.phaseUntil = Math.max(snake.effects.phaseUntil, now + definition.durationMs);
      break;
    default:
      break;
  }

  showToast(`${snake.name}: ${definition.label}`);
}

function checkGameOver() {
  const aliveSnakes = game.snakes.filter((snake) => snake.alive);

  if (game.mode === "classic") {
    if (aliveSnakes.length === 0) {
      endGame("Crashed out.");
    }

    return;
  }

  if (aliveSnakes.length <= 1) {
    if (aliveSnakes.length === 1) {
      endGame(`${aliveSnakes[0].name} wins with ${aliveSnakes[0].score} points.`);
    } else {
      endGame("No snake survived.");
    }
  }
}

function endGame(summary) {
  if (!game.running) {
    return;
  }

  game.running = false;
  game.paused = false;
  setStatus("Finished");

  if (game.frameId) {
    cancelAnimationFrame(game.frameId);
    game.frameId = null;
  }

  const bestHuman = getBestHumanSnake();
  if (bestHuman) {
    game.pendingHighscore = {
      name: sanitizeName(ui.playerNameInput.value.trim() || bestHuman.name),
      score: bestHuman.score,
      mode: game.mode,
      metadata: {
        winner: summary,
        players: game.session?.players ?? game.snakes.length,
        cpu: game.session?.cpu ?? 0
      }
    };
  } else {
    game.pendingHighscore = null;
  }

  showGameOver(summary, bestHuman);
  void refreshScoreboards();
}

function getBestHumanSnake() {
  const humans = game.snakes.filter((snake) => snake.kind === "human");
  if (!humans.length) {
    return null;
  }

  return [...humans].sort((a, b) => b.score - a.score)[0];
}

function showGameOver(summary, bestHuman) {
  ui.gameOverTitle.textContent = "Match Complete";

  if (bestHuman) {
    ui.gameOverText.textContent = `${summary} Top human score: ${bestHuman.score}.`;
    ui.submitNameInput.value = sanitizeName(ui.playerNameInput.value.trim() || bestHuman.name);
    ui.saveScoreBtn.disabled = false;
  } else {
    ui.gameOverText.textContent = `${summary} No human score available for highscores.`;
    ui.saveScoreBtn.disabled = true;
  }

  if (typeof ui.gameOverDialog.showModal === "function") {
    if (!ui.gameOverDialog.open) {
      ui.gameOverDialog.showModal();
    }
  } else {
    ui.gameOverDialog.setAttribute("open", "true");
  }
}

function closeGameOverDialog() {
  if (typeof ui.gameOverDialog.close === "function" && ui.gameOverDialog.open) {
    ui.gameOverDialog.close();
  } else {
    ui.gameOverDialog.removeAttribute("open");
  }
}

async function savePendingScore() {
  if (!game.pendingHighscore) {
    return;
  }

  const name = sanitizeName(ui.submitNameInput.value.trim() || game.pendingHighscore.name || "Player");
  const entry = {
    ...game.pendingHighscore,
    name,
    created_at: new Date().toISOString()
  };

  ui.saveScoreBtn.disabled = true;

  highscores.saveLocalScore(entry);
  const onlineResult = await highscores.saveOnlineScore(entry);
  await refreshScoreboards();

  if (onlineResult.ok) {
    showToast("Score saved locally and online.");
  } else if (highscores.client) {
    showToast(`Saved locally. Online save failed: ${onlineResult.reason}`);
  } else {
    showToast("Score saved locally.");
  }

  game.pendingHighscore = null;
  closeGameOverDialog();
}

function setScoreTab(tab) {
  const localActive = tab === "local";

  ui.localScores.classList.toggle("hidden", !localActive);
  ui.onlineScores.classList.toggle("hidden", localActive);

  ui.tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
}

async function refreshScoreboards() {
  const mode = ui.modeSelect.value;

  const localScores = highscores.getLocalScores(mode);
  renderScoreList(ui.localScores, localScores, "No local highscores yet.");

  if (!highscores.client) {
    const emptyMessage = highscores.config.managed
      ? "Supabase is managed by Netlify, but online highscores are unavailable."
      : "Configure Supabase to load online scores.";
    renderScoreList(ui.onlineScores, [], emptyMessage);
    return;
  }

  const onlineScores = await highscores.getOnlineScores(mode, 10);
  renderScoreList(ui.onlineScores, onlineScores, "No online highscores yet.");
}

function renderScoreList(element, entries, emptyMessage) {
  element.innerHTML = "";

  if (!entries.length) {
    const item = document.createElement("li");
    item.className = "score-list-empty";
    item.textContent = emptyMessage;
    element.appendChild(item);
    return;
  }

  entries.slice(0, 10).forEach((entry) => {
    const item = document.createElement("li");
    const date = entry.created_at ? new Date(entry.created_at).toLocaleDateString() : "";
    item.textContent = `${entry.name} - ${entry.score}${date ? ` (${date})` : ""}`;
    element.appendChild(item);
  });
}

function spawnFood() {
  const cell = randomEmptyCell();
  if (!cell) {
    return;
  }

  game.food = cell;
}

function spawnPowerUp() {
  const cell = randomEmptyCell();
  if (!cell) {
    return;
  }

  const definition = POWER_UP_TYPES[Math.floor(Math.random() * POWER_UP_TYPES.length)];
  game.powerUps.push({
    x: cell.x,
    y: cell.y,
    type: definition.type,
    spawnedAt: performance.now(),
    expiresAt: performance.now() + 14000
  });
}

function randomEmptyCell(maxAttempts = 500) {
  for (let attempts = 0; attempts < maxAttempts; attempts += 1) {
    const candidate = {
      x: Math.floor(Math.random() * game.board.cols),
      y: Math.floor(Math.random() * game.board.rows)
    };

    if (isCellOccupied(candidate)) {
      continue;
    }

    return candidate;
  }

  return null;
}

function isCellOccupied(cell) {
  if (game.food && sameCell(cell, game.food)) {
    return true;
  }

  for (const powerUp of game.powerUps) {
    if (powerUp.x === cell.x && powerUp.y === cell.y) {
      return true;
    }
  }

  for (const snake of game.snakes) {
    for (const segment of snake.body) {
      if (segment.x === cell.x && segment.y === cell.y) {
        return true;
      }
    }
  }

  return false;
}
function chooseCpuDirection(snake, now) {
  const targets = [];
  if (game.food) {
    targets.push({ ...game.food, weight: 1.4 });
  }

  for (const powerUp of game.powerUps) {
    targets.push({ x: powerUp.x, y: powerUp.y, weight: 1 });
  }

  let target = game.food;
  if (targets.length > 0) {
    target = [...targets].sort(
      (a, b) =>
        manhattanDistance(snake.body[0], a) / (a.weight || 1) -
        manhattanDistance(snake.body[0], b) / (b.weight || 1)
    )[0];
  }

  const candidates = Object.keys(DIRECTIONS).filter((direction) => OPPOSITE[direction] !== snake.direction);

  let bestDirection = snake.direction;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const direction of candidates) {
    const vector = DIRECTIONS[direction];
    const candidate = {
      x: snake.body[0].x + vector.x,
      y: snake.body[0].y + vector.y
    };

    const phaseActive = now < snake.effects.phaseUntil;
    const unsafe =
      (!phaseActive && isOutsideBoard(candidate)) ||
      (!phaseActive && Boolean(findBodyCollision(candidate, snake)));

    if (unsafe) {
      continue;
    }

    const wrapped = phaseActive ? wrapCell(candidate) : candidate;
    const distanceScore = target ? 70 - manhattanDistance(wrapped, target) * 4 : 0;
    const spaceScore = countFreeNeighbors(wrapped, snake, now) * 8;
    const randomScore = Math.random() * 4;
    const total = distanceScore + spaceScore + randomScore;

    if (total > bestScore) {
      bestScore = total;
      bestDirection = direction;
    }
  }

  snake.nextDirection = bestDirection;
}

function countFreeNeighbors(cell, snake, now) {
  let count = 0;
  const phaseActive = now < snake.effects.phaseUntil;

  for (const direction of Object.keys(DIRECTIONS)) {
    const vector = DIRECTIONS[direction];
    const testCell = {
      x: cell.x + vector.x,
      y: cell.y + vector.y
    };

    if (!phaseActive && isOutsideBoard(testCell)) {
      continue;
    }

    const wrapped = phaseActive ? wrapCell(testCell) : testCell;

    if (!phaseActive && findBodyCollision(wrapped, snake)) {
      continue;
    }

    count += 1;
  }

  return count;
}

function pollGamepads(now) {
  if (!navigator.getGamepads) {
    return;
  }

  const pads = Array.from(navigator.getGamepads()).filter(Boolean);
  const humans = game.snakes.filter((snake) => snake.kind === "human");

  humans.forEach((snake, index) => {
    const pad = pads[index];
    snake.controllerIndex = pad ? pad.index : null;

    if (!pad) {
      return;
    }

    const direction = readGamepadDirection(pad);
    if (!direction) {
      return;
    }

    const key = `${snake.id}:${pad.index}`;
    const lastAt = game.gamepadDirTimestamps.get(key) || 0;
    if (now - lastAt < 110) {
      return;
    }

    queueDirection(snake, direction);
    game.gamepadDirTimestamps.set(key, now);
  });
}

function readGamepadDirection(gamepad) {
  if (gamepad.buttons[12]?.pressed) {
    return "up";
  }

  if (gamepad.buttons[13]?.pressed) {
    return "down";
  }

  if (gamepad.buttons[14]?.pressed) {
    return "left";
  }

  if (gamepad.buttons[15]?.pressed) {
    return "right";
  }

  const x = gamepad.axes[0] || 0;
  const y = gamepad.axes[1] || 0;

  if (Math.abs(x) < 0.45 && Math.abs(y) < 0.45) {
    return null;
  }

  if (Math.abs(x) > Math.abs(y)) {
    return x > 0 ? "right" : "left";
  }

  return y > 0 ? "down" : "up";
}

function onKeyDown(event) {
  const key = event.key;

  if (key === " " || key.toLowerCase() === "p") {
    event.preventDefault();
    togglePause();
    return;
  }

  if (!game.running || game.paused) {
    return;
  }

  const normalized = key.length === 1 ? key.toLowerCase() : key;

  for (const snake of game.snakes) {
    if (!snake.alive || snake.kind !== "human" || !snake.keymap) {
      continue;
    }

    if (snake.keymap.up.includes(normalized)) {
      event.preventDefault();
      queueDirection(snake, "up");
      return;
    }

    if (snake.keymap.down.includes(normalized)) {
      event.preventDefault();
      queueDirection(snake, "down");
      return;
    }

    if (snake.keymap.left.includes(normalized)) {
      event.preventDefault();
      queueDirection(snake, "left");
      return;
    }

    if (snake.keymap.right.includes(normalized)) {
      event.preventDefault();
      queueDirection(snake, "right");
      return;
    }
  }
}

function queueDirection(snake, direction) {
  if (!snake || !snake.alive) {
    return;
  }

  if (direction === OPPOSITE[snake.direction] && snake.body.length > 1) {
    return;
  }

  snake.nextDirection = direction;
}

function getPrimaryHumanSnake() {
  return game.snakes.find((snake) => snake.kind === "human" && snake.alive) || null;
}

function togglePause(forceState) {
  if (!game.running) {
    return;
  }

  if (typeof forceState === "boolean") {
    game.paused = forceState;
  } else {
    game.paused = !game.paused;
  }

  ui.pauseBtn.textContent = game.paused ? "Resume" : "Pause";

  if (game.paused) {
    setStatus("Paused");
    showToast("Game paused.");
  } else {
    setStatus("Running");
    game.lastTs = 0;
    showToast("Game resumed.");
  }

  draw(performance.now());
}

function resizeCanvas() {
  const shell = ui.canvas.parentElement;
  const rect = shell.getBoundingClientRect();

  ui.canvas.width = Math.max(320, Math.floor(rect.width));
  ui.canvas.height = Math.max(220, Math.floor(rect.height));

  game.board.cell = Math.max(8, Math.floor(Math.min(ui.canvas.width / game.board.cols, ui.canvas.height / game.board.rows)));
  game.board.width = game.board.cols * game.board.cell;
  game.board.height = game.board.rows * game.board.cell;
  game.board.offsetX = Math.floor((ui.canvas.width - game.board.width) / 2);
  game.board.offsetY = Math.floor((ui.canvas.height - game.board.height) / 2);
}

function draw(now) {
  const { offsetX, offsetY, width, height, cell } = game.board;

  ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);

  ctx.fillStyle = "#031018";
  ctx.fillRect(offsetX, offsetY, width, height);

  ctx.strokeStyle = "rgba(110, 174, 217, 0.11)";
  ctx.lineWidth = 1;

  for (let x = 0; x <= game.board.cols; x += 1) {
    const px = offsetX + x * cell + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, offsetY);
    ctx.lineTo(px, offsetY + height);
    ctx.stroke();
  }

  for (let y = 0; y <= game.board.rows; y += 1) {
    const py = offsetY + y * cell + 0.5;
    ctx.beginPath();
    ctx.moveTo(offsetX, py);
    ctx.lineTo(offsetX + width, py);
    ctx.stroke();
  }

  drawFood(now);
  drawPowerUps(now);

  for (const snake of game.snakes) {
    drawSnake(snake, now);
  }

  drawBoardMeta();

  if (game.paused) {
    ctx.fillStyle = "rgba(2, 12, 20, 0.6)";
    ctx.fillRect(offsetX, offsetY, width, height);
    ctx.fillStyle = "#c8f3ff";
    ctx.font = "700 32px Syne";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Paused", offsetX + width / 2, offsetY + height / 2);
  }
}

function drawFood(now) {
  if (!game.food) {
    return;
  }

  const pulse = 0.8 + Math.sin(now / 120) * 0.14;
  const centerX = game.board.offsetX + game.food.x * game.board.cell + game.board.cell / 2;
  const centerY = game.board.offsetY + game.food.y * game.board.cell + game.board.cell / 2;
  const radius = game.board.cell * 0.32 * pulse;

  ctx.fillStyle = "#ff5f7f";
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.beginPath();
  ctx.arc(centerX - radius * 0.3, centerY - radius * 0.3, Math.max(1.3, radius * 0.24), 0, Math.PI * 2);
  ctx.fill();
}

function fillRoundedRect(x, y, width, height, radius) {
  const normalizedRadius = Math.max(0, Math.min(radius, Math.min(width, height) / 2));

  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, normalizedRadius);
    ctx.fill();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(x + normalizedRadius, y);
  ctx.lineTo(x + width - normalizedRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + normalizedRadius);
  ctx.lineTo(x + width, y + height - normalizedRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - normalizedRadius, y + height);
  ctx.lineTo(x + normalizedRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - normalizedRadius);
  ctx.lineTo(x, y + normalizedRadius);
  ctx.quadraticCurveTo(x, y, x + normalizedRadius, y);
  ctx.closePath();
  ctx.fill();
}

function drawPowerUps(now) {
  for (const powerUp of game.powerUps) {
    const definition = POWER_UP_TYPES.find((item) => item.type === powerUp.type);
    if (!definition) {
      continue;
    }

    const x = game.board.offsetX + powerUp.x * game.board.cell;
    const y = game.board.offsetY + powerUp.y * game.board.cell;
    const inset = Math.max(2, game.board.cell * 0.12);
    const size = game.board.cell - inset * 2;
    const pulse = 0.92 + Math.sin(now / 220 + powerUp.x * 0.3 + powerUp.y * 0.2) * 0.1;

    ctx.fillStyle = definition.color;
    ctx.globalAlpha = 0.9;

    const pulseSize = size * pulse;
    const shift = (size - pulseSize) / 2;

    fillRoundedRect(
      x + inset + shift,
      y + inset + shift,
      pulseSize,
      pulseSize,
      Math.max(2, game.board.cell * 0.16)
    );

    ctx.globalAlpha = 1;
    ctx.fillStyle = "#05263f";
    ctx.font = `${Math.max(9, Math.floor(game.board.cell * 0.38))}px Space Grotesk`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(getPowerSymbol(powerUp.type), x + game.board.cell / 2, y + game.board.cell / 2 + 0.5);
  }
}

function drawSnake(snake, now) {
  const alpha = snake.alive ? 1 : 0.32;
  const phaseActive = now < snake.effects.phaseUntil;

  for (let i = snake.body.length - 1; i >= 0; i -= 1) {
    const segment = snake.body[i];
    const x = game.board.offsetX + segment.x * game.board.cell;
    const y = game.board.offsetY + segment.y * game.board.cell;
    const pad = Math.max(1.2, game.board.cell * 0.08);
    const size = game.board.cell - pad * 2;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = i === 0 ? snake.color : shadeHexColor(snake.color, -18);

    if (phaseActive && i === 0) {
      ctx.fillStyle = "#ffe6fa";
    }

    fillRoundedRect(x + pad, y + pad, size, size, Math.max(2, game.board.cell * 0.2));

    if (i === 0) {
      ctx.globalAlpha = 0.9 * alpha;
      ctx.fillStyle = "rgba(3, 14, 24, 0.82)";
      const eyeSize = Math.max(1.5, game.board.cell * 0.1);
      const eyeOffset = game.board.cell * 0.18;
      const centerX = x + game.board.cell / 2;
      const centerY = y + game.board.cell / 2;

      if (snake.direction === "left" || snake.direction === "right") {
        const dir = snake.direction === "right" ? 1 : -1;
        ctx.beginPath();
        ctx.arc(centerX + dir * eyeOffset, centerY - eyeOffset, eyeSize, 0, Math.PI * 2);
        ctx.arc(centerX + dir * eyeOffset, centerY + eyeOffset, eyeSize, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const dir = snake.direction === "down" ? 1 : -1;
        ctx.beginPath();
        ctx.arc(centerX - eyeOffset, centerY + dir * eyeOffset, eyeSize, 0, Math.PI * 2);
        ctx.arc(centerX + eyeOffset, centerY + dir * eyeOffset, eyeSize, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  ctx.globalAlpha = 1;
}

function drawBoardMeta() {
  ctx.fillStyle = "rgba(9, 20, 34, 0.7)";
  ctx.fillRect(game.board.offsetX + 8, game.board.offsetY + 8, 220, 32);

  const alive = game.snakes.filter((snake) => snake.alive).length;
  ctx.fillStyle = "#d8f4ff";
  ctx.font = "13px Space Grotesk";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(`Mode: ${game.mode} | Alive: ${alive}/${game.snakes.length}`, game.board.offsetX + 14, game.board.offsetY + 24);
}

function updatePlayerStats() {
  ui.playerStats.innerHTML = "";

  for (const snake of game.snakes) {
    const row = document.createElement("div");
    row.className = `player-stat ${snake.alive ? "" : "player-dead"}`.trim();

    const left = document.createElement("div");
    left.className = "player-meta";

    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.backgroundColor = snake.color;

    const name = document.createElement("span");
    const tags = [];
    tags.push(snake.kind === "cpu" ? "CPU" : "Human");
    if (snake.effects.shieldCharges > 0) {
      tags.push(`Shield ${snake.effects.shieldCharges}`);
    }

    name.textContent = `${snake.name}${tags.length ? ` (${tags.join(", ")})` : ""}`;

    left.append(dot, name);

    const score = document.createElement("strong");
    score.textContent = `${snake.score}`;

    row.append(left, score);
    ui.playerStats.appendChild(row);
  }
}

function setStatus(text) {
  ui.status.textContent = text;
}

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("visible");

  if (game.toastTimeoutId) {
    window.clearTimeout(game.toastTimeoutId);
  }

  game.toastTimeoutId = window.setTimeout(() => {
    ui.toast.classList.remove("visible");
  }, 1800);
}

function sanitizeName(value) {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return (trimmed || "Player").slice(0, 24);
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sameCell(a, b) {
  return a?.x === b?.x && a?.y === b?.y;
}

function isOutsideBoard(cell) {
  return cell.x < 0 || cell.y < 0 || cell.x >= game.board.cols || cell.y >= game.board.rows;
}

function wrapCell(cell) {
  return {
    x: (cell.x + game.board.cols) % game.board.cols,
    y: (cell.y + game.board.rows) % game.board.rows
  };
}

function manhattanDistance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function shadeHexColor(hex, amount) {
  const normalized = hex.replace("#", "");
  const int = Number.parseInt(normalized, 16);

  if (Number.isNaN(int) || normalized.length !== 6) {
    return hex;
  }

  const r = clampNumber(((int >> 16) & 0xff) + amount, 0, 255);
  const g = clampNumber(((int >> 8) & 0xff) + amount, 0, 255);
  const b = clampNumber((int & 0xff) + amount, 0, 255);

  return `rgb(${r}, ${g}, ${b})`;
}

function getPowerSymbol(type) {
  switch (type) {
    case "speed":
      return "S";
    case "multiplier":
      return "2x";
    case "shield":
      return "D";
    case "freeze":
      return "F";
    case "phase":
      return "P";
    default:
      return "?";
  }
}

