import { NextRequest, NextResponse } from "next/server";
import { ApiUsageService } from "@/services/api-usage.service";
import { verifyToken, getUserById } from "@/lib/auth";
import {
  getAzureContainerClient,
  getResumeContainerName,
  buildBlobUrl,
} from "@/lib/azure-blob";

async function extractAuth(request: NextRequest) {
  // Accept the token from EITHER the Authorization header OR the auth_token
  // cookie. The dashboard uploads via a plain fetch() with no Authorization
  // header, relying on the cookie the browser sends automatically (same as the
  // middleware, which checks cookie-or-header). A header-only check here caused
  // a 401 "Unauthorized" on every dashboard resume/image upload.
  const authHeader = request.headers.get("authorization");
  const headerToken =
    authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.substring(7)
      : null;
  const cookieToken = request.cookies.get("auth_token")?.value || null;
  const token = headerToken || cookieToken;
  if (!token) return null;
  const { valid, userId } = verifyToken(token);
  if (!valid || !userId) return null;
  const user = await getUserById(userId);
  if (!user || !user.organization_id) return null;
  return { userId, organizationId: user.organization_id };
}

/** Extract all email addresses from plain text. Returns the first one found. */
function extractEmailFromText(text: string): string | null {
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(emailRegex);
  return matches ? matches[0].toLowerCase() : null;
}

/** Parse resume file to plain text (PDF, DOCX, DOC). Returns null on failure. */
async function extractTextFromResume(file: File): Promise<string | null> {
  try {
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));

    if (
      ext === ".docx" ||
      file.type ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const mammoth = (await import("mammoth")).default;
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }

    if (ext === ".doc" || file.type === "application/msword") {
      const WordExtractor = (await import("word-extractor")).default;
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const extractor = new WordExtractor();
      const doc = await extractor.extract(buffer);
      return doc.getBody();
    }

    if (ext === ".pdf" || file.type === "application/pdf") {
      const { PDFLoader } = await import("langchain/document_loaders/fs/pdf");
      const loader = new PDFLoader(file);
      const docs = await loader.load();
      return docs.map((doc) => doc.pageContent).join("\n");
    }

    return null;
  } catch (err) {
    console.error("[Resume Parse] Failed to extract text:", err);
    return null;
  }
}

export async function POST(request: NextRequest) {
  const auth = await extractAuth(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("resume") as File;

    console.log(
      "Resume upload API called, file received:",
      file ? `${file.name} (${file.size} bytes)` : "null",
    );

    if (!file) {
      console.error("No file provided in formData");
      return NextResponse.json(
        { error: "No resume file provided" },
        { status: 400 },
      );
    }

    // Validate file type - PDF or Word
    const allowedTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ];
    const allowedExts = [".pdf", ".doc", ".docx"];
    const fileExt = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    if (!allowedTypes.includes(file.type) && !allowedExts.includes(fileExt)) {
      return NextResponse.json(
        { error: "Only PDF and Word files are allowed for resumes" },
        { status: 400 },
      );
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "Resume file size must be less than 10MB" },
        { status: 400 },
      );
    }

    // -------------------------------------------------------------------------
    // Email-based duplicate detection
    // Parse the resume text, extract the candidate email, and check whether
    // any existing record in interview_assignee already has that email.
    // This catches duplicates regardless of filename.
    // -------------------------------------------------------------------------
    const resumeText = await extractTextFromResume(file);
    const candidateEmail = resumeText ? extractEmailFromText(resumeText) : null;

    // Email duplicate check skipped — same candidate can re-upload updated resume.

    // -------------------------------------------------------------------------
    // Determine storage filename.
    // If a candidate email was extracted, store the resume keyed by email so
    // the same candidate always maps to the same Blob path.
    // Fallback: use the sanitized original filename.
    // -------------------------------------------------------------------------
    const baseName = file.name.split("/").pop() || file.name;
    const fileExtension = baseName.slice(baseName.lastIndexOf(".")) || fileExt;
    const sanitizedName = baseName.replace(/[^a-zA-Z0-9._-]/g, "_");

    // Build the blob filename: prefer email-based key, fall back to original name.
    // Always preserve file extension so Office Online / PDF viewers can identify the file type.
    const emailKey = candidateEmail
      ? candidateEmail.replace(/[^a-zA-Z0-9@._-]/g, "_") // e.g. "john.doe@example.com"
      : sanitizedName;
    // Keep the extension on the blob so viewers (Office Online / PDF) can
    // identify the file type — Vercel Blob preserved it via the original name;
    // our email-based key had none, so append it explicitly here.
    const blobPath = `resumes/${emailKey}${fileExtension}`;

    // Resolve the shared Azure Storage account + resume container.
    const { containerClient, account, container } = getAzureContainerClient(
      getResumeContainerName(),
    );
    // Public read so the URL slots directly into resume viewers without a
    // signing round-trip (matches how recordings + the old Vercel Blob worked).
    await containerClient.createIfNotExists({ access: "blob" });

    const blockBlob = containerClient.getBlockBlobClient(blobPath);
    const resumeUrl = buildBlobUrl(account, container, blobPath);

    console.log("Checking if resume already exists in Azure Blob:", blobPath);

    // If a blob already exists at this path, reuse it — same candidate always
    // maps to the same path, so this dedupes re-uploads by email.
    const alreadyExists = await blockBlob.exists();
    if (alreadyExists) {
      console.log("Resume already exists in Azure Blob, reusing:", resumeUrl);
      return NextResponse.json({ resumeUrl }, { status: 200 });
    }

    console.log("Uploading resume to Azure Blob:", blobPath);

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await blockBlob.uploadData(buffer, {
      blobHTTPHeaders: {
        blobContentType: file.type || "application/octet-stream",
      },
    });

    console.log("Resume uploaded successfully to Azure Blob:", resumeUrl);

    // Track blob upload for cost analysis
    ApiUsageService.saveBlobUploadUsage({
      organizationId: auth.organizationId,
      userId: auth.userId,
      fileSizeBytes: file.size,
      fileType: "resume",
      metadata: {
        fileName: blobPath,
        url: resumeUrl,
        originalName: file.name,
      },
    }).catch((err) => {
      console.error("Failed to save blob upload usage", err);
    });

    return NextResponse.json({ resumeUrl }, { status: 200 });
  } catch (error) {
    console.error("Resume upload error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to upload resume",
      },
      { status: 500 },
    );
  }
}
