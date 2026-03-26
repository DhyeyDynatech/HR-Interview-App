import { NextRequest, NextResponse } from "next/server";
import { put } from '@vercel/blob';
import { ApiUsageService } from "@/services/api-usage.service";
import { verifyToken, getUserById } from "@/lib/auth";

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

    console.log('Upload API called, file received:', file ? `${file.name} (${file.size} bytes)` : 'null');

    if (!file) {
      console.error('No file provided in formData');
      return NextResponse.json({ error: "No image file provided" }, { status: 400 });
    }

    const fileName = `user-images/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    console.log('Uploading file to Vercel Blob:', fileName);

    const blob = await put(fileName, file, {
      access: 'public',
      addRandomSuffix: false,
    });

    console.log('File uploaded successfully to Vercel Blob:', blob.url);

    ApiUsageService.saveBlobUploadUsage({
      organizationId: auth.organizationId,
      userId: auth.userId,
      fileSizeBytes: file.size,
      fileType: 'image',
      metadata: {
        fileName: fileName,
        url: blob.url,
        originalName: file.name,
      },
    }).catch((err) => {
      console.error("Failed to save blob upload usage", err);
    });

    return NextResponse.json({ imageUrl: blob.url }, { status: 200 });
  } catch (error) {
    console.error("Image upload error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to upload image" },
      { status: 500 }
    );
  }
}
