/**
 * Copyright 2017 Google Inc.
 *
 * Use of this source code is governed by a MIT-style
 * license that can be found in the LICENSE file or at
 * https://opensource.org/licenses/MIT.
 *
 *
 * @fileoverview Node utilities for working with the percy client.
 * https://github.com/percy/percy-js
 *
 * Based on the ember percy utilities:
 * https://github.com/percy/ember-percy/blob/fe475031437fb7da33edb256d812164dfbddc94b/index.js
 *
 * Example usage:
 * Configure protractor configuration as follows:
 *
 * protractor.karma.conf.js
 * const percyNodeClient = require('./percy-node-client.js');
 *
 * exports.config = {
 *   ...
 *   onPrepare: function() {
 *     // You may have to write a custom promise to combine this with a
 *     // server setup step. See below for param documentation.
 *     return percyUtil.setup(...);
 *   },
 *   onComplete: function() {
 *     return percyUtil.finalizeBuild();
 *   },
 * };
 *
 *
 * Overall flow of how to use these utilities and what they do.
 *
 * setup()
 *   Do this once before tests begin in the protractor `onPrepare` phase.
 *
 * snapshot()
 *   In each spec, call snapshot() which will create a snapshot of the html in
 *   the page and pass it to percyClient.
 *
 * finalizeBuild()
 *   Runs in protractor onComplete phase after all test specs are finished by
 *   sending all of the snapshots together to percy api for processing.
 *
 *
 * Note: This client does not return any sort of status as to whether the
 * snapshots match or not. You have to check the percy dashboard to see if
 * snapshots differ.
 *
 * Here's a gist showing how you can check if diffs pass and return error exit
 * code if it fails. But this API is not advertised by Percy publicly so
 * support for it is limited.
 * https://gist.github.com/rdy/cb67b9c5403817b7dea3efcfc67429c7
 */

const crypto = require('crypto');
const walk = require('walk');
const fs = require('fs');
const PercyClient = require('percy-client');
const PromisePool = require('es6-promise-pool');
const Environment = require('percy-client/dist/environment');
const globby = require('globby');

const MAX_FILE_SIZE_BYTES = 15728640;  // 15MB.


var percyClient, percyBuildPromise;
var isPercyEnabled = true;
var isDebugEnabled = false;


/**
 * An array of promises for when snapshots have finished uploading.
 * @type {Array<Promise>}
 */
const snapshotResourceUploadPromises = [];


/**
 * A list of resources that percy does not yet have uploaded.
 * @type {Array<Promise>}
 */
const buildResourceUploadPromises = [];


/**
 * A key value pairing where the key is the name of the breakpoint and the value
 * is the pixel width of the breakpoint.
 * @type {Object<string, number>}
 */
var registeredBreakpoints = {};


/**
 * Maximum trys to retrieve the build infomation from the Percy server.
 * @const {number}
 */
let MAX_RETRIES_WHEN_PROCESSING = 1000;


/**
 * After app is ready, create a percy build and upload assets. Call this only
 * once per protractor test run (so in the karma onPrepare phase).
 * Call this in the protractor onPrepare() phase. It should be called only
 * once to setup the percy client to be shared across all specs.
 *
 *   It will:
 *   - create percy client
 *   - create manifest of asset (css, images) and send it to percy to determine
 *     which are missing from percy's server.
 *   - upload missing assets to percy.
 *
 * @param {Array<string>} buildDirs The directories where assets are stored.
 * @param {Array<string>} rootDirs The directory for the root of the app.
 *     This is used to change a local path to a url path.
 * @param {Object<string,number>} breakpointsConfig A key value pairing where
 *     the key is the name of the breakpoint and the value is the pixel width of
 *     the breakpoint. E.g.
 *     {
 *       small: 320,
 *       medium: 768,
 *       large: 1024,
 *     }
 * @param {boolean=} opt_isDebugEnabled If debug mode is enabled.
 * @return {Promise} Resolves when all assets have been uploaded to percy.
 */
