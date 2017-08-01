const path = require('path');
const assert = require('assert');
const sinon = require('sinon');
const percyNodeClient = require(path.join(__dirname, '..', 'src', 'percy-node-client'));



describe('percyNodeClient', function() {
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
  const BUILD_RESPONSE_MOCK = {foo: 123};

  const UPLOAD_RESOURCE_RESPONSE_MOCK = {success: true};

  beforeEach(function() {
    // Mock process environment variables.
    process.env.PERCY_TOKEN = 'abcxyz';
    process.env.PERCY_PROJECT = 'foo/bar';
    // TODO: Mock PercyClient.
  });

  context('when percy is missing assets', function() {
    beforeEach(function() {
      // Mock the initial build post request.
      nock('https://percy.io').post(API_URLS.CREATE_BUILD)
          .reply(201, BUILD_RESPONSE_MOCK);
      // Mock the upload asset requests.
      nock('https://percy.io').post(API_URLS.UPLOAD_RESOURCE)
          .reply(201, UPLOAD_RESOURCE_RESPONSE_MOCK);

    });

    it('should upload assets', function(done) {
      const setupPromise = percyNodeClient.setup(
          BUILD_DIRS, PATHS_TO_REPLACE, BREAKPOINT_CONFIG);

      setupPromise.then(() => {
        // TODO: Revise client to use a separate logging object.
        // TODO: Stub the logging object.
        // TODO: Assert log triggered saying it uploaded styles.css

        done();
      });
    });
  });



  it('should run tests', function() {
    assert.equal(true, true);
  });
});
