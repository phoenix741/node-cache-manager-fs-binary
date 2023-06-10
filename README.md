[![NPM](https://nodei.co/npm/cache-manager-fs-stream.png)](https://nodei.co/npm/cache-manager-fs-stream/)

# cache-manager-fs-stream

# Node Cache Manager store for Filesystem with binary data

The Filesystem store for the [node-cache-manager](https://github.com/node-cache-manager/node-cache-manager) module, storing binary data as separate files, returning them as readable streams or buffers.
This should be convenient for caching binary data and sending them as streams to a consumer, e.g. `res.send()`.
The library caches on disk arbitrary data, but values of an object under the special key `binary` is stored as separate files.

## Node.js versions

Works with versions upper than 16.x

## Installation

```sh
    npm install cache-manager-fs-stream --save
```

## Features

- limit maximum size on disk
- refill cache on startup (in case of application restart)
- returns binary data as buffers or readable streams
- can store buffers inside the single cache file

## Single store

```javascript
// node cachemanager
import { caching } from 'cache-manager';
// storage for the cachemanager
import { DiskStoreCache, create } from 'cache-manager-fs-stream';
// initialize caching on disk
const diskstore = create({
  ttl: 60 * 60 /* seconds */,
  maxsize: 1000 * 1000 * 1000 /* max size in bytes on disk */,
  path: 'diskcache',
  binaryEncode: true, // File will be binary encoded (serialized with v8)
  zip: true, // use zip to compress the cache files
});

const diskCache = await caching(diskstore);

// ...
var cacheKey = 'userImageWatermarked:' + user.id + ':' + image.id;
var ttl = 60 * 60 * 24 * 7 * 1000; // in ms

// wrapper function, see more examples at node-cache-manager
const result = diskCache.wrap(
  cacheKey,
  // called if the cache misses in order to generate the value to cache
  async () => {
    // get the image from the database
    return value; // value can be object, Buffer, Stream
  },
  // Options, see node-cache-manager for more examples
  { ttl: ttl },
);
```

### Options

options for store initialization

```javascript
// default values

// time to live in seconds
options.ttl = 60;
// path for cached files
options.path = 'cache/';
// prevent filling of the cache with the files from the cache-directory
options.preventfill = false;
// if true the main cache files will be zipped (not the binary ones)
options.zip = false;
// maximum size of the cache in bytes
options.maxsize = 1000 * 1000 * 1000;
// if true, the binary files are encoded with v8
options.binaryEncode = false;
```

## Tests

To run tests:

```sh
    npm test
```

## License

cache-manager-fs-stream is licensed under the MIT license.

## Credits

Based on https://github.com/sheershoff/node-cache-manager-fs-binary