async function setup(buildDirs, rootDirs, breakpointsConfig,
                     opt_isDebugEnabled = false) {
  registeredBreakpoints = breakpointsConfig;
  isDebugEnabled = opt_isDebugEnabled;
  const environment = new Environment(process.env);
  logger.log(`[percy] Setting up project "${process.env.PERCY_PROJECT}"`);
  percyClient = new PercyClient({
    token: process.env.PERCY_TOKEN,
    clientInfo: process.env.PERCY_PROJECT,
    environment: environment,
    // Not sure if we actually have to populate this with anything.
    environmentInfo: '',
  });
  const resourceManifestDict = gatherBuildResources(
      percyClient, buildDirs, rootDirs);

  // Convert resources from dict to array. Still may need dict later.
  const resourceManifestArr = [];
  Object.keys(resourceManifestDict).forEach(function(key) {
    resourceManifestArr.push(resourceManifestDict[key]);
  });

  logDebug('Resource manifest', resourceManifestArr);

  // Initialize the percy client and a new build.
  // environment.repo is defined by the PERCY_PROJECT environment variable.
  let repo = environment.repo;
  // This tells the percy server about all of our build assets. The promise
  // returns a build response which notifies us if any of the assets are not
  // yet uploaded to the server.
  // Return a promise and only resolve when all build resources are uploaded,
  // which ensures that the output build dir is still available to be read from
  // before deleted.
  try {
    // Assign to module variable so we can chain off of it elsewhere.
    percyBuildPromise = percyClient.createBuild(repo,
        {resources: resourceManifestArr});
    const buildResponse = await percyBuildPromise;

    // Here we process the response to check if percy says it's missing
    // any of the assets. For the ones it's missing, we upload them.
    var percyBuildData = buildResponse.body.data;
    //console.log('PERCY BUILD RESPONSE', buildResponse.body);
    logger.log('\n[percy] Build created:',
        percyBuildData.attributes['web-url']);

    // Upload all missing build resources.
    var missingResources = parseMissingResources(buildResponse);
    logDebug('Missing resources', missingResources);
    if (missingResources && missingResources.length > 0) {
      await uploadMissingResources(percyBuildData.id, missingResources,
          resourceManifestDict);
    }
  } catch (err) {
    handlePercyFailure(err);
  }
}


/**
 * Creates a dom snapshot and adds it to the percy client.
 * It will:
 *   - create config for snapshot widths.
 *   - call percySnapshot() passing widths and html content.
 *   - trigger uploading snapshots to percy if it doesn't already have them.
 *
 * @param {string} name The name to use for this snapshot.
 *     E.g. 'carousel-simple'
 * @param {string} content The html content as a string to take a snapshot of.
 * @param {Array<string>=} opt_breakpoints A list of breakpoint names.
 * @param {boolean=} opt_enableJs Whether or not to enable javascript.
 */
