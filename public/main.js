import {
  h,
  render,
  diff,
  patch,
  createStore,
  createRouter,
} from '/framework/index.js';
import {
  initNetwork,
  joinGame,
  sendChat,
  sendKeyDown,
  sendKeyUp,
  sendBomb,
  sendStart,
  getMyPlayerId,
} from './network.js';
import {
  playSound,
  playExplosion,
  startMusic,
  stopMusic,
  toggleMute,
  isMuted,
} from './sounds.js';

const CELL_SIZE = 40;
const COLS = 15;
const ROWS = 13;
const MIN_PLAYERS = 2;

const store = createStore({
  nickname: '',
  joinError: '',
  lobby: null,
  chatMessages: [],
  myPlayerId: null,
});

let currentRoute = '/';
let gameState = null;
let prevState = null;
let deathAcknowledged = false;

// Framework render bookkeeping: we mount once with render() then keep the
// previous vnode so we can diff/patch in place. Patching in place is what
// preserves input focus and lets the game loop update efficiently.
let rootVNode = null;
let lastFullRoute = null;

let renderLoopId = null;
let lastFpsTime = performance.now();
let fpsFrames = 0;
let fpsDisplay = 60;
let lastChatLen = 0;
const pressedKeys = new Set();

const KEY_DIRECTIONS = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  W: 'up',
  s: 'down',
  S: 'down',
  a: 'left',
  A: 'left',
  d: 'right',
  D: 'right',
};

function getRoute() {
  return window.location.hash.slice(1) || '/';
}

function goTo(route) {
  window.location.hash = `#${route}`;
}

// Single entry point for putting a vnode on screen. A full render() happens
// only when the route changes; within a screen we diff/patch the existing DOM.
function commit(vnode) {
  const app = document.getElementById('app');
  if (!app) return;

  if (rootVNode === null || lastFullRoute !== currentRoute) {
    render(vnode, app);
    lastFullRoute = currentRoute;
  } else {
    const patchObj = diff(rootVNode, vnode);
    if (patchObj) {
      patch(app.firstChild, patchObj, app);
    }
  }

  rootVNode = vnode;
}

function renderCurrentScreen() {
  currentRoute = getRoute();

  let vnode;
  switch (currentRoute) {
    case '/waiting':
      stopGameRenderLoop();
      vnode = buildWaitingScreen();
      break;
    case '/game':
      vnode = buildGameScreen();
      commit(vnode);
      startGameRenderLoop();
      maybeScrollChat();
      return;
    case '/error':
      stopGameRenderLoop();
      vnode = buildErrorScreen();
      break;
    default:
      stopGameRenderLoop();
      vnode = buildStartScreen();
      break;
  }

  commit(vnode);
  maybeScrollChat();
}

function buildStartScreen() {
  const { nickname, joinError } = store.getState();

  return h('div', { class: 'screen' }, [
    h('h1', {}, ['Bomberman DOM']),
    h('p', { class: 'subtitle' }, ['Last bomber standing wins.']),
    h('div', { class: 'error-message' }, [joinError || '']),
    h('input', {
      type: 'text',
      class: 'nickname-input',
      placeholder: 'Enter your nickname',
      value: nickname,
      maxlength: '20',
      oninput: (e) => store.setState({ nickname: e.target.value, joinError: '' }),
      onkeypress: (e) => {
        if (e.key === 'Enter') handleJoin();
      },
    }),
    h('button', { class: 'btn btn-large', onclick: handleJoin }, ['Join Game']),
  ]);
}

function buildErrorScreen() {
  const { joinError } = store.getState();

  return h('div', { class: 'screen' }, [
    h('div', { class: 'error-card' }, [
      h('div', { class: 'error-icon' }, ['!']),
      h('h1', { class: 'error-title' }, ['Oops!']),
      h('p', { class: 'error-text' }, [joinError || 'Something went wrong.']),
      h(
        'button',
        { class: 'btn btn-large', onclick: () => goTo('/') },
        ['Back to Menu']
      ),
    ]),
  ]);
}

function handleJoin() {
  const { nickname } = store.getState();
  if (!nickname.trim()) {
    store.setState({ joinError: 'Please enter a nickname.' });
    return;
  }
  joinGame(nickname.trim());
}

