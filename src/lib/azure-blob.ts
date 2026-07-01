import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  ContainerClient,
} from "@azure/storage-blob";

/**
 * Shared Azure Blob Storage client factory.
 *
 * Both interview recordings and candidate resumes live in the same Azure
 * Storage account (configured via AZURE_STORAGE_ACCOUNT_NAME / _KEY), each in
 * its own container. This helper centralizes the account/credential setup and
 * the env validation that used to live only in the recording upload route.
 */

/**
 * Build a ContainerClient for the given container in the configured Azure
 * Storage account. Throws with a clear message if the env is missing/invalid.
 */
export function getAzureContainerClient(containerName: string): {
  containerClient: ContainerClient;
  account: string;
  container: string;
  endpoint: string;
  credential: StorageSharedKeyCredential;
} {
  // Trim env values — leading/trailing whitespace from .env files is the most
  // common source of "Invalid URL" errors when the SDK builds the endpoint.
  const account = (process.env.AZURE_STORAGE_ACCOUNT_NAME || "").trim();
  const key = (process.env.AZURE_STORAGE_ACCOUNT_KEY || "").trim();
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
  const containerClient = service.getContainerClient(containerName);

  return {
    containerClient,
    account,
    container: containerName,
    endpoint,
    credential,
  };
}

/** Container name for candidate resumes. Overridable via env. */
export function getResumeContainerName(): string {
  return (
    (process.env.AZURE_STORAGE_RESUME_CONTAINER || "").trim() ||
    "interview-resumes"
  );
}

/** Container name for user/candidate images. Overridable via env. */
export function getImageContainerName(): string {
  return (
    (process.env.AZURE_STORAGE_IMAGE_CONTAINER || "").trim() ||
    "interview-images"
  );
}

/** Public URL for a blob at the given path in the given container. */
export function buildBlobUrl(
  account: string,
  container: string,
  blobPath: string,
): string {
  return `https://${account}.blob.core.windows.net/${container}/${blobPath}`;
}
