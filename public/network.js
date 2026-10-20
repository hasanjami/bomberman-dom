const socket = io();

let myPlayerId = null;

export function getSocket() {
  return socket;
}

export function getMyPlayerId() {
  return myPlayerId;
}

export function initNetwork(handlers) {
  socket.on('join:success', (data) => {
    myPlayerId = data.playerId;
    handlers.onJoinSuccess(data);
  });

  socket.on('join:error', (data) => {
    handlers.onJoinError(data.message);
  });

  socket.on('lobby:state', (data) => {
    handlers.onLobbyState(data);
  });

  socket.on('chat:message', (message) => {
    handlers.onChatMessage(message);
  });

  socket.on('game:start', (data) => {
    handlers.onGameStart(data);
  });

  socket.on('game:state', (state) => {
    handlers.onGameState(state);
  });

  socket.on('connect_error', () => {
    if (handlers.onConnectionError) {
      handlers.onConnectionError('Cannot reach the game server. Is it running?');
    }
  });
}

export function joinGame(nickname) {
  socket.emit('join', { nickname });
}

export function sendStart() {
  socket.emit('start:request');
}

export function sendChat(text) {
  socket.emit('chat:message', { text });
}

export function sendKeyDown(direction) {
  socket.emit('input:keydown', { direction });
}

export function sendKeyUp(direction) {
  socket.emit('input:keyup', { direction });
}

export function sendBomb() {
  socket.emit('input:bomb');
}
