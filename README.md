[![Build Status](https://travis-ci.org/google/percy-node.svg?branch=master)](https://travis-ci.org/google/percy-node)

# percy-node

This is a wrapper of [percy-js](https://github.com/percy/percy-js) that simplifies the API so it can be used for automated visual regression testing in node environments such as testing an express app, an Angular app, or AngularJS app.

For more general information about Percy, visit [Percy's homepage](https://percy.io/)

This is not an official Google product.

## How to use

Percy-node is an installable [npm package](https://www.npmjs.com/package/percy-node).

```
npm install percy-node --save-dev
```

## Feature

Percy-node provides an optional feature to return Percy build results. Passing 'true' to finalizeBuild() to enable that feature. You also need a token with read access, please reach out to the Percy team for that.

```
const percyNodeClient = require('percy-node');
percyNodeClient.finalizeBuild(true);
```

## Motivation
This package was originally created specifically to allow testing of Express AngularJS apps tested with Jasmine, Karma, and Protractor. However, it is written in a general enough way that it could be used in another node based testing environment.


## How to use with Protractor
See the [Protractor guide](/docs/protractor.md)

## Contributing
See [CONTRIBUTING.md](/CONTRIBUTING.md)
