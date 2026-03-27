"use server";

import { ApiUsageService } from "@/services/api-usage.service";

// Resumes with fewer than this many characters after trimming are treated as
// image-only (scanned) and trigger the vision OCR fallback.
const OCR_MIN_TEXT_LENGTH = 100;

// ---------------------------------------------------------------------------
// File type helpers
// ---------------------------------------------------------------------------

function isDocxFile(file: File): boolean {
  return (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.name.toLowerCase().endsWith(".docx")
  );
}

function isDocFile(file: File): boolean {
  return (
    file.type === "application/msword" ||
    file.name.toLowerCase().endsWith(".doc")
  );
}

function isPdfFile(file: File): boolean {
  return (
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  );
}

// ---------------------------------------------------------------------------
// Text extraction (existing logic, unchanged)
// ---------------------------------------------------------------------------

/** Extracts text from .docx files using mammoth with word-extractor fallback */
async function parseDocxFile(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  try {
    const mammoth = (await import("mammoth")).default;
    const result = await mammoth.extractRawText({ buffer });
    if (result.value && result.value.trim().length > 0) {
      return result.value;
    }
  } catch (e) {
    console.warn(`[Parse] Mammoth failed for ${file.name}, trying word-extractor:`, e);
  }

  try {
    const WordExtractor = (await import("word-extractor")).default;
    const extractor = new WordExtractor();
    const doc = await extractor.extract(buffer);
    const text = doc.getBody();
    if (text && text.trim().length > 0) return text;
  } catch (e) {
    console.error(`[Parse] Word-extractor also failed for .docx ${file.name}:`, e);
  }

  return ""; // Return empty so OCR fallback can run
}

/** Extracts text from legacy .doc files */
async function parseDocFile(file: File): Promise<string> {
  try {
    const WordExtractor = (await import("word-extractor")).default;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const extractor = new WordExtractor();
    const doc = await extractor.extract(buffer);
    const text = doc.getBody();
    if (text && text.trim().length > 0) return text;
    return "";
  } catch (e) {
    console.error(`[Parse] Word-extractor failed for .doc ${file.name}:`, e);
    return "";
  }
}

// ---------------------------------------------------------------------------
// OCR helpers — PDF page rendering via MuPDF (WASM)
// ---------------------------------------------------------------------------

/**
 * Renders PDF pages to JPEG images using MuPDF (pure WASM, no workers).
 * Handles all PDF image compression formats (JPEG, JPEG2000, JBIG2, CCITT, etc.)
 * without the pdfjs LoopbackPort / WASM-memory detachment issues.
 * Returns up to 3 JPEG base64 strings (one per page).
 */
async function extractImagesFromPdf(data: Uint8Array): Promise<string[]> {
  const base64Images: string[] = [];

  try {
    const mupdf = (await import("mupdf")).default;

    const doc = mupdf.Document.openDocument(data, "application/pdf");
    const pageCount = Math.min(doc.countPages(), 3);

    for (let i = 0; i < pageCount; i++) {
      const page = doc.loadPage(i);
      // 2x scale matrix for better OCR quality
      const matrix = mupdf.Matrix.scale(2, 2);
      const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false);
      const jpegBytes = pixmap.asJPEG(85, false);
      base64Images.push(Buffer.from(jpegBytes).toString("base64"));
    }
  } catch (e) {
    console.error("[Parse] MuPDF rendering failed:", e);
  }

  return base64Images;
}

/**
 * Extracts embedded images from a DOCX file by reading it as a ZIP archive.
 * DOCX files store all media in the word/media/ folder. This avoids using
 * mammoth's convertToHtml which crashes on unknown node types in some DOCX files.
 * Returns up to 3 JPEG base64 strings.
 */
