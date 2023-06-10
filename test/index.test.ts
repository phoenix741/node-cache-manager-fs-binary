import { rmdir } from 'fs/promises';
import { Readable } from 'stream';
import { DiskStore, create } from '../src';
import { exists, streamToPromise } from '../src/utils';

const cacheDirectory = 'test/customCache';

describe('test for the hde-disk-store module', () => {
  let s: DiskStore | undefined;

  // remove test directory after run
  afterEach(async () => {
    if (s) {
      await s.initializationPromise;

      // cleanup all entries in the cache
      await s.cleancache();

      if (s.options.path) {
        await rmdir(s.options.path);
      }
    }
  });

  describe('construction', () => {
    it('simple create cache test', async () => {
      // create a store with default values
      s = create();
      await s.initializationPromise;

      // check the creation result
      expect(s).toBeDefined();
      expect(await exists(s.options.path ?? 'nop')).toBeTruthy();
    });

    it('create cache with option path test', async () => {
      // create a store
      s = create({ path: cacheDirectory });
      await s.initializationPromise;

      // check path option creation
      expect(s).toBeDefined();
      expect(await exists(s.options.path ?? 'nop')).toBeTruthy();
    });
  });

  describe('get', () => {
    it('simple get test with not existing key', async () => {
      s = create({ path: cacheDirectory, preventfill: true });

      const data = await s.get('asdf');
      expect(data).toBeUndefined();
    });

    describe('test missing file on disk', () => {
      it('file does not exist', async () => {
        s = create({ path: cacheDirectory, preventfill: true });

        await s.set('test', 'test');

        const metadata = s.getMetadata('test');
        const tmpfilename = metadata?.filename;

        metadata && (metadata.filename = 'bla');

        await expect(s.get('test')).rejects.toThrow();

        metadata && tmpfilename && (metadata.filename = tmpfilename);

        await s.del('test');
      });
    });

    it('test expired of key (and also ttl option on setting)', async () => {
      s = create({ path: cacheDirectory, preventfill: true });

      await s.set('asdf', 'blabla', -1000);

      const data = await s.get('asdf');

      expect(data).toBeUndefined();
    });
  });

  describe('set', () => {
    it('simple set test', async () => {
      s = create({ path: cacheDirectory, preventfill: true });

      const data = 'a lot of data in a file';
      await s.set('asdf', data);

      const data2 = await s.get('asdf');

      expect(data2).toBe(data);
    });
  });

  describe('keys', () => {
    it('simple keys test', async () => {
      s = create({ path: cacheDirectory, preventfill: true });

      const data = 'just a string with data';
      await s.set('key123', data);

      const keys = await s.keys();

      expect(keys.length).toBe(1);
      expect(keys[0]).toBe('key123');
    });
  });

  describe('del / reset', () => {
    it('simple del test for not existing key', async () => {
      s = create({ path: cacheDirectory, preventfill: true });

      await s.del('not existing');
    });

    it('successfull deletion', async () => {
      s = create({ path: cacheDirectory, preventfill: true });

      await s.set('nix', 'empty');

      await s.del('nix');
    });

    describe('delete errorhandling', () => {
      it('file not exists', async () => {
        s = create({ path: cacheDirectory, preventfill: true });

        await s.set('test', 'empty');

        const metadata = s.getMetadata('test');
        const fn = metadata?.filename;

        metadata && (metadata.filename = `${fn}.not_here`);

        await s.del('test');

        metadata && fn && (metadata.filename = fn);
      });
    });

    it('reset all', async () => {
      s = create({ path: cacheDirectory, preventfill: true });

      await s.set('test', 'test');
      await s.set('test2', 'test2');

      await s.reset();

      const keys = await s.keys();

      expect(keys.length).toBe(0);
    });

    it('reset callback', async () => {
      s = create({ path: cacheDirectory, preventfill: true });

      await s.set('test', 'test');
      await s.reset();
    });
  });

  describe('zip test', () => {
    it('save and load again', async () => {
      // create store
      s = create({ zip: true, path: cacheDirectory, preventfill: true });

      const datastring = 'bla only for test \n and so on...';
      const dataKey = 'zipDataTest';

      await s.set(dataKey, datastring);

      const data = await s.get(dataKey);

      expect(data).toBe(datastring);
    });
  });

  describe('buffers portion', () => {
    it('saves and loads binary key buffers without revival', async () => {
      s = create({
        zip: true,
        path: cacheDirectory,
        preventfill: true,
      });

      const dataBufferArray = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
      const dataKey = 'binaryBufferTest';
      const data2Cache = Buffer.from(dataBufferArray);

      await s.set(dataKey, data2Cache);

      const data = await s.get(dataKey);

      expect(data).toEqual(data2Cache);
    });

    it('saves binary key buffers and loads as readable stream', async () => {
      s = create({
        zip: true,
        path: cacheDirectory,
        preventfill: true,
      });

      const dataBufferArray = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
      const dataKey = 'binaryBufferReadableStreamTest';
      const data2Cache = Buffer.from(dataBufferArray);

      await s.set(dataKey, data2Cache);

      const data = await s.get(dataKey, true);

      expect(data).toBeInstanceOf(Readable);
      expect(await streamToPromise(data!)).toEqual(data2Cache);
    });
  });

  describe('integrationtests', () => {
    it('cache initialization on start', async () => {
      // create store
      s = create({ path: cacheDirectory, preventfill: true });

      // save element
      await s.set('RestoreDontSurvive', 'data', -1);

      await s.set('RestoreTest', 'test');

      const t = create({ path: cacheDirectory });
      await t.initializationPromise;

      //fill complete
      const data = await t.get('RestoreTest');
      expect(data).toBe('test');

      const data2 = await t.get('RestoreDontSurvive');
      expect(data2).toBeUndefined();

      expect(t.currentsize).toBeGreaterThan(0);
    });

    it('cache initialization on start with zip option', async () => {
      // create store
      s = create({ path: cacheDirectory, zip: true, preventfill: true });

      // save element
      await s.set('RestoreDontSurvive', 'data', -1);

      await s.set('RestoreTest', 'test');

      const t = create({
        path: cacheDirectory,
        zip: true,
      });

      await t.initializationPromise;

      //fill complete
      const data = await t.get('RestoreTest');
      expect(data).toBe('test');

      const data2 = await t.get('RestoreDontSurvive');
      expect(data2).toBeUndefined();

      expect(t.currentsize).toBeGreaterThan(0);
    });

    it('max size option', async () => {
      // create store
      s = create({
        path: cacheDirectory,
        preventfill: true,
        maxsize: 1,
      });

      await expect(s.set('one', 'dataone')).rejects.toThrowError(
        'Item size too big.',
      );
      expect((await s.keys()).length).toBe(0);

      await expect(s.set('x', 'x', -1)).rejects.toThrowError(
        'Item size too big.',
      );
      expect((await s.keys()).length).toBe(0);

      s.options.maxsize = 150;
      await s.set('a', 'a', 10000);
      expect((await s.keys()).length).toBe(1);

      await s.set('b', 'b', 100);
      expect((await s.keys()).length).toBe(2);

      await s.set('c', 'c', 100);
      expect((await s.keys()).length).toBe(2);

      // now b should be removed from the cache, a should exists
      const data = await s.get('a');
      expect(data).toBe('a');

      const data2 = await s.get('b');
      expect(data2).toBeUndefined();
    });
  });
});
