/**
 * SHA-256 content hash for change detection.
 * Returns a hex string. Async because it uses the Web Crypto API.
 */
export async function hashContent(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const buffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(buffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Accepted file extensions for upload */
export const ACCEPTED_EXTENSIONS = ".md,.csv,.txt,.json,.png,.jpg,.jpeg,.gif,.webp,.docx,.pdf,.pptx";
