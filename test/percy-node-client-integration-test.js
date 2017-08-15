const path = require('path');
const assert = require('assert');
const sinon = require('sinon');
const percyNodeClient = require(path.join(__dirname, '..', 'src', 'percy-node-client'));
const nock = require('nock');


describe('percyNodeClient', function() {
  let stubLogger;
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
  };

  // TODO: Move mock to separate file.
  const BUILD_RESPONSE_MOCK = {
    data: {
      attributes: {
        'web-url': 'https://percy.io/foo/bar/builds/123'
      }
    }
  };

  const UPLOAD_RESOURCE_RESPONSE_MOCK = {success: true};

  beforeEach(function() {
    // Mock process environment variables.
    process.env.PERCY_TOKEN = 'abcxyz';
    process.env.PERCY_PROJECT = 'foo/bar';
    //process.env.PERCY_BRANCH = 'foo-branch';

    stubLogger = sinon.stub(percyNodeClient.logger, 'log').callsFake(() => {});

    // TODO: Mock PercyClient.
  });

  afterEach(function() {
    percyNodeClient.logger.log.restore();
  });

  context('when percy is missing assets', function() {
    beforeEach(function() {
      // Mock the initial build post request.
      nock('https://percy.io').post(API_URLS.CREATE_BUILD)
          .reply(201, BUILD_RESPONSE_MOCK);
      // TODO: Determine what this request is. I wasn't expecting it and
      // can't find a reference to it anywhere.
      nock('https://percy.io').post('/api/v1/repos/foo/bar/builds/')
          .reply(201, BUILD_RESPONSE_MOCK);
      // Mock the upload asset requests.
      nock('https://percy.io').post(API_URLS.UPLOAD_RESOURCE)
          .reply(201, UPLOAD_RESOURCE_RESPONSE_MOCK);

    });

    it('should upload assets', function(done) {
      const setupPromise = percyNodeClient.setup(
          BUILD_DIRS, PATHS_TO_REPLACE, BREAKPOINT_CONFIG);

      setupPromise.then(() => {
        assert.equal(percyNodeClient.logger.log.getCall(0).args[0],
            '[percy] Setting up project "foo/bar"');
        assert.equal(percyNodeClient.logger.log.getCall(1).args[0],
            '\n[percy] Build created:');
        assert.equal(percyNodeClient.logger.log.getCall(1).args[1],
            'https://percy.io/foo/bar/builds/123');
        assert.equal(percyNodeClient.logger.log.getCall(2).args[0],
            '[percy] Uploaded new build resource: /assets/styles.css',
            'upload build resource');
        console.log('after fourth assert');
        done();
      });
    });
  });
});
