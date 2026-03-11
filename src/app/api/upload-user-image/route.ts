import { NextRequest, NextResponse } from "next/server";
import { put } from '@vercel/blob';
import { ApiUsageService } from "@/services/api-usage.service";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("userImage") as File;
    const organizationId = formData.get("organizationId") as string | null;
    const userId = formData.get("userId") as string | null;

    console.log('Upload API called, file received:', file ? `${file.name} (${file.size} bytes)` : 'null');

    if (!file) {
      console.error('No file provided in formData');

      return NextResponse.json(
        { error: "No image file provided" },
        { status: 400 }
      );
    }

    // Generate unique filename
    const fileName = `user-images/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    console.log('Uploading file to Vercel Blob:', fileName);

    // Upload to Vercel Blob Storage
    const blob = await put(fileName, file, {
      access: 'public',
      addRandomSuffix: false,
    });

    console.log('File uploaded successfully to Vercel Blob:', blob.url);

    // Track blob upload for cost analysis
    ApiUsageService.saveBlobUploadUsage({
      organizationId: organizationId || undefined,
      userId: userId || undefined,
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

