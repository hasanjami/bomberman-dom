const registry = new WeakMap();

function getElementRegistry(element) {
  if (!registry.has(element)) {
    registry.set(element, new Map());
  }
  return registry.get(element);
}

function getEventHandlers(element, eventName) {
  const elementRegistry = getElementRegistry(element);
  if (!elementRegistry.has(eventName)) {
    elementRegistry.set(eventName, new Set());
  }
  return elementRegistry.get(eventName);
}

export function on(element, eventName, handler) {
  if (!element || !eventName || !handler) return;

  const handlers = getEventHandlers(element, eventName);
  if (!handlers.has(handler)) {
    handlers.add(handler);
    element.addEventListener(eventName, handler);
  }
}

export function off(element, eventName, handler) {
  if (!element || !eventName || !handler) return;

  const elementRegistry = registry.get(element);
  if (!elementRegistry) return;

  const handlers = elementRegistry.get(eventName);
  if (!handlers || !handlers.has(handler)) return;

  handlers.delete(handler);
  element.removeEventListener(eventName, handler);

  if (handlers.size === 0) {
    elementRegistry.delete(eventName);
  }
}

export function emit(element, eventName, data) {
  if (!element || !eventName) return;

  element.dispatchEvent(
    new CustomEvent(eventName, {
      detail: data,
      bubbles: true,
    })
  );
}