async function extractImagesFromDocx(buffer: Buffer): Promise<string[]> {
  const AdmZip = (await import("adm-zip")).default;
  const sharp = (await import("sharp")).default;
  const base64Images: string[] = [];

  try {
    const zip = new AdmZip(buffer);
    const mediaEntries = zip.getEntries().filter(
      (e) => e.entryName.startsWith("word/media/") && !e.isDirectory
    );

    for (const entry of mediaEntries) {
      if (base64Images.length >= 3) break;
      try {
        const imgBuffer = entry.getData();
        const jpegBuffer = await sharp(imgBuffer).jpeg({ quality: 85 }).toBuffer();
        base64Images.push(jpegBuffer.toString("base64"));
      } catch {
        // Skip entries sharp can't process (e.g. WMF, EMF vector graphics)
      }
    }
  } catch (e) {
    console.error("[Parse] DOCX image extraction failed:", e);
  }

  return base64Images;
}

// ---------------------------------------------------------------------------
// Vision OCR via OpenAI
// ---------------------------------------------------------------------------

/**
 * Sends extracted page images to OpenAI vision (gpt-5-mini) and returns the
 * full resume text plus token usage for cost tracking.
 */
async function extractTextViaVisionOCR(base64Images: string[]): Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model: string;
}> {
  if (base64Images.length === 0) {
    throw new Error("No images available for OCR");
  }

  const { getOpenAIClient, MODELS } = await import("@/lib/openai-client");
  const openai = getOpenAIClient();

  const imageContent = base64Images.slice(0, 3).map((b64) => ({
    type: "image_url" as const,
    image_url: {
      url: `data:image/jpeg;base64,${b64}`,
      detail: "high" as const,
    },
  }));

  const response = await openai.chat.completions.create({
    model: MODELS.GPT5_MINI,
    messages: [
      {
        role: "user",
        content: [
          ...imageContent,
          {
            type: "text",
            text: "This is a scanned resume. Extract all text exactly as it appears — name, contact information, work experience, education, skills, and all other content. Return only the extracted text with no additional commentary.",
          },
        ],
      },
    ],
    max_completion_tokens: 4000,
  });

  const text = response.choices[0]?.message?.content || "";

  return {
    text,
    inputTokens: response.usage?.prompt_tokens || 0,
    outputTokens: response.usage?.completion_tokens || 0,
    totalTokens: response.usage?.total_tokens || 0,
    model: MODELS.GPT5_MINI,
  };
}

// ---------------------------------------------------------------------------
// Main server action
// ---------------------------------------------------------------------------

/**
 * Server Action to parse PDF or Word documents.
 * Optimized for resumes that may have complex formatting or be entirely
 * image-based (scanned). When text extraction yields fewer than
 * OCR_MIN_TEXT_LENGTH characters, falls back to OpenAI vision OCR.
 *
 * Optional FormData fields:
 *   organizationId — for cost tracking attribution
 *   userId         — for cost tracking attribution
 */
