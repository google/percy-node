const path = require('path');
const assert = require('assert');
const percyNodeClient = require(path.join(__dirname, '..', 'src', 'percy-node-client'));

describe('percyNodeClient', function() {

  beforeEach(() => {
    // TODO: Mock PercyClient.
  });

  it('should run tests', function() {
    assert.equal(true, true);
  });
});
