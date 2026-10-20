import { on, off } from './events.js';

const PATCH_TYPES = {
  CREATE: 'CREATE',
  REMOVE: 'REMOVE',
  REPLACE: 'REPLACE',
  TEXT: 'TEXT',
  UPDATE: 'UPDATE',
};

function isTextVNode(vnode) {
  return vnode && vnode.tag === null;
}

function isEventKey(key) {
  // Accept both lowercase HTML-style names (onclick) and camelCase (onClick).
  return key.length > 2 && key.startsWith('on') && /[a-z]/i.test(key[2]);
}

function eventKeyToName(key) {
  return key.slice(2).toLowerCase();
}

function normalizeChildren(children) {
  const normalized = [];

  function flatten(items) {
    if (items == null || items === false) return;

    if (Array.isArray(items)) {
      items.forEach(flatten);
      return;
    }

    if (typeof items === 'string' || typeof items === 'number') {
      normalized.push({ tag: null, text: String(items) });
      return;
    }

    normalized.push(items);
  }

  flatten(children);
  return normalized;
}

export function h(tag, attrs = {}, children = []) {
  return {
    tag,
    attrs: attrs || {},
    children: normalizeChildren(children),
  };
}

function setAttribute(el, key, value) {
  if (key === 'className') {
    el.setAttribute('class', value);
    return;
  }

  if (key === 'htmlFor') {
    el.setAttribute('for', value);
    return;
  }

  if (key === 'checked' || key === 'disabled' || key === 'readOnly') {
    el[key] = Boolean(value);
    return;
  }

  if (key === 'value') {
    el.value = value == null ? '' : String(value);
    return;
  }

  if (value === false || value == null) {
    el.removeAttribute(key);
    return;
  }

  if (value === true) {
    el.setAttribute(key, '');
    return;
  }

  el.setAttribute(key, value);
}

function applyAttrs(el, attrs = {}) {
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === 'key' || isEventKey(key)) return;
    setAttribute(el, key, value);
  });

  Object.entries(attrs).forEach(([key, value]) => {
    if (!isEventKey(key) || typeof value !== 'function') return;
    on(el, eventKeyToName(key), value);
  });
}

export function createElement(vnode) {
  if (!vnode) return null;

  if (isTextVNode(vnode)) {
    return document.createTextNode(vnode.text);
  }

  const el = document.createElement(vnode.tag);
  applyAttrs(el, vnode.attrs);

  vnode.children.forEach((child) => {
    const childEl = createElement(child);
    if (childEl) {
      el.appendChild(childEl);
    }
  });

  return el;
}

function diffAttrs(oldAttrs = {}, newAttrs = {}) {
  const set = {};
  const remove = [];
  const events = {};

  Object.keys(oldAttrs).forEach((key) => {
    if (key === 'key') return;

    if (!(key in newAttrs)) {
      if (isEventKey(key)) {
        events[key] = { oldHandler: oldAttrs[key], newHandler: null };
      } else {
        remove.push(key);
      }
    }
  });

  Object.entries(newAttrs).forEach(([key, value]) => {
    if (key === 'key') return;

    if (isEventKey(key)) {
      if (oldAttrs[key] !== value) {
        events[key] = { oldHandler: oldAttrs[key], newHandler: value };
      }
      return;
    }

    if (oldAttrs[key] !== value) {
      set[key] = value;
    }
  });

  return { set, remove, events };
}

function getVNodeKey(vnode) {
  return vnode && vnode.attrs ? vnode.attrs.key : undefined;
}

function diffChildren(oldChildren = [], newChildren = []) {
  const usesKeys = [...oldChildren, ...newChildren].some(
    (child) => getVNodeKey(child) !== undefined
  );

  if (usesKeys) {
    return diffKeyedChildren(oldChildren, newChildren);
  }

  const childPatches = [];
  const maxLength = Math.max(oldChildren.length, newChildren.length);

  for (let index = 0; index < maxLength; index += 1) {
    childPatches.push(diff(oldChildren[index], newChildren[index]));
  }

  return childPatches;
}

function diffKeyedChildren(oldChildren = [], newChildren = []) {
  const oldKeyed = new Map();
  oldChildren.forEach((child, index) => {
    const key = getVNodeKey(child);
    if (key !== undefined) {
      oldKeyed.set(key, { vnode: child, index });
    }
  });

  const childPatches = new Array(newChildren.length).fill(null);
  const usedOldIndexes = new Set();

  newChildren.forEach((newChild, newIndex) => {
    const key = getVNodeKey(newChild);
    if (key !== undefined && oldKeyed.has(key)) {
      const { vnode: oldChild, index: oldIndex } = oldKeyed.get(key);
      childPatches[newIndex] = diff(oldChild, newChild);
      usedOldIndexes.add(oldIndex);
      return;
    }

    childPatches[newIndex] = { type: PATCH_TYPES.CREATE, vnode: newChild };
  });

  const removals = [];
  oldChildren.forEach((oldChild, oldIndex) => {
    const key = getVNodeKey(oldChild);
    if (key !== undefined) {
      if (!newChildren.some((child) => getVNodeKey(child) === key)) {
        removals.push({ index: oldIndex, type: PATCH_TYPES.REMOVE });
      }
      return;
    }

    if (!usedOldIndexes.has(oldIndex)) {
      removals.push({ index: oldIndex, type: PATCH_TYPES.REMOVE });
    }
  });

  return { keyed: true, patches: childPatches, removals };
}