export async function parsePdf(formData: FormData) {
  const file = formData.get("file") as File;
  const organizationId = (formData.get("organizationId") as string | null) || undefined;
  const userId = (formData.get("userId") as string | null) || undefined;

  if (!file) {
    return { success: false, error: "No file provided" };
  }

  console.log(`[Parse] Starting extraction for: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);

  try {
    let fullText = "";
    let ocrUsed = false;

    // ------------------------------------------------------------------
    // DOCX
    // ------------------------------------------------------------------
    if (isDocxFile(file)) {
      fullText = await parseDocxFile(file);

      if (fullText.trim().length < OCR_MIN_TEXT_LENGTH) {
        console.log(`[Parse] Text too short for ${file.name} (${fullText.trim().length} chars), attempting OCR`);
        try {
          const arrayBuffer = await file.arrayBuffer();
          const images = await extractImagesFromDocx(Buffer.from(arrayBuffer));
          if (images.length > 0) {
            const ocr = await extractTextViaVisionOCR(images);
            fullText = ocr.text;
            ocrUsed = true;
            ApiUsageService.saveOpenAIUsage({
              organizationId,
              userId,
              category: "resume_parsing",
              inputTokens: ocr.inputTokens,
              outputTokens: ocr.outputTokens,
              totalTokens: ocr.totalTokens,
              model: ocr.model,
              metadata: { resumeName: file.name, ocrMethod: "vision", fileType: "docx" },
            }).catch((err) => console.error("[OCR] Failed to save usage:", err));
          }
        } catch (ocrErr) {
          console.error(`[Parse] OCR fallback failed for ${file.name}:`, ocrErr);
        }
      }

    // ------------------------------------------------------------------
    // Legacy DOC
    // ------------------------------------------------------------------
    } else if (isDocFile(file)) {
      fullText = await parseDocFile(file);
      // DOC is binary format — OCR not attempted (extremely rare to be image-only)

    // ------------------------------------------------------------------
    // PDF
    // ------------------------------------------------------------------
    } else if (isPdfFile(file)) {
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      // Preserve a copy before pdfjs — its WASM decoders detach the original ArrayBuffer.
      const uint8ArrayForOCR = new Uint8Array(arrayBuffer.slice(0));

      // Primary: pdfjs-dist
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const loadingTask = pdfjs.getDocument({
          data: uint8Array,
          disableWorker: true,
          useSystemFonts: true,
          disableFontFace: true,
          verbosity: 0,
        } as any);

        const doc = await loadingTask.promise;
        let textContent = "";
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const content = await page.getTextContent();
          // @ts-ignore
          textContent += content.items.map((item: any) => item.str).join(" ") + "\n";
        }
        fullText = textContent;
      } catch (pdfErr: any) {
        console.error(`[Parse] pdfjs-dist failed for ${file.name}:`, pdfErr.message);
      }

      // Fallback: pdf-parse (import via lib path to avoid the test/data ENOENT bug)
      if (!fullText.trim()) {
        try {
          console.log(`[Parse] pdfjs returned empty for ${file.name}, trying pdf-parse fallback`);
          const pdfParse = (await import("pdf-parse/lib/pdf-parse.js" as any)).default;
          const parsed = await pdfParse(Buffer.from(uint8Array));
          fullText = parsed.text || "";
        } catch (fallbackErr: any) {
          console.error(`[Parse] pdf-parse fallback also failed for ${file.name}:`, fallbackErr.message);
        }
      }

      // OCR fallback for image-only (scanned) PDFs
      if (fullText.trim().length < OCR_MIN_TEXT_LENGTH) {
        console.log(`[Parse] Text too short for ${file.name} (${fullText.trim().length} chars), attempting OCR`);
        try {
          const images = await extractImagesFromPdf(uint8ArrayForOCR);
          if (images.length > 0) {
            const ocr = await extractTextViaVisionOCR(images);
            fullText = ocr.text;
            ocrUsed = true;
            ApiUsageService.saveOpenAIUsage({
              organizationId,
              userId,
              category: "resume_parsing",
              inputTokens: ocr.inputTokens,
              outputTokens: ocr.outputTokens,
              totalTokens: ocr.totalTokens,
              model: ocr.model,
              metadata: { resumeName: file.name, ocrMethod: "vision", fileType: "pdf" },
            }).catch((err) => console.error("[OCR] Failed to save usage:", err));
          }
        } catch (ocrErr) {
          console.error(`[Parse] OCR fallback failed for ${file.name}:`, ocrErr);
        }
      }

    } else {
      throw new Error(`Unsupported file type: ${file.type || "unknown"}`);
    }

    const trimmedText = fullText.trim();
    if (!trimmedText) {
      throw new Error(
        "Could not extract text from this file. The document may be empty, password-protected, or in an unsupported format."
      );
    }

    console.log(
      `[Parse] Successfully extracted ${trimmedText.length} characters from ${file.name}` +
        (ocrUsed ? " (via vision OCR)" : "")
    );

    return { success: true, text: trimmedText, ocrUsed };
  } catch (error) {
    console.error(`[Parse] Error processing ${file.name}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to parse document content",
    };
  }
}
