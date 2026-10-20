function cloneState(state) {
  if (typeof structuredClone === 'function') {
    return structuredClone(state);
  }
  return JSON.parse(JSON.stringify(state));
}

export function createStore(initialState) {
  let state = cloneState(initialState);
  const subscribers = new Set();

  return {
    getState() {
      return cloneState(state);
    },

    setState(partial) {
      state = {
        ...state,
        ...partial,
      };

      if (partial.todos !== undefined) {
        state.todos = cloneState(partial.todos);
      }

      subscribers.forEach((fn) => fn(this.getState()));
    },

    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },

    unsubscribe(fn) {
      subscribers.delete(fn);
    },
  };
}
