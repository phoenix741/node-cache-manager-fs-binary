import type { Cache, Milliseconds, Store } from 'cache-manager';
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import { Stream, Readable as ReadableStream, Readable } from 'stream';
import { pipeline as pipelinePromise } from 'stream/promises';
import { promisify } from 'util';
import * as uuid from 'uuid';
import { deserialize, serialize } from 'v8';
import { createDeflate, createInflate, deflate, unzip } from 'zlib';
import { MetaData, calculateBinaryFilename } from './metadata';
import { exists, streamToPromise, unlinkIfExist } from './utils';

const unzipPromise = promisify(unzip);
const deflatePromise = promisify(deflate);

const DEFAULT_TTL = 60000;

export interface DiskStoreOptions {
  path: string;
  ttl: Milliseconds;
  maxsize: number;
  zip: boolean;
  preventfill: boolean;
  binaryEncode: boolean;
}

export class DiskStore implements Store {
  name = 'diskstore';
  // current size of the cache
  #currentsize = 0;
  // internal array for informations about the cached files - resists in memory
  #collection = new Map<string, MetaData<unknown>>();
  // Promise for the initialization of the cache
  #initializationPromise?: Promise<void>;
  // options for the cache
  readonly options: DiskStoreOptions = {
    path: 'cache',
    ttl: DEFAULT_TTL,
    maxsize: 0,
    zip: false,
    preventfill: false,
    binaryEncode: false,
  };

  /**
   * construction of the disk storage
   */
  constructor(options: Partial<DiskStoreOptions> = {}) {
    Object.assign(this.options, options);

    // fill the cache on startup with already existing files
    if (!options.preventfill) {
      this.#initializationPromise = this.intializefill();
    }
  }

  get currentsize() {
    return this.#currentsize;
  }

  get initializationPromise() {
    return this.#initializationPromise;
  }

  async mset(args: [string, unknown][], ttl?: Milliseconds): Promise<void> {
    await Promise.all(args.map(([key, value]) => this.set(key, value, ttl)));
  }

  mget(...args: string[]): Promise<unknown[]> {
    return Promise.all(args.map((key) => this.get(key)));
  }

  async mdel(...args: string[]): Promise<void> {
    for (const key of args) {
      await this.del(key);
    }
  }

  async ttl(key: string): Promise<number> {
    const metaData = this.#collection.get(key);
    if (!metaData) {
      return -1;
    }

    return metaData.expires;
  }

  /**
   * delete an entry from the cache
   */
  async del(key: string): Promise<void> {
    // get the metainformations for the key
    const metadata = this.#collection.get(key);
    if (!metadata) {
      return;
    }

    try {
      await unlinkIfExist(metadata.binaryFilename);
      await unlinkIfExist(metadata.filename);

      // update internal properties
      this.#currentsize -= metadata.size;
      this.#collection.delete(key);
    } catch (e) {
      // ignore errors
    }
  }

  /**
   * set a key into the cache
   */
  async set(key: string, val: Buffer, ttl?: Milliseconds): Promise<void>;
  async set(key: string, val: Readable, ttl?: Milliseconds): Promise<void>;
  async set<T>(key: string, val: T, ttl?: Milliseconds): Promise<void>;
  async set(
    key: string,
    val: unknown,
    ttl: Milliseconds = this.options.ttl ?? DEFAULT_TTL,
  ): Promise<void> {
    await this.#ensureDirectoryExists();

    const metadata = new MetaData<unknown>({
      key,
      expires: Date.now() + ttl,
      filename: this.options.path + `/cache_${uuid.v4()}.dat`,
      size: 0,
    });

    let binarySize = 0;
    if (val instanceof Buffer || isReadableStream(val)) {
      // If the value is buffer or readable, we store it in a separate file

      const stream = isReadableStream(val) ? val : Readable.from(val);

      // put storage filenames into stored value.binary object
      metadata.binaryFilename = calculateBinaryFilename(metadata.filename);

      await pipelinePromise([
        stream,
        ...(this.options.zip ? [createDeflate()] : []),
        createWriteStream(metadata.binaryFilename),
      ]);

      // calculate the size of the binary data
      binarySize += (await stat(metadata.binaryFilename)).size;
    } else {
      metadata.value = val;
    }

    metadata.size = binarySize;
    const stream = await this.#serialize(metadata);
    metadata.size = stream.length + binarySize;

    if (this.options.maxsize && metadata.size > this.options.maxsize) {
      await unlinkIfExist(metadata.binaryFilename);
      throw new Error('Item size too big.');
    }

    // remove the key from the cache (if it already existed, this updates also the current size of the store)
    await this.del(key);

    // check used space and remove entries if we use too much space
    await this.freeupspace();

    // write data into the cache-file
    await writeFile(metadata.filename, stream);

    // remove data value from memory
    metadata.value = undefined;
    delete metadata.value;

    this.#currentsize += metadata.size;

    // place element with metainfos in internal collection
    this.#collection.set(metadata.key, metadata);
  }

