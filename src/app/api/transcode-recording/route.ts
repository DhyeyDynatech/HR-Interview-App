import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { unlink, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
} from "@azure/storage-blob";
import { logger } from "@/lib/logger";
import { ResponseService } from "@/services/responses.service";

export const dynamic = "force-dynamic";
// Must run on the Node.js runtime — spawn()/child_process and the ffmpeg-static
// binary are unavailable on the Edge runtime.
export const runtime = "nodejs";
// Transcoding a full recording can take a while for long interviews. Bound the
// function generously — the ffmpeg step itself is fast (audio-only, copy-ish
// bitrate) but the download + upload of the file dominate. Must fit the plan's
// serverless ceiling (300 on Vercel Pro; drop to 60 on Hobby).
export const maxDuration = 300;

// Guard against absurd inputs. A 30-min mono Opus webm is a few MB; anything
// past this is not a real interview recording and shouldn't be transcoded.
const MAX_BYTES = 200 * 1024 * 1024; // 200 MB

function getAzureClient() {
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
  if (!/^[a-z0-9]{3,24}$/.test(account)) {
    throw new Error(`AZURE_STORAGE_ACCOUNT_NAME "${account}" is invalid`);
  }

  const endpoint =
    endpointOverride || `https://${account}.blob.core.windows.net`;
  const credential = new StorageSharedKeyCredential(account, key);
  const service = new BlobServiceClient(endpoint, credential);
  const containerClient = service.getContainerClient(container);

  return { containerClient, account, container };
}

/**
 * Run ffmpeg to convert a webm/opus (or mp4) buffer to MP3. Unlike the
 * streamed MediaRecorder webm — which has no seek index (Cues) and so can't be
 * seeked in the browser — MP3 is universally seekable and playable, which is
 * the whole point of this route.
 *
 * We go through temp files rather than pure stdio pipes because ffmpeg needs to
 * seek within the input to read the webm structure, and a non-seekable stdin
 * pipe makes that unreliable for these headerless streaming files.
 */
async function transcodeToMp3(input: Buffer, callId: string): Promise<Buffer> {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static binary path not resolved");
  }
  const stamp = callId.replace(/[^a-zA-Z0-9_-]/g, "");
  const inPath = join(tmpdir(), `rec-${stamp}-in`);
  const outPath = join(tmpdir(), `rec-${stamp}-out.mp3`);

  await writeFile(inPath, input);
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegPath as string, [
        "-y", // overwrite output
        "-i",
        inPath,
        "-vn", // no video
        "-ac",
        "1", // mono — matches the recording graph
        "-c:a",
        "libmp3lame",
        "-b:a",
        "64k", // small; speech-quality
        outPath,
      ]);
      let stderr = "";
      proc.stderr.on("data", (d) => {
        stderr += d.toString();
      });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
      });
    });

    return await readFile(outPath);
  } finally {
    // Best-effort temp cleanup — never let a cleanup failure mask the result.
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const callId = String(body.call_id || "").trim();
  if (!callId) {
    return NextResponse.json({ error: "call_id is required" }, { status: 400 });
  }

  // Authorize + locate the source recording via the response row, exactly like
  // the upload route. The source webm URL is whatever's currently on the row.
  const row = await ResponseService.getResponseByCallId(callId);
  if (!row) {
    return NextResponse.json({ error: "Unknown call_id" }, { status: 404 });
  }
  const sourceUrl: string | undefined = row.details?.recording_url;
  if (!sourceUrl) {
    return NextResponse.json(
      { error: "No recording_url on this response to transcode" },
      { status: 400 },
    );
  }
  // Idempotency: if it's already an mp3, there's nothing to do.
  if (sourceUrl.toLowerCase().endsWith(".mp3")) {
    return NextResponse.json(
      { success: true, recording_url: sourceUrl, alreadyMp3: true },
      { status: 200 },
    );
  }

  try {
    // 1. Download the finished source recording.
    const srcRes = await fetch(sourceUrl);
    if (!srcRes.ok) {
      throw new Error(
        `Failed to fetch source recording: HTTP ${srcRes.status}`,
      );
    }
    const srcBuf = Buffer.from(await srcRes.arrayBuffer());
    if (srcBuf.length === 0) {
      return NextResponse.json(
        { error: "Source recording is empty" },
        { status: 400 },
      );
    }
    if (srcBuf.length > MAX_BYTES) {
      return NextResponse.json(
        { error: `Source exceeds ${MAX_BYTES} bytes` },
        { status: 413 },
      );
    }

    // 2. Transcode to MP3.
    const mp3 = await transcodeToMp3(srcBuf, callId);

    // 3. Upload the MP3 alongside the webm (same folder, .mp3 extension).
    const interviewId = row.interview_id || "unknown";
    const mp3Path = `${interviewId}/${callId}.mp3`;
    const { containerClient, account, container } = getAzureClient();
    await containerClient.createIfNotExists({ access: "blob" });
    const blockBlob = containerClient.getBlockBlobClient(mp3Path);
    await blockBlob.uploadData(mp3, {
      blobHTTPHeaders: { blobContentType: "audio/mpeg" },
    });
    const mp3Url = `https://${account}.blob.core.windows.net/${container}/${mp3Path}`;

    // 4. Point the row at the MP3. Keep the original webm URL under
    //    recording_url_webm so nothing is lost and we can re-run if needed.
    const mergedDetails = {
      ...(row.details || {}),
      recording_url: mp3Url,
      recording_url_webm: sourceUrl,
      recording_status: "uploaded",
    };
    await ResponseService.saveResponse({ details: mergedDetails }, callId);

    logger.info("Recording transcoded to MP3", {
      call_id: callId,
      mp3_bytes: mp3.length,
      path: mp3Path,
    });

    return NextResponse.json(
      { success: true, recording_url: mp3Url },
      { status: 200 },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error(`Recording transcode failed for ${callId}: ${detail}`);

    // Non-fatal to the interview — the webm is still on the row and plays via
    // the blob-download fallback. Surface a 500 so the trigger can retry.
    return NextResponse.json(
      { error: "Transcode failed", details: detail },
      { status: 500 },
    );
  }
}
