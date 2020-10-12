const { promises: promisifiedFS, readFileSync } = require('fs');
const { join } = require('path');
const { deepStrictEqual } = require('assert');

const { AsyncGetter, Options } = require('../dist');

const FILE_PATH = join(__dirname, './number-list.json');
const CALL_TIMES = 1e4;

const getFromJson = (k) =>
  promisifiedFS.readFile(FILE_PATH)
    .then(data => {
      const json = JSON.parse(data.toString('utf8'));
      return json[k];
    });

const readJSONSync = (k) => {
  const data = readFileSync(FILE_PATH);
  const json = JSON.parse(data.toString('utf8'));
  return json[k];
};

const callDirectly = (c = CALL_TIMES) => {
  const list = [];
  while (c--) {
    list.push(getFromJson('one'));
  }
  return Promise.all(list);
};

const callSync = (c = CALL_TIMES) => {
  const list = [];
  while(c--) {
    list.push(readJSONSync);
  }
  return list;
};

const getAsyncGetter = (options) =>
  new AsyncGetter(getFromJson, options);

const callByAsyncGetter = (instance, c = CALL_TIMES) => {
  const asyncGetter = instance || new AsyncGetter(getFromJson, {
    expiresInSec: 3,
    maxTryTimes: 3,
    parallel: 3,
  });

  const list = [];
  while(c--) {
    list.push(asyncGetter.load('one'));
  }

  return Promise.all(list);
};

module.exports = {
  callDirectly,
  callByAsyncGetter,
  callSync,
  getAsyncGetter,
};

require.main == module && (() => {
  console.time('callDirectly');
  let l1, l2;
  const p1 = callDirectly()
    .then(res => {
      console.timeEnd('callDirectly');
      l1 = res;

      console.time('callByAsyncGetter');
      return callByAsyncGetter()
    })
    .then(res => {
      console.timeEnd('callByAsyncGetter');
      l2 = res;
    })
    .then(() => {
      deepStrictEqual(l1, l2);
    });
})();
