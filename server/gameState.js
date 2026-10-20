const COLS = 15;
const ROWS = 13;

const PLAYER_COLORS = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00'];
const CORNER_SPAWNS = [
  { x: 1, y: 1 },
  { x: COLS - 2, y: 1 },
  { x: 1, y: ROWS - 2 },
  { x: COLS - 2, y: ROWS - 2 },
];

const BOMB_FUSE_MS = 3000;
const EXPLOSION_DURATION_MS = 500;
const BASE_MOVE_SPEED = 0.15;
const POWERUP_DROP_CHANCE = 0.3;

function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function isSafeCorner(x, y) {
  return (
    (x < 3 && y < 3) ||
    (x > COLS - 4 && y < 3) ||
    (x < 3 && y > ROWS - 4) ||
    (x > COLS - 4 && y > ROWS - 4)
  );
}

function createBoard(seed) {
  const random = createSeededRandom(seed);
  const board = [];

  for (let y = 0; y < ROWS; y++) {
    const row = [];
    for (let x = 0; x < COLS; x++) {
      if (y === 0 || y === ROWS - 1 || x === 0 || x === COLS - 1) {
        row.push({ type: 'wall', x, y });
      } else if (y % 2 === 0 && x % 2 === 0) {
        row.push({ type: 'wall', x, y });
      } else if (random() > 0.7 && !isSafeCorner(x, y)) {
        row.push({ type: 'block', x, y });
      } else {
        row.push({ type: 'empty', x, y });
      }
    }
    board.push(row);
  }

  return board;
}

function cloneBoard(board) {
  return board.map((row) => row.map((cell) => ({ ...cell })));
}

class GameState {
  constructor(seed, lobbyPlayers) {
    this.seed = seed;
    this.board = createBoard(seed);
    this.bombs = [];
    this.explosions = [];
    this.powerups = [];
    this.gameOver = false;
    this.winner = null;
    this.activeInputs = new Map();

    this.players = lobbyPlayers.map((info, index) => ({
      id: info.id,
      socketId: info.socketId,
      name: info.name,
      index,
      x: CORNER_SPAWNS[index].x,
      y: CORNER_SPAWNS[index].y,
      color: PLAYER_COLORS[index],
      bombs: 1,
      flame: 1,
      speed: 1,
      lives: 3,
    }));

    lobbyPlayers.forEach((info) => {
      this.activeInputs.set(info.id, new Set());
    });
  }

  setInput(playerId, direction, pressed) {
    const inputs = this.activeInputs.get(playerId);
    if (!inputs) return;

    if (pressed) {
      inputs.add(direction);
    } else {
      inputs.delete(direction);
    }
  }

  update(deltaMs) {
    if (this.gameOver) return;

    this.movePlayers(deltaMs);
    this.updateBombs(deltaMs);
    this.updateExplosions(deltaMs);
    this.checkWinCondition();
  }

  movePlayers(deltaMs) {
    const factor = deltaMs / 16.67;

    this.players.forEach((player) => {
      if (player.lives <= 0) return;

      const inputs = this.activeInputs.get(player.id);
      if (!inputs || inputs.size === 0) return;

      let dx = 0;
      let dy = 0;

      if (inputs.has('up')) dy -= 1;
      if (inputs.has('down')) dy += 1;
      if (inputs.has('left')) dx -= 1;
      if (inputs.has('right')) dx += 1;

      if (dx === 0 && dy === 0) return;

      const length = Math.hypot(dx, dy);
      dx /= length;
      dy /= length;

      const step = BASE_MOVE_SPEED * player.speed * factor;
      const newX = player.x + dx * step;
      const newY = player.y + dy * step;

      if (this.canMoveTo(player, newX, newY)) {
        player.x = newX;
        player.y = newY;
        this.collectPowerup(player);
      }
    });
  }

  canMoveTo(player, x, y) {
    const roundedX = Math.round(x);
    const roundedY = Math.round(y);

    if (roundedX < 0 || roundedX >= COLS || roundedY < 0 || roundedY >= ROWS) {
      return false;
    }

    if (this.board[roundedY][roundedX].type !== 'empty') {
      return false;
    }

    const bombCollision = this.bombs.some(
      (bomb) => Math.round(bomb.x) === roundedX && Math.round(bomb.y) === roundedY
    );

    return !bombCollision;
  }

