const Benchmark = require('benchmark');

const {
  callDirectly,
  callByAsyncGetter,
  callSync,
  getAsyncGetter,
} = require('./read-file');

const suite = new Benchmark.Suite;

let ins;
const getIns = () => {
  if (!ins) {
    ins = getAsyncGetter({
      expiresInSec: 3,
      maxTryTimes: 3,
      parallel: 1,
    });
  }
  return ins;
};

// add tests
suite
  .add('ReadFile#callDirectly', () => callDirectly(1))
  .add('ReadFile#callByAsyncGetter', () => callByAsyncGetter(getIns(), 1))
  // .add('ReadFile#callSync', () => callSync(1))

// add listeners
.on('cycle', function(event) {
  console.log(String(event.target));
})
.on('complete', function() {
  console.log('Fastest is ' + this.filter('fastest').map('name'));
})
// run async
.run({ 'async': true });