export function diff(oldVnode, newVnode) {
  if (!newVnode) {
    return { type: PATCH_TYPES.REMOVE };
  }

  if (!oldVnode) {
    return { type: PATCH_TYPES.CREATE, vnode: newVnode };
  }

  if (isTextVNode(oldVnode) && isTextVNode(newVnode)) {
    if (oldVnode.text !== newVnode.text) {
      return { type: PATCH_TYPES.TEXT, text: newVnode.text };
    }
    return null;
  }

  if (isTextVNode(oldVnode) !== isTextVNode(newVnode)) {
    return { type: PATCH_TYPES.REPLACE, vnode: newVnode };
  }

  if (oldVnode.tag !== newVnode.tag) {
    return { type: PATCH_TYPES.REPLACE, vnode: newVnode };
  }

  return {
    type: PATCH_TYPES.UPDATE,
    attrs: diffAttrs(oldVnode.attrs, newVnode.attrs),
    children: diffChildren(oldVnode.children, newVnode.children),
  };
}

function applyAttrChanges(el, attrsPatch) {
  attrsPatch.remove.forEach((key) => {
    el.removeAttribute(key);
  });

  Object.entries(attrsPatch.set).forEach(([key, value]) => {
    setAttribute(el, key, value);
  });

  Object.entries(attrsPatch.events).forEach(([key, { oldHandler, newHandler }]) => {
    const eventName = eventKeyToName(key);
    if (typeof oldHandler === 'function') {
      off(el, eventName, oldHandler);
    }
    if (typeof newHandler === 'function') {
      on(el, eventName, newHandler);
    }
  });
}

function patchChildNodes(parent, childPatches) {
  if (!childPatches) return;

  if (childPatches.keyed) {
    childPatches.removals
      .sort((a, b) => b.index - a.index)
      .forEach((removal) => {
        const node = parent.childNodes[removal.index];
        if (node) {
          parent.removeChild(node);
        }
      });

    childPatches.patches.forEach((childPatch, index) => {
      if (!childPatch) return;

      if (childPatch.type === PATCH_TYPES.CREATE) {
        const newNode = createElement(childPatch.vnode);
        const reference = parent.childNodes[index] || null;
        parent.insertBefore(newNode, reference);
        return;
      }

      const current = parent.childNodes[index];
      if (current) {
        patch(current, childPatch, parent);
      }
    });

    return;
  }

  const patches = childPatches;

  for (let index = patches.length - 1; index >= 0; index -= 1) {
    const childPatch = patches[index];
    if (childPatch && childPatch.type === PATCH_TYPES.REMOVE) {
      const node = parent.childNodes[index];
      if (node) {
        parent.removeChild(node);
      }
    }
  }

  patches.forEach((childPatch, index) => {
    if (!childPatch || childPatch.type === PATCH_TYPES.REMOVE) return;

    if (childPatch.type === PATCH_TYPES.CREATE) {
      const newNode = createElement(childPatch.vnode);
      const reference = parent.childNodes[index] || null;
      parent.insertBefore(newNode, reference);
      return;
    }

    const current = parent.childNodes[index];
    if (current) {
      patch(current, childPatch, parent);
    }
  });
}

export function patch(domNode, patchObj, parent = null) {
  if (!patchObj) return domNode;

  switch (patchObj.type) {
    case PATCH_TYPES.CREATE: {
      const newNode = createElement(patchObj.vnode);
      if (parent) {
        parent.appendChild(newNode);
      }
      return newNode;
    }

    case PATCH_TYPES.REMOVE: {
      if (domNode && parent) {
        parent.removeChild(domNode);
      }
      return null;
    }

    case PATCH_TYPES.REPLACE: {
      const newNode = createElement(patchObj.vnode);
      if (domNode && domNode.parentNode) {
        domNode.parentNode.replaceChild(newNode, domNode);
      }
      return newNode;
    }

    case PATCH_TYPES.TEXT: {
      if (domNode) {
        domNode.nodeValue = patchObj.text;
      }
      return domNode;
    }

    case PATCH_TYPES.UPDATE: {
      applyAttrChanges(domNode, patchObj.attrs);
      patchChildNodes(domNode, patchObj.children);
      return domNode;
    }

    default:
      return domNode;
  }
}

export function render(vnode, container) {
  container.replaceChildren();
  const root = createElement(vnode);
  if (root) {
    container.appendChild(root);
  }
  return root;
}
