# How to use percy-node with Protractor

This guide details how to use percy node with [Protractor](http://www.protractortest.org/#/) which is ideal for end to end tests for AngularJS apps or Angular (2+) apps.

**Note:** We haven't actually verified this works with Angular2+ yet so if you are able to get it working, please let us know. We welcome contributions to this documentation.

## Configuration

We assume you've already successfully gotten protractor to launch your server and execute some tests against your app. If you haven't gotten this far yet, please read the [Protractor tutorial](http://www.protractortest.org/#/tutorial)

### Configure directories

At the top of your protractor configuration file (e.g. `conf.js`), declare the constants `ASSET_DIRS` and `PATHS_TO_REPLACE`

`conf.js`

```javascript
const ASSET_DIRS = [
  'mysite/assets/**',
  'mysite/css/**'
];

const PATHS_TO_REPLACE = [
  process.cwd() + '/mysite/',
];

const BREAKPOINT_WIDTH = {
  'x-small': 320,
  small: 600,
  medium: 1024,
  large: 1440,
};

exports.config = {
  ...
```

#### `ASSET_DIRS`

In this constant, define paths for your static assets such as images, compiled 
css, and optionally your compiled js. These paths should be relative starting 
from the directory where protractor will be executed (typically starting from 
the root of your project). It supports globs.


#### `PATHS_TO_REPLACE`

These are path partials to be removed from the `ASSET_DIRS` paths to create the 
urls. For example if you have `/root/path/to/project/mysite/assets/ponies.jpg` 
and it's accessible on your webserver at `localhost:8000/assets/ponies.jpg`, 
then you'll want to remove everything up to and including `/mysite/`.

#### `BREAKPOINT_WIDTH`

This is an object where the key is the name of your breakpoint and the value is
the pixel width of the breakpoint. You will refer to these breakpoints by name
in your snapshots later.

### Define `onPrepare`

Again, in your protractor configuration file (e.g `conf.js`), import the
`percy-node` package and add or modify your `onPrepare` method as follows.

`conf.js`

```javascript
const percyNodeClient = require('percy-node');


exports.config = {
  ...

  // onPrepare waits for the returned promise to resolve before beginning
  // the tests. So make sure you either return the promise from
  // percyNodeClient.setup() or create your own custom promise.
  onPrepare: function() {
    // Add code to start your server here.

    // Return promise so Protractor wont begin until percyNodeClient setup
    // promise resolves.
    return percyNodeClient.setup(ASSET_DIRS, PATHS_TO_REPLACE,
        BREAKPOINT_WIDTH);
  
  },
};


```


Here's another example for the `onPrepare` method with a custom promise and express server.

`conf.js`

```javascript

const server = require('./server.js'); // Express server.
const percyNodeClient = require('percy-node');

...

exports.config = {
  ...
  onPrepare: function() {
    return new Promise((resolve) => {      
      server.start(9000).then((url) => {
        browser.params.testUrl = url;
        percyNodeClient.setup(ASSET_DIRS, PATHS_TO_REPLACE,
            BREAKPOINT_WIDTH).then(resolve);
      });
    });
  
  },
};
```

### Define `onComplete`
Continuing in your protractor configuration file, add an `onComplete` property
to the configuration.

`conf.js`

```javascript
exports.config = {
  ...
  onComplete: function() {
    // Add code to stop your server here.
  
    return percyNodeClient.finalizeBuild();
  }
};
```

If you're using a node express server, here's how this might look:

`conf.js`

```javascript

const server = require('./server.js'); // Express server.

...

exports.config = {
  ...
  onComplete: function() {
    server.stop();
    return percyNodeClient.finalizeBuild();
  }
};
```

## Create snapshot helper

After completing the configurations above, you'll need to define a helper method
to reuse in your test specs. Here's one you can start with but feel free to
customize it to your needs. This one grabs the entire html document to send to
percy.

`percy-helpers.js`

```javascript

/**
 * Takes a snapshot of the current dom and passes it to percy to be processed.
 *
 * @param {string} name The unique name to give this snapshot which appears in
 *     the percy UI.
 * @param {Array<string>} breakpoints The names of which breakpoints you want
 *     percy to take snapshots in.
 * @param {*} browser Reference to selenium webdriver browser.
 * @param {!Function} done The jasmine callback to call when the snapshot
 *     process completes.
 * @param {string=} opt_selector A jquery like selector to use.
 *     Uses 'html' by default.
 */
function snapshot(name, breakpoints, browser, done, opt_selector = 'html') {
  browser.executeScript('return arguments[0].outerHTML;',
      $(opt_selector)).then((content) => {
    percyNodeClient.snapshot(name, content, breakpoints);
    done();
  });
}

module.exports = {snapshot};
```


## Add test specs

Now you can write your jasmine test specs. With this example, you can only have one snapshot per `it()` block unless you setup a promise pool or promise chain.

`homepage.spec.js`

```javascript
const protractorHelpers = require('../path/to/percy-helpers');

describe(function('Homepage') {
  // Note that the function is accepting a `done` parameter.
  it('should look awesome-o', (done) => {
    // Navigate to the page you want snapshots of.
    browser.get('http://localhost:9000/home');
  
    protractorHelpers.snapshot('homepage',
        ['small', 'medium'], browser, done);
  });
});
```
