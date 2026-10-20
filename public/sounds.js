// Lightweight sound manager. Short SFX are cloned on each play so overlapping
// sounds (multiple explosions) don't cut each other off. Music loops quietly.

const defs = {
  bomb: { src: '/assets/bomb.ogg', volume: 0.45 },
  explosion1: { src: '/assets/explosion1.ogg', volume: 0.5 },
  explosion2: { src: '/assets/explosion2.ogg', volume: 0.5 },
  powerup: { src: '/assets/powerup1.ogg', volume: 0.6 },
  move: { src: '/assets/move.ogg', volume: 0.25 },
};

const bases = {};
for (const [name, def] of Object.entries(defs)) {
  const audio = new Audio(def.src);
  audio.preload = 'auto';
  audio.volume = def.volume;
  bases[name] = audio;
}

const music = new Audio('/assets/john.ogg');
music.loop = true;
music.volume = 0.22;

let muted = false;
let musicWanted = false;

export function playSound(name) {
  if (muted) return;
  const base = bases[name];
  if (!base) return;
  const node = base.cloneNode(true);
  node.volume = base.volume;
  node.play().catch(() => {});
}

export function playExplosion() {
  playSound(Math.random() < 0.5 ? 'explosion1' : 'explosion2');
}

export function startMusic() {
  musicWanted = true;
  if (muted) return;
  music.currentTime = 0;
  music.play().catch(() => {});
}

export function stopMusic() {
  musicWanted = false;
  music.pause();
  music.currentTime = 0;
}

export function toggleMute() {
  muted = !muted;
  if (muted) {
    music.pause();
  } else if (musicWanted) {
    music.play().catch(() => {});
  }
  return muted;
}

export function isMuted() {
  return muted;
}