function snapshot(name, content, opt_breakpoints, opt_enableJs) {
  const enableJs = opt_enableJs || false;
  const defaultBreakpointNames = Object.keys(
      registeredBreakpoints);
  // Transform the `breakpoints` array of named breakpoints into an array of
  // integer widths, mapped by the breakpoints config.
  /** @type {Array<string>} */
  var breakpointNamesList = opt_breakpoints || defaultBreakpointNames;

  const widths = getWidthsFromBreakpointNames(breakpointNamesList);

  // Add a new promise to the list of resource uploads so that finalize_build
  // can wait on resource uploads. We MUST do this immediately here with a
  // custom promise, not wait for the nested `uploadResource()` promise below,
  // to avoid creating a race condition where the uploads array may be missing
  // some possible upload promises.
  //
  // Nasty way to get a reference to the `resolve` method so that we can
  // manually resolve this promise below.
  // http://stackoverflow.com/a/26150465/128597
  var resolveAfterHtmlResourceUploaded;
  var htmlResourceUploadedPromise = new Promise(function(resolve) {
    resolveAfterHtmlResourceUploaded = resolve;
  });
  snapshotResourceUploadPromises.push(htmlResourceUploadedPromise);

  percyBuildPromise.then(function(buildResponse) {
    const percyBuildData = buildResponse.body.data;

    // Construct the root resource and create the snapshot.
    var htmlResource = percyClient.makeResource({
      resourceUrl: '/',
      content: content,
      isRoot: true,
      mimetype: 'text/html',
    });

    var snapshotPromise = percyClient.createSnapshot(
        percyBuildData.id,
        [htmlResource],
        {
          name: name,
          widths: widths,
          enableJavaScript: enableJs,
        });

    // Upload missing resources (just the root resource HTML in this case).
    snapshotPromise.then((response) => {
      var snapshotId = response.body.data.id;

      var missingResources = parseMissingResources(response);
      logDebug('Missing snapshot resources', missingResources);
      uploadHtml(percyBuildData.id, snapshotId, htmlResource, missingResources,
          resolveAfterHtmlResourceUploaded);
    }, (error) => {
      // TODO: Exit with error exit code? May not want to silently let this
      // pass. Need to discuss as a team our strategy for handling failures with
      // percy and determine how reliable percy is.
      if (error.statusCode && error.statusCode == 400) {
        console.warn(
            '[percy][WARNING] Bad request error, skipping snapshot: ' + name
        );
        console.warn(error.toString());
        // Skip this snapshot, resolve on error to unblock the finalization
        // promise chain.
        resolveAfterHtmlResourceUploaded();
      } else {
        handlePercyFailure(error);
      }
    });
  });
}


/**
 * Sent another request to the Percy server if the number of tries does not exceed the limit. 
 * @param {string} buildId Percy Build ID.
 * @param {number} numRetries The number of get build requests to the server.
 * @param {function} resolve Promise resolve function.
 */
function retry(buildId, numRetries, resolve) {
  if (numRetries < MAX_RETRIES_WHEN_PROCESSING) {
      // Retry with recursion with retries incremented
      return setTimeout(checkBuildStatus, 1000, buildId, numRetries + 1, resolve);
  } else {
      handleError('Retries exceeded. Exiting.');
  }
}


/**
 * Retrieve the build information from the Percy server, send another request to the server
 * if the build state is processing or pending. Once the build is finished, check for diffs and
 * display errors if there are diffs.
 * @param {string} buildId Percy Build ID.
 * @param {number} numRetries The number of get build requests to the server.
 * @param {function} resolve Promise resolve function.
 */
async function checkBuildStatus(buildId, numRetries, resolve) {
  const response = await percyClient.getBuild(buildId);
  const {body: {data: {attributes}}}  = response;
  const {state} = attributes;
  if (state == 'processing' || state == 'pending') {
      retry(buildId, numRetries, resolve);
  } else if (state == 'finished'){
    const totalDiffs = attributes['total-comparisons-diff'];
      if (totalDiffs) {
        const url = attributes['web-url'];
        handleError('percy', `diffs found: ${totalDiffs}. Check ${url}`);
      } else {
        logger.log('Hooray! The build is successful with no diffs. \\o/');
      }
      resolve();
  } else if (state == 'failed') {
    handleError('percy', `build failed: ${attributes['failure-reason']}`);
    resolve();
  }
}


/**
 * Return a promise that gets build information.
 * @param {string} buildId Percy Build ID.
 * @return {Promise} Promise object gets resolved when build is finished.
 */
function getBuildPromise(buildId) {
  return new Promise(function(resolve, reject) {
    checkBuildStatus(buildId, 0, resolve);
  });
}


/**
 * Finalizes the request to be sent to Percy api which includes all the assets,
 * snapshots, etc.
 * Return this in karma onComplete() phase after all test specs have been run.
 * @param {boolean} getDiffs Set to true to output build results.
 * @return {Promise}
 */
