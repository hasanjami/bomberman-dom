const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { GameState } = require('./gameState');

const PORT = process.env.PORT || 3030;
const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;
const COUNTDOWN_SECONDS = 10;
const WAIT_SECONDS = 20;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static(path.join(__dirname, '../public')));
app.use('/framework', express.static(path.join(__dirname, '../framework')));
app.use('/assets', express.static(path.join(__dirname, '../assets')));

const lobby = {
  players: new Map(),
  chatMessages: [],
  phase: 'waiting',
  countdown: 0,
  waitTimer: null,
  countdownTimer: null,
};

let game = null;
let gameLoopInterval = null;
let lastTick = Date.now();
let nextPlayerId = 1;

function getLobbySnapshot() {
  return {
    phase: lobby.phase,
    playerCount: lobby.players.size,
    maxPlayers: MAX_PLAYERS,
    countdown: lobby.countdown,
    players: Array.from(lobby.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
    })),
    chatMessages: lobby.chatMessages,
  };
}

function broadcastLobby() {
  io.emit('lobby:state', getLobbySnapshot());
}

function clearWaitTimer() {
  if (lobby.waitTimer) {
    clearTimeout(lobby.waitTimer);
    lobby.waitTimer = null;
  }
}

function clearCountdownTimer() {
  if (lobby.countdownTimer) {
    clearInterval(lobby.countdownTimer);
    lobby.countdownTimer = null;
  }
}

function startCountdown(seconds = COUNTDOWN_SECONDS) {
  if (lobby.phase === 'countdown' || lobby.phase === 'playing') return;

  clearWaitTimer();
  lobby.phase = 'countdown';
  lobby.countdown = seconds;
  broadcastLobby();

  clearCountdownTimer();
  lobby.countdownTimer = setInterval(() => {
    lobby.countdown -= 1;
    broadcastLobby();

    if (lobby.countdown <= 0) {
      clearCountdownTimer();
      startGame();
    }
  }, 1000);
}

function scheduleWaitTimer() {
  if (lobby.waitTimer || lobby.phase !== 'waiting') return;
  if (lobby.players.size < MIN_PLAYERS) return;

  lobby.waitTimer = setTimeout(() => {
    lobby.waitTimer = null;
    if (lobby.phase === 'waiting' && lobby.players.size >= MIN_PLAYERS) {
      startCountdown();
    }
  }, WAIT_SECONDS * 1000);
}

// Spec timing: need at least MIN_PLAYERS (2) to play. Reaching MAX_PLAYERS (4)
// starts the 10s countdown immediately; otherwise a 20s window runs and then
// the 10s countdown begins (provided we still have >= MIN_PLAYERS). If the
// lobby drops below MIN_PLAYERS while waiting, cancel the pending window.
function updateLobbyTimers() {
  if (lobby.phase !== 'waiting') return;

  const count = lobby.players.size;

  if (count >= MAX_PLAYERS) {
    startCountdown();
    return;
  }

  if (count >= MIN_PLAYERS) {
    scheduleWaitTimer();
    return;
  }

  clearWaitTimer();
}

// Only stop the loop interval here. Clearing `game` itself is done in
// resetLobby(); nulling it here would wipe the game that startGame() just
// created (startGameLoop calls this first to clear any stale interval).
function stopGameLoop() {
  if (gameLoopInterval) {
    clearInterval(gameLoopInterval);
    gameLoopInterval = null;
  }
}

function startGameLoop() {
  stopGameLoop();
  lastTick = Date.now();

  gameLoopInterval = setInterval(() => {
    if (!game) return;

    const now = Date.now();
    const deltaMs = now - lastTick;
    lastTick = now;

    game.update(deltaMs);
    io.emit('game:state', game.getState());

    if (game.gameOver) {
      stopGameLoop();
      lobby.phase = 'finished';
      broadcastLobby();
    }
  }, 1000 / 60);
}

function resetLobby() {
  clearWaitTimer();
  clearCountdownTimer();
  stopGameLoop();
  game = null;
  lobby.phase = 'waiting';
  lobby.countdown = 0;
  lobby.chatMessages = [];
  lobby.players.clear();
  nextPlayerId = 1;
  broadcastLobby();
}