function buildWaitingScreen() {
  const { lobby, chatMessages } = store.getState();
  const playerCount = lobby?.playerCount ?? 0;
  const maxPlayers = lobby?.maxPlayers ?? 4;
  const phase = lobby?.phase ?? 'waiting';
  const countdown = lobby?.countdown ?? 0;
  const players = lobby?.players ?? [];
  const canStart = phase === 'waiting' && playerCount >= MIN_PLAYERS;

  let statusText = 'Waiting for at least 2 players to join...';
  if (phase === 'countdown') {
    statusText = 'Get ready!';
  } else if (playerCount >= maxPlayers) {
    statusText = 'Lobby full — starting soon...';
  } else if (playerCount >= MIN_PLAYERS) {
    statusText = 'Ready to start! Or wait for more players.';
  }

  const children = [
    h('h1', {}, ['Waiting Room']),
    h('div', { class: 'player-counter' }, [
      h('span', { class: 'count-num' }, [String(playerCount)]),
      h('span', { class: 'count-sep' }, [' / ']),
      h('span', { class: 'count-max' }, [String(maxPlayers)]),
    ]),
    h('div', { class: 'status-text' }, [statusText]),
  ];

  if (phase === 'countdown') {
    children.push(h('div', { class: 'countdown-badge' }, [String(countdown)]));
  } else {
    children.push(
      h(
        'button',
        {
          class: canStart ? 'btn btn-large' : 'btn btn-large btn-disabled',
          disabled: !canStart,
          onclick: () => {
            if (canStart) sendStart();
          },
        },
        [canStart ? 'Start Game' : 'Need 2+ players']
      )
    );
  }

  children.push(
    h(
      'ul',
      { class: 'lobby-players' },
      players.map((p) =>
        h('li', { key: `lp-${p.id}` }, [
          h('span', { class: 'dot' }, []),
          p.name + (p.id === getMyPlayerId() ? ' (You)' : ''),
        ])
      )
    ),
    buildChatSection(chatMessages)
  );

  return h('div', { class: 'screen' }, children);
}

function buildGameScreen() {
  const { chatMessages } = store.getState();
  const players = gameState?.players ?? [];

  return h('div', { class: 'game-container' }, [
    h('div', { class: 'game-board', id: 'game-board' }, buildBoardChildren(gameState)),
    h('div', { class: 'sidebar' }, [
      h('h2', {}, ['Players']),
      h(
        'div',
        { class: 'player-list', id: 'player-list' },
        players.map((player) => buildPlayerItem(player))
      ),
      buildChatSection(chatMessages),
      h('p', { class: 'controls-hint' }, ['Arrows / WASD: move  •  Space: bomb']),
      h(
        'button',
        { class: 'btn btn-mute', onclick: () => toggleMute() },
        [isMuted() ? 'Sound: Off' : 'Sound: On']
      ),
    ]),
  ]);
}

// Compare the previous and current server states to fire one-shot sound
// effects (bomb placed, explosion burst, power-up picked up).
function detectGameSounds(prev, next) {
  if (!prev || !next) return;

  const prevBombs = new Set(prev.bombs.map((b) => `${b.x}-${b.y}`));
  if (next.bombs.some((b) => !prevBombs.has(`${b.x}-${b.y}`))) {
    playSound('bomb');
  }

  if ((prev.explosions?.length || 0) === 0 && next.explosions.length > 0) {
    playExplosion();
  }

  if (next.powerups.length < prev.powerups.length) {
    playSound('powerup');
  }
}

function buildBoardChildren(state) {
  const children = [
    h('div', { class: 'fps-counter', id: 'fps-counter' }, [`FPS: ${fpsDisplay}`]),
    buildCellsLayer(state),
    buildBombsLayer(state),
    buildExplosionsLayer(state),
    buildPowerupsLayer(state),
    buildPlayersLayer(state),
  ];

  const me = state?.players?.find((p) => p.id === getMyPlayerId());

  if (state?.gameOver) {
    children.push(buildGameOverOverlay(state, me));
  } else if (me && me.lives <= 0 && !deathAcknowledged) {
    children.push(buildDeathOverlay());
  }

  return children;
}

function buildCellsLayer(state) {
  const cells = [];

  if (state?.board?.length) {
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const cell = state.board[y][x];
        if (cell.type === 'empty') continue;
        const style = `left: ${x * CELL_SIZE}px; top: ${y * CELL_SIZE}px;`;
        const cls = cell.type === 'wall' ? 'cell wall' : 'cell block';
        cells.push(h('div', { class: cls, style, key: `c-${x}-${y}` }));
      }
    }
  }

  return h('div', { class: 'cells-layer' }, cells);
}

function buildBombsLayer(state) {
  const bombs = (state?.bombs ?? []).map((bomb) => {
    const style = `left: ${bomb.x * CELL_SIZE + (CELL_SIZE - 30) / 2}px; top: ${bomb.y * CELL_SIZE + (CELL_SIZE - 30) / 2}px;`;
    return h('div', { class: 'bomb', style, key: `b-${bomb.x}-${bomb.y}` }, [
      String(bomb.timer ?? ''),
    ]);
  });

  return h('div', { class: 'bombs-layer' }, bombs);
}

