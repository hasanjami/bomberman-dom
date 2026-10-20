# Bomberman DOM

A real-time multiplayer Bomberman-style browser game. Two to four players join a shared lobby, chat, then compete on a grid with bombs, destructible blocks and power-ups.

**Project type:** Individual project, developed by Hasan Abbas.

## Features

- Multiplayer lobby with unique nicknames, chat and a start countdown.
- Server-managed game state synchronized with Socket.IO.
- Bomb placement, explosions, destructible blocks and player lives.
- Power-ups for bomb capacity, explosion range and movement speed.
- Win detection and game-over screens.
- Custom JavaScript UI framework with virtual DOM rendering, state and routing.
- Sprite assets, background music and sound effects.

## My work

I built the game logic, lobby lifecycle, real-time networking and DOM-based interface, and integrated the custom framework with rendering, player input and audio.

## Stack

JavaScript, Node.js, Express 5, Socket.IO, HTML and CSS.

## Run locally

Use Node.js 18 or newer and npm:

```bash
git clone https://github.com/hasanjami/bomberman-dom.git
cd bomberman-dom
npm ci
npm start
```

Open `http://localhost:3030` in at least two browser tabs or windows. Join each tab with a different nickname. The lobby supports up to four players.

## Controls

| Input | Action |
| --- | --- |
| Arrow keys or W/A/S/D | Move |
| Space | Place a bomb |
| Lobby chat input | Send a message |
| Start button | Request the short start countdown when enough players have joined |

## Structure

| Directory | Purpose |
| --- | --- |
| `server/` | Express server, lobby events and authoritative game state |
| `public/` | Screens, rendering, input, networking and styles |
| `framework/` | Virtual DOM, event helpers, store and hash router |
| `assets/` | Game images and audio |

The server uses `PORT` when provided and defaults to `3030`. Lobby and match state are kept in memory. There is currently no automated test suite; the package's placeholder test command is not a gameplay check.

Game imagery and audio are bundled project assets. The individual-project credit describes the application implementation and does not imply authorship of every media asset or the Bomberman franchise.
