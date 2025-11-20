import { encryptData } from "../lib/crypto";

interface PortalOptions {
  roomId: string;
  roomKey: string | CryptoKey;
  url: string;
}

export class Portal {
  roomId: string;
  roomKey: string | CryptoKey;
  url: string;
  ws: WebSocket | null;

  constructor(opts: PortalOptions) {
    this.roomId = opts.roomId;
    this.roomKey = opts.roomKey;
    this.url = opts.url;
    this.ws = null;
  }

  connect(onMessage: (data: unknown) => void) {
    const ws = new WebSocket(`${this.url}?roomId=${this.roomId}`);
    this.ws = ws;

    ws.onmessage = (evt) => {
      const data = JSON.parse(evt.data);
      onMessage(data);
    };
  }

  async broadcastElementsDelta(elements: unknown, version: number) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const json = JSON.stringify(elements);
    const encoded = new TextEncoder().encode(json);
    const { ciphertext, iv } = await encryptData(this.roomKey, encoded);

    this.ws.send(
      JSON.stringify({
        type: "SCENE_UPDATE",
        roomId: this.roomId,
        ciphertext: Array.from(new Uint8Array(ciphertext)),
        iv: Array.from(iv),
        version,
      })
    );
  }
}
