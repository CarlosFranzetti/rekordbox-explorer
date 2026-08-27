/**
 * Types for the vendored OneLibrary modules.
 *
 * The `.js` files beside this one are upstream verbatim so their fixes apply as
 * a clean diff. Declaring their shape here gives the rest of the app real types
 * without editing vendored code, and keeps `checkJs` off for it.
 *
 * This declares only the surface we actually use. If you reach for something
 * upstream exports that is missing here, add it — do not widen to `any`.
 */

declare module '@/lib/onelibrary/sqlcipher' {
  export const PAGE_SIZE: 4096;
  export const RESERVE: 80;
  export const IV_LEN: 16;
  export const SALT_LEN: 16;
  export const KDF_ITERATIONS: number;
  /** The passphrase rekordbox uses for exportLibrary.db. */
  export const DEFAULT_KEY: string;
  export class DecryptError extends Error {}

  export function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey>;

  /** Decrypt a SQLCipher database into a plain SQLite image. */
  export function decrypt(
    buffer: ArrayBuffer | Uint8Array,
    passphrase?: string,
    onProgress?: (done: number, total: number) => void
  ): Promise<Uint8Array>;

  /** Encrypt a plain SQLite image back into a SQLCipher database. */
  export function encrypt(
    image: Uint8Array,
    passphrase?: string,
    opts?: { salt?: Uint8Array; onProgress?: (done: number, total: number) => void }
  ): Promise<Uint8Array>;
}

declare module '@/lib/onelibrary/sqlite' {
  export class SQLiteError extends Error {}

  export interface TableMeta {
    name: string;
    rootpage: number;
    sql: string;
    columns: string[];
    /** The column aliasing the rowid, if the table declares INTEGER PRIMARY KEY. */
    rowidAlias: string | null;
  }

  export class SQLiteDatabase {
    constructor(image: Uint8Array);
    readonly data: Uint8Array;
    readonly pageSize: number;
    readonly reserve: number;
    readonly usable: number;
    readonly tables: Map<string, TableMeta>;
    /** Every row of `table` as plain objects keyed by column name. */
    select(table: string): Record<string, unknown>[];
    tableNames(): string[];
  }

  export function rowidAlias(sql: string): string | null;
  export function parseColumns(sql: string): string[];
}

declare module '@/lib/onelibrary/sqlite-write' {
  export class SQLiteWriteError extends Error {}

  export interface WritableTable {
    name: string;
    sql: string;
    columns: string[];
    rowidAlias?: string | null;
    /** `__rowid` pins a row's b-tree key; without it the writer uses position. */
    rows: Record<string, unknown>[];
  }

  export interface WritableIndex {
    name: string;
    sql: string;
    table: string;
    column: string;
  }

  export function buildRecord(values: unknown[]): Uint8Array;
  export function writeDatabase(tables: WritableTable[], indexes?: WritableIndex[]): Uint8Array;
}
