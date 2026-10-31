// Ores Live v1: text-only DOM diffs. No eval, innerHTML, arbitrary selectors,
// scripts or automatic replay of client mutations. Transport: WebSocket.
export const SUBPROTOCOL = 'ores.live.v1';
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const TOPIC = /^[a-z][a-z0-9_:/-]{0,127}$/;
const EPOCH = /^[A-Za-z0-9_-]{1,80}$/;
const EVENT = /^[a-z][a-z0-9_]{0,63}$/;
const TAGS = new Set(['li', 'div', 'span', 'p', 'tr', 'td']);
const ATTRS = new Set(['class', 'title', 'role', 'hidden']);
const MAX_FRAME = 65536;
const bytes = value => new TextEncoder().encode(value).length;
const plainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const validSeq = n => Number.isSafeInteger(n) && n >= 0;
const validKey = k => typeof k === 'string' && ID.test(k);
const validAttr = a => typeof a === 'string' && (ATTRS.has(a) || /^aria-[a-z][a-z0-9-]{0,45}$/.test(a));

export class OresLiveClient {
  constructor({url, root, topic, csrf, socketFactory, baseUrl,
               schedule = (fn, ms) => setTimeout(fn, ms),
               cancel = id => clearTimeout(id), random = Math.random,
               onStatus = () => {}}) {
    if (!root || !root.ownerDocument || typeof root.contains !== 'function') throw Error('root element required');
    if (typeof topic !== 'string' || !TOPIC.test(topic)) throw Error('invalid topic');
    if (typeof csrf !== 'string' || csrf.length < 16 || csrf.length > 512) throw Error('CSRF token required');
    const locationUrl = new URL(baseUrl || globalThis.location?.href);
    const endpoint = new URL(url, locationUrl);
    if (!['ws:', 'wss:'].includes(endpoint.protocol) || endpoint.host !== locationUrl.host ||
        (locationUrl.protocol === 'https:' && endpoint.protocol !== 'wss:') ||
        endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw Error('unsafe WebSocket URL');
    this.url = endpoint.href;
    this.root = root;
    this.topic = topic;
    this.csrf = csrf;
    this.socketFactory = socketFactory || ((u, p) => new WebSocket(u, p));
    this.schedule = schedule;
    this.cancel = cancel;
    this.random = random;
    this.onStatus = onStatus;
    this.socket = null;
    this.running = false;
    this.ready = false;
    this.epoch = null;
    this.seq = 0;
    this.retry = 0;
    this.timer = null;
    this.awaitingSnapshot = true;
  }

  start() { if (this.running) return; this.running = true; this._connect(); }
  stop() {
    this.running = false;
    this.ready = false;
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    if (this.socket) this.socket.close(1000, 'client stop');
    this.socket = null;
  }
  sendEvent(event, data = {}) {
    if (!this.running || !this.ready || typeof event !== 'string' || !EVENT.test(event) || !plainObject(data)) return false;
    // A send cannot be assumed committed across disconnect; never auto-replay.
    return this._send({v: 1, type: 'event', topic: this.topic, event, data});
  }
  _connect() {
    if (!this.running) return;
    let socket;
    try { socket = this.socketFactory(this.url, SUBPROTOCOL); }
    catch (_) { this._retry(); return; }
    this.socket = socket;
    this.ready = false;
    this.awaitingSnapshot = this.epoch === null;
    socket.onopen = () => {
      if (!this.running || socket !== this.socket) return;
      if (socket.protocol !== SUBPROTOCOL) { this._fatal('subprotocol mismatch'); return; }
      this.retry = 0;
      this.onStatus('connected');
      this._send({v: 1, type: 'join', topic: this.topic,
                  csrf: this.csrf, epoch: this.epoch, seq: this.seq});
    };
    socket.onmessage = msg => {
      if (!this.running || socket !== this.socket) return;
      try { this._receive(msg.data); }
      catch (_) { this._fatal('invalid frame'); }
    };
    socket.onclose = () => {
      if (socket !== this.socket) return;
      this.ready = false;
      this.onStatus('disconnected');
      this._retry();
    };
    socket.onerror = () => this.onStatus('transport-error');
  }
  _retry() {
    if (!this.running || this.timer !== null) return;
    const ceiling = Math.min(30000, 500 * Math.pow(2, Math.min(6, this.retry++)));
    this.timer = this.schedule(() => { this.timer = null; this._connect(); }, Math.floor(this.random() * ceiling));
  }
  _fatal(reason) {
    this.onStatus(reason);
    this.running = false;
    this.ready = false;
    if (this.socket) this.socket.close(1008, reason);
  }
  _send(frame) {
    if (!this.socket || this.socket.readyState !== 1 || this.socket.bufferedAmount > MAX_FRAME) return false;
    const encoded = JSON.stringify(frame);
    if (bytes(encoded) > MAX_FRAME) return false;
    this.socket.send(encoded);
    return true;
  }
  _resync() {
    if (this.awaitingSnapshot) return;
    this.ready = false;
    this.awaitingSnapshot = true;
    this.onStatus('resync');
    this._send({v: 1, type: 'resync', topic: this.topic, epoch: this.epoch, seq: this.seq});
  }
  _receive(raw) {
    if (typeof raw !== 'string' || bytes(raw) > MAX_FRAME) throw Error('oversized frame');
    const frame = JSON.parse(raw);
    if (!plainObject(frame) || frame.v !== 1 || frame.topic !== this.topic ||
        !['snapshot', 'patch', 'ready'].includes(frame.type) || !validSeq(frame.seq) ||
        typeof frame.epoch !== 'string' || !EPOCH.test(frame.epoch)) throw Error('bad envelope');
    if (frame.type === 'ready') {
      if (this.awaitingSnapshot || frame.epoch !== this.epoch || frame.seq !== this.seq) { this._resync(); return; }
      this.ready = true;
      this.onStatus('ready');
      return;
    }
    if (frame.type === 'patch' && (this.awaitingSnapshot || frame.epoch !== this.epoch || frame.seq !== this.seq + 1)) {
      this._resync(); return;
    }
    if (frame.type === 'snapshot' && frame.epoch === this.epoch && frame.seq < this.seq) return;
    // Validate all operations and their targets before mutating any DOM.
    const mutations = this._prepare(frame.ops);
    for (const apply of mutations) apply();
    this.epoch = frame.epoch;
    this.seq = frame.seq;
    this.awaitingSnapshot = false;
    this.ready = frame.type === 'snapshot' || this.ready;
    this._send({v: 1, type: 'ack', topic: this.topic, epoch: this.epoch, seq: this.seq});
  }
  _prepare(ops) {
    if (!Array.isArray(ops) || ops.length > 128) throw Error('invalid operations');
    const actions = [];
    const virtualKeys = new Map();
    const destructive = new Set();
    const targets = [];
    for (const op of ops) {
      if (!plainObject(op) || !validKey(op.id)) throw Error('invalid operation target');
      const node = this.root.ownerDocument.getElementById(op.id);
      if (!node || !this.root.contains(node)) throw Error('target outside live root');
      targets.push(node);
      if (!virtualKeys.has(node)) {
        const keys = new Set();
        for (const child of node.children) {
          const k = child.getAttribute('data-ores-key');
          if (k !== null) keys.add(k);
        }
        virtualKeys.set(node, keys);
      }
      const keys = virtualKeys.get(node);
      if (op.op === 'text' && typeof op.text === 'string' && bytes(op.text) <= 8192) {
        destructive.add(node);
        keys.clear();
        actions.push(() => { node.textContent = op.text; });
      } else if (op.op === 'attr' && validAttr(op.name) && typeof op.value === 'string' && bytes(op.value) <= 1024) {
        actions.push(() => node.setAttribute(op.name, op.value));
      } else if (op.op === 'append_text' && validKey(op.key) && TAGS.has(op.tag) &&
                 typeof op.text === 'string' && bytes(op.text) <= 8192) {
        if (keys.has(op.key)) throw Error('duplicate key');
        keys.add(op.key);
        actions.push(() => {
          const child = this.root.ownerDocument.createElement(op.tag);
          child.setAttribute('data-ores-key', op.key);
          child.textContent = op.text;
          node.appendChild(child);
        });
      } else if (op.op === 'remove_key' && validKey(op.key)) {
        if (!keys.has(op.key)) throw Error('missing key');
        keys.delete(op.key);
        actions.push(() => this._child(node, op.key)?.remove());
      } else if (op.op === 'clear') {
        destructive.add(node);
        keys.clear();
        actions.push(() => { node.textContent = ''; });
      } else { throw Error('invalid operation'); }
    }
    // A text/clear operation may remove descendant nodes. Disallow batches
    // that would depend on DOM nodes deleted by another operation.
    for (const parent of destructive) {
      for (const target of targets) {
        if (target !== parent && parent.contains(target)) throw Error('overlapping destructive operations');
      }
    }
    return actions;
  }
  _child(parent, key) {
    for (const child of parent.children) if (child.getAttribute('data-ores-key') === key) return child;
    return null;
  }
}
