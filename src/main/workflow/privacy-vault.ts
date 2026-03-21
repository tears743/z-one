/**
 * Z-One Privacy Vault — Per-device encrypted storage with security Q&A verification.
 *
 * Security model:
 * - Each device has an isolated vault directory
 * - Data encrypted with AES-256-GCM (symmetric, for speed)
 * - Security answers encrypted with RSA-2048 (asymmetric)
 * - Per-device RSA key pair stored in the device's vault directory
 * - Access grants are scoped to a single agent iteration (auto-revoke)
 */

import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { logger } from "../logger";
import { getAppSettings } from "../db";
import { NativeTool } from "../execution/tool-registry";
import { userInteractionBridge } from "../execution/tools/native/user-interaction";

// ─── Encryption Utilities ───────────────────────────────────────────────────

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;

function deriveKey(deviceId: string, masterSecret: string): Buffer {
  return crypto.pbkdf2Sync(
    `${masterSecret}:${deviceId}`,
    "z-one-vault-salt",
    100000,
    KEY_LENGTH,
    "sha512",
  );
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
}

function decrypt(encryptedData: string, key: Buffer): string {
  const parts = encryptedData.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted data format");
  const iv = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const ciphertext = parts[2];
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/** Encrypt security answer with RSA public key */
function rsaEncryptAnswer(answer: string, publicKey: string): string {
  const buffer = Buffer.from(answer.trim().toLowerCase(), "utf-8");
  const encrypted = crypto.publicEncrypt(
    { key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
    buffer,
  );
  return encrypted.toString("base64");
}

/** Decrypt security answer with RSA private key for verification */
function rsaDecryptAnswer(encryptedAnswer: string, privateKey: string): string {
  const buffer = Buffer.from(encryptedAnswer, "base64");
  const decrypted = crypto.privateDecrypt(
    { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
    buffer,
  );
  return decrypted.toString("utf-8");
}

/** Generate RSA key pair for a device */
function generateKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
}

// ─── Vault Entry Types ──────────────────────────────────────────────────────

interface VaultEntry {
  label: string;
  encryptedValue: string;
  securityQuestion: string;
  /** RSA-encrypted security answer (base64) */
  encryptedAnswer: string;
  createdAt: number;
}

interface VaultFile {
  deviceId: string;
  entries: Record<string, VaultEntry>;
}

interface AccessGrant {
  deviceId: string;
  label: string;
  iterationId: string;
  grantedAt: number;
}

// ─── Privacy Vault Class ────────────────────────────────────────────────────

export class PrivacyVault {
  /** Master secret for key derivation (in production, use a secure source) */
  private masterSecret: string;
  /** Active access grants (scoped to iteration) */
  private activeGrants: Map<string, AccessGrant> = new Map();

  constructor(masterSecret?: string) {
    // Use a device-unique secret. In production, derive from OS keychain.
    this.masterSecret = masterSecret || "z-one-vault-default-secret-" + (process.env.USER || "user");
  }

  private getVaultDir(): string {
    const settings = getAppSettings();
    const workspaceRoot =
      settings?.general?.agentWorkspace || path.join(process.cwd(), "workspace");
    return path.join(workspaceRoot, "privacy");
  }

  private getDeviceVaultPath(deviceId: string): string {
    const safeDeviceId = deviceId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.getVaultDir(), `device_${safeDeviceId}`, "vault.json");
  }

  private getKeyPairPath(deviceId: string): { pubPath: string; privPath: string } {
    const safeDeviceId = deviceId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const dir = path.join(this.getVaultDir(), `device_${safeDeviceId}`);
    return { pubPath: path.join(dir, "public.pem"), privPath: path.join(dir, "private.pem") };
  }

  private getAccessLogPath(deviceId: string): string {
    const safeDeviceId = deviceId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.getVaultDir(), `device_${safeDeviceId}`, "access.log");
  }

  private async ensureDeviceDir(deviceId: string) {
    const dir = path.dirname(this.getDeviceVaultPath(deviceId));
    await fs.mkdir(dir, { recursive: true });
  }

  private async loadVault(deviceId: string): Promise<VaultFile> {
    const vaultPath = this.getDeviceVaultPath(deviceId);
    try {
      const content = await fs.readFile(vaultPath, "utf-8");
      return JSON.parse(content);
    } catch {
      return { deviceId, entries: {} };
    }
  }

  private async saveVault(vault: VaultFile) {
    await this.ensureDeviceDir(vault.deviceId);
    const vaultPath = this.getDeviceVaultPath(vault.deviceId);
    await fs.writeFile(vaultPath, JSON.stringify(vault, null, 2), "utf-8");
  }

  private async logAccess(deviceId: string, label: string, granted: boolean) {
    await this.ensureDeviceDir(deviceId);
    const logPath = this.getAccessLogPath(deviceId);
    const entry = `[${new Date().toISOString()}] ${granted ? "✅ GRANTED" : "❌ DENIED"} access to "${label}"\n`;
    await fs.appendFile(logPath, entry, "utf-8");
  }

  /** Get or create RSA key pair for a device */
  private async getOrCreateKeyPair(deviceId: string): Promise<{ publicKey: string; privateKey: string }> {
    await this.ensureDeviceDir(deviceId);
    const { pubPath, privPath } = this.getKeyPairPath(deviceId);

    try {
      const publicKey = await fs.readFile(pubPath, "utf-8");
      const privateKey = await fs.readFile(privPath, "utf-8");
      return { publicKey, privateKey };
    } catch {
      // Generate new key pair
      const keys = generateKeyPair();
      await fs.writeFile(pubPath, keys.publicKey, "utf-8");
      await fs.writeFile(privPath, keys.privateKey, { encoding: "utf-8", mode: 0o600 });
      logger.info(`[PrivacyVault] Generated RSA key pair for device ${deviceId}`);
      return keys;
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────

  /**
   * Store a piece of private data with a security question.
   */
  async store(
    deviceId: string,
    label: string,
    value: string,
    securityQuestion: string,
    securityAnswer: string,
  ): Promise<void> {
    const aesKey = deriveKey(deviceId, this.masterSecret);
    const encryptedValue = encrypt(value, aesKey);

    // Encrypt answer with RSA public key
    const { publicKey } = await this.getOrCreateKeyPair(deviceId);
    const encryptedAnswer = rsaEncryptAnswer(securityAnswer, publicKey);

    const vault = await this.loadVault(deviceId);
    vault.entries[label] = {
      label,
      encryptedValue,
      securityQuestion,
      encryptedAnswer,
      createdAt: Date.now(),
    };
    await this.saveVault(vault);
    await this.logAccess(deviceId, label, true);

    logger.info(`[PrivacyVault] Stored "${label}" for device ${deviceId}`);
  }

  /**
   * Request access to private data. Triggers user verification.
   * Returns the decrypted value if verification passes, null otherwise.
   */
  async requestAccess(
    deviceId: string,
    label: string,
    iterationId: string,
  ): Promise<{ granted: boolean; value?: string }> {
    // Check for existing valid grant
    const grantKey = `${deviceId}:${label}`;
    const existingGrant = this.activeGrants.get(grantKey);
    if (existingGrant && existingGrant.iterationId === iterationId) {
      // Already granted for this iteration
      const vault = await this.loadVault(deviceId);
      const entry = vault.entries[label];
      if (entry) {
        const key = deriveKey(deviceId, this.masterSecret);
        return { granted: true, value: decrypt(entry.encryptedValue, key) };
      }
    }

    const vault = await this.loadVault(deviceId);
    const entry = vault.entries[label];
    if (!entry) {
      return { granted: false };
    }

    // Ask user for security answer via ask_user tool bridge
    const requestId = `privacy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // Emit the question to the device
    userInteractionBridge.emit("ask_user", {
      requestId,
      deviceId,
      message: `🔐 需要访问你的隐私数据 [${label}]\n请回答安全问题: ${entry.securityQuestion}`,
      waitForReply: true,
    });

    // Wait for reply
    const reply = await new Promise<string | null>((resolve) => {
      const replyEvent = `user_reply:${deviceId}:${requestId}`;
      const timer = setTimeout(() => {
        userInteractionBridge.removeAllListeners(replyEvent);
        resolve(null);
      }, 5 * 60 * 1000); // 5 min timeout

      userInteractionBridge.once(replyEvent, (answer: string) => {
        clearTimeout(timer);
        resolve(answer);
      });
    });

    if (!reply) {
      await this.logAccess(deviceId, label, false);
      return { granted: false };
    }

    // Verify answer using RSA decryption
    const { privateKey } = await this.getOrCreateKeyPair(deviceId);
    try {
      const storedAnswer = rsaDecryptAnswer(entry.encryptedAnswer, privateKey);
      if (reply.trim().toLowerCase() !== storedAnswer) {
        await this.logAccess(deviceId, label, false);
        logger.info(`[PrivacyVault] Verification failed for "${label}" on device ${deviceId}`);
        return { granted: false };
      }
    } catch (err) {
      logger.error(`[PrivacyVault] RSA decryption failed:`, err);
      await this.logAccess(deviceId, label, false);
      return { granted: false };
    }

    // Grant access for this iteration
    this.activeGrants.set(grantKey, {
      deviceId,
      label,
      iterationId,
      grantedAt: Date.now(),
    });

    const aesKey = deriveKey(deviceId, this.masterSecret);
    const value = decrypt(entry.encryptedValue, aesKey);
    await this.logAccess(deviceId, label, true);
    logger.info(`[PrivacyVault] Access granted for "${label}" on device ${deviceId} (iteration: ${iterationId})`);

    return { granted: true, value };
  }

  /**
   * Revoke all grants for a specific iteration.
   */
  revokeIteration(iterationId: string) {
    for (const [key, grant] of this.activeGrants) {
      if (grant.iterationId === iterationId) {
        this.activeGrants.delete(key);
      }
    }
    logger.info(`[PrivacyVault] Revoked all grants for iteration ${iterationId}`);
  }

  /**
   * List all labels stored for a device (no values exposed).
   */
  async listLabels(deviceId: string): Promise<string[]> {
    const vault = await this.loadVault(deviceId);
    return Object.keys(vault.entries);
  }

  /**
   * Delete a specific entry.
   */
  async deleteEntry(deviceId: string, label: string): Promise<boolean> {
    const vault = await this.loadVault(deviceId);
    if (!vault.entries[label]) return false;
    delete vault.entries[label];
    await this.saveVault(vault);
    logger.info(`[PrivacyVault] Deleted "${label}" for device ${deviceId}`);
    return true;
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let vaultInstance: PrivacyVault | null = null;

export function getPrivacyVault(): PrivacyVault {
  if (!vaultInstance) {
    vaultInstance = new PrivacyVault();
  }
  return vaultInstance;
}

// ─── Native Tools ───────────────────────────────────────────────────────────

export const StorePrivateDataTool: NativeTool = {
  name: "store_private_data",
  description:
    "Store sensitive/private data in the user's encrypted privacy vault. " +
    "The user will be asked to set a security question and answer for future access. " +
    "Data is encrypted with AES-256 and tied to the user's device.",
  inputSchema: {
    type: "object",
    properties: {
      label: {
        type: "string",
        description: "A short label for the data (e.g., 'github_token', 'api_key')",
      },
      value: {
        type: "string",
        description: "The sensitive value to store",
      },
      securityQuestion: {
        type: "string",
        description: "A security question the user must answer to access this data later",
      },
      securityAnswer: {
        type: "string",
        description: "The answer to the security question",
      },
    },
    required: ["label", "value", "securityQuestion", "securityAnswer"],
  },
  execute: async (args: any, context?: any) => {
    const vault = getPrivacyVault();
    const deviceId = context?.deviceId || "unknown";
    try {
      await vault.store(
        deviceId,
        args.label,
        args.value,
        args.securityQuestion,
        args.securityAnswer,
      );
      return JSON.stringify({
        success: true,
        message: `Private data "${args.label}" stored securely.`,
      });
    } catch (err: any) {
      return JSON.stringify({ success: false, error: err.message });
    }
  },
};

export const ReadPrivateDataTool: NativeTool = {
  name: "read_private_data",
  description:
    "Read encrypted private data from the user's privacy vault. " +
    "IMPORTANT: This will trigger identity verification — the user must answer their security question. " +
    "Access is valid ONLY for the current agent iteration and auto-revokes after.",
  inputSchema: {
    type: "object",
    properties: {
      label: {
        type: "string",
        description: "The label of the data to access (e.g., 'github_token')",
      },
    },
    required: ["label"],
  },
  execute: async (args: any, context?: any) => {
    const vault = getPrivacyVault();
    const deviceId = context?.deviceId || "unknown";
    const iterationId = context?.iterationId || `iter-${Date.now()}`;
    try {
      const result = await vault.requestAccess(deviceId, args.label, iterationId);
      if (result.granted) {
        return JSON.stringify({
          success: true,
          value: result.value,
          message: `Access granted to "${args.label}" for this iteration.`,
        });
      } else {
        return JSON.stringify({
          success: false,
          message: `Access denied to "${args.label}". Verification failed or timed out.`,
        });
      }
    } catch (err: any) {
      return JSON.stringify({ success: false, error: err.message });
    }
  },
};

export const ListPrivateDataTool: NativeTool = {
  name: "list_private_data",
  description:
    "List all labels of private data stored in the user's privacy vault. " +
    "Does NOT expose the actual values — only the labels.",
  inputSchema: {
    type: "object",
    properties: {},
  },
  execute: async (_args: any, context?: any) => {
    const vault = getPrivacyVault();
    const deviceId = context?.deviceId || "unknown";
    try {
      const labels = await vault.listLabels(deviceId);
      return JSON.stringify({
        success: true,
        labels,
        count: labels.length,
      });
    } catch (err: any) {
      return JSON.stringify({ success: false, error: err.message });
    }
  },
};

export const PrivacyVaultTools = [
  StorePrivateDataTool,
  ReadPrivateDataTool,
  ListPrivateDataTool,
];
