import { NextRequest, NextResponse } from "next/server";
import { ApiUsageService } from "@/services/api-usage.service";
import { verifyToken, getUserById } from "@/lib/auth";
import {
  getAzureContainerClient,
  getImageContainerName,
  buildBlobUrl,
} from "@/lib/azure-blob";

async function extractAuth(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.substring(7);
  const { valid, userId } = verifyToken(token);
  if (!valid || !userId) return null;
  const user = await getUserById(userId);
  if (!user || !user.organization_id) return null;
  return { userId, organizationId: user.organization_id };
}

export async function POST(request: NextRequest) {
  const auth = await extractAuth(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("userImage") as File;

    console.log(
      "Upload API called, file received:",
      file ? `${file.name} (${file.size} bytes)` : "null",
    );

    if (!file) {
      console.error("No file provided in formData");
      return NextResponse.json(
        { error: "No image file provided" },
        { status: 400 },
      );
    }

    const blobPath = `user-images/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

    // Store in the shared Azure Storage account, in the images container.
    const { containerClient, account, container } = getAzureContainerClient(
      getImageContainerName(),
    );
    // Public read so <img src> resolves the URL directly (matches how the old
    // Vercel Blob public access worked).
    await containerClient.createIfNotExists({ access: "blob" });

    const blockBlob = containerClient.getBlockBlobClient(blobPath);
    const imageUrl = buildBlobUrl(account, container, blobPath);

    console.log("Uploading file to Azure Blob:", blobPath);

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await blockBlob.uploadData(buffer, {
      blobHTTPHeaders: {
        blobContentType: file.type || "application/octet-stream",
      },
    });

    console.log("File uploaded successfully to Azure Blob:", imageUrl);

    ApiUsageService.saveBlobUploadUsage({
      organizationId: auth.organizationId,
      userId: auth.userId,
      fileSizeBytes: file.size,
      fileType: "image",
      metadata: {
        fileName: blobPath,
        url: imageUrl,
        originalName: file.name,
      },
    }).catch((err) => {
      console.error("Failed to save blob upload usage", err);
    });

    return NextResponse.json({ imageUrl }, { status: 200 });
  } catch (error) {
    console.error("Image upload error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to upload image",
      },
      { status: 500 },
    );
  }
}