async function finalizeBuild(getDiffs = false) {
  logger.log('[percy] Finalizing build...');

  try {
    // These promises need to be processed sequentially, not concurrently.
    const {body: {data: percyBuildData}} = await percyBuildPromise;
    // We also need to wait until all snapshot resources have been uploaded.
    // We do NOT need to wait until the snapshot itself has been finalized, just
    // until resources are uploaded.
    await Promise.all(snapshotResourceUploadPromises);
    // Finalize the build.
    await percyClient.finalizeBuild(percyBuildData.id);
    // Avoid trying to add snapshots to an already-finalized build. This might
    // happen when running tests locally and the browser gets refreshed after
    // the end of a test run. Generally, this is not a problem because tests
    // only run in CI and only once.
    isPercyEnabled = false;

    // Attempt to make our logging come last, giving time for test output to finish.
    var url = percyBuildData.attributes['web-url'];
    process.nextTick(function() {
      logger.log('[percy] Visual diffs are now processing:', url);
    });

    if (getDiffs) {
      await getBuildPromise(percyBuildData.id);
    }

  } catch (err) {
    handlePercyFailure(err);
  }
}


/**
 * Reads the filesystem for assets and assembles an object to be handed to percy
 * so it can upload the assets.
 * Synchronously walk the build directory, read each file and calculate its
 * SHA 256 hash, and create a mapping of hashes to Resource objects.
 * @param {PercyClient} percyClient
 * @param {Array<string>} buildDirs the directory to look in for assets.
 * @param {Array<string>} rootDirs The directory for the root of the app.
 *     This is used to change a local path to a url path.
 * @return {Object<string,PercyClient.Resource>}
 *     {@see https://github.com/percy/percy-js/blob/master/src/main.js#L9}
 */
function gatherBuildResources(percyClient, buildDirs, rootDirs) {
  const hashToResource = {};
  const paths = globby.sync(buildDirs, {absolute: true, nodir: true});

  let absolutePath, resourceUrl, content, sha;
  for (let i = 0; i < paths.length; i++) {
    absolutePath = paths[i];
    resourceUrl = absolutePath;
    rootDirs.forEach((rootDir) => {
      resourceUrl = resourceUrl.replace(rootDir, '');
    });
    if (resourceUrl.charAt(0) !== '/') resourceUrl = '/' + resourceUrl;
    // Skip large files.
    if (fs.statSync(absolutePath)['size'] > MAX_FILE_SIZE_BYTES) {
      console.warn('\n[percy][WARNING] Skipping large build resource: ',
          resourceUrl);
      continue;
    }

    content = fs.readFileSync(absolutePath);
    sha = crypto.createHash('sha256').update(content).digest('hex');

    hashToResource[sha] = percyClient.makeResource({
      resourceUrl: encodeURI(resourceUrl),
      sha: sha,
      localPath: absolutePath,
    });
  }

  return hashToResource;
}


/**
 * Uploads to percy any assets (such as css, images, js, etc) that it doesn't
 * already have cached on its servers.
 * @param {number} buildId
 * @param {Array<{id: number}>} missingResources
 * @param {Object<string,PercyClient.Resource>} resourceManifestDict
 */
async function uploadMissingResources(
    buildId, missingResources, resourceManifestDict) {
  var missingResourcesIndex = 0;
  var promiseGenerator = function() {
    var missingResource = missingResources[missingResourcesIndex];
    missingResourcesIndex++;

    if (missingResource) {
      var resource = resourceManifestDict[missingResource.id];
      var content = fs.readFileSync(resource.localPath);

      // Start the build resource upload and add it to a collection we can
      // block on later because build resources must be fully uploaded before
      // snapshots are finalized.
      var promise = percyClient.uploadResource(buildId, content);
      promise.then((response) => {
        logger.log(
            `[percy] Uploaded new build resource: ${resource.resourceUrl}`);
      }, handlePercyFailure);
      buildResourceUploadPromises.push(promise);

      return promise;
    } else {
      // Trigger the pool to end.
      return null;
    }
  };

  // We do this in a promise pool for two reasons: 1) to limit the number of
  // files that are held in memory concurrently, and 2) without a pool, all
  // upload promises are created at the same time and request-promise timeout
  // settings begin immediately, which timeboxes ALL uploads to finish within
  // one timeout period. With a pool, we defer creation of the upload promises,
  // which makes timeouts apply more individually.
  var concurrency = 2;
  var pool = new PromisePool(promiseGenerator, concurrency);

  // Wait for all build resource uploads before we allow the addon build step to
  // complete. If an upload failed, resolve anyway to unblock the building
  // process.
  await pool.start();
}


