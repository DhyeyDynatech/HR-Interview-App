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
// OCR helpers — image extraction (no canvas required)
// ---------------------------------------------------------------------------

/**
 * Extracts embedded raster images from a PDF using pdfjs-dist operator list.
 * Works without a canvas — reads the raw pixel data already decoded by pdfjs,
 * then re-encodes to JPEG via sharp (already in the project).
 * Returns up to 3 JPEG base64 strings (one per unique image per page).
 */
async function extractImagesFromPdf(uint8Array: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const sharp = (await import("sharp")).default;
  const base64Images: string[] = [];

  const doc = await pdfjs.getDocument({
    data: uint8Array,
    disableWorker: true,
    verbosity: 0,
  } as any).promise;

  const OPS = (pdfjs as any).OPS;
  if (!OPS) {
    console.warn("[OCR] pdfjs OPS not available — cannot extract images");
    return base64Images;
  }

  // Process at most 3 pages to keep token usage bounded
  const pageCount = Math.min(doc.numPages, 3);

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await doc.getPage(pageNum);
    const ops = await page.getOperatorList();

    // Collect unique image object names referenced on this page
    const imgNamesSet = new Set<string>();
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] === OPS.paintImageXObject) {
        imgNamesSet.add(ops.argsArray[i][0] as string);
      }
    }
    const imgNames = Array.from(imgNamesSet);

    for (const name of imgNames) {
      try {
        // page.objs.get fires the callback once the image object is ready
        const img: any = await Promise.race([
          new Promise<any>((resolve) => {
            page.objs.get(name, (imgData: any) => resolve(imgData));
          }),
          // Safety timeout — skip if image doesn't load within 8 s
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
        ]);

        if (!img?.data || img.width <= 0 || img.height <= 0) continue;

        const channels = Math.round(img.data.length / (img.width * img.height));
        if (channels < 1 || channels > 4) continue;

        const jpegBuffer = await sharp(Buffer.from(img.data), {
          raw: {
            width: img.width,
            height: img.height,
            channels: channels as 1 | 2 | 3 | 4,
          },
        })
          .jpeg({ quality: 85 })
          .toBuffer();

        base64Images.push(jpegBuffer.toString("base64"));

        // Cap at 3 images total to limit token usage
        if (base64Images.length >= 3) return base64Images;
      } catch (imgErr) {
        console.warn(`[OCR] Could not extract image "${name}" from PDF page ${pageNum}:`, imgErr);
      }
    }
  }

  return base64Images;
}

/**
 * Extracts embedded images from a DOCX file.
 * DOCX files are ZIP archives; mammoth's convertImage hook gives us the raw
 * image bytes for every image in the document without needing a ZIP library.
 * Returns up to 3 JPEG base64 strings.
 */
async function extractImagesFromDocx(buffer: Buffer): Promise<string[]> {
  const mammoth = (await import("mammoth")).default;
  const sharp = (await import("sharp")).default;
  const base64Images: string[] = [];

  await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.inline(async (element: any) => {
        if (base64Images.length >= 3) return { src: "" };
        try {
          const imgBuffer = Buffer.from(await element.read());
          const jpegBuffer = await sharp(imgBuffer).jpeg({ quality: 85 }).toBuffer();
          base64Images.push(jpegBuffer.toString("base64"));
        } catch {
          // Skip images that sharp can't process
        }
        return { src: "" };
      }),
    }
  );

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

  const { getOpenAIClientDirect, DIRECT_MODELS } = await import("@/lib/openai-client");
  const openai = getOpenAIClientDirect();

  const imageContent = base64Images.slice(0, 3).map((b64) => ({
    type: "image_url" as const,
    image_url: {
      url: `data:image/jpeg;base64,${b64}`,
      detail: "high" as const,
    },
  }));

  const response = await openai.chat.completions.create({
    model: DIRECT_MODELS.GPT5_MINI,
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
    max_tokens: 4000,
  });

  const text = response.choices[0]?.message?.content || "";

  return {
    text,
    inputTokens: response.usage?.prompt_tokens || 0,
    outputTokens: response.usage?.completion_tokens || 0,
    totalTokens: response.usage?.total_tokens || 0,
    model: DIRECT_MODELS.GPT5_MINI,
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

      // Fallback: pdf-parse
      if (!fullText.trim()) {
        try {
          console.log(`[Parse] pdfjs returned empty for ${file.name}, trying pdf-parse fallback`);
          const pdfParse = (await import("pdf-parse")).default;
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
          const images = await extractImagesFromPdf(uint8Array);
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
