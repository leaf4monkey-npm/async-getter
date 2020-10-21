import 'ts-node/register';
import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as sinon from 'sinon';
import { promises as promisifiedFS } from 'fs';
import { join } from 'path';

import { AsyncGetter, Options } from '../src/';
import * as exp from '../example/number-list.json';

chai.use(chaiAsPromised);
const { expect } = chai;

const shuffle = <T>(input: T[]): T[] => {
  for (let i = input.length - 1; i >= 0; i--) {
    const randomIndex = Math.floor(Math.random() * (i + 1));
    [input[randomIndex], input[i]] = [input[i], input[randomIndex]];
  }
  return input;
};

const FILE_PATH = join(__dirname, '../example/number-list.json');
const wait = (ms: number): Promise<void> =>
  new Promise(
    r => setTimeout(r, ms)
  );

type WrappedCallback = (k: string) => Promise<number>;

describe('AsyncGetter', () => {
  let waitMs: number;
  let asyncFunc: WrappedCallback;
  let options: Options<string, number>;
  let asyncGetter;
  let funcSpy: sinon.SinonSpy;

  const initIns = (): void => {
    asyncGetter = new AsyncGetter((id: string) => asyncFunc(id), options);
    funcSpy = sinon.spy(asyncGetter, '_blockedFunc');
  };


  const load = (times: number, id: string): Promise<number[]> => {
    let retList: Promise<number>[] = [];
    while (times--) {
      retList.push(asyncGetter.load(id));
    }
    return Promise.all(retList);
  };

  beforeEach(() => {
    waitMs = 100;
    options = {
      expiresInSec: 2,
      maxTryTimes: 3,
      parallel: 3,
    };
    asyncFunc = async (k: string): Promise<number> => {
      const data = await promisifiedFS.readFile(FILE_PATH);
      const json = JSON.parse(data.toString('utf8'));
      return json[k];
    };
    initIns();
  });

  afterEach(() => funcSpy.restore());

  it('should execute wrapped function', async () => {
    const ret = asyncGetter.load('five');
    await expect(ret).to.eventually.equals(5);
    expect(funcSpy.callCount).to.equals(1);
    return ret;
  });

  context('with duplicated calls', () => {
    let times: number;
    context('less than or equals to `options.parallel`', () => {
      beforeEach(() => {
        times = Math.ceil(Math.random() * (options.parallel - 1)) + 1;
      });
      it('should not reduce call times', async () => {
        const retList = load(times, 'one');
        await expect(retList).to.eventually.deep.equals(Array(times).fill(1));
        expect(funcSpy.callCount).to.equals(times);
        expect(funcSpy.args).to.deep.equals(Array(times).fill(['one']));
      });
    });
    context('more than `options.parallel`', () => {
      beforeEach(() => {
        times = options.parallel + Math.ceil(Math.random() * 10);
      });
      it('should reduce call times to `options.parallel`', async () => {
        const retList = load(times, 'one');
        await expect(retList).to.eventually.deep.equals(Array(times).fill(1));
        expect(funcSpy.callCount).to.equals(options.parallel);
        expect(funcSpy.args).to.deep.equals(Array(options.parallel).fill(['one']));
      });
    });
  });

  context('with multiple ids', () => {
    const keys = Object.keys(exp);
    let times: number;
    let keyArr: string[];
    beforeEach(() => {
      times = options.parallel + Math.ceil(Math.random() * 10);
      keyArr = shuffle(keys.map(key => Array(times).fill(key)).flat());
    });
    it('should reduce call times', async () => {
      const list = keyArr.map(async key => {
        const p = load(1, key).then(([val]: number[]) => ({ key, val }));
        await wait(1);
        return p;
      });
      const results = await Promise.all(list);
      const map: { [prop: string]: number } = {};
      results.forEach(({ key, val }) => {
        expect(val).to.equals(exp[key]);
        map[key] = map[key] || 0;
        map[key]++;
      });
      expect(Object.keys(map)).to.have.same.members(keys);
      keys.forEach(key => {
        expect(map[key]).to.equals(times);
      });
      expect(funcSpy.callCount).to.equals(keys.length * options.parallel);
    });
  });

  context('retry', () => {
    context('resolve before exceed max retry times', () => {
      let callCount: number;
      let rawAsyncFn: WrappedCallback;
      let maxTimes: number;
      beforeEach(() => {
        options = {
          expiresInSec: 2,
          maxTryTimes: 3,
          parallel: 1,
        };

        callCount = 0;
        maxTimes = options.maxTryTimes;
        rawAsyncFn = asyncFunc;
        asyncFunc = async (id: string) => {
          if (++callCount < maxTimes) {
            throw new Error(`Call count has not reach ${maxTimes} yet.`);
          }
          return rawAsyncFn(id);
        };

        initIns();
      });
      afterEach(() => {
        asyncFunc = rawAsyncFn;
      });
      it('should get result', async () => {
        const ret = await asyncGetter.load('one');
        expect(ret).to.equals(1);
        expect(callCount).to.equals(maxTimes);
      });
    });

    context('never resolve before exceed max retry times', () => {
      let callCount: number;
      let rawAsyncFn: WrappedCallback;
      let maxTimes: number;
      beforeEach(() => {
        options = {
          expiresInSec: 2,
          maxTryTimes: 3,
          parallel: 1,
        };

        callCount = 0;
        maxTimes = options.maxTryTimes;
        rawAsyncFn = asyncFunc;
        asyncFunc = async (id: string) => {
          if (++callCount <= maxTimes) {
            throw new Error(`Always throws error.`);
          }
          return rawAsyncFn(id);
        };

        initIns();
      });
      afterEach(() => {
        asyncFunc = rawAsyncFn;
      });
      it('should get result', async () => {
        const p = expect(asyncGetter.load('one')).to.eventually.rejectedWith(`Always throws error.`);
        await p;
        expect(callCount).to.equals(options.maxTryTimes);
        return p;
      });
    });
  });

  context('never timeout', () => {
    let callCount: number;
    let rawAsyncFn: WrappedCallback;
    let maxTimes: number;
    beforeEach(() => {
      options = {
        expiresInSec: 0,
        maxTryTimes: 3,
        parallel: 1,
      };

      callCount = 0;
      maxTimes = options.maxTryTimes;
      rawAsyncFn = asyncFunc;
      asyncFunc = async (id: string) => {
        ++callCount;
        await new Promise(r => setTimeout(r, 400));
        if (callCount < maxTimes) {
          throw new Error(`Call count has not reach ${maxTimes} yet.`);
        }
        return rawAsyncFn(id);
      };

      initIns();
    });
    afterEach(() => {
      asyncFunc = rawAsyncFn;
    });
    it('should reject with timeout error', async () => {
      await expect(asyncGetter.load('one')).to.eventually.equals(1);
    });
  });

  context('timeout', () => {
    context('executing time exceed `options.expiresInSec`', () => {
      let callCount: number;
      let rawAsyncFn: WrappedCallback;
      let maxTimes: number;
      beforeEach(() => {
        options = {
          expiresInSec: 1,
          maxTryTimes: 3,
          parallel: 1,
        };

        callCount = 0;
        maxTimes = options.maxTryTimes;
        rawAsyncFn = asyncFunc;
        asyncFunc = async (id: string) => {
          ++callCount;
          await new Promise(r => setTimeout(r, 400));
          if (callCount < maxTimes) {
            throw new Error(`Call count has not reach ${maxTimes} yet.`);
          }
          return rawAsyncFn(id);
        };

        initIns();
      });
      afterEach(() => {
        asyncFunc = rawAsyncFn;
      });
      it('should reject with timeout error', async () => {
        await expect(asyncGetter.load('one')).to.eventually.rejectedWith('Async getter executed timeout.')
        expect(callCount).to.equals(maxTimes);
      });
    });
  });
});
