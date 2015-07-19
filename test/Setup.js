import chai from 'chai';
import mocha from 'mocha';


export default (function (global) {


  var testEnv = {

    sandbox : null,

    defaultInit : function() {
      beforeEach(testEnv.globalSetup);
      afterEach(testEnv.globalTeardown);
    },

    globalSetup : function() {
      testEnv.sandbox = scope.create("<div id='sandbox'></div>");
      testEnv.sandbox.appendTo(document.body);
      // CSS metrics should be integer by default in IE10 Release Preview, but
      // getBoundingClientRect will randomly return float values unless this
      // feature is explicitly deactivated:
      if (document.msCSSOMElementFloatMetrics) {
        document.msCSSOMElementFloatMetrics = null;
      }
    },

    globalTeardown: function() {
      testEnv.sandbox.remove();
    }

  };

  global.assert = chai.assert;
  global.isBrowser = true;
  chai.config.includeStack = true;
  mocha.setup("bdd");

  return testEnv;

})(window);
