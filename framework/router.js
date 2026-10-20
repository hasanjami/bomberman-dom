export function navigate(path) {
  window.location.hash = path;
}

export function createRouter(routes) {
  function resolve() {
    const hash = window.location.hash.slice(1) || '/';
    const handler = routes[hash] ?? routes['/'];
    if (typeof handler === 'function') {
      handler(hash);
    }
  }

  window.addEventListener('hashchange', resolve);
  resolve();

  return { navigate };
}
