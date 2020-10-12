enum PromiseStatus {
  PENDING,
  REJECTED,
  RESOLVED,
};

type Timer<V = null> = {
  timeout: NodeJS.Timeout,
  expiresAt: number,
  promise: Promise<V>,
  resolve: () => void,
  clear: (immediately?: boolean) => void,
};

export type CacheMap<K, V> = {
  get(key: K): V | void;
  set(key: K, value: V): any;
  delete(key: K): any;
  clear(): any;
};

export class AsyncGetterTimeoutError extends Error {}

export type Cache<V> = {
  timer: Timer,
  promises: Promise<V | null>[],
  expiresAt: number,
  status: PromiseStatus,
  resultPromise: Promise<V>,
  result: V,
  error: Error,
  restTimes: number,
};

export type NextTickFn = (cb: Function) => void;

export type Options<K, V> = {
  expiresInSec?: number,
  maxTryTimes?: number,
  parallel?: number,
  cacheMap?: CacheMap<K, Cache<V>>,
};

const DEFAULT_OPTIONS = {
  expiresInSec: 3,
  maxTryTimes: 3,
  parallel: 1,
  cacheMap: null,
};

const checkNonnegNum = <K, V>(options: Options<K, V>, key: string, canbeZero?: boolean): void => {
  const num = Math.ceil(options[key]); // should be integer
  if (num < 0) {
    if (canbeZero) {
      throw new TypeError(`Expect \`${key}\` to be a nonnegative number, got ${num}.`);
    }
    throw new TypeError(`Expect \`${key}\` to be a positive number, got ${num}.`);
  }
  if (num === 0 && !canbeZero) {
    throw new TypeError(`Expect \`${key}\` to be a positive number, got ${num}.`);
  }
  options[key] = num;
}

export type BlockedFunction<K, V> = (id: K) => Promise<V | null>;

export class AsyncGetter<K, V> {
  constructor (fn: BlockedFunction<K, V>, options?: Options<K, V>) {
    this._blockedFunc = fn;
    options = Object.assign({}, DEFAULT_OPTIONS, options);
    checkNonnegNum(options, 'expiresInSec', true);
    checkNonnegNum(options, 'maxTryTimes');
    checkNonnegNum(options, 'parallel');
    this._cacheMap = options.cacheMap || new Map<K, Cache<V>>();
    this._options = options;
  }

  callCount = 0;
  loadCount = 0;

  private resetCache (id: K, oldCache?: Cache<V>): Cache<V> {
    let cache: Cache<V>;
    const baseData = {
      status: PromiseStatus.PENDING,
      resultPromise: null,
      result: null,
      error: null,
    };
    if (oldCache) {
      cache = Object.assign(baseData, oldCache, { promises: [] });
    } else {
      const timer = this.setupTimer();
      cache = {
        ...baseData,
        timer,
        promises: [],
        expiresAt: timer.expiresAt,
        restTimes: this._options.maxTryTimes,
      };
    }
    this._cacheMap.set(id, cache);
    return cache;
  }

  private removeCache (id: K, cache: Cache<V>): void {
    const exists = this._cacheMap.get(id);
    if (exists && exists === cache) {
      this._cacheMap.delete(id);
    }
  }

  async load (id: K): Promise<V> {
    this.loadCount++;
    let cache = this._cacheMap.get(id) as Cache<V>;
    if (!cache || cache.expiresAt < Date.now()) {
      cache = this.resetCache(id);
    }

    const { parallel } = this._options;

    if (cache.promises.length === parallel) {
      return cache.resultPromise;
    }

    this.callCount++;
    cache.status !== PromiseStatus.RESOLVED
      && cache.promises.push(
        this._blockedFunc(id)
          .then((ret: V): V => {
            cache.result = ret;
            // RESOLVED status could not be covered by other statuses, but REJECTED status could be covered by RESOLVED status.
            cache.status = PromiseStatus.RESOLVED;
            return ret;
          })
          .catch(err => {
            if (cache.status !== PromiseStatus.RESOLVED) {
              cache.status = PromiseStatus.REJECTED;
              cache.error = err;
            }
            throw err;
          })
        );

    const promises = cache.timer
      ? Promise.race([Promise.all(cache.promises), cache.timer.promise])
      : Promise.all(cache.promises);

    cache.resultPromise = promises
      .then(() => {
        // If the cache still exists, delete it.
        this.removeCache(id, cache);
        this.clearTimer(cache.timer, true);
        return cache.result;
      })
      .catch(err => {
        --cache.restTimes;

        if (cache.restTimes && !(err instanceof AsyncGetterTimeoutError)) {
          this.resetCache(id, cache);
          let len = cache.promises.length - 1;
          while (len > 0) {
            this.load(id);
          }
          return this.load(id);
        }
        this.clearTimer(cache.timer, cache.promises.length === parallel);
        throw err;
      });

    return cache.resultPromise;
  }

  private clearTimer (timer: Timer | void, immediately?: boolean): void {
    timer && timer.clear(immediately);
  }


  setupTimer (): Timer {
    if (this._options.expiresInSec > 0) {
      const timer = {} as Timer;
      let fulfilled: boolean;
      timer.promise = new Promise((resolve, reject): void => {
        timer.resolve = resolve;
        let callback = () => {
          if (!fulfilled) {
            fulfilled = true;
            reject(new AsyncGetterTimeoutError('Async getter executed timeout.'));
          }
        };
        const clear = () => {
          if (timer.timeout !== null) {
            clearTimeout(timer.timeout);
            timer.timeout = null;
            if (!fulfilled) {
              fulfilled = true;
              timer.resolve();
            }
          }
        };
        const millis = this._options.expiresInSec * 1000;
        timer.expiresAt = millis + Date.now();
        timer.timeout = setTimeout(() => callback(), millis);
        timer.clear = (immediately?: boolean): void => {
          if (immediately) {
            return clear();;
          }
          callback = clear;
        };
      });
      return timer;
    }
    return null;
  }

  _cacheMap: CacheMap<K, Cache<V>>;
  _blockedFunc: BlockedFunction<K, V>;
  _options: Options<K, V>;
}
