declare module 'pdf-parse' {
  import type { Buffer } from 'node:buffer';

  type PDFParseResult = {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: any;
    version: string;
    text: string;
  };

  function pdfParse(data: Buffer | Uint8Array, options?: Record<string, unknown>): Promise<PDFParseResult>;
  export = pdfParse;
}