  collectPowerup(player) {
    const roundedX = Math.round(player.x);
    const roundedY = Math.round(player.y);
    const index = this.powerups.findIndex(
      (p) => Math.round(p.x) === roundedX && Math.round(p.y) === roundedY
    );

    if (index === -1) return;

    const powerup = this.powerups[index];
    switch (powerup.type) {
      case 'bomb':
        player.bombs += 1;
        break;
      case 'flame':
        player.flame += 1;
        break;
      case 'speed':
        player.speed += 0.5;
        break;
      default:
        break;
    }

    this.powerups.splice(index, 1);
  }

  placeBomb(playerId) {
    const player = this.players.find((p) => p.id === playerId);
    if (!player || player.lives <= 0) return;

    const bombX = Math.round(player.x);
    const bombY = Math.round(player.y);

    const existingBomb = this.bombs.find((b) => b.x === bombX && b.y === bombY);
    const activeBombs = this.bombs.filter((b) => b.playerId === playerId).length;

    if (existingBomb || activeBombs >= player.bombs) return;

    this.bombs.push({
      x: bombX,
      y: bombY,
      timerMs: BOMB_FUSE_MS,
      flame: player.flame,
      playerId: player.id,
    });
  }

  updateBombs(deltaMs) {
    const remaining = [];

    this.bombs.forEach((bomb) => {
      bomb.timerMs -= deltaMs;
      if (bomb.timerMs <= 0) {
        this.createExplosion(bomb.x, bomb.y, bomb.flame);
      } else {
        remaining.push(bomb);
      }
    });

    this.bombs = remaining;
  }

  createExplosion(x, y, flame) {
    this.explosions.push({ x, y, timerMs: EXPLOSION_DURATION_MS });
    this.checkExplosionHit(x, y);

    const directions = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ];

    directions.forEach(([dx, dy]) => {
      for (let j = 1; j <= flame; j += 1) {
        const newX = x + dx * j;
        const newY = y + dy * j;

        if (this.board[newY][newX].type === 'wall') break;

        this.explosions.push({ x: newX, y: newY, timerMs: EXPLOSION_DURATION_MS });

        if (this.board[newY][newX].type === 'block') {
          this.board[newY][newX] = { type: 'empty', x: newX, y: newY };

          if (Math.random() < POWERUP_DROP_CHANCE) {
            const types = ['bomb', 'flame', 'speed'];
            const type = types[Math.floor(Math.random() * types.length)];
            this.powerups.push({ x: newX, y: newY, type });
          }
          break;
        }

        this.checkExplosionHit(newX, newY);
      }
    });
  }

  checkExplosionHit(x, y) {
    this.players.forEach((player) => {
      if (
        player.lives > 0 &&
        Math.round(player.x) === x &&
        Math.round(player.y) === y
      ) {
        player.lives -= 1;
      }
    });
  }

  updateExplosions(deltaMs) {
    this.explosions = this.explosions
      .map((explosion) => ({ ...explosion, timerMs: explosion.timerMs - deltaMs }))
      .filter((explosion) => explosion.timerMs > 0);
  }

  checkWinCondition() {
    const alivePlayers = this.players.filter((p) => p.lives > 0);
    if (alivePlayers.length <= 1) {
      this.gameOver = true;
      this.winner = alivePlayers.length === 1 ? alivePlayers[0].name : null;
    }
  }

  getState() {
    return {
      seed: this.seed,
      board: this.board,
      players: this.players.map((p) => ({ ...p })),
      bombs: this.bombs.map((b) => ({
        ...b,
        timer: Math.ceil(b.timerMs / 1000),
      })),
      explosions: this.explosions,
      powerups: this.powerups.map((p) => ({ ...p })),
      gameOver: this.gameOver,
      winner: this.winner,
    };
  }
}

module.exports = {
  GameState,
  COLS,
  ROWS,
  PLAYER_COLORS,
};
