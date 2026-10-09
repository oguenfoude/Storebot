import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

const rawSecret = process.env.API_KEY_ENCRYPTION_SECRET?.trim();
const ENCRYPTION_SECRET = rawSecret ? rawSecret.replace(/^["']|["']$/g, "") : "";

(() => {
  if (!ENCRYPTION_SECRET) {
    throw new Error(
      "API_KEY_ENCRYPTION_SECRET not configured — set it in .env (required for encrypting seller API keys)"
    );
  }
})();

function deriveKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptApiKey(plaintext: string): string {
  const key = deriveKey(ENCRYPTION_SECRET);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    encrypted.toString("base64"),
    authTag.toString("base64"),
  ].join(":");
}

export function decryptApiKey(encrypted: string): string {
  const key = deriveKey(ENCRYPTION_SECRET);
  const parts = encrypted.split(":");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted API key format");
  }

  const iv = Buffer.from(parts[0], "base64");
  const ciphertext = Buffer.from(parts[1], "base64");
  const authTag = Buffer.from(parts[2], "base64");

  if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Invalid encrypted API key components");
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
