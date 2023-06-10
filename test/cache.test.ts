import { caching } from 'cache-manager';
import { DiskStoreCache, create } from '../src';
import { rmdir } from 'fs/promises';

describe('CacheTest', () => {
  let cache: DiskStoreCache;

  beforeEach(async () => {
    const diskstore = create({
      path: 'test/cache',
    });
    await diskstore.initializationPromise;

    cache = await caching(diskstore);
  });

  afterEach(async () => {
    await cache.store.cleancache();
    if (cache.store.options.path) {
      await rmdir(cache.store.options.path);
    }
  });

  it('Set/Get', async () => {
    const ttl = 5 * 1000; /*milliseconds*/
    await cache.set('foo', 'bar', ttl);

    const result = await cache.get('foo');

    expect(result).toBe('bar');
  });

  it('Del', async () => {
    const ttl = 5 * 1000; /*milliseconds*/
    await cache.set('foo', 'bar', ttl);

    await cache.del('foo');

    expect(await cache.get('foo')).toBeUndefined();
  });

  it('Wrap', async () => {
    const ttl = 5 * 1000; /*milliseconds*/
    let count = 0;
    const getUser = async (id: number) => {
      count++;
      return { id, name: 'Bob' };
    };
    const callWrap = () => cache.wrap(key, () => getUser(userId), ttl);

    const userId = 123;
    const key = 'user_' + userId;

    const result = await callWrap();
    const result2 = await callWrap();

    expect(result).toEqual({ id: 123, name: 'Bob' });
    expect(result2).toEqual({ id: 123, name: 'Bob' });
    expect(count).toBe(1);
  });
});
