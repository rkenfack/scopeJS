import template from "src/databinding/Template";
import cssHelpers from "src/css/Helpers";
import pageready from "src/event/pageReady";
import clazz from "src/css/Class";
import style from "src/css/Style";
import dimension from "src/css/Dimension";
import traversing from "src/core/Traversing";
import events from "src/event/Event";
import Logger from "src/modules/Logger";
import manipulation from "src/core/Manipulation";



var Collection = function () {
  var collection = Object.create(Array.prototype);
  collection = (Array.apply(collection, arguments) || collection);
  for (var method in Collection.prototype) {
    if (Collection.prototype.hasOwnProperty(method)) {
      collection[method] = Collection.prototype[method];
    }
  }
  return (collection);
};


/**
* Return a new Collection from the given array.
* @param array {Array} The array to be converted into a collection.
* @return {Collection} The created collection
*/
Collection.fromArray = function (array) {
  var collection = Collection.apply(null, array);
  return (collection);
};


/**
* Returns a collection of all elements descended from the given context on which it is invoked
* that match the specified group of CSS selectors.
* @param selector {String|HTMLElement|Collection|window|document} Group of selectors to match on.
*/
Collection.query = function (selector, context) {
  context = context || document;
  if (typeof selector === "string") {
    if (context.querySelectorAll) {
      return Collection.fromArray(Array.prototype.slice.call(context.querySelectorAll(selector)));
    }
  } else if (cssHelpers.isSuportedElement(selector)) {
    return Collection.fromArray([selector]);
  }
  return Collection.fromArray(Array.prototype.slice.call(selector));
};


/**
*
*/
Collection.create = function(htmlString) {
  var container = document.createElement('div');
  container.innerHTML = htmlString;
  var children = Array.prototype.slice.call(container.childNodes, 0);
  children = children.filter(function(child) {
    return cssHelpers.isSuportedElement(child);
  });
  return Collection.fromArray(children);
};


/**
* Adds a new method to the collection prototype.
*
* @param module {Map} Map containing the functions to be added.
*   The keys of the map are the names under wich the functions will be presents on the collection
*   and the values are the functions to be added.
* @param override {Boolean} Wether or not an an existing function should be overriden.
*
*/
Collection.addModule = function(module, override) {
  for(var name in module) {
    if(((Collection.prototype[name] !== undefined) || (Array.prototype[name] !== undefined)) && (override !== true)) {
      Logger.error("Method '" + name + "' already available.");
    } else {
      Collection.prototype[name] = module[name];
    }
  }
};


/**
* Adds a static method the collection
*
* @param module {Map} Map containing the functions to be added.
*   The keys of the map are the names under wich the functions will be presents on the collection
*   and the values are the functions to be added.
* @param override {Boolean} Wether or not an an existing function should be overriden.
*
*/
Collection.addStaticModule = function(module, override) {
  for(var name in module) {
    if((Collection[name] !== undefined) && (override !== true)) {
      Collection[name] = module[name];
    } else {
      Logger.error("Method '" + name + "' already available as static method.");
    }
  }
};

Object.assign(Collection, pageready);
Object.assign(Collection.prototype, clazz);
Object.assign(Collection.prototype, style);
Object.assign(Collection.prototype, traversing);
Object.assign(Collection.prototype, dimension);
Object.assign(Collection.prototype, events);
Object.assign(Collection.prototype, manipulation);

Collection.addModule({
  template : template.template
});


export default Collection;