  /**
   * get entry from the cache
   */
  async get(key: string, readable: true): Promise<Readable | undefined>;
  async get<T>(key: string): Promise<T | undefined>;
  async get(key: string, readable = false): Promise<unknown> {
    // get the metadata from the collection
    const data = this.#collection.get(key);
    if (!data) {
      // not found
      return;
    }

    // found but expired
    if (data.expires < new Date().getTime()) {
      // delete the elemente from the store
      await this.del(key);
      return;
    }

    // try to read the file
    const fileContent = await readFile(data.filename);
    const diskdata = await this.#deserialize(fileContent);

    if (diskdata?.binaryFilename) {
      const readableValue = createReadStream(diskdata.binaryFilename);
      const dataStream = this.options.zip
        ? readableValue.pipe(createInflate())
        : readableValue;

      if (readableValue !== dataStream) {
        readableValue.on('error', (err) => {
          dataStream.emit('error', err);
        });
      }

      if (readable) {
        return dataStream;
      }

      return streamToPromise(dataStream);
    }

    return diskdata.value;
  }

  getMetadata(key: string): MetaData<unknown> | undefined {
    return this.#collection.get(key);
  }

  /**
   * helper method to free up space in the cache (regarding the given spacelimit)
   */
  async freeupspace() {
    if (!this.options.maxsize) {
      return;
    }

    // do we use to much space? then cleanup first the expired elements
    if (this.#currentsize > this.options.maxsize) {
      this.cleanExpired();
    }

    // for this we need a sorted list basend on the expire date of the entries (descending)
    const tuples = Array.from(this.#collection.entries())
      .sort(([, { expires: a }], [, { expires: b }]) => a - b)
      .map(([key]) => key);

    for (const key of tuples) {
      if (this.#currentsize <= this.options.maxsize) {
        break;
      }

      // delete an entry from the store
      await this.del(key);
    }
  }

  /**
   * get keys stored in cache
   * @param {Function} cb
   */
  async keys() {
    return Array.from(this.#collection.keys());
  }

  /**
   * cleanup cache on disk -> delete all used files from the cache
   */
  async reset() {
    for (const elementKey of this.#collection.keys()) {
      await this.del(elementKey);
    }
  }

  /**
   * helper method to clean all expired files
   */
  async cleanExpired() {
    for (const [key, entry] of this.#collection.entries()) {
      if (entry.expires < new Date().getTime()) {
        await this.del(key);
      }
    }
  }

  /**
   * clean the complete cache and all(!) files in the cache directory
   */
  async cleancache() {
    await this.#ensureDirectoryExists();

    // clean all current used files
    await this.reset();

    // check, if other files still resist in the cache and clean them, too
    const files = await readdir(this.options.path);

    for (const file of files) {
      const filename = join(this.options.path, file);
      await unlinkIfExist(filename);
    }
  }

  /**
   * fill the cache from the cache directory (usefull e.g. on server/service restart)
   */
  async intializefill() {
    await this.#ensureDirectoryExists();

    // get potential files from disk
    const files = await readdir(this.options.path);
    for (const file of files) {
      if (!/\.dat$/.test(file)) {
        // only .dat files, no .bin files read
        continue;
      }

      const filename = join(this.options.path, file);
      if (!(await exists(filename))) {
        continue;
      }

      try {
        const data = await readFile(filename);
        const diskdata = await this.#deserialize(data);

        diskdata.filename = filename;
        diskdata.size = diskdata.size + data.length;

        // update collection size
        this.#currentsize += diskdata.size;

        // remove the entrys content - we don't want the content in the memory (only the meta informations)
        diskdata.value = undefined;
        delete diskdata.value;

        // and put the entry in the store
        this.#collection.set(diskdata.key, diskdata);

        // check for expiry - in this case we instantly delete the entry
        if (diskdata.expires < new Date().getTime()) {
          await this.del(diskdata.key);
        }
      } catch (err) {
        await unlinkIfExist(filename);
        await unlinkIfExist(calculateBinaryFilename(filename));
      }
    }
  }

  async #ensureDirectoryExists() {
    if (!(await exists(this.options.path))) {
      try {
        await mkdir(this.options.path);
      } catch (err) {
        // Ignore the error if the directory already exists
      }
    }
  }

  async #serialize(value: MetaData<unknown>): Promise<Buffer> {
    const serialized: Buffer = this.options.binaryEncode
      ? serialize(value)
      : Buffer.from(JSON.stringify(value));

    if (this.options.zip) {
      return await deflatePromise(serialized);
    }

    return serialized;
  }

  async #deserialize(value: Buffer): Promise<MetaData<unknown>> {
    const serialized = this.options.zip ? await unzipPromise(value) : value;
    const deserialized: MetaData<unknown> = this.options.binaryEncode
      ? deserialize(serialized)
      : new MetaData(JSON.parse(serialized.toString()));
    return deserialized;
  }
}

export type DiskStoreCache = Cache<DiskStore>;

/**
 * Export 'DiskStore'
 */

export function create(args: Partial<DiskStoreOptions> = {}) {
  return new DiskStore(args);
}

export function isStream(stream: unknown): stream is Stream {
  return (
    stream !== null &&
    typeof stream === 'object' &&
    typeof (stream as Stream).pipe === 'function'
  );
}

export function isReadableStream(stream: unknown): stream is ReadableStream {
  return (
    isStream(stream) &&
    (stream as ReadableStream).readable !== false &&
    typeof (stream as ReadableStream)._read === 'function' &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (stream as any)._readableState === 'object'
  );
}
