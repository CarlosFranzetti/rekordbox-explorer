/**
 * In-memory stand-in for the File System Access API.
 *
 * Enough of the surface to exercise the backup vault end to end, plus fault
 * injection so we can test what happens when a drive starts failing mid-write.
 */

interface MemoryFile {
  kind: 'file';
  name: string;
  data: Uint8Array;
}

interface MemoryDir {
  kind: 'directory';
  name: string;
  children: Map<string, MemoryFile | MemoryDir>;
}

export interface FaultConfig {
  /** Reject `createWritable` for paths whose name matches. */
  failWritesMatching?: RegExp;
  /** Silently corrupt bytes written to matching names, to test verification. */
  corruptWritesMatching?: RegExp;
  /** Reject directory creation for matching names. */
  failMkdirMatching?: RegExp;
}

export class MemoryFileSystem {
  readonly faults: FaultConfig = {};
  private readonly rootDir: MemoryDir = { kind: 'directory', name: 'USB', children: new Map() };

  get root(): FileSystemDirectoryHandle {
    return this.wrapDir(this.rootDir) as FileSystemDirectoryHandle;
  }

  /** Seed a file at a slash-separated path. */
  seed(path: string, data: Uint8Array): void {
    const segments = path.split('/').filter(Boolean);
    const fileName = segments.pop()!;
    let dir = this.rootDir;
    for (const segment of segments) {
      let next = dir.children.get(segment);
      if (!next || next.kind !== 'directory') {
        next = { kind: 'directory', name: segment, children: new Map() };
        dir.children.set(segment, next);
      }
      dir = next;
    }
    dir.children.set(fileName, { kind: 'file', name: fileName, data: new Uint8Array(data) });
  }

  /** Read a file at a slash-separated path, or null. */
  peek(path: string): Uint8Array | null {
    const segments = path.split('/').filter(Boolean);
    const fileName = segments.pop()!;
    let dir: MemoryDir | undefined = this.rootDir;
    for (const segment of segments) {
      const next: MemoryFile | MemoryDir | undefined = dir?.children.get(segment);
      if (!next || next.kind !== 'directory') return null;
      dir = next;
    }
    const file = dir?.children.get(fileName);
    return file && file.kind === 'file' ? file.data : null;
  }

  /** Every file path in the tree, sorted. */
  paths(): string[] {
    const out: string[] = [];
    const walk = (dir: MemoryDir, prefix: string) => {
      for (const [name, child] of dir.children) {
        if (child.kind === 'file') out.push(`${prefix}${name}`);
        else walk(child, `${prefix}${name}/`);
      }
    };
    walk(this.rootDir, '');
    return out.sort();
  }

  private wrapDir(dir: MemoryDir): unknown {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const fs = this;
    return {
      kind: 'directory' as const,
      name: dir.name,

      async getDirectoryHandle(name: string, options?: { create?: boolean }) {
        const existing = dir.children.get(name);
        if (existing && existing.kind === 'directory') return fs.wrapDir(existing);
        if (existing) throw new Error(`"${name}" is a file`);
        if (!options?.create) throw new DOMException(`${name} not found`, 'NotFoundError');
        if (fs.faults.failMkdirMatching?.test(name)) {
          throw new DOMException(`cannot create ${name}`, 'NotAllowedError');
        }
        const created: MemoryDir = { kind: 'directory', name, children: new Map() };
        dir.children.set(name, created);
        return fs.wrapDir(created);
      },

      async getFileHandle(name: string, options?: { create?: boolean }) {
        const existing = dir.children.get(name);
        if (existing && existing.kind === 'file') return fs.wrapFile(dir, existing);
        if (existing) throw new Error(`"${name}" is a directory`);
        if (!options?.create) throw new DOMException(`${name} not found`, 'NotFoundError');
        const created: MemoryFile = { kind: 'file', name, data: new Uint8Array(0) };
        dir.children.set(name, created);
        return fs.wrapFile(dir, created);
      },

      async removeEntry(name: string, options?: { recursive?: boolean }) {
        const existing = dir.children.get(name);
        if (!existing) throw new DOMException(`${name} not found`, 'NotFoundError');
        if (existing.kind === 'directory' && existing.children.size > 0 && !options?.recursive) {
          throw new DOMException('directory not empty', 'InvalidModificationError');
        }
        dir.children.delete(name);
      },

      async *entries() {
        for (const [name, child] of [...dir.children]) {
          yield [name, child.kind === 'file' ? fs.wrapFile(dir, child) : fs.wrapDir(child)] as [
            string,
            unknown,
          ];
        }
      },

      async queryPermission() {
        return 'granted' as PermissionState;
      },
      async requestPermission() {
        return 'granted' as PermissionState;
      },
    };
  }

  private wrapFile(parent: MemoryDir, file: MemoryFile): unknown {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const fs = this;
    return {
      kind: 'file' as const,
      name: file.name,

      async getFile() {
        // jsdom's File does not implement arrayBuffer(), so hand back a
        // File-shaped object carrying only what this app actually uses.
        const bytes = new Uint8Array(file.data);
        return {
          name: file.name,
          size: bytes.length,
          type: '',
          lastModified: Date.now(),
          async arrayBuffer() {
            return bytes.buffer.slice(0) as ArrayBuffer;
          },
          async text() {
            return new TextDecoder().decode(bytes);
          },
        } as unknown as File;
      },

      async createWritable() {
        if (fs.faults.failWritesMatching?.test(file.name)) {
          throw new DOMException(`write blocked: ${file.name}`, 'NotAllowedError');
        }
        const chunks: Uint8Array[] = [];
        return {
          async write(data: ArrayBuffer | ArrayBufferView | Blob | string) {
            if (typeof data === 'string') chunks.push(new TextEncoder().encode(data));
            else if (data instanceof ArrayBuffer) chunks.push(new Uint8Array(data));
            else if (ArrayBuffer.isView(data)) {
              chunks.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
            } else {
              chunks.push(new Uint8Array(await (data as Blob).arrayBuffer()));
            }
          },
          async close() {
            const total = chunks.reduce((sum, c) => sum + c.length, 0);
            const merged = new Uint8Array(total);
            let cursor = 0;
            for (const chunk of chunks) {
              merged.set(chunk, cursor);
              cursor += chunk.length;
            }
            if (fs.faults.corruptWritesMatching?.test(file.name) && merged.length > 0) {
              merged[0] = merged[0] ^ 0xff;
            }
            file.data = merged;
            parent.children.set(file.name, file);
          },
          async abort() {},
          async seek() {},
          async truncate() {},
        };
      },
    };
  }
}
