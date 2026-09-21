import type { JsonStorageAdapter, StorageConfig, TokenDatabase } from '../types/storage.js';

export function safeClone<T>(data: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(data);
  }
  return JSON.parse(
    JSON.stringify(data, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)),
  );
}

/**
 * In-memory storage adapter.
 * Useful for browser, edge, testing, or temporary caching without filesystem persistence.
 */
export class MemoryStorageAdapter implements JsonStorageAdapter {
  private readonly store = new Map<string, TokenDatabase>();

  async read(token: string): Promise<TokenDatabase | null> {
    const key = token.toLowerCase();
    const data = this.store.get(key);
    if (!data) return null;
    return safeClone(data);
  }

  async write(token: string, data: TokenDatabase): Promise<void> {
    const key = token.toLowerCase();
    this.store.set(key, safeClone(data));
  }

  async exists(token: string): Promise<boolean> {
    return this.store.has(token.toLowerCase());
  }

  async delete(token: string): Promise<void> {
    this.store.delete(token.toLowerCase());
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * File-based JSON storage adapter for Node.js environments.
 * Saves structured JSON database files per token into a configured directory.
 */
export class FileStorageAdapter implements JsonStorageAdapter {
  private readonly dataDir: string;
  private initialized = false;

  constructor(dataDir = './.pons-cache') {
    this.dataDir = dataDir;
  }

  private async ensureDir(): Promise<void> {
    if (this.initialized) return;
    try {
      const fs = await import('node:fs/promises');
      await fs.mkdir(this.dataDir, { recursive: true });
      this.initialized = true;
    } catch (err: any) {
      // In non-node or browser contexts, import will fail
      throw new Error(`FileStorageAdapter requires a Node.js filesystem environment: ${err?.message ?? err}`);
    }
  }

  private getFilePath(token: string): string {
    const sanitized = token.toLowerCase().replace(/[^a-z0-9]/g, '');
    const filename = `${sanitized}.json`;
    return `${this.dataDir}/${filename}`;
  }

  async read(token: string): Promise<TokenDatabase | null> {
    await this.ensureDir();
    const fs = await import('node:fs/promises');
    const filePath = this.getFilePath(token);

    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as TokenDatabase;
      if (parsed.holders && Array.isArray(parsed.holders)) {
        parsed.holders = parsed.holders.map((h) => ({
          ...h,
          balanceRaw: BigInt(h.balanceRaw ?? 0),
        }));
      }
      return parsed;
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async write(token: string, data: TokenDatabase): Promise<void> {
    await this.ensureDir();
    const fs = await import('node:fs/promises');
    const filePath = this.getFilePath(token);
    const tmpPath = `${filePath}.${Date.now()}-${Math.random().toString(36).substring(2, 7)}.tmp`;

    const serialized = JSON.stringify(
      data,
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
      2,
    );

    // Atomic write
    await fs.writeFile(tmpPath, serialized, 'utf-8');
    await fs.rename(tmpPath, filePath);
  }

  async exists(token: string): Promise<boolean> {
    await this.ensureDir();
    const fs = await import('node:fs/promises');
    const filePath = this.getFilePath(token);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async delete(token: string): Promise<void> {
    await this.ensureDir();
    const fs = await import('node:fs/promises');
    const filePath = this.getFilePath(token);
    try {
      await fs.unlink(filePath);
    } catch (err: any) {
      if (err?.code !== 'ENOENT') throw err;
    }
  }
}

/**
 * Creates the appropriate JSON storage adapter based on runtime environment and config.
 */
export function createDefaultStorageAdapter(config?: StorageConfig): JsonStorageAdapter {
  if (config?.adapter) {
    return config.adapter;
  }

  const isNode =
    typeof process !== 'undefined' &&
    process.versions != null &&
    process.versions.node != null;

  if (isNode) {
    return new FileStorageAdapter(config?.dataDir ?? './.pons-cache');
  }

  return new MemoryStorageAdapter();
}
