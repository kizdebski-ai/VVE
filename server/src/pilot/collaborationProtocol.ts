import {
  CollaborationFailure,
  type ClientFrame,
  type ServerFrame
} from './collaborationRuntime';

export const collaborationMessage = {
  sync: 10,
  awareness: 11,
  mutation: 12,
  acknowledgement: 13,
  synchronizationComplete: 14,
  denial: 15,
  serverDraining: 16,
  update: 17
} as const;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const prefixed = (
  type: number,
  payload: Uint8Array<ArrayBufferLike> = new Uint8Array()
): Uint8Array => {
  const frame = new Uint8Array(1 + payload.length);
  frame[0] = type;
  frame.set(payload, 1);
  return frame;
};

const operationFrame = (type: number, operationId: string, update: Uint8Array): Uint8Array => {
  const id = encoder.encode(operationId);
  if (id.length > 128) throw new CollaborationFailure('malformed', 'Operation id is too long.');
  const payload = new Uint8Array(2 + id.length + update.length);
  new DataView(payload.buffer).setUint16(0, id.length);
  payload.set(id, 2);
  payload.set(update, 2 + id.length);
  return prefixed(type, payload);
};

export const decodeClientFrame = (bytes: Uint8Array): ClientFrame => {
  if (bytes[0] === collaborationMessage.awareness) {
    return { kind: 'awareness', update: bytes.slice(1) };
  }
  if (bytes[0] !== collaborationMessage.mutation || bytes.length < 4) {
    throw new CollaborationFailure('malformed', 'Unknown collaboration frame.');
  }
  const idLength = new DataView(bytes.buffer, bytes.byteOffset + 1, 2).getUint16(0);
  const updateOffset = 3 + idLength;
  if (idLength === 0 || idLength > 128 || updateOffset >= bytes.length) {
    throw new CollaborationFailure('malformed', 'Malformed mutation frame.');
  }
  return {
    kind: 'mutation',
    operationId: decoder.decode(bytes.slice(3, updateOffset)),
    update: bytes.slice(updateOffset)
  };
};

export const encodeServerFrame = (frame: ServerFrame): Uint8Array => {
  switch (frame.kind) {
    case 'sync':
      return prefixed(collaborationMessage.sync, frame.update);
    case 'awareness':
      return prefixed(collaborationMessage.awareness, frame.update);
    case 'update':
      return operationFrame(collaborationMessage.update, frame.operationId, frame.update);
    case 'acknowledgement':
      return prefixed(
        collaborationMessage.acknowledgement,
        encoder.encode(JSON.stringify({
          operationId: frame.operationId,
          digest: frame.digest,
          duplicate: frame.duplicate
        }))
      );
    case 'synchronizationComplete':
      return prefixed(
        collaborationMessage.synchronizationComplete,
        encoder.encode(JSON.stringify({ digest: frame.digest }))
      );
    case 'denial':
      return prefixed(
        collaborationMessage.denial,
        encoder.encode(
          JSON.stringify(
            frame.operationId
              ? { reason: frame.reason, operationId: frame.operationId }
              : { reason: frame.reason }
          )
        )
      );
    case 'serverDraining':
      return prefixed(collaborationMessage.serverDraining, encoder.encode(frame.reason));
  }
};
