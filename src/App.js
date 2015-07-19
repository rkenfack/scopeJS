/**
  Browser support : IE10, Chrome , Firefox
  @version 0.0.1
  @author Romeo Kenfack Tsakem
*/


// http://casperjs.org/
// https://github.com/web-animations/web-animations-js


import polyfill from "src/polyfill/Object";
import array from "src/polyfill/Array";
import customEvent from "src/polyfill/CustomEvent";
import promise from "src/polyfill/Promise";
import Collection from "src/core/Collection";
import Observable from "src/databinding/Observable";
import Router from "src/modules/Router";
import Http from "src/modules/Http";
import Logger from "src/modules/Logger";
import HTMLParser from "src/HTMLParser/HTMLParser";
import Emitter from "src/event/Emitter";

(function(global) {

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
  scope.Emitter = Emitter;

  global.scope = scope;
  global.Observable = Observable;

  global.$ = global.scope;


})(window);