function buildExplosionsLayer(state) {
  const seen = new Set();
  const explosions = [];

  (state?.explosions ?? []).forEach((explosion) => {
    const cellKey = `${explosion.x}-${explosion.y}`;
    if (seen.has(cellKey)) return;
    seen.add(cellKey);
    const style = `left: ${explosion.x * CELL_SIZE}px; top: ${explosion.y * CELL_SIZE}px; width: ${CELL_SIZE}px; height: ${CELL_SIZE}px;`;
    explosions.push(h('div', { class: 'explosion', style, key: `e-${cellKey}` }));
  });

  return h('div', { class: 'explosions-layer' }, explosions);
}

const POWERUP_LABELS = { bomb: 'B', flame: 'F', speed: 'S' };

function buildPowerupsLayer(state) {
  const powerups = (state?.powerups ?? []).map((powerup) => {
    const style = `left: ${powerup.x * CELL_SIZE + (CELL_SIZE - 25) / 2}px; top: ${powerup.y * CELL_SIZE + (CELL_SIZE - 25) / 2}px;`;
    return h(
      'div',
      {
        class: `powerup powerup-${powerup.type}`,
        style,
        key: `pu-${powerup.x}-${powerup.y}`,
      },
      [POWERUP_LABELS[powerup.type] || '?']
    );
  });

  return h('div', { class: 'powerups-layer' }, powerups);
}

function buildPlayersLayer(state) {
  const myId = getMyPlayerId();
  const players = (state?.players ?? [])
    .filter((player) => player.lives > 0)
    .map((player) => {
      const isMe = player.id === myId;
      const style = `left: ${player.x * CELL_SIZE + (CELL_SIZE - 32) / 2}px; top: ${player.y * CELL_SIZE + (CELL_SIZE - 32) / 2}px; color: ${player.color};`;
      return h(
        'div',
        {
          class: isMe ? 'player-wrap me' : 'player-wrap',
          style,
          key: `pl-${player.id}`,
        },
        [
          h('span', { class: 'player-name' }, [isMe ? 'YOU' : player.name]),
          h('div', {
            class: 'player',
            style: `background-color: ${player.color};`,
          }),
        ]
      );
    });

  return h('div', { class: 'players-layer' }, players);
}

function buildDeathOverlay() {
  return h('div', { class: 'game-over lose-bg' }, [
    h('div', { class: 'result-emoji' }, ['💀']),
    h('div', { class: 'lose-title' }, ['You Were Eliminated!']),
    h('p', { class: 'result-sub' }, ['You can keep watching, or leave.']),
    h('div', { class: 'overlay-actions' }, [
      h(
        'button',
        {
          class: 'btn',
          onclick: () => {
            deathAcknowledged = true;
          },
        },
        ['Keep Watching']
      ),
      h('button', { class: 'btn btn-secondary', onclick: backToMenu }, ['Back to Menu']),
    ]),
  ]);
}

function buildGameOverOverlay(state, me) {
  const iWon = me && me.lives > 0;
  const titleClass = iWon ? 'win-title' : 'lose-title';
  const title = iWon ? 'You Win!' : 'You Lose!';
  const emoji = iWon ? '🏆' : '💀';
  const sub = state.winner ? `${state.winner} is the last bomber standing.` : 'Draw — no survivors!';

  return h('div', { class: iWon ? 'game-over win-bg' : 'game-over lose-bg' }, [
    h('div', { class: 'result-emoji' }, [emoji]),
    h('div', { class: titleClass }, [title]),
    h('p', { class: 'result-sub' }, [sub]),
    h('button', { class: 'btn btn-large', onclick: backToMenu }, ['Back to Menu']),
  ]);
}

function backToMenu() {
  gameState = null;
  prevState = null;
  deathAcknowledged = false;
  pressedKeys.clear();
  stopMusic();
  store.setState({ lobby: null, chatMessages: [] });
  goTo('/');
}

function buildPlayerItem(player) {
  const isMe = player.id === getMyPlayerId();
  const dead = player.lives <= 0;
  const hearts = '❤'.repeat(Math.max(0, player.lives)) + '·'.repeat(Math.max(0, 3 - player.lives));

  return h('div', { class: dead ? 'player-item dead' : 'player-item' }, [
    h('div', {
      class: 'player-color',
      style: `background-color: ${player.color}; color: ${player.color};`,
    }),
    h('div', { class: 'player-meta' }, [
      h('span', { class: 'player-name-label' }, [`${player.name}${isMe ? ' (You)' : ''}`]),
      h('span', { class: 'player-hearts' }, [dead ? 'Eliminated' : hearts]),
    ]),
  ]);
}

