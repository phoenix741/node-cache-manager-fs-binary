import { access, unlink } from 'fs/promises';
import { Readable } from 'stream';

export function exists(path: string): Promise<boolean> {
  return access(path)
    .then(() => true)
    .catch(() => false);
}

export async function unlinkIfExist(path: string | undefined): Promise<void> {
  try {
    if (path) {
      await unlink(path);
    }
  } catch (err) {
    // ignore
  }
}

export function streamToPromise(readable: Readable): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const _buf: Array<Buffer> = [];

    readable.on('data', (chunk) => _buf.push(chunk));
    readable.on('end', () => resolve(Buffer.concat(_buf)));
    readable.on('error', (err) => reject(`error converting stream - ${err}`));
  });
}
