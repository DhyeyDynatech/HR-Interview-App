import { NextRequest, NextResponse } from "next/server";
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
} from "@azure/storage-blob";
import { logger } from "@/lib/logger";
import { ResponseService } from "@/services/responses.service";

export const dynamic = "force-dynamic";

// Upload size cap — a 30-min stereo Opus webm is well under this; anything
// bigger is almost certainly a misuse and should be rejected before we burn
// memory or storage on it.
const MAX_BYTES = 200 * 1024 * 1024; // 200 MB

// Window in which a recording upload is accepted after the response row was
// created. Measured from row creation (call start). A long interview plus a
// slow end-of-call save can legitimately push the upload well past the old
// 2-hour cap and get rejected with a 410, silently losing the audio. 6 hours
// keeps the leaked-call_id abuse window bounded while comfortably covering any
// realistic interview length + retry/backoff tail.
const UPLOAD_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours

function getAzureClient() {
  // Trim env values — leading/trailing whitespace from .env files is the
  // most common source of "Invalid URL" errors when the SDK tries to
  // construct the endpoint.
  const account = (process.env.AZURE_STORAGE_ACCOUNT_NAME || "").trim();
  const key = (process.env.AZURE_STORAGE_ACCOUNT_KEY || "").trim();
  const container =
    (process.env.AZURE_STORAGE_CONTAINER || "").trim() ||
    "interview-recordings";
  const endpointOverride = (process.env.AZURE_STORAGE_ENDPOINT || "").trim();

  if (!account || !key) {
    throw new Error(
      "AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCOUNT_KEY must be set",
    );
  }

  // Azure Storage account names: 3-24 chars, lowercase letters + digits only.
  // Anything else makes an invalid subdomain → URL parser rejects.
  if (!/^[a-z0-9]{3,24}$/.test(account)) {
    throw new Error(
      `AZURE_STORAGE_ACCOUNT_NAME "${account}" is invalid — must be 3-24 lowercase letters/digits (no dashes, underscores, or uppercase). Check your .env value.`,
    );
  }

  const endpoint =
    endpointOverride || `https://${account}.blob.core.windows.net`;
  const credential = new StorageSharedKeyCredential(account, key);
  const service = new BlobServiceClient(endpoint, credential);
  const containerClient = service.getContainerClient(container);

  return { containerClient, account, container, endpoint };
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form body" }, { status: 400 });
  }

  const callId = String(form.get("call_id") || "").trim();
  const file = form.get("file");

  if (!callId) {
    return NextResponse.json({ error: "call_id is required" }, { status: 400 });
  }
  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { error: "file (Blob) is required" },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "file is empty" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file exceeds ${MAX_BYTES} bytes` },
      { status: 413 },
    );
  }

  // Authorize by call_id: the row must exist (so register-call issued it) and
  // be recent. Anyone uploading without a valid call_id is rejected.
  const existing = await ResponseService.getResponseByCallId(callId);
  if (!existing) {
    return NextResponse.json({ error: "Unknown call_id" }, { status: 404 });
  }
  const createdAt = existing.created_at
    ? new Date(existing.created_at).getTime()
    : 0;
  if (createdAt && Date.now() - createdAt > UPLOAD_WINDOW_MS) {
    return NextResponse.json(
      { error: "Upload window expired" },
      { status: 410 },
    );
  }

  // Pick content type + extension. We only mint webm here, but be permissive.
  const contentType = file.type || "audio/webm";
  const ext = contentType.includes("wav")
    ? "wav"
    : contentType.includes("mp4")
      ? "mp4"
      : "webm";

  const interviewId = existing.interview_id || "unknown";
  const blobPath = `${interviewId}/${callId}.${ext}`;

  try {
    const { containerClient, account, container } = getAzureClient();
    // Create container on first use. Public read so the URL slots directly
    // into the existing <audio src> player without a signing round-trip.
    // Flip to "private" + SAS-signing later if leak risk becomes a concern.
    await containerClient.createIfNotExists({ access: "blob" });

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const blockBlob = containerClient.getBlockBlobClient(blobPath);
    await blockBlob.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: contentType },
    });

    const url = `https://${account}.blob.core.windows.net/${container}/${blobPath}`;

    logger.info("Recording uploaded to Azure Blob", {
      call_id: callId,
      size: file.size,
      path: blobPath,
    });

    return NextResponse.json(
      {
        success: true,
        recording_url: url,
        bytes: file.size,
      },
      { status: 200 },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // Include account name + endpoint in the log so we can tell whether the
    // problem is env-config or network/auth. Never log the account key.
    const accountForLog = (process.env.AZURE_STORAGE_ACCOUNT_NAME || "").trim();
    const endpointForLog =
      (process.env.AZURE_STORAGE_ENDPOINT || "").trim() ||
      `https://${accountForLog}.blob.core.windows.net`;
    logger.error(
      `Azure Blob upload failed: ${detail} | account="${accountForLog}" endpoint="${endpointForLog}"`,
    );

    return NextResponse.json(
      {
        error: "Upload failed",
        details: detail,
      },
      { status: 500 },
    );
  }
}