/**
 * Uploads the html snapshot to percy if it doesn't already have it stored.
 * @param {number} buildId
 * @param {number} snapshotId
 * @param {PercyClient.Resource} htmlResource
 * @param {Array<{id: number}>} missingResources
 * @param {Function} callback
 *
 */
function uploadHtml(buildId, snapshotId, htmlResource, missingResources,
                    callback) {
  if (missingResources.length > 0) {
    // We assume there is only one missing resource here and it is the root
    // resource. All other resources should be build resources.
    percyClient.uploadResource(buildId, htmlResource.content)
        .then(function() {
          callback();

          // After we're sure all build resources are uploaded, finalize the
          // snapshot.
          Promise.all(buildResourceUploadPromises).then(function() {
            logDebug('Snapshot id', snapshotId);
            percyClient.finalizeSnapshot(snapshotId);
          });
        });
  } else {
    // No missing resources, we can immediately finalize the snapshot after
    // build resources.
    Promise.all(buildResourceUploadPromises).then(function() {
      percyClient.finalizeSnapshot(snapshotId);
    });

    // No resources to upload, so resolve immediately.
    callback();
  }
}


/**
 * Takes a list of breakpoint names and gets the corresponding widths from
 * the registered breakpoints.
 * @param {Array<string>} breakpointNamesList
 * @return {Array<number>}
 */
function getWidthsFromBreakpointNames(breakpointNamesList) {
  const widths = [];
  for (var i in breakpointNamesList) {
    if (breakpointNamesList.hasOwnProperty(i)) {
      var breakpointName = breakpointNamesList[i];
      var breakpointWidth =
          registeredBreakpoints[breakpointName];

      if (!parseInt(breakpointWidth)) {
        console.error(`[percy] Breakpoint name "${breakpointName}"
            is not defined in Percy config.`);
      }
      // Avoid duplicate widths.
      if (widths.indexOf(breakpointWidth) === -1) {
        widths.push(breakpointWidth);
      }
    }
  }
  return widths;
}


/**
 * Checks the percy response to see if it says it's missing any of the resources
 * in our registry so that they can be uploaded.
 * @param {Object} response
 * @return {Array<{id: string}>}
 */
function parseMissingResources(response) {
  return response.body.data &&
      response.body.data.relationships &&
      response.body.data.relationships['missing-resources'] &&
      response.body.data.relationships['missing-resources'].data || [];
}

/**
 * Displays the error in the console and exits with a non-zero exit code to
 * trigger a failed build message in CI.
 * @param {string} error
 */
function handlePercyFailure(error) {
  isPercyEnabled = false;
  console.error(
      `[percy][ERROR] API call failed, Percy has been disabled 
      for this build. ${error.toString()}`);
  process.exit(2);
}

/**
 * Logs debug information to the console.
 * @param {Array<string>} args
 */
function logDebug(...args) {
  if (isDebugEnabled) {
    console.log('[percy] DEBUG', ...args);
  }
}


/**
 * Separate logging so we can more easily spy/mock logging.
 * @param args
 */
const logger = {
  log: function(...args) {
    console.log(...args);
  },
  error: function(...args) {
    console.error(...args);
  }
};


/**
 * Print error message and exit.
 * @param args 
 */
function handleError(...args) {
  console.log('THIS IS AAA');
  logger.error(...args);
  process.exit(2);
}


/** @type {Object<string,Function>} */
module.exports = {
  setup, snapshot, finalizeBuild, logger
};
