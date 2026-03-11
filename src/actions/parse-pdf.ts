"use server";

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

async function parseDocxFile(file: File): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function parseDocFile(file: File): Promise<string> {
  const WordExtractor = (await import("word-extractor")).default;
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const extractor = new WordExtractor();
  const doc = await extractor.extract(buffer);
  return doc.getBody();
}

export async function parsePdf(formData: FormData) {
  try {
    const file = formData.get("file") as File;

    if (!file) {
      throw new Error("No file provided");
    }

    let fullText = "";

    if (isDocxFile(file)) {
      fullText = await parseDocxFile(file);
    } else if (isDocFile(file)) {
      fullText = await parseDocFile(file);
    } else if (isPdfFile(file)) {
      const { PDFLoader } = await import("langchain/document_loaders/fs/pdf");
      const loader = new PDFLoader(file);
      const docs = await loader.load();
      fullText = docs.map((doc) => doc.pageContent).join("\n");
    } else {
      throw new Error("Unsupported file type. Please upload a PDF or Word document.");
    }

    return {
      success: true,
      text: fullText,
    };
  } catch (error) {
    console.error("Error parsing document:", error);

    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to parse document",
    };
  }
}
