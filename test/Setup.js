
import chai from 'chai';
import mocha from 'mocha';


export default (function () {

  var globalSetup = function () {
    testEnv.sandbox = scope.create("<div id='sandbox'></div>");
    testEnv.sandbox.appendTo(document.body);
    // CSS metrics should be integer by default in IE10 Release Preview, but
    // getBoundingClientRect will randomly return float values unless this
    // feature is explicitly deactivated:
    if (document.msCSSOMElementFloatMetrics) {
      document.msCSSOMElementFloatMetrics = null;
    }
  };

  var globalTeardown = function () {
    testEnv.sandbox.remove();
  };


  chai.config.includeStack = true;
  mocha.setup("bdd");


  return {
    globalSetup : globalSetup,
    globalTeardown : globalTeardown
  }

})();

