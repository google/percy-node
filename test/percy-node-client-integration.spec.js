/**
 * Copyright 2017 Google Inc.
 *
 * Use of this source code is governed by a MIT-style
 * license that can be found in the LICENSE file or at
 * https://opensource.org/licenses/MIT.
 *
 * Integration test. This test ensures the percy-node-client.js is working
 * properly with the percy-js package.
 */

const path = require('path');
const percyNodeClient = require(path.join(__dirname, '..', 'src',
    'percy-node-client'));
const nock = require('nock');


describe('percyNodeClient', function() {
  let setupPromise;
  let nockRequests = {};
  // Change to true for helpful debugging.
  const enableDebugMode = false;

  // Directory of assets to upload to percy (e.g. images, css)
  const BUILD_DIRS = ['test/mock-project/assets/**'];
  // Paths that shouldn't be part of the final url path.
  // E.g.
  // including `/full/path/to/site/` will convert
  // /full/path/to/site/assets/images/foo.jpg --> /assets/images/foo.jpg
  const PATHS_TO_REPLACE = [
    process.cwd() + 'test/mock-project',
  ];

  const BREAKPOINT_CONFIG = {
    small: 600,
    large: 1440,
  };

  const API_URLS = {
    CREATE_BUILD: '/api/v1/projects/foo/bar/builds/',
    UPLOAD_RESOURCE: '/api/v1/builds/123/resources/',
    CREATE_SNAPSHOT: '/api/v1/builds/123/snapshots/',
    FINALIZE_SNAPSHOT: '/api/v1/snapshots/snapshot1/finalize',
    FINALIZE_BUILD: '/api/v1/builds/123/finalize',
  };

  const BUTTON_SNAPSHOT = `
    <body>
      <button class="bogus">Red</button>
    </body>
  `;

  // TODO: Move mock to separate file.
  const BUILD_RESPONSE_MOCK = {
    data: {
      id: '123', // Unique build id for this build.
      relationships: {
        'missing-resources': {
          // An array of resources the percy api says it doesn't yet have.
          data: [
            {
              // Hash for /assets/styles.css
              id: '34dcd364992c6d3620b8d9db413a0b6fc0bd536cb9911e3f434969988f216b54'
            },
          ]
        }
      },
      attributes: {
        'web-url': 'https://percy.io/foo/bar/builds/123'
      }
    }
  };

  const SUCCESS_RESPONSE_MOCK = {success: true};

  const CREATE_SNAPSHOT_RESPONSE_MOCK = {
    data: {
      id: 'snapshot1',
      relationships: {
        'missing-resources': {
          // An array of resources the percy api says it doesn't yet have.
          data: [
            {
              // Hash for buttons.
              id: 'TODO'
            },
          ]
        }
      },
    }
  };

  beforeEach(function() {
    // Mock process environment variables.
    process.env.PERCY_TOKEN = 'abcxyz';
    process.env.PERCY_PROJECT = 'foo/bar';
    process.env.PERCY_BRANCH = 'foo-branch';

    spyOn(percyNodeClient.logger, 'log');
  });

  describe('when percy is missing assets', function() {
    beforeEach(function() {

      // Mock the initial build post request.
      nockRequests.createBuild = nock('https://percy.io')
          .post(API_URLS.CREATE_BUILD)
          .reply(201, BUILD_RESPONSE_MOCK);

      // I don't actually know what this request is. I don't see references
      // to it in the percy-js client.
      nockRequests.buildsRequest = nock('https://percy.io')
          .post('/api/v1/repos/foo/bar/builds/')
          .reply(201, BUILD_RESPONSE_MOCK);

      nockRequests.uploadCss = nock('https://percy.io')
          .post(API_URLS.UPLOAD_RESOURCE)
          .reply(201, SUCCESS_RESPONSE_MOCK);
      nockRequests.uploadHtmlSnapshot = nock('https://percy.io')
          .post(API_URLS.UPLOAD_RESOURCE)
          .reply(201, SUCCESS_RESPONSE_MOCK);
      nockRequests.createSnapshot = nock('https://percy.io')
          .post(API_URLS.CREATE_SNAPSHOT)
          .reply(201, CREATE_SNAPSHOT_RESPONSE_MOCK);
      nockRequests.finalizeSnapshot = nock('https://percy.io')
          .post(API_URLS.FINALIZE_SNAPSHOT)
          .reply(201, SUCCESS_RESPONSE_MOCK);
      nockRequests.finalizeBuild = nock('https://percy.io')
          .post(API_URLS.FINALIZE_BUILD)
          .reply(201, SUCCESS_RESPONSE_MOCK);

      setupPromise = percyNodeClient.setup(
          BUILD_DIRS, PATHS_TO_REPLACE, BREAKPOINT_CONFIG,
          enableDebugMode);
    });

    it('should create a build', (done) => {
      setupPromise.then(() => {
        nockRequests.createBuild.isDone();
        nockRequests.buildsRequest.isDone();
        expect(percyNodeClient.logger.log.calls.argsFor(0)[0])
            .toBe('[percy] Setting up project "foo/bar"');
        expect(percyNodeClient.logger.log.calls.argsFor(1)[0])
            .toBe('\n[percy] Build created:');
        expect(percyNodeClient.logger.log.calls.argsFor(1)[1])
            .toBe('https://percy.io/foo/bar/builds/123');
        done();
      });
    });

    it('should upload missing assets', (done) => {
      setupPromise.then(() => {
        nockRequests.uploadCss.isDone();
        expect(percyNodeClient.logger.log.calls.argsFor(2)[0])
            .toContain('[percy] Uploaded new build resource:');
        expect(percyNodeClient.logger.log.calls.argsFor(2)[0])
            .toContain('/assets/styles.css');
        done();
      });
    });

    it('should upload missing snapshots', (done) => {
      setupPromise.then(() => {
        percyNodeClient.snapshot('buttons', BUTTON_SNAPSHOT,
            ['small', 'large']);
        nockRequests.uploadHtmlSnapshot.isDone();
        percyNodeClient.finalizeBuild().then(() => {
          nockRequests.finalizeSnapshot.isDone();
          done();
        });
      });
    });

    it('should finalize the build', (done) => {
      setupPromise.then(() => {
        percyNodeClient.snapshot('buttons', BUTTON_SNAPSHOT,
             ['small', 'large']);
        percyNodeClient.finalizeBuild().then(() => {
          nockRequests.finalizeBuild.isDone();
          expect(percyNodeClient.logger.log.calls.argsFor(3)[0])
              .toBe('[percy] Finalizing build...');

          // Have to delay here because of process.nextTick in finalizeBuild.
          setTimeout(() => {
            expect(percyNodeClient.logger.log.calls.argsFor(4)[0])
                .toBe('[percy] Visual diffs are now processing:');
            expect(percyNodeClient.logger.log.calls.argsFor(4)[1])
                .toBe('https://percy.io/foo/bar/builds/123');
            done();
          }, 10);
        });
      });
    });
  });
});
