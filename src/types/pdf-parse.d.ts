declare module 'pdf-parse' {
  function pdfParse(
    dataBuffer: Buffer | Uint8Array,
    options?: Record<string, unknown>
  ): Promise<{ text: string; numpages: number; info: Record<string, unknown> }>;
  export = pdfParse;
}
