/**
 * helper object with meta-informations about the cached data
 */
export class MetaData<T> {
  // the key for the storing
  key: string;
  // temporary filename for the cached file because filenames cannot represend urls completely
  filename: string;
  // expirydate of the entry
  expires: number;
  // data to store
  value?: T;
  // binary data
  binaryFilename?: string;
  // size of the current entry
  size: number;

  constructor(o: MetaData<T>) {
    this.key = o.key;
    this.filename = o.filename;
    this.expires = o.expires;
    this.value = o.value;
    this.binaryFilename = o.binaryFilename;
    this.size = o.size;
  }
}

export function calculateBinaryFilename(key: string): string {
  return key.replace(/\.dat$/, `.bin`);
}
