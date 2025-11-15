const WebSocket = require('ws');
const Y = require('yjs');

const room = 'codex-cli-test';
const url = `ws://localhost:8000/ws/whiteboard/${room}`;
const doc = new Y.Doc();
const drawings = doc.getArray('drawings');
drawings.push([{ type: 'pen', points: [{ x: 1, y: 2 }] }]);
const initialUpdate = Y.encodeStateAsUpdate(doc);

const toMessage = (type, payload) => {
  const msg = new Uint8Array(1 + payload.length);
  msg[0] = type;
  msg.set(payload, 1);
  return msg;
};

const ws = new WebSocket(url);
ws.binaryType = 'arraybuffer';

ws.on('open', () => {
  console.log('ws open');
  ws.send(toMessage(0, initialUpdate));
});

ws.on('message', (data) => {
  const view = new Uint8Array(data);
  console.log('message type', view[0], 'len', view.length);
});

ws.on('error', (err) => {
  console.error('ws error', err);
});

setTimeout(() => {
  console.log('closing');
  ws.close();
}, 2000);
