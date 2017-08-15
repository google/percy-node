const path = require('path');
const percyNodeClient = require(path.join(__dirname, '..', 'src', 'percy-node-client'));
const nock = require('nock');


describe('percyNodeClient', function() {
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
  };

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
            }
          ]
        }
      },
      attributes: {
        'web-url': 'https://percy.io/foo/bar/builds/123'
      }
    }
  };
  // relationships['missing-resources'].data
  //

  const UPLOAD_RESOURCE_RESPONSE_MOCK = {success: true};

  beforeEach(function() {
    // Mock process environment variables.
    process.env.PERCY_TOKEN = 'abcxyz';
    process.env.PERCY_PROJECT = 'foo/bar';
    process.env.PERCY_BRANCH = 'foo-branch';

    spyOn(percyNodeClient.logger, 'log');

    // TODO: Mock PercyClient.
  });

  describe('when percy is missing assets', function() {
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

    it('should create a build', (done) => {
      const setupPromise = percyNodeClient.setup(
          BUILD_DIRS, PATHS_TO_REPLACE, BREAKPOINT_CONFIG,
          enableDebugMode);

      setupPromise.then(() => {
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
      const setupPromise = percyNodeClient.setup(
          BUILD_DIRS, PATHS_TO_REPLACE, BREAKPOINT_CONFIG,
          enableDebugMode);

      setupPromise.then(() => {

        expect(percyNodeClient.logger.log.calls.argsFor(2)[0])
            .toContain('[percy] Uploaded new build resource:');
        expect(percyNodeClient.logger.log.calls.argsFor(2)[0])
            .toContain('/assets/styles.css');
        done();
      });
    });


  });
});
