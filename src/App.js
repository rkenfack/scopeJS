/**
 *  Browser support : IE9, Chrome , Firefox
 *  @version 0.0.1
 *  @author Romeo Kenfack Tsakem
 */

// http://casperjs.org/
// https://github.com/Fyrd/caniuse

//TODO: Implements conditions as functions (data-show. data-hide, data-if)
//TODO: Fix ciclic references

import windowPolyfills from "src/polyfill/Window";
import polyfill from "src/polyfill/Object";
import dataset from "src/polyfill/Dataset";
import customEvent from "src/polyfill/CustomEvent";
import promise from "src/polyfill/Promise";
import webanimation from "src/resources/web-animations-next.min";
import Collection from "src/core/Collection";
import Observable from "src/databinding/Observable";
import Router from "src/modules/Router";
import xhr from "src/modules/XHR";
import Logger from "src/modules/Logger";

export default (function () {

  var scope = function (selector, ctx) {
    return Collection.query(selector, ctx);
  };


  for(var module in Collection) {
    if(Collection.hasOwnProperty(module)) {
      if(typeof Collection[module] == "function") {
        scope[module] = Collection[module].bind(scope);
      } else {
        scope[module] = Collection[module];
      }
    }
  }

  scope.addModule = Collection.addModule;

  scope.addStaticModule(xhr);

  scope.addStaticModule({
    Router: Router.Router,
    Logger: Logger,
    Observable: Observable
  });

  var _scope = scope;

  scope.noConflict = function () {
    return _scope;
  };

  if (typeof window != "undefined") {
    window.scope = window.$ = scope;
  }


  return scope;

})();
