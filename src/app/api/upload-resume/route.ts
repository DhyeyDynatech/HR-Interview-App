import { NextRequest, NextResponse } from "next/server";
import { put, head } from '@vercel/blob';
import { createClient } from "@supabase/supabase-js";
import { ApiUsageService } from "@/services/api-usage.service";

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
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
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));

    if (ext === '.docx' || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const mammoth = (await import("mammoth")).default;
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }

    if (ext === '.doc' || file.type === 'application/msword') {
      const WordExtractor = (await import("word-extractor")).default;
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const extractor = new WordExtractor();
      const doc = await extractor.extract(buffer);
      return doc.getBody();
    }

    if (ext === '.pdf' || file.type === 'application/pdf') {
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
  try {
    const formData = await request.formData();
    const file = formData.get("resume") as File;
    const organizationId = formData.get("organizationId") as string | null;
    const userId = formData.get("userId") as string | null;

    console.log('Resume upload API called, file received:', file ? `${file.name} (${file.size} bytes)` : 'null');

    if (!file) {
      console.error('No file provided in formData');
      return NextResponse.json(
        { error: "No resume file provided" },
        { status: 400 }
      );
    }

    // Validate file type - PDF or Word
    const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'];
    const allowedExts = ['.pdf', '.doc', '.docx'];
    const fileExt = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
    if (!allowedTypes.includes(file.type) && !allowedExts.includes(fileExt)) {
      return NextResponse.json(
        { error: "Only PDF and Word files are allowed for resumes" },
        { status: 400 }
      );
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "Resume file size must be less than 10MB" },
        { status: 400 }
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

    if (candidateEmail && (organizationId || userId)) {
      try {
        const supabase = getSupabaseClient();
        const orgId = organizationId || userId;

        const { data: existingByEmail } = await supabase
          .from("interview_assignee")
          .select("id, first_name, last_name, email")
          .eq("organization_id", orgId)
          .ilike("email", candidateEmail)
          .not("email", "is", null)
          .limit(1);

        if (existingByEmail && existingByEmail.length > 0) {
          const existing = existingByEmail[0];
          console.log(`[Resume Dedup] Duplicate email detected: "${candidateEmail}" already exists (assignee id=${existing.id}).`);
          return NextResponse.json(
            {
              error: `A candidate with email "${candidateEmail}" already exists in this organization.`,
              isDuplicate: true,
              duplicateEmail: candidateEmail,
              existingCandidate: {
                id: existing.id,
                name: `${existing.first_name || ''} ${existing.last_name || ''}`.trim(),
                email: existing.email,
              },
            },
            { status: 409 }
          );
        }
      } catch (err) {
        // If email duplicate check fails, log and continue — don't block upload
        console.error("[Resume Dedup] Email duplicate check failed, proceeding:", err);
      }
    }

    // -------------------------------------------------------------------------
    // Determine storage filename.
    // If a candidate email was extracted, store the resume keyed by email so
    // the same candidate always maps to the same Blob path.
    // Fallback: use the sanitized original filename.
    // -------------------------------------------------------------------------
    const baseName = file.name.split('/').pop() || file.name;
    const fileExtension = baseName.slice(baseName.lastIndexOf('.')) || fileExt;
    const sanitizedName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_');

    // Build the blob filename: prefer email-based key, fall back to original name.
    // Always preserve file extension so Office Online / PDF viewers can identify the file type.
    const emailKey = candidateEmail
      ? candidateEmail.replace(/[^a-zA-Z0-9@._-]/g, '_') + fileExtension // e.g. "john.doe@example.com.docx"
      : sanitizedName;
    const fileName = `resumes/${emailKey}`;

    // Check if blob already exists in Vercel Blob — skip upload if so
    try {
      const existing = await head(fileName);
      if (existing && existing.url) {
        console.log(`[Resume Dedup] Blob already exists at "${fileName}". Reusing URL: ${existing.url}`);
        return NextResponse.json({ resumeUrl: existing.url }, { status: 200 });
      }
    } catch {
      // head() throws if blob doesn't exist — proceed with upload
    }

    console.log('Uploading resume to Vercel Blob:', fileName);

    // Upload to Vercel Blob Storage
    const blob = await put(fileName, file, {
      access: 'public',
      addRandomSuffix: false,
    });

    console.log('Resume uploaded successfully to Vercel Blob:', blob.url);

    // Track blob upload for cost analysis
    ApiUsageService.saveBlobUploadUsage({
      organizationId: organizationId || undefined,
      userId: userId || undefined,
      fileSizeBytes: file.size,
      fileType: 'resume',
      metadata: {
        fileName: fileName,
        url: blob.url,
        originalName: file.name,
      },
    }).catch((err) => {
      console.error("Failed to save blob upload usage", err);
    });

    return NextResponse.json({ resumeUrl: blob.url }, { status: 200 });
  } catch (error) {
    console.error("Resume upload error:", error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to upload resume" },
      { status: 500 }
    );
  }
}
