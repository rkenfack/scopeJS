/**
  Browser support : IE9, Chrome , Firefox
  @version 0.0.1
  @author Romeo Kenfack Tsakem
*/


// http://casperjs.org/
// https://github.com/Fyrd/caniuse

import windowPolyfills from "src/polyfill/Window";
import polyfill from "src/polyfill/Object";
import dataset from "src/polyfill/Dataset";
import customEvent from "src/polyfill/CustomEvent";
import promise from "src/polyfill/Promise";
import objectobserve from "src/resources/ObjectObserve";
import webanimation from "src/resources/web-animations-next.min";
import Collection from "src/core/Collection";
import Observable from "src/databinding/Observable";
import Router from "src/modules/Router";
import Http from "src/modules/Http";
import Logger from "src/modules/Logger";
import HTMLParser from "src/HTMLParser/HTMLParser";

export default (function() {

  var scope = function(selector, ctx) {
    return Collection.query(selector, ctx);
  };

  scope.addModule = Collection.addModule;
  scope.addStaticModule = Collection.addStaticModule;
  scope.ready = Collection.ready;
  scope.create = Collection.create;
  scope.Router = Router.Router;
  scope.http = Http.qwest;
  scope.Logger = Logger;
  scope.HTMLParser = HTMLParser;
  scope.Observable = Observable;

  var _scope = scope;

  scope.noConflict = function() {
    return _scope;
  };

  if(typeof window != "undefined") {
    window.scope = window.$ = scope;
  }


  return scope;

})();