function buildChatSection(messages) {
  return h('div', { class: 'chat-container' }, [
    h(
      'div',
      { class: 'chat-messages', id: 'chat-messages' },
      messages.map((msg, index) =>
        h('div', { class: 'chat-msg', key: `msg-${index}` }, [
          h('span', { class: 'chat-author' }, [`${msg.player}: `]),
          msg.text,
        ])
      )
    ),
    h('div', { class: 'chat-input' }, [
      h('input', {
        type: 'text',
        placeholder: 'Type a message...',
        id: 'chat-input-field',
        onkeypress: (e) => {
          if (e.key === 'Enter') {
            handleSendChat(e.target.value);
            e.target.value = '';
          }
        },
      }),
      h(
        'button',
        {
          onclick: (e) => {
            const input = e.target.parentElement.querySelector('input');
            handleSendChat(input.value);
            input.value = '';
          },
        },
        ['Send']
      ),
    ]),
  ]);
}

function handleSendChat(text) {
  if (text.trim()) {
    sendChat(text.trim());
  }
}

function maybeScrollChat() {
  const { chatMessages } = store.getState();
  if (chatMessages.length === lastChatLen) return;
  lastChatLen = chatMessages.length;

  requestAnimationFrame(() => {
    const chatMessagesEl = document.getElementById('chat-messages');
    if (chatMessagesEl) {
      chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    }
  });
}

function renderGameFrame() {
  if (currentRoute !== '/game') return;
  commit(buildGameScreen());
  maybeScrollChat();
}

function startGameRenderLoop() {
  if (renderLoopId) return;

  lastFpsTime = performance.now();
  fpsFrames = 0;

  function loop(now) {
    fpsFrames += 1;
    if (now - lastFpsTime >= 1000) {
      fpsDisplay = fpsFrames;
      fpsFrames = 0;
      lastFpsTime = now;
    }

    renderGameFrame();

    if (gameState && gameState.gameOver) {
      stopGameRenderLoop();
      return;
    }

    renderLoopId = requestAnimationFrame(loop);
  }

  renderLoopId = requestAnimationFrame(loop);
}

function stopGameRenderLoop() {
  if (renderLoopId) {
    cancelAnimationFrame(renderLoopId);
    renderLoopId = null;
  }
}

createRouter({
  '/': () => renderCurrentScreen(),
  '/waiting': () => renderCurrentScreen(),
  '/game': () => renderCurrentScreen(),
  '/error': () => renderCurrentScreen(),
});

store.subscribe(() => {
  if (currentRoute !== '/game') {
    renderCurrentScreen();
  }
});

initNetwork({
  onJoinSuccess(data) {
    store.setState({
      myPlayerId: data.playerId,
      lobby: data.lobby,
      chatMessages: data.lobby.chatMessages ?? [],
      joinError: '',
    });
    goTo('/waiting');
  },

  onJoinError(message) {
    store.setState({ joinError: message });
    goTo('/error');
  },

  onConnectionError(message) {
    if (currentRoute === '/game') return;
    store.setState({ joinError: message });
    goTo('/error');
  },

  onLobbyState(lobby) {
    store.setState({ lobby });

    if (lobby.phase === 'playing' && currentRoute !== '/game') {
      goTo('/game');
    }
  },

  onChatMessage(message) {
    const { chatMessages } = store.getState();
    store.setState({ chatMessages: [...chatMessages, message] });
  },

  onGameStart() {
    deathAcknowledged = false;
    prevState = null;
    startMusic();
    goTo('/game');
  },

  onGameState(state) {
    detectGameSounds(prevState, state);
    prevState = state;
    gameState = state;
  },
});

document.addEventListener('keydown', (e) => {
  if (currentRoute !== '/game' || !gameState || gameState.gameOver) return;

  const direction = KEY_DIRECTIONS[e.key];
  if (direction) {
    e.preventDefault();
    if (!pressedKeys.has(direction)) {
      pressedKeys.add(direction);
      sendKeyDown(direction);
    }
    return;
  }

  if (e.key === ' ' && !e.repeat) {
    e.preventDefault();
    sendBomb();
  }
});

document.addEventListener('keyup', (e) => {
  const direction = KEY_DIRECTIONS[e.key];
  if (!direction) return;

  if (pressedKeys.has(direction)) {
    pressedKeys.delete(direction);
    sendKeyUp(direction);
  }
});

renderCurrentScreen();