function startGame() {
  if (lobby.players.size < MIN_PLAYERS) return;

  lobby.phase = 'playing';
  const seed = Date.now();
  const lobbyPlayers = Array.from(lobby.players.values());

  game = new GameState(seed, lobbyPlayers);
  startGameLoop();

  io.emit('game:start', {
    seed,
    yourPlayerId: null,
    assignments: lobbyPlayers.map((p) => ({
      id: p.id,
      name: p.name,
      socketId: p.socketId,
    })),
  });

  io.emit('game:state', game.getState());
  broadcastLobby();
}

io.on('connection', (socket) => {
  let joinedPlayer = null;

  socket.on('join', ({ nickname }) => {
    const trimmed = (nickname || '').trim();
    if (!trimmed) {
      socket.emit('join:error', { message: 'Nickname is required.' });
      return;
    }

    if (lobby.phase === 'playing' || lobby.phase === 'countdown') {
      socket.emit('join:error', { message: 'Game already in progress.' });
      return;
    }

    // After a finished game the lobby is stuck in 'finished'; a new joiner
    // reopens it as a fresh waiting room so players are never locked out.
    if (lobby.phase === 'finished') {
      stopGameLoop();
      game = null;
      lobby.phase = 'waiting';
      lobby.countdown = 0;
    }

    if (lobby.players.size >= MAX_PLAYERS) {
      socket.emit('join:error', { message: 'Lobby is full.' });
      return;
    }

    const duplicate = Array.from(lobby.players.values()).some(
      (p) => p.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (duplicate) {
      socket.emit('join:error', { message: 'Nickname already taken.' });
      return;
    }

    joinedPlayer = {
      id: nextPlayerId++,
      name: trimmed,
      socketId: socket.id,
    };

    lobby.players.set(socket.id, joinedPlayer);
    socket.emit('join:success', {
      playerId: joinedPlayer.id,
      lobby: getLobbySnapshot(),
    });

    broadcastLobby();
    updateLobbyTimers();
  });

  // Manual start: any player in a waiting lobby with >= MIN_PLAYERS can kick
  // off a short countdown instead of waiting for the auto timer.
  socket.on('start:request', () => {
    if (!joinedPlayer) return;
    if (lobby.phase !== 'waiting') return;
    if (lobby.players.size < MIN_PLAYERS) return;
    startCountdown(3);
  });

  socket.on('chat:message', ({ text }) => {
    const trimmed = (text || '').trim();
    if (!trimmed || !joinedPlayer) return;

    const message = {
      player: joinedPlayer.name,
      text: trimmed,
      timestamp: Date.now(),
    };

    lobby.chatMessages.push(message);
    if (lobby.chatMessages.length > 100) {
      lobby.chatMessages.shift();
    }

    io.emit('chat:message', message);
  });

  socket.on('input:keydown', ({ direction }) => {
    if (!game || !joinedPlayer) return;
    game.setInput(joinedPlayer.id, direction, true);
  });

  socket.on('input:keyup', ({ direction }) => {
    if (!game || !joinedPlayer) return;
    game.setInput(joinedPlayer.id, direction, false);
  });

  socket.on('input:bomb', () => {
    if (!game || !joinedPlayer) return;
    game.placeBomb(joinedPlayer.id);
  });

  socket.on('disconnect', () => {
    if (!joinedPlayer) return;

    lobby.players.delete(socket.id);

    if (game && lobby.phase === 'playing') {
      const player = game.players.find((p) => p.id === joinedPlayer.id);
      if (player) {
        player.lives = 0;
        game.checkWinCondition();
        io.emit('game:state', game.getState());
      }
    }

    if (lobby.players.size === 0) {
      resetLobby();
      return;
    }

    if (lobby.phase === 'waiting') {
      updateLobbyTimers();
      broadcastLobby();
    }
  });
});

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\nPort ${PORT} is already in use. Another server is probably still running.\n` +
        `Close it, or start on a different port, e.g.:  PORT=4000 npm start\n`
    );
    process.exit(1);
  }
  throw err;
});

httpServer.listen(PORT, () => {
  console.log(`Bomberman server running at http://localhost:${PORT}`);
});
