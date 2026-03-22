"use server";

// Utility to check file extensions
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

  throw new Error(`Text extraction failed for ${file.name}`);
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
    throw new Error("Empty body extracted");
  } catch (e) {
    console.error(`[Parse] Word-extractor failed for .doc ${file.name}:`, e);
    throw new Error(`Failed to extract text from legacy Word doc: ${file.name}`);
  }
}

/** 
 * Server Action to parse PDF or Word documents.
 * Optimized for resumes which might have complex formatting or legacy structures.
 */
export async function parsePdf(formData: FormData) {
  const file = formData.get("file") as File;
  
  if (!file) {
    return { success: false, error: "No file provided" };
  }

  console.log(`[Parse] Starting extraction for: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);

  try {
    let fullText = "";

    if (isDocxFile(file)) {
      fullText = await parseDocxFile(file);
    } else if (isDocFile(file)) {
      fullText = await parseDocFile(file);
    } else if (isPdfFile(file)) {
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      
      try {
        // Use pdfjs-dist legacy build for better Node.js compatibility
        // pdfjs-dist is externalized in next.config.js to prevent bundling issues
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

        // Disable worker to avoid standard Next.js bundling issues with workers
        // We cast to any because disableWorker is sometimes missing from types but useful at runtime
        const loadingTask = pdfjs.getDocument({
          data: uint8Array,
          disableWorker: true,
          useSystemFonts: true,
          disableFontFace: true,
          verbosity: 0
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
        // Fall through to pdf-parse fallback below
      }

      // Fallback: pdf-parse handles fonts/encodings that pdfjs-dist sometimes misses
      if (!fullText.trim()) {
        try {
          console.log(`[Parse] pdfjs returned empty for ${file.name}, trying pdf-parse fallback`);
          const pdfParse = (await import("pdf-parse")).default;
          const parsed = await pdfParse(Buffer.from(uint8Array));
          fullText = parsed.text || "";
        } catch (fallbackErr: any) {
          console.error(`[Parse] pdf-parse fallback also failed for ${file.name}:`, fallbackErr.message);
          throw new Error(`PDF extraction failed: ${fallbackErr.message}`);
        }
      }
    } else {
      const fileType = file.type || "unknown";
      throw new Error(`Unsupported file type: ${fileType}`);
    }

    const trimmedText = fullText.trim();
    if (!trimmedText) {
      throw new Error("Extracted text is empty. The file might be scanned (image-only) or protected.");
    }

    console.log(`[Parse] Successfully extracted ${trimmedText.length} characters from ${file.name}`);

    return {
      success: true,
      text: trimmedText,
    };
  } catch (error) {
    console.error(`[Parse] Error processing ${file.name}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to parse document content",
    };
  }
}
