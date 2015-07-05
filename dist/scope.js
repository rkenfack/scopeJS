(function(global) {

  var defined = {};

  // indexOf polyfill for IE8
  var indexOf = Array.prototype.indexOf || function(item) {
    for (var i = 0, l = this.length; i < l; i++)
      if (this[i] === item)
        return i;
    return -1;
  }

  function dedupe(deps) {
    var newDeps = [];
    for (var i = 0, l = deps.length; i < l; i++)
      if (indexOf.call(newDeps, deps[i]) == -1)
        newDeps.push(deps[i])
    return newDeps;
  }

  function register(name, deps, declare, execute) {
    if (typeof name != 'string')
      throw "System.register provided no module name";

    var entry;

    // dynamic
    if (typeof declare == 'boolean') {
      entry = {
        declarative: false,
        deps: deps,
        execute: execute,
        executingRequire: declare
      };
    }
    else {
      // ES6 declarative
      entry = {
        declarative: true,
        deps: deps,
        declare: declare
      };
    }

    entry.name = name;

    // we never overwrite an existing define
    if (!(name in defined))
      defined[name] = entry; 

    entry.deps = dedupe(entry.deps);

    // we have to normalize dependencies
    // (assume dependencies are normalized for now)
    // entry.normalizedDeps = entry.deps.map(normalize);
    entry.normalizedDeps = entry.deps;
  }

  function buildGroups(entry, groups) {
    groups[entry.groupIndex] = groups[entry.groupIndex] || [];

    if (indexOf.call(groups[entry.groupIndex], entry) != -1)
      return;

    groups[entry.groupIndex].push(entry);

    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      var depEntry = defined[depName];

      // not in the registry means already linked / ES6
      if (!depEntry || depEntry.evaluated)
        continue;

      // now we know the entry is in our unlinked linkage group
      var depGroupIndex = entry.groupIndex + (depEntry.declarative != entry.declarative);

      // the group index of an entry is always the maximum
      if (depEntry.groupIndex === undefined || depEntry.groupIndex < depGroupIndex) {

        // if already in a group, remove from the old group
        if (depEntry.groupIndex !== undefined) {
          groups[depEntry.groupIndex].splice(indexOf.call(groups[depEntry.groupIndex], depEntry), 1);

          // if the old group is empty, then we have a mixed depndency cycle
          if (groups[depEntry.groupIndex].length == 0)
            throw new TypeError("Mixed dependency cycle detected");
        }

        depEntry.groupIndex = depGroupIndex;
      }

      buildGroups(depEntry, groups);
    }
  }

  function link(name) {
    var startEntry = defined[name];

    startEntry.groupIndex = 0;

    var groups = [];

    buildGroups(startEntry, groups);

    var curGroupDeclarative = !!startEntry.declarative == groups.length % 2;
    for (var i = groups.length - 1; i >= 0; i--) {
      var group = groups[i];
      for (var j = 0; j < group.length; j++) {
        var entry = group[j];

        // link each group
        if (curGroupDeclarative)
          linkDeclarativeModule(entry);
        else
          linkDynamicModule(entry);
      }
      curGroupDeclarative = !curGroupDeclarative; 
    }
  }

  // module binding records
  var moduleRecords = {};
  function getOrCreateModuleRecord(name) {
    return moduleRecords[name] || (moduleRecords[name] = {
      name: name,
      dependencies: [],
      exports: {}, // start from an empty module and extend
      importers: []
    })
  }

  function linkDeclarativeModule(entry) {
    // only link if already not already started linking (stops at circular)
    if (entry.module)
      return;

    var module = entry.module = getOrCreateModuleRecord(entry.name);
    var exports = entry.module.exports;

    var declaration = entry.declare.call(global, function(name, value) {
      module.locked = true;
      exports[name] = value;

      for (var i = 0, l = module.importers.length; i < l; i++) {
        var importerModule = module.importers[i];
        if (!importerModule.locked) {
          var importerIndex = indexOf.call(importerModule.dependencies, module);
          importerModule.setters[importerIndex](exports);
        }
      }

      module.locked = false;
      return value;
    });

    module.setters = declaration.setters;
    module.execute = declaration.execute;

    if (!module.setters || !module.execute)
      throw new TypeError("Invalid System.register form for " + entry.name);

    // now link all the module dependencies
    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      var depEntry = defined[depName];
      var depModule = moduleRecords[depName];

      // work out how to set depExports based on scenarios...
      var depExports;

      if (depModule) {
        depExports = depModule.exports;
      }
      else if (depEntry && !depEntry.declarative) {
        if (depEntry.module.exports && depEntry.module.exports.__esModule)
          depExports = depEntry.module.exports;
        else
          depExports = { 'default': depEntry.module.exports, __useDefault: true };
      }
      // in the module registry
      else if (!depEntry) {
        depExports = load(depName);
      }
      // we have an entry -> link
      else {
        linkDeclarativeModule(depEntry);
        depModule = depEntry.module;
        depExports = depModule.exports;
      }

      // only declarative modules have dynamic bindings
      if (depModule && depModule.importers) {
        depModule.importers.push(module);
        module.dependencies.push(depModule);
      }
      else
        module.dependencies.push(null);

      // run the setter for this dependency
      if (module.setters[i])
        module.setters[i](depExports);
    }
  }

  // An analog to loader.get covering execution of all three layers (real declarative, simulated declarative, simulated dynamic)
  function getModule(name) {
    var exports;
    var entry = defined[name];

    if (!entry) {
      exports = load(name);
      if (!exports)
        throw new Error("Unable to load dependency " + name + ".");
    }

    else {
      if (entry.declarative)
        ensureEvaluated(name, []);

      else if (!entry.evaluated)
        linkDynamicModule(entry);

      exports = entry.module.exports;
    }

    if ((!entry || entry.declarative) && exports && exports.__useDefault)
      return exports['default'];

    return exports;
  }

  function linkDynamicModule(entry) {
    if (entry.module)
      return;

    var exports = {};

    var module = entry.module = { exports: exports, id: entry.name };

    // AMD requires execute the tree first
    if (!entry.executingRequire) {
      for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
        var depName = entry.normalizedDeps[i];
        var depEntry = defined[depName];
        if (depEntry)
          linkDynamicModule(depEntry);
      }
    }

    // now execute
    entry.evaluated = true;
    var output = entry.execute.call(global, function(name) {
      for (var i = 0, l = entry.deps.length; i < l; i++) {
        if (entry.deps[i] != name)
          continue;
        return getModule(entry.normalizedDeps[i]);
      }
      throw new TypeError('Module ' + name + ' not declared as a dependency.');
    }, exports, module);

    if (output)
      module.exports = output;
  }

  /*
   * Given a module, and the list of modules for this current branch,
   *  ensure that each of the dependencies of this module is evaluated
   *  (unless one is a circular dependency already in the list of seen
   *  modules, in which case we execute it)
   *
   * Then we evaluate the module itself depth-first left to right 
   * execution to match ES6 modules
   */
  function ensureEvaluated(moduleName, seen) {
    var entry = defined[moduleName];

    // if already seen, that means it's an already-evaluated non circular dependency
    if (!entry || entry.evaluated || !entry.declarative)
      return;

    // this only applies to declarative modules which late-execute

    seen.push(moduleName);

    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      if (indexOf.call(seen, depName) == -1) {
        if (!defined[depName])
          load(depName);
        else
          ensureEvaluated(depName, seen);
      }
    }

    if (entry.evaluated)
      return;

    entry.evaluated = true;
    entry.module.execute.call(global);
  }

  // magical execution function
  var modules = {};
  function load(name) {
    if (modules[name])
      return modules[name];

    var entry = defined[name];

    // first we check if this module has already been defined in the registry
    if (!entry)
      throw "Module " + name + " not present.";

    // recursively ensure that the module and all its 
    // dependencies are linked (with dependency group handling)
    link(name);

    // now handle dependency execution in correct order
    ensureEvaluated(name, []);

    // remove from the registry
    defined[name] = undefined;

    var module = entry.module.exports;

    if (!module || !entry.declarative && module.__esModule !== true)
      module = { 'default': module, __useDefault: true };

    // return the defined module object
    return modules[name] = module;
  };

  return function(mains, declare) {

    var System;
    var System = {
      register: register, 
      get: load, 
      set: function(name, module) {
        modules[name] = module; 
      },
      newModule: function(module) {
        return module;
      },
      global: global 
    };
    System.set('@empty', {});

    declare(System);

    for (var i = 0; i < mains.length; i++)
      load(mains[i]);
  }

})(typeof window != 'undefined' ? window : global)
/* (['mainModule'], function(System) {
  System.register(...);
}); */

(['src/App', 'src/development'], function(System) {

System.register("src/development", [], false, function(__require, __exports, __module) {
  System.get("@@global-helpers").prepareGlobal(__module.id, []);
  (function() {
    (function() {
      if (scope && scope.Logger) {
        scope.Logger.enableAll();
      }
    })();
  }).call(System.global);
  return System.get("@@global-helpers").retrieveGlobal(__module.id, false);
});

System.register("npm:core-js@0.9.13/library/modules/$.fw", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = function($) {
    $.FW = false;
    $.path = $.core;
    return $;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.13/library/modules/$.enum-keys", ["npm:core-js@0.9.13/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.13/library/modules/$");
  module.exports = function(it) {
    var keys = $.getKeys(it),
        getDesc = $.getDesc,
        getSymbols = $.getSymbols;
    if (getSymbols)
      $.each.call(getSymbols(it), function(key) {
        if (getDesc(it, key).enumerable)
          keys.push(key);
      });
    return keys;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.13/library/fn/object/define-property", ["npm:core-js@0.9.13/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.13/library/modules/$");
  module.exports = function defineProperty(it, key, desc) {
    return $.setDesc(it, key, desc);
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.13/library/modules/es6.object.statics-accept-primitives", ["npm:core-js@0.9.13/library/modules/$", "npm:core-js@0.9.13/library/modules/$.def"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.13/library/modules/$"),
      $def = require("npm:core-js@0.9.13/library/modules/$.def"),
      isObject = $.isObject,
      toObject = $.toObject;
  $.each.call(('freeze,seal,preventExtensions,isFrozen,isSealed,isExtensible,' + 'getOwnPropertyDescriptor,getPrototypeOf,keys,getOwnPropertyNames').split(','), function(KEY, ID) {
    var fn = ($.core.Object || {})[KEY] || Object[KEY],
        forced = 0,
        method = {};
    method[KEY] = ID == 0 ? function freeze(it) {
      return isObject(it) ? fn(it) : it;
    } : ID == 1 ? function seal(it) {
      return isObject(it) ? fn(it) : it;
    } : ID == 2 ? function preventExtensions(it) {
      return isObject(it) ? fn(it) : it;
    } : ID == 3 ? function isFrozen(it) {
      return isObject(it) ? fn(it) : true;
    } : ID == 4 ? function isSealed(it) {
      return isObject(it) ? fn(it) : true;
    } : ID == 5 ? function isExtensible(it) {
      return isObject(it) ? fn(it) : false;
    } : ID == 6 ? function getOwnPropertyDescriptor(it, key) {
      return fn(toObject(it), key);
    } : ID == 7 ? function getPrototypeOf(it) {
      return fn(Object($.assertDefined(it)));
    } : ID == 8 ? function keys(it) {
      return fn(toObject(it));
    } : function getOwnPropertyNames(it) {
      return fn(toObject(it));
    };
    try {
      fn('z');
    } catch (e) {
      forced = 1;
    }
    $def($def.S + $def.F * forced, 'Object', method);
  });
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.13/library/fn/object/get-own-property-descriptor", ["npm:core-js@0.9.13/library/modules/$", "npm:core-js@0.9.13/library/modules/es6.object.statics-accept-primitives"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.13/library/modules/$");
  require("npm:core-js@0.9.13/library/modules/es6.object.statics-accept-primitives");
  module.exports = function getOwnPropertyDescriptor(it, key) {
    return $.getDesc(it, key);
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.13/library/fn/object/create", ["npm:core-js@0.9.13/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.13/library/modules/$");
  module.exports = function create(P, D) {
    return $.create(P, D);
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.13/library/fn/object/get-own-property-names", ["npm:core-js@0.9.13/library/modules/$", "npm:core-js@0.9.13/library/modules/es6.object.statics-accept-primitives"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.13/library/modules/$");
  require("npm:core-js@0.9.13/library/modules/es6.object.statics-accept-primitives");
  module.exports = function getOwnPropertyNames(it) {
    return $.getNames(it);
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.13/library/fn/object/define-properties", ["npm:core-js@0.9.13/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.13/library/modules/$");
  module.exports = function defineProperties(T, D) {
    return $.setDescs(T, D);
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.7/helpers/create-class", ["npm:babel-runtime@5.4.7/core-js/object/define-property"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  "use strict";
  var _Object$defineProperty = require("npm:babel-runtime@5.4.7/core-js/object/define-property")["default"];
  exports["default"] = (function() {
    function defineProperties(target, props) {
      for (var i = 0; i < props.length; i++) {
        var descriptor = props[i];
        descriptor.enumerable = descriptor.enumerable || false;
        descriptor.configurable = true;
        if ("value" in descriptor)
          descriptor.writable = true;
        _Object$defineProperty(target, descriptor.key, descriptor);
      }
    }
    return function(Constructor, protoProps, staticProps) {
      if (protoProps)
        defineProperties(Constructor.prototype, protoProps);
      if (staticProps)
        defineProperties(Constructor, staticProps);
      return Constructor;
    };
  })();
  exports.__esModule = true;
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.7/helpers/class-call-check", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  "use strict";
  exports["default"] = function(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
      throw new TypeError("Cannot call a class as a function");
    }
  };
  exports.__esModule = true;
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.13/library/modules/$", ["npm:core-js@0.9.13/library/modules/$.fw"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var global = typeof self != 'undefined' ? self : Function('return this')(),
      core = {},
      defineProperty = Object.defineProperty,
      hasOwnProperty = {}.hasOwnProperty,
      ceil = Math.ceil,
      floor = Math.floor,
      max = Math.max,
      min = Math.min;
  var DESC = !!function() {
    try {
      return defineProperty({}, 'a', {get: function() {
          return 2;
        }}).a == 2;
    } catch (e) {}
  }();
  var hide = createDefiner(1);
  function toInteger(it) {
    return isNaN(it = +it) ? 0 : (it > 0 ? floor : ceil)(it);
  }
  function desc(bitmap, value) {
    return {
      enumerable: !(bitmap & 1),
      configurable: !(bitmap & 2),
      writable: !(bitmap & 4),
      value: value
    };
  }
  function simpleSet(object, key, value) {
    object[key] = value;
    return object;
  }
  function createDefiner(bitmap) {
    return DESC ? function(object, key, value) {
      return $.setDesc(object, key, desc(bitmap, value));
    } : simpleSet;
  }
  function isObject(it) {
    return it !== null && (typeof it == 'object' || typeof it == 'function');
  }
  function isFunction(it) {
    return typeof it == 'function';
  }
  function assertDefined(it) {
    if (it == undefined)
      throw TypeError("Can't call method on  " + it);
    return it;
  }
  var $ = module.exports = require("npm:core-js@0.9.13/library/modules/$.fw")({
    g: global,
    core: core,
    html: global.document && document.documentElement,
    isObject: isObject,
    isFunction: isFunction,
    that: function() {
      return this;
    },
    toInteger: toInteger,
    toLength: function(it) {
      return it > 0 ? min(toInteger(it), 0x1fffffffffffff) : 0;
    },
    toIndex: function(index, length) {
      index = toInteger(index);
      return index < 0 ? max(index + length, 0) : min(index, length);
    },
    has: function(it, key) {
      return hasOwnProperty.call(it, key);
    },
    create: Object.create,
    getProto: Object.getPrototypeOf,
    DESC: DESC,
    desc: desc,
    getDesc: Object.getOwnPropertyDescriptor,
    setDesc: defineProperty,
    setDescs: Object.defineProperties,
    getKeys: Object.keys,
    getNames: Object.getOwnPropertyNames,
    getSymbols: Object.getOwnPropertySymbols,
    assertDefined: assertDefined,
    ES5Object: Object,
    toObject: function(it) {
      return $.ES5Object(assertDefined(it));
    },
    hide: hide,
    def: createDefiner(0),
    set: global.Symbol ? simpleSet : hide,
    each: [].forEach
  });
  if (typeof __e != 'undefined')
    __e = core;
  if (typeof __g != 'undefined')
    __g = global;
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.13/library/modules/$.assign", ["npm:core-js@0.9.13/library/modules/$", "npm:core-js@0.9.13/library/modules/$.enum-keys"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.13/library/modules/$"),
      enumKeys = require("npm:core-js@0.9.13/library/modules/$.enum-keys");
  module.exports = Object.assign || function assign(target, source) {
    var T = Object($.assertDefined(target)),
        l = arguments.length,
        i = 1;
    while (l > i) {
      var S = $.ES5Object(arguments[i++]),
          keys = enumKeys(S),
          length = keys.length,
          j = 0,
          key;
      while (length > j)
        T[key = keys[j++]] = S[key];
    }
    return T;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.7/core-js/object/define-property", ["npm:core-js@0.9.13/library/fn/object/define-property"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("npm:core-js@0.9.13/library/fn/object/define-property"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.13/library/fn/object/keys", ["npm:core-js@0.9.13/library/modules/es6.object.statics-accept-primitives", "npm:core-js@0.9.13/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  require("npm:core-js@0.9.13/library/modules/es6.object.statics-accept-primitives");
  module.exports = require("npm:core-js@0.9.13/library/modules/$").core.Object.keys;
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.7/core-js/object/get-own-property-descriptor", ["npm:core-js@0.9.13/library/fn/object/get-own-property-descriptor"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("npm:core-js@0.9.13/library/fn/object/get-own-property-descriptor"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.7/core-js/object/create", ["npm:core-js@0.9.13/library/fn/object/create"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("npm:core-js@0.9.13/library/fn/object/create"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.7/core-js/object/get-own-property-names", ["npm:core-js@0.9.13/library/fn/object/get-own-property-names"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("npm:core-js@0.9.13/library/fn/object/get-own-property-names"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.7/core-js/object/define-properties", ["npm:core-js@0.9.13/library/fn/object/define-properties"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("npm:core-js@0.9.13/library/fn/object/define-properties"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.13/library/modules/$.def", ["npm:core-js@0.9.13/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.13/library/modules/$"),
      global = $.g,
      core = $.core,
      isFunction = $.isFunction;
  function ctx(fn, that) {
    return function() {
      return fn.apply(that, arguments);
    };
  }
  $def.F = 1;
  $def.G = 2;
  $def.S = 4;
  $def.P = 8;
  $def.B = 16;
  $def.W = 32;
  function $def(type, name, source) {
    var key,
        own,
        out,
        exp,
        isGlobal = type & $def.G,
        isProto = type & $def.P,
        target = isGlobal ? global : type & $def.S ? global[name] : (global[name] || {}).prototype,
        exports = isGlobal ? core : core[name] || (core[name] = {});
    if (isGlobal)
      source = name;
    for (key in source) {
      own = !(type & $def.F) && target && key in target;
      if (own && key in exports)
        continue;
      out = own ? target[key] : source[key];
      if (isGlobal && !isFunction(target[key]))
        exp = source[key];
      else if (type & $def.B && own)
        exp = ctx(out, global);
      else if (type & $def.W && target[key] == out)
        !function(C) {
          exp = function(param) {
            return this instanceof C ? new C(param) : C(param);
          };
          exp.prototype = C.prototype;
        }(out);
      else
        exp = isProto && isFunction(out) ? ctx(Function.call, out) : out;
      exports[key] = exp;
      if (isProto)
        (exports.prototype || (exports.prototype = {}))[key] = out;
    }
  }
  module.exports = $def;
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.7/core-js/object/keys", ["npm:core-js@0.9.13/library/fn/object/keys"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("npm:core-js@0.9.13/library/fn/object/keys"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.13/library/modules/es6.object.assign", ["npm:core-js@0.9.13/library/modules/$.def", "npm:core-js@0.9.13/library/modules/$.assign"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $def = require("npm:core-js@0.9.13/library/modules/$.def");
  $def($def.S, 'Object', {assign: require("npm:core-js@0.9.13/library/modules/$.assign")});
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.13/library/fn/object/assign", ["npm:core-js@0.9.13/library/modules/es6.object.assign", "npm:core-js@0.9.13/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  require("npm:core-js@0.9.13/library/modules/es6.object.assign");
  module.exports = require("npm:core-js@0.9.13/library/modules/$").core.Object.assign;
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.4.7/core-js/object/assign", ["npm:core-js@0.9.13/library/fn/object/assign"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("npm:core-js@0.9.13/library/fn/object/assign"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

System.register('src/polyfill/CustomEvent', [], function (_export) {
  'use strict';

  return {
    setters: [],
    execute: function () {
      _export('default', (function () {

        try {
          new CustomEvent('?');
        } catch (o_O) {
          /*!(C) Andrea Giammarchi -- WTFPL License*/
          this.CustomEvent = (function (eventName, defaultInitDict) {

            // the infamous substitute
            function CustomEvent(type, eventInitDict) {
              var event = document.createEvent(eventName);
              if (type !== null) {
                initCustomEvent.call(event, type, (eventInitDict || (
                // if falsy we can just use defaults
                eventInitDict = defaultInitDict)).bubbles, eventInitDict.cancelable, eventInitDict.detail);
              } else {
                // no need to put the expando property otherwise
                // since an event cannot be initialized twice
                // previous case is the most common one anyway
                // but if we end up here ... there it goes
                event.initCustomEvent = initCustomEvent;
              }
              return event;
            }

            // borrowed or attached at runtime
            function initCustomEvent(type, bubbles, cancelable, detail) {
              this['init' + eventName](type, bubbles, cancelable, detail);
              if (!('detail' in this)) {
                this.detail = detail;
              }
            }

            // that's it
            return CustomEvent;
          })(
          // is this IE9 or IE10 ?
          // where CustomEvent is there
          // but not usable as construtor ?
          this.CustomEvent ?
          // use the CustomEvent interface in such case
          'CustomEvent' : 'Event',
          // otherwise the common compatible one
          {
            bubbles: false,
            cancelable: false,
            detail: null
          });
        }
      }).bind(window)());
    }
  };
});
System.register('src/polyfill/Promise', [], function (_export) {
  'use strict';

  return {
    setters: [],
    execute: function () {
      _export('default', (function (root) {

        // Use polyfill for setImmediate for performance gains
        var asap = typeof setImmediate === 'function' && setImmediate || function (fn) {
          setTimeout(fn, 1);
        };

        // Polyfill for Function.prototype.bind
        function bind(fn, thisArg) {
          return function () {
            fn.apply(thisArg, arguments);
          };
        }

        var isArray = Array.isArray || function (value) {
          return Object.prototype.toString.call(value) === '[object Array]';
        };

        function Promise(fn) {
          if (typeof this !== 'object') throw new TypeError('Promises must be constructed via new');
          if (typeof fn !== 'function') throw new TypeError('not a function');
          this._state = null;
          this._value = null;
          this._deferreds = [];

          doResolve(fn, bind(resolve, this), bind(reject, this));
        }

        function handle(deferred) {
          var me = this;
          if (this._state === null) {
            this._deferreds.push(deferred);
            return;
          }
          asap(function () {
            var cb = me._state ? deferred.onFulfilled : deferred.onRejected;
            if (cb === null) {
              (me._state ? deferred.resolve : deferred.reject)(me._value);
              return;
            }
            var ret;
            try {
              ret = cb(me._value);
            } catch (e) {
              deferred.reject(e);
              return;
            }
            deferred.resolve(ret);
          });
        }

        function resolve(newValue) {
          try {
            //Promise Resolution Procedure: https://github.com/promises-aplus/promises-spec#the-promise-resolution-procedure
            if (newValue === this) throw new TypeError('A promise cannot be resolved with itself.');
            if (newValue && (typeof newValue === 'object' || typeof newValue === 'function')) {
              var then = newValue.then;
              if (typeof then === 'function') {
                doResolve(bind(then, newValue), bind(resolve, this), bind(reject, this));
                return;
              }
            }
            this._state = true;
            this._value = newValue;
            finale.call(this);
          } catch (e) {
            reject.call(this, e);
          }
        }

        function reject(newValue) {
          this._state = false;
          this._value = newValue;
          finale.call(this);
        }

        function finale() {
          for (var i = 0, len = this._deferreds.length; i < len; i++) {
            handle.call(this, this._deferreds[i]);
          }
          this._deferreds = null;
        }

        function Handler(onFulfilled, onRejected, resolve, reject) {
          this.onFulfilled = typeof onFulfilled === 'function' ? onFulfilled : null;
          this.onRejected = typeof onRejected === 'function' ? onRejected : null;
          this.resolve = resolve;
          this.reject = reject;
        }

        /**
         * Take a potentially misbehaving resolver function and make sure
         * onFulfilled and onRejected are only called once.
         *
         * Makes no guarantees about asynchrony.
         */
        function doResolve(fn, onFulfilled, onRejected) {
          var done = false;
          try {
            fn(function (value) {
              if (done) return;
              done = true;
              onFulfilled(value);
            }, function (reason) {
              if (done) return;
              done = true;
              onRejected(reason);
            });
          } catch (ex) {
            if (done) return;
            done = true;
            onRejected(ex);
          }
        }

        Promise.prototype['catch'] = function (onRejected) {
          return this.then(null, onRejected);
        };

        Promise.prototype.then = function (onFulfilled, onRejected) {
          var me = this;
          return new Promise(function (resolve, reject) {
            handle.call(me, new Handler(onFulfilled, onRejected, resolve, reject));
          });
        };

        Promise.all = function () {
          var args = Array.prototype.slice.call(arguments.length === 1 && isArray(arguments[0]) ? arguments[0] : arguments);

          return new Promise(function (resolve, reject) {
            if (args.length === 0) return resolve([]);
            var remaining = args.length;
            function res(i, val) {
              try {
                if (val && (typeof val === 'object' || typeof val === 'function')) {
                  var then = val.then;
                  if (typeof then === 'function') {
                    then.call(val, function (val) {
                      res(i, val);
                    }, reject);
                    return;
                  }
                }
                args[i] = val;
                if (--remaining === 0) {
                  resolve(args);
                }
              } catch (ex) {
                reject(ex);
              }
            }
            for (var i = 0; i < args.length; i++) {
              res(i, args[i]);
            }
          });
        };

        Promise.resolve = function (value) {
          if (value && typeof value === 'object' && value.constructor === Promise) {
            return value;
          }

          return new Promise(function (resolve) {
            resolve(value);
          });
        };

        Promise.reject = function (value) {
          return new Promise(function (resolve, reject) {
            reject(value);
          });
        };

        Promise.race = function (values) {
          return new Promise(function (resolve, reject) {
            for (var i = 0, len = values.length; i < len; i++) {
              values[i].then(resolve, reject);
            }
          });
        };

        /**
         * Set the immediate function to execute callbacks
         * @param fn {function} Function to execute
         * @private
         */
        Promise._setImmediateFn = function _setImmediateFn(fn) {
          asap = fn;
        };

        if (typeof module !== 'undefined' && module.exports) {
          module.exports = Promise;
        } else if (!root.Promise) {
          root.Promise = Promise;
        }
      })(window));
    }
  };
});
System.register('src/resources/soma-template', [], function (_export) {
  'use strict';

  return {
    setters: [],
    execute: function () {
      _export('default', (function (soma) {

        'use strict';

        soma = soma || {};

        soma.template = soma.template || {};
        soma.template.version = '0.3.0';

        soma.template.errors = {
          TEMPLATE_STRING_NO_ELEMENT: 'Error in soma.template, a string template requirement a second parameter: an element target - soma.template.create(\'string\', element)',
          TEMPLATE_NO_PARAM: 'Error in soma.template, a template requires at least 1 parameter - soma.template.create(element)'
        };

        var tokenStart = '{{';
        var tokenEnd = '}}';
        var helpersObject = {};
        var helpersScopeObject = {};

        var settings = soma.template.settings = soma.template.settings || {};

        settings.autocreate = true;

        var tokens = settings.tokens = {
          start: function start(value) {
            if (isDefined(value) && value !== '') {
              tokenStart = escapeRegExp(value);
              setRegEX(value, true);
            }
            return tokenStart;
          },
          end: function end(value) {
            if (isDefined(value) && value !== '') {
              tokenEnd = escapeRegExp(value);
              setRegEX(value, false);
            }
            return tokenEnd;
          }
        };

        var attributes = settings.attributes = {
          'skip': 'data-skip',
          'repeat': 'data-repeat',
          'src': 'data-src',
          'href': 'data-href',
          'show': 'data-show',
          'hide': 'data-hide',
          'cloak': 'data-cloak',
          'checked': 'data-checked',
          'disabled': 'data-disabled',
          'multiple': 'data-multiple',
          'readonly': 'data-readonly',
          'selected': 'data-selected',
          'template': 'data-template',
          'html': 'data-html',
          'class': 'data-class'
        };

        var vars = settings.vars = {
          index: '$index',
          key: '$key',
          element: '$element',
          parentElement: '$parentElement',
          attribute: '$attribute',
          scope: '$scope'
        };

        var events = settings.events = {};
        settings.eventsPrefix = 'data-';
        var eventsString = 'click dblclick mousedown mouseup mouseover mouseout mousemove mouseenter mouseleave keydown keyup focus blur change select selectstart scroll copy cut paste mousewheel keypress error contextmenu input textinput drag dragenter dragleave dragover dragend dragstart dragover drop load submit reset search resize beforepaste beforecut beforecopy';
        eventsString += ' touchstart touchend touchmove touchenter touchleave touchcancel gesturestart gesturechange gestureend';
        var eventsArray = eventsString.split(' ');
        var i = -1,
            l = eventsArray.length;
        while (++i < l) {
          events[settings.eventsPrefix + eventsArray[i]] = eventsArray[i];
        }

        var regex = {
          sequence: null,
          token: null,
          expression: null,
          escape: /[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g,
          trim: /^[\s+]+|[\s+]+$/g,
          repeat: /(.*)\s+in\s+(.*)/,
          func: /(.*)\((.*)\)/,
          params: /,\s+|,|\s+,\s+/,
          quote: /\"|\'/g,
          content: /[^.|^\s]/gm,
          depth: /..\//g,
          string: /^(\"|\')(.*)(\"|\')$/
        };

        var ie = (function () {
          if (typeof document !== 'object') {
            return undefined;
          }
          var v = 3,
              stop = false,
              div = document.createElement('div');
          while (!stop) {
            div.innerHTML = '<!--[if gt IE ' + ++v + ']><i></i><![endif]-->';
            if (!div.getElementsByTagName('i')[0]) {
              stop = true;
            }
          }
          return v > 4 ? v : undefined;
        })();
        function isArray(value) {
          return Object.prototype.toString.apply(value) === '[object Array]';
        }
        function isObject(value) {
          return typeof value === 'object';
        }
        function isString(value) {
          return typeof value === 'string';
        }
        function isElement(value) {
          return value ? value.nodeType > 0 : false;
        }
        function isTextNode(el) {
          return el && el.nodeType && el.nodeType === 3;
        }
        function isFunction(value) {
          return value && typeof value === 'function';
        }
        function isDefined(value) {
          return value !== null && value !== undefined;
        }
        function normalizeBoolean(value) {
          if (!isDefined(value)) {
            return false;
          }
          if (value === 'true' || value === '1' || value === true || value === 1) {
            return true;
          }
          if (value === 'false' || value === '0' || value === false || value === 0 || isString(value) && hasInterpolation(value)) {
            return false;
          }
          return !!value;
        }
        function isExpression(value) {
          return value && isFunction(value.toString) && value.toString() === '[object Expression]';
        }
        function isExpFunction(value) {
          if (!isString(value)) {
            return false;
          }
          return !!value.match(regex.func);
        }
        function childNodeIsTemplate(node) {
          return node && node.parent && templates.get(node.element);
        }
        function escapeRegExp(str) {
          return str.replace(regex.escape, '\\$&');
        }
        function setRegEX(nonEscapedValue, isStartToken) {
          // sequence: \{\{.+?\}\}|[^{]+|\{(?!\{)[^{]*
          var unescapedCurrentStartToken = tokens.start().replace(/\\/g, '');
          var endSequence = '';
          var ts = isStartToken ? nonEscapedValue : unescapedCurrentStartToken;
          if (ts.length > 1) {
            endSequence = '|\\' + ts.substr(0, 1) + '(?!\\' + ts.substr(1, 1) + ')[^' + ts.substr(0, 1) + ']*';
          }
          regex.sequence = new RegExp(tokens.start() + '.+?' + tokens.end() + '|[^' + tokens.start() + ']+' + endSequence, 'g');
          regex.token = new RegExp(tokens.start() + '.*?' + tokens.end(), 'g');
          regex.expression = new RegExp(tokens.start() + '|' + tokens.end(), 'gm');
        }
        function trim(value) {
          return value.replace(regex.trim, '');
        }
        function trimQuotes(value) {
          if (regex.string.test(value)) {
            return value.substr(1, value.length - 2);
          }
          return value;
        }
        function trimArray(value) {
          if (value[0] === '') {
            value.shift();
          }
          if (value[value.length - 1] === '') {
            value.pop();
          }
          return value;
        }
        function trimTokens(value) {
          return value.replace(regex.expression, '');
        }
        function trimScopeDepth(value) {
          return value.replace(regex.depth, '');
        }
        function insertBefore(referenceNode, newNode) {
          if (!referenceNode.parentNode) {
            return;
          }
          referenceNode.parentNode.insertBefore(newNode, referenceNode);
        }
        function insertAfter(referenceNode, newNode) {
          if (!referenceNode.parentNode) {
            return;
          }
          referenceNode.parentNode.insertBefore(newNode, referenceNode.nextSibling);
        }
        function removeClass(elm, className) {
          var rmc;
          if (typeof document === 'object' && document.documentElement.classList) {
            rmc = function (elm, className) {
              elm.classList.remove(className);
            };
          } else {
            rmc = function (elm, className) {
              if (!elm || !elm.className) {
                return false;
              }
              var reg = new RegExp('(^|\\s)' + className + '(\\s|$)', 'g');
              elm.className = elm.className.replace(reg, '$2');
            };
          }
          rmc(elm, className);
        }
        // jquery contains
        var contains = typeof document !== 'object' ? function () {} : document.documentElement.contains ? function (a, b) {
          var adown = a.nodeType === 9 ? a.documentElement : a,
              bup = b && b.parentNode;
          return a === bup || !!(bup && bup.nodeType === 1 && adown.contains && adown.contains(bup));
        } : document.documentElement.compareDocumentPosition ? function (a, b) {
          return b && !!(a.compareDocumentPosition(b) & 16);
        } : function (a, b) {
          while (b = b.parentNode) {
            if (b === a) {
              return true;
            }
          }
          return false;
        };

        function HashMap(id) {
          var items = {};
          var count = 0;
          //var uuid = function(a,b){for(b=a='';a++<36;b+=a*51&52?(a^15?8^Math.random()*(a^20?16:4):4).toString(16):'-');return b;}
          function uuid() {
            return ++count + id;
          }
          function getKey(target) {
            if (!target) {
              return;
            }
            if (typeof target !== 'object') {
              return target;
            }
            var result;
            try {
              // IE 7-8 needs a try catch, seems like I can't add a property on text nodes
              result = target[id] ? target[id] : target[id] = uuid();
            } catch (err) {}
            return result;
          }
          this.remove = function (key) {
            delete items[getKey(key)];
          };
          this.get = function (key) {
            return items[getKey(key)];
          };
          this.put = function (key, value) {
            items[getKey(key)] = value;
          };
          this.has = function (key) {
            return typeof items[getKey(key)] !== 'undefined';
          };
          this.getData = function () {
            return items;
          };
          this.dispose = function () {
            for (var key in items) {
              if (items.hasOwnProperty(key)) {
                delete items[key];
              }
            }
            this.length = 0;
          };
        }

        function getRepeaterData(repeaterValue, scope) {
          var parts = repeaterValue.match(regex.repeat);
          if (!parts) {
            return;
          }
          var source = parts[2];
          var exp = new Expression(source);
          return exp.getValue(scope);
        }

        function updateScopeWithRepeaterData(repeaterValue, scope, data) {
          var parts = repeaterValue.match(regex.repeat);
          if (!parts) {
            return;
          }
          var name = parts[1];
          scope[name] = data;
        }
        function getWatcherValue(exp, newValue) {
          var node = exp.node || exp.attribute.node;
          var watchers = node.template.watchers;
          var nodeTarget = node.element;
          if (!watchers) {
            return newValue;
          }
          var watcherNode = watchers.get(nodeTarget);
          if (!watcherNode && isTextNode(node.element) && node.parent) {
            watcherNode = watchers.get(node.parent.element);
          }
          var watcher = watcherNode ? watcherNode : watchers.get(exp.pattern);
          if (isFunction(watcher)) {
            var watcherValue = watcher(exp.value, newValue, exp.pattern, node.scope, node, exp.attribute);
            if (isDefined(watcherValue)) {
              return watcherValue;
            }
          }
          return newValue;
        }

        function getScopeFromPattern(scope, pattern) {
          var depth = getScopeDepth(pattern);
          var scopeTarget = scope;
          while (depth > 0) {
            scopeTarget = scopeTarget._parent ? scopeTarget._parent : scopeTarget;
            depth--;
          }
          return scopeTarget;
        }

        function getValueFromPattern(scope, pattern, context) {
          var exp = new Expression(pattern);
          return _getValue(scope, exp.pattern, exp.path, exp.params, undefined, undefined, undefined, context);
        }

        function _getValue(_x, _x2, _x3, _x4, _x5, _x6, _x7, _x8) {
          var _arguments = arguments;
          var _again = true;

          _function: while (_again) {
            var scope = _x,
                pattern = _x2,
                pathString = _x3,
                params = _x4,
                getFunction = _x5,
                getParams = _x6,
                paramsFound = _x7,
                context = _x8;
            paramsValues = j = jl = scopeTarget = path = pathParts = i = l = undefined;
            _again = false;

            // context
            if (pattern === vars.element) {
              return context[vars.element];
            }
            if (pattern === vars.parentElement) {
              return context[vars.parentElement];
            }
            if (pattern === vars.attribute) {
              return context[vars.attribute];
            }
            if (pattern === vars.scope) {
              return context[vars.scope];
            }
            // string
            if (regex.string.test(pattern)) {
              return trimQuotes(pattern);
            } else if (!isNaN(pattern)) {
              return +pattern;
            }
            // find params
            var paramsValues = [];
            if (!paramsFound && params) {
              for (var j = 0, jl = params.length; j < jl; j++) {
                paramsValues.push(getValueFromPattern(scope, params[j], context));
              }
            } else {
              paramsValues = paramsFound;
            }
            if (getParams) {
              return paramsValues;
            }
            // find scope
            var scopeTarget = getScopeFromPattern(scope, pattern);
            // remove parent string
            pattern = pattern.replace(/..\//g, '');
            pathString = pathString.replace(/..\//g, '');
            if (!scopeTarget) {
              return undefined;
            }
            // search path
            var path = scopeTarget;
            var pathParts = pathString.split(/\.|\[|\]/g);
            if (pathParts.length > 0) {
              for (var i = 0, l = pathParts.length; i < l; i++) {
                if (pathParts[i] !== '') {
                  path = path[pathParts[i]];
                }
                if (!isDefined(path)) {
                  // no path, search in parent
                  if (scopeTarget._parent) {
                    _x = scopeTarget._parent;
                    _x2 = pattern;
                    _x3 = pathString;
                    _x4 = params;
                    _x5 = getFunction;
                    _x6 = getParams;
                    _x7 = paramsValues;
                    _again = true;
                    continue _function;
                  } else {
                    return undefined;
                  }
                }
              }
            }
            // return value
            if (!isFunction(path)) {
              return path;
            } else {
              if (getFunction) {
                return path;
              } else {
                return path.apply(null, paramsValues);
              }
            }
            return undefined;
          }
        }

        function getExpressionPath(value) {
          var val = value.split('(')[0];
          val = trimScopeDepth(val);
          return val;
        }

        function getParamsFromString(value) {
          return trimArray(value.split(regex.params));
        }

        function getScopeDepth(value) {
          var val = value.split('(')[0];
          var matches = val.match(regex.depth);
          return !matches ? 0 : matches.length;
        }

        function addAttribute(node, name, value) {
          var attr;
          node.attributes = node.attributes || [];
          if (name === settings.attributes.skip) {
            node.skip = normalizeBoolean(value);
          }
          if (name === settings.attributes.html) {
            node.html = normalizeBoolean(value);
          }
          if (name === settings.attributes.repeat && !node.isRepeaterDescendant) {
            node.repeater = value;
          }
          if (hasInterpolation(name + ':' + value) || name === settings.attributes.repeat || name === settings.attributes.skip || name === settings.attributes.html || name === settings.attributes.show || name === settings.attributes.hide || name === settings.attributes.href || name === settings.attributes['class'] || name === settings.attributes.checked || name === settings.attributes.disabled || name === settings.attributes.multiple || name === settings.attributes.readonly || name === settings.attributes.selected || value.indexOf(settings.attributes.cloak) !== -1) {
            attr = new Attribute(name, value, node);
            node.attributes.push(attr);
          }
          if (events[name]) {
            attr = new Attribute(name, value, node);
            node.attributes.push(attr);
          }
          return attr;
        }

        function getNodeFromElement(element, scope) {
          var node = new Node(element, scope);
          node.previousSibling = element.previousSibling;
          node.nextSibling = element.nextSibling;
          var eventsArray = [];
          for (var attr, attrs = element.attributes, j = 0, jj = attrs && attrs.length; j < jj; j++) {
            attr = attrs[j];
            if (attr.specified || attr.name === 'value') {
              var newAttr = addAttribute(node, attr.name, attr.value);
              if (events[attr.name]) {
                if (events[attr.name] && !node.isRepeaterChild) {
                  eventsArray.push({ name: events[attr.name], value: attr.value, attr: newAttr });
                }
              }
            }
          }
          for (var a = 0, b = eventsArray.length; a < b; a++) {
            node.addEvent(eventsArray[a].name, eventsArray[a].value, eventsArray[a].attr);
          }
          return node;
        }

        function hasInterpolation(value) {
          var matches = value.match(regex.token);
          return matches && matches.length > 0;
        }

        function hasContent(value) {
          return regex.content.test(value);
        }

        function isElementValid(element) {
          if (!element) {
            return;
          }
          var type = element.nodeType;
          if (!element || !type) {
            return false;
          }
          // comment
          if (type === 8) {
            return false;
          }
          // empty text node
          if (type === 3 && !hasContent(element.nodeValue) && !hasInterpolation(element.nodeValue)) {
            return false;
          }
          // result
          return true;
        }

        function _compile(template, element, parent, nodeTarget) {
          if (!isElementValid(element)) {
            return;
          }
          // get node
          var node;
          if (!nodeTarget) {
            node = getNodeFromElement(element, parent ? parent.scope : new Scope(helpersScopeObject)._createChild());
          } else {
            node = nodeTarget;
            node.parent = parent;
          }
          if (parent && (parent.repeater || parent.isRepeaterChild)) {
            node.isRepeaterChild = true;
          }
          node.template = template;
          // children
          if (node.skip) {
            return;
          }
          var child = element.firstChild;
          while (child) {
            var childNode = _compile(template, child, node);
            if (childNode) {
              childNode.parent = node;
              node.children.push(childNode);
            }
            child = child.nextSibling;
          }
          return node;
        }

        function updateScopeWithData(scope, data) {
          clearScope(scope);
          for (var d in data) {
            if (data.hasOwnProperty(d)) {
              scope[d] = data[d];
            }
          }
        }

        function clearScope(scope) {
          for (var key in scope) {
            if (scope.hasOwnProperty(key)) {
              if (key.substr(0, 1) !== '_') {
                scope[key] = null;
                delete scope[key];
              }
            }
          }
        }

        function updateNodeChildren(node) {
          if (node.repeater || !node.children || childNodeIsTemplate(node)) {
            return;
          }
          for (var i = 0, l = node.children.length; i < l; i++) {
            node.children[i].update();
          }
        }

        function renderNodeChildren(node) {
          if (!node.children || childNodeIsTemplate(node)) {
            return;
          }
          for (var i = 0, l = node.children.length; i < l; i++) {
            node.children[i].render();
          }
        }

        function renderNodeRepeater(node) {
          var data = getRepeaterData(node.repeater, node.scope);
          var previousElement;
          if (isArray(data)) {
            // process array
            for (var i = 0, l1 = data.length, l2 = node.childrenRepeater.length, l = l1 > l2 ? l1 : l2; i < l; i++) {
              if (i < l1) {
                previousElement = createRepeaterChild(node, i, data[i], vars.index, i, previousElement);
              } else {
                node.parent.element.removeChild(node.childrenRepeater[i].element);
                node.childrenRepeater[i].dispose();
              }
            }
            if (node.childrenRepeater.length > data.length) {
              node.childrenRepeater.length = data.length;
            }
          } else {
            // process object
            var count = -1;
            for (var o in data) {
              if (data.hasOwnProperty(o)) {
                count++;
                previousElement = createRepeaterChild(node, count, data[o], vars.key, o, previousElement);
              }
            }
            var size = count;
            while (count++ < node.childrenRepeater.length - 1) {
              node.parent.element.removeChild(node.childrenRepeater[count].element);
              node.childrenRepeater[count].dispose();
            }
            node.childrenRepeater.length = size + 1;
          }
          if (node.element.parentNode) {
            node.element.parentNode.removeChild(node.element);
          }
        }

        function compileClone(node, newNode) {
          if (!isElementValid(newNode.element)) {
            return;
          }
          // create attribute
          if (node.attributes) {
            for (var i = 0, l = node.attributes.length; i < l; i++) {
              var attr = node.attributes[i];
              var newAttr = addAttribute(newNode, attr.name, attr.value);
              if (events[attr.name]) {
                newNode.addEvent(events[attr.name], attr.value, newAttr);
              }
            }
          }
          // children
          var child = node.element.firstChild;
          var newChild = newNode.element.firstChild;
          // loop
          while (child && newChild) {
            var childNode = node.getNode(child);
            var newChildNode = new Node(newChild, newNode.scope);
            newNode.children.push(newChildNode);
            newChildNode.parent = newNode;
            newChildNode.template = newNode.template;
            newChildNode.isRepeaterChild = true;
            var compiledNode = compileClone(childNode, newChildNode);
            if (compiledNode) {
              compiledNode.parent = newChildNode;
              compiledNode.template = newChildNode.template;
              newChildNode.children.push(compiledNode);
            }
            child = child.nextSibling;
            newChild = newChild.nextSibling;
          }
          return newChildNode;
        }

        function cloneRepeaterNode(element, node) {
          var newNode = new Node(element, node.scope._createChild());
          newNode.template = node.template;
          newNode.parent = node;
          newNode.isRepeaterChild = true;
          newNode.isRepeaterDescendant = true;
          compileClone(node, newNode);
          return newNode;
        }

        function appendRepeaterElement(previousElement, node, newElement) {
          if (!previousElement) {
            if (node.element.previousSibling) {
              insertAfter(node.element.previousSibling, newElement);
            } else if (node.element.nextSibling) {
              insertBefore(node.element.nextSibling, newElement);
            } else {
              node.parent.element.appendChild(newElement);
            }
          } else {
            insertAfter(previousElement, newElement);
          }
        }

        function createRepeaterChild(node, count, data, indexVar, indexVarValue, previousElement) {
          var existingChild = node.childrenRepeater[count];
          if (!existingChild) {
            var newElement = node.element.cloneNode(true);
            // need to append the cloned element to the DOM
            // before changing attributes or IE will crash
            appendRepeaterElement(previousElement, node, newElement);
            // can't recreate the node with a cloned element on IE7
            // be cause the attributes are not specified anymore (attribute.specified)
            //var newNode = getNodeFromElement(newElement, node.scope._createChild(), true);
            var newNode = cloneRepeaterNode(newElement, node);
            node.childrenRepeater[count] = newNode;
            updateScopeWithRepeaterData(node.repeater, newNode.scope, data);
            newNode.scope[indexVar] = indexVarValue;
            newNode.update();
            newNode.render();
            return newElement;
          } else {
            // existing node
            updateScopeWithRepeaterData(node.repeater, existingChild.scope, data);
            existingChild.scope[indexVar] = indexVarValue;
            existingChild.update();
            existingChild.render();
            return existingChild.element;
          }
        }

        var Scope = function Scope(data) {
          var self;
          function createChild(data) {
            var obj = createObject(data);
            obj._parent = self;
            self._children.push(obj);
            return obj;
          }
          function createObject(data) {
            var obj = data || {};
            obj._parent = null;
            obj._children = [];
            obj._createChild = function () {
              self = obj;
              return createChild.apply(obj, arguments);
            };
            return obj;
          }
          return createObject(data);
        };
        var Node = function Node(element, scope) {
          this.element = element;
          this.scope = scope;
          this.attributes = null;
          this.value = null;
          this.interpolation = null;
          this.invalidate = false;
          this.skip = false;
          this.repeater = null;
          this.isRepeaterDescendant = false;
          this.isRepeaterChild = false;
          this.parent = null;
          this.children = [];
          this.childrenRepeater = [];
          this.previousSibling = null;
          this.nextSibling = null;
          this.template = null;
          this.eventHandlers = {};
          this.html = false;

          if (isTextNode(this.element)) {
            this.value = this.element.nodeValue;
            this.interpolation = new Interpolation(this.value, this, undefined);
          }
        };
        Node.prototype = {
          toString: function toString() {
            return '[object Node]';
          },
          dispose: function dispose() {
            this.clearEvents();
            var i, l;
            if (this.children) {
              for (i = 0, l = this.children.length; i < l; i++) {
                this.children[i].dispose();
              }
            }
            if (this.childrenRepeater) {
              for (i = 0, l = this.childrenRepeater.length; i < l; i++) {
                this.childrenRepeater[i].dispose();
              }
            }
            if (this.attributes) {
              for (i = 0, l = this.attributes.length; i < l; i++) {
                this.attributes[i].dispose();
              }
            }
            if (this.interpolation) {
              this.interpolation.dispose();
            }
            this.element = null;
            this.scope = null;
            this.attributes = null;
            this.value = null;
            this.interpolation = null;
            this.repeater = null;
            this.parent = null;
            this.children = null;
            this.childrenRepeater = null;
            this.previousSibling = null;
            this.nextSibling = null;
            this.template = null;
            this.eventHandlers = null;
          },
          getNode: function getNode(element) {
            var node;
            if (element === this.element) {
              return this;
            }
            if (this.childrenRepeater.length > 0) {
              for (var k = 0, kl = this.childrenRepeater.length; k < kl; k++) {
                node = this.childrenRepeater[k].getNode(element);
                if (node) {
                  return node;
                }
              }
            }
            for (var i = 0, l = this.children.length; i < l; i++) {
              node = this.children[i].getNode(element);
              if (node) {
                return node;
              }
            }
            return null;
          },
          getAttribute: function getAttribute(name) {
            if (this.attributes) {
              for (var i = 0, l = this.attributes.length; i < l; i++) {
                var att = this.attributes[i];
                if (att.interpolationName && att.interpolationName.value === name) {
                  return att;
                }
              }
            }
          },
          update: function update() {
            if (childNodeIsTemplate(this)) {
              return;
            }
            if (isDefined(this.interpolation)) {
              this.interpolation.update();
            }
            if (isDefined(this.attributes)) {
              for (var i = 0, l = this.attributes.length; i < l; i++) {
                this.attributes[i].update();
              }
            }
            updateNodeChildren(this);
          },
          invalidateData: function invalidateData() {
            if (childNodeIsTemplate(this)) {
              return;
            }
            this.invalidate = true;
            var i, l;
            if (this.attributes) {
              for (i = 0, l = this.attributes.length; i < l; i++) {
                this.attributes[i].invalidate = true;
              }
            }
            for (i = 0, l = this.childrenRepeater.length; i < l; i++) {
              this.childrenRepeater[i].invalidateData();
            }
            for (i = 0, l = this.children.length; i < l; i++) {
              this.children[i].invalidateData();
            }
          },
          addEvent: function addEvent(type, pattern, attr) {
            if (this.repeater) {
              return;
            }
            if (this.eventHandlers[type]) {
              this.removeEvent(type);
            }
            var scope = this.scope;
            var node = this;
            var handler = function handler(event) {
              var exp = new Expression(pattern, node, attr);
              var func = exp.getValue(scope, true);
              var params = exp.getValue(scope, false, true);
              params.unshift(event);
              if (func) {
                func.apply(null, params);
              }
            };
            this.eventHandlers[type] = handler;
            _addEvent(this.element, type, handler);
          },
          removeEvent: function removeEvent(type) {
            _removeEvent(this.element, type, this.eventHandlers[type]);
            this.eventHandlers[type] = null;
            delete this.eventHandlers[type];
          },
          clearEvents: function clearEvents() {
            if (this.eventHandlers) {
              for (var key in this.eventHandlers) {
                if (this.eventHandlers.hasOwnProperty(key)) {
                  this.removeEvent(key);
                }
              }
            }
            if (this.children) {
              for (var k = 0, kl = this.children.length; k < kl; k++) {
                this.children[k].clearEvents();
              }
            }
            if (this.childrenRepeater) {
              for (var f = 0, fl = this.childrenRepeater.length; f < fl; f++) {
                this.childrenRepeater[f].clearEvents();
              }
            }
          },
          render: function render() {
            if (childNodeIsTemplate(this)) {
              return;
            }
            if (this.invalidate) {
              this.invalidate = false;
              if (isTextNode(this.element)) {
                if (this.parent && this.parent.html) {
                  this.value = this.parent.element.innerHTML = this.interpolation.render();
                } else {
                  this.value = this.element.nodeValue = this.interpolation.render();
                }
              }
            }
            if (this.attributes) {
              for (var i = 0, l = this.attributes.length; i < l; i++) {
                this.attributes[i].render();
              }
            }
            if (this.repeater) {
              renderNodeRepeater(this);
            } else {
              renderNodeChildren(this);
            }
          }
        };
        var Attribute = function Attribute(name, value, node) {
          this.name = name;
          this.value = value;
          this.node = node;
          this.interpolationName = new Interpolation(this.name, null, this);
          this.interpolationValue = new Interpolation(this.value, null, this);
          this.invalidate = false;
        };
        Attribute.prototype = {
          toString: function toString() {
            return '[object Attribute]';
          },
          dispose: function dispose() {
            if (this.interpolationName) {
              this.interpolationName.dispose();
            }
            if (this.interpolationValue) {
              this.interpolationValue.dispose();
            }
            this.interpolationName = null;
            this.interpolationValue = null;
            this.node = null;
            this.name = null;
            this.value = null;
            this.previousName = null;
          },
          update: function update() {
            if (this.node.repeater) {
              return;
            }
            this.interpolationName.update();
            this.interpolationValue.update();
          },
          render: function render() {
            if (this.node.repeater) {
              return;
            }
            // normal attribute
            function renderAttribute(name, value, node) {
              if (name === 'value' && node.element['value'] !== undefined) {
                element.value = value;
              } else if (ie === 7 && name === 'class') {
                element.className = value;
              } else {
                element.setAttribute(name, value);
              }
            }
            // boolean attribute
            function renderBooleanAttribute(name, value) {
              element.setAttribute(name, value);
            }
            // special attribute
            function renderSpecialAttribute(value, attrName) {
              if (normalizeBoolean(value)) {
                element.setAttribute(attrName, attrName);
              } else {
                element.removeAttribute(attrName);
              }
            }
            // src attribute
            function renderSrc(value) {
              element.setAttribute('src', value);
            }
            // href attribute
            function renderHref(value) {
              element.setAttribute('href', value);
            }
            var element = this.node.element;
            if (this.invalidate) {
              this.invalidate = false;
              this.previousName = this.name;
              this.name = isDefined(this.interpolationName.render()) ? this.interpolationName.render() : this.name;
              this.value = isDefined(this.interpolationValue.render()) ? this.interpolationValue.render() : this.value;
              if (this.name === attributes.src) {
                renderSrc(this.value);
              } else if (this.name === attributes.href) {
                renderHref(this.value);
              } else {
                if (ie !== 7 || ie === 7 && !this.node.isRepeaterChild) {
                  this.node.element.removeAttribute(this.interpolationName.value);
                }
                if (this.previousName) {
                  if (ie === 7 && this.previousName === 'class') {
                    // iE
                    this.node.element.className = '';
                  } else {
                    if (ie !== 7 || ie === 7 && !this.node.isRepeaterChild) {
                      this.node.element.removeAttribute(this.previousName);
                    }
                  }
                }
                renderAttribute(this.name, this.value, this.node);
              }
            }

            // class
            if (this.name === attributes['class']) {
              // TODO: Refactor attributes, danger of variable naming colisions.
              var classConfig, configProperty, propValue, activateClass, valueResult;

              try {
                classConfig = JSON.parse(this.value);
              } catch (ex) {
                throw new Error('Error, the value of a data-class attribute must be a valid JSON: ' + this.value);
              }

              for (configProperty in classConfig) {
                propValue = classConfig[configProperty];
                valueResult = propValue ? normalizeBoolean(propValue) : false;
                activateClass = propValue ? normalizeBoolean(propValue) : false;

                if (valueResult) {
                  this.node.element.classList.add(configProperty);
                } else {
                  removeClass(this.node.element, configProperty);
                }
              }
            }

            // cloak
            if (this.name === 'class' && this.value.indexOf(settings.attributes.cloak) !== -1) {
              removeClass(this.node.element, settings.attributes.cloak);
            }
            // hide
            if (this.name === attributes.hide) {
              var bool = normalizeBoolean(this.value);
              renderAttribute(this.name, bool, this.node);
              element.style.display = bool ? 'none' : '';
            }
            // show
            if (this.name === attributes.show) {
              var bool = normalizeBoolean(this.value);
              renderAttribute(this.name, bool, this.node);
              element.style.display = bool ? '' : 'none';
            }
            // checked
            if (this.name === attributes.checked) {
              renderSpecialAttribute(this.value, 'checked');
              renderAttribute(this.name, normalizeBoolean(this.value) ? true : false, this.node);
              element.checked = normalizeBoolean(this.value) ? true : false;
            }
            // disabled
            if (this.name === attributes.disabled) {
              renderSpecialAttribute(this.value, 'disabled');
              renderAttribute(this.name, normalizeBoolean(this.value) ? true : false, this.node);
            }
            // multiple
            if (this.name === attributes.multiple) {
              renderSpecialAttribute(this.value, 'multiple');
              renderAttribute(this.name, normalizeBoolean(this.value) ? true : false, this.node);
            }
            // readonly
            if (this.name === attributes.readonly) {
              var bool = normalizeBoolean(this.value);
              if (ie === 7) {
                element.readOnly = bool ? true : false;
              } else {
                renderSpecialAttribute(this.value, 'readonly');
              }
              renderAttribute(this.name, bool ? true : false, this.node);
            }
            // selected
            if (this.name === attributes.selected) {
              renderSpecialAttribute(this.value, 'selected');
              renderAttribute(this.name, normalizeBoolean(this.value) ? true : false, this.node);
            }
          }
        };

        var Interpolation = function Interpolation(value, node, attribute) {
          this.value = node && !isTextNode(node.element) ? trim(value) : value;
          this.node = node;
          this.attribute = attribute;
          this.sequence = [];
          this.expressions = [];
          var parts = this.value.match(regex.sequence);
          if (parts) {
            for (var i = 0, l = parts.length; i < l; i++) {
              if (parts[i].match(regex.token)) {
                var exp = new Expression(trimTokens(parts[i]), this.node, this.attribute);
                this.sequence.push(exp);
                this.expressions.push(exp);
              } else {
                this.sequence.push(parts[i]);
              }
            }
            trimArray(this.sequence);
          }
        };
        Interpolation.prototype = {
          toString: function toString() {
            return '[object Interpolation]';
          },
          dispose: function dispose() {
            if (this.expressions) {
              for (var i = 0, l = this.expressions.length; i < l; i++) {
                this.expressions[i].dispose();
              }
            }
            this.value = null;
            this.node = null;
            this.attribute = null;
            this.sequence = null;
            this.expressions = null;
          },
          update: function update() {
            var i = -1,
                l = this.expressions.length;
            while (++i < l) {
              this.expressions[i].update();
            }
          },
          render: function render() {
            var rendered = '';
            if (this.sequence) {
              for (var i = 0, l = this.sequence.length; i < l; i++) {
                var val = '';
                if (isExpression(this.sequence[i])) {
                  val = this.sequence[i].value;
                } else {
                  val = this.sequence[i];
                }
                if (!isDefined(val)) {
                  val = '';
                }
                rendered += val;
              }
            }
            return rendered;
          }
        };

        var Expression = function Expression(pattern, node, attribute) {
          if (!isDefined(pattern)) {
            return;
          }
          this.pattern = pattern;
          this.isString = regex.string.test(pattern);
          this.node = node;
          this.attribute = attribute;
          this.value = this.isString ? this.pattern : undefined;
          if (this.isString) {
            this.isFunction = false;
            this.depth = null;
            this.path = null;
            this.params = null;
          } else {
            this.isFunction = isExpFunction(this.pattern);
            this.depth = getScopeDepth(this.pattern);
            this.path = getExpressionPath(this.pattern);
            this.params = !this.isFunction ? null : getParamsFromString(this.pattern.match(regex.func)[2]);
          }
        };
        Expression.prototype = {
          toString: function toString() {
            return '[object Expression]';
          },
          dispose: function dispose() {
            this.pattern = null;
            this.node = null;
            this.attribute = null;
            this.path = null;
            this.params = null;
            this.value = null;
          },
          update: function update() {
            var node = this.node;
            if (!node && this.attribute) {
              node = this.attribute.node;
            }
            if (!node && node.scope) {
              return;
            }
            var newValue = this.getValue(node.scope);
            newValue = getWatcherValue(this, newValue);
            if (this.value !== newValue) {
              this.value = newValue;
              (this.node || this.attribute).invalidate = true;
            }
          },
          getValue: function getValue(scope, getFunction, getParams) {
            var node = this.node;
            if (!node && this.attribute) {
              node = this.attribute.node;
            }
            var context = {};
            if (node) {
              context[vars.element] = node.element;
              if (node.element) {
                context[vars.parentElement] = node.element.parentNode;
              }
            }
            context[vars.attribute] = this.attribute;
            context[vars.scope] = scope;
            return _getValue(scope, this.pattern, this.path, this.params, getFunction, getParams, undefined, context);
          }
        };

        var templates = new HashMap('st');

        var Template = function Template(element) {
          this.watchers = new HashMap('stw');
          this.node = null;
          this.scope = null;
          this.compile(element);
        };
        Template.prototype = {
          toString: function toString() {
            return '[object Template]';
          },
          compile: function compile(element) {
            if (element) {
              this.element = element;
            }
            if (this.node) {
              this.node.dispose();
            }
            this.node = _compile(this, this.element);
            this.node.root = true;
            this.scope = this.node.scope;
          },
          update: function update(data) {
            if (isDefined(data)) {
              updateScopeWithData(this.node.scope, data);
            }
            if (this.node) {
              this.node.update();
            }
          },
          render: function render(data) {
            this.update(data);
            if (this.node) {
              this.node.render();
            }
          },
          invalidate: function invalidate() {
            if (this.node) {
              this.node.invalidateData();
            }
          },
          watch: function watch(target, watcher) {
            if (!isString(target) && !isElement(target) || !isFunction(watcher)) {
              return;
            }
            this.watchers.put(target, watcher);
          },
          unwatch: function unwatch(target) {
            this.watchers.remove(target);
          },
          clearWatchers: function clearWatchers() {
            this.watchers.dispose();
          },
          clearEvents: function clearEvents() {
            this.node.clearEvents();
          },
          getNode: function getNode(element) {
            return this.node.getNode(element);
          },
          dispose: function dispose() {
            templates.remove(this.element);
            if (this.watchers) {
              this.watchers.dispose();
            }
            if (this.node) {
              this.node.dispose();
            }
            this.element = null;
            this.watchers = null;
            this.node = null;
          }
        };

        // written by Dean Edwards, 2005
        // with input from Tino Zijdel, Matthias Miller, Diego Perini
        // http://dean.edwards.name/weblog/2005/10/add-event/
        function _addEvent(element, type, handler) {
          if (element.addEventListener) {
            element.addEventListener(type, handler, false);
          } else {
            // assign each event handler a unique ID
            if (!handler.$$guid) {
              handler.$$guid = _addEvent.guid++;
            }
            // create a hash table of event types for the element
            if (!element.events) {
              element.events = {};
            }
            // create a hash table of event handlers for each element/event pair
            var handlers = element.events[type];
            if (!handlers) {
              handlers = element.events[type] = {};
              // store the existing event handler (if there is one)
              if (element['on' + type]) {
                handlers[0] = element['on' + type];
              }
            }
            // store the event handler in the hash table
            handlers[handler.$$guid] = handler;
            // assign a global event handler to do all the work
            element['on' + type] = function (event) {
              var returnValue = true;
              // grab the event object (IE uses a global event object)
              event = event || fixEvent(((this.ownerDocument || this.document || this).parentWindow || window).event);
              // get a reference to the hash table of event handlers
              var handlers = this.events[event.type];
              // execute each event handler
              for (var i in handlers) {
                if (handlers.hasOwnProperty(i)) {
                  this.$$handleEvent = handlers[i];
                  if (this.$$handleEvent(event) === false) {
                    returnValue = false;
                  }
                }
              }
              return returnValue;
            };
          }
        }
        // a counter used to create unique IDs
        _addEvent.guid = 1;
        function _removeEvent(element, type, handler) {
          if (element.removeEventListener) {
            element.removeEventListener(type, handler, false);
          } else {
            // delete the event handler from the hash table
            if (element.events && element.events[type]) {
              delete element.events[type][handler.$$guid];
            }
          }
        }
        function fixEvent(event) {
          // add W3C standard event methods
          event.preventDefault = fixEvent.preventDefault;
          event.stopPropagation = fixEvent.stopPropagation;
          return event;
        }
        fixEvent.preventDefault = function () {
          this.returnValue = false;
        };
        fixEvent.stopPropagation = function () {
          this.cancelBubble = true;
        };

        var maxDepth;
        var eventStore = [];

        function parseEvents(element, object, depth) {
          maxDepth = depth === undefined ? Number.MAX_VALUE : depth;
          parseNode(element, object, 0, true);
        }

        function parseNode(element, object, depth, isRoot) {
          if (!isElement(element)) {
            throw new Error('Error in soma.template.parseEvents, only a DOM Element can be parsed.');
          }
          if (isRoot) {
            parseAttributes(element, object);
          }
          if (maxDepth === 0) {
            return;
          }
          var child = element.firstChild;
          while (child) {
            if (child.nodeType === 1) {
              if (depth < maxDepth) {
                parseNode(child, object, ++depth);
                parseAttributes(child, object);
              }
            }
            child = child.nextSibling;
          }
        }

        function parseAttributes(element, object) {
          for (var attr, name, value, attrs = element.attributes, j = 0, jj = attrs && attrs.length; j < jj; j++) {
            attr = attrs[j];
            if (attr.specified) {
              name = attr.name;
              value = attr.value;
              if (events[name]) {
                var handler = getHandlerFromPattern(object, value);
                if (handler && isFunction(handler)) {
                  _addEvent(element, events[name], handler);
                  eventStore.push({ element: element, type: events[name], handler: handler });
                }
              }
            }
          }
        }

        function getHandlerFromPattern(object, pattern) {
          var parts = pattern.match(regex.func);
          if (parts) {
            var func = parts[1];
            if (isFunction(object[func])) {
              return object[func];
            }
          }
        }

        function clearEvents(element) {
          var i = eventStore.length,
              l = 0;
          while (--i >= l) {
            var item = eventStore[i];
            if (element === item.element || contains(element, item.element)) {
              _removeEvent(item.element, item.type, item.handler);
              eventStore.splice(i, 1);
            }
          }
        }

        var ready;
        if (typeof document === 'object') {
          // https://github.com/ded/domready
          var ready = (function () {
            function l(b) {
              for (k = 1; b = a.shift();) b();
            }var b,
                a = [],
                c = !1,
                d = document,
                e = d.documentElement,
                f = e.doScroll,
                g = 'DOMContentLoaded',
                h = 'addEventListener',
                i = 'onreadystatechange',
                j = 'readyState',
                k = /^loade|c/.test(d[j]);return (d[h] && d[h](g, b = function () {
              d.removeEventListener(g, b, c), l();
            }, c), f && d.attachEvent(i, b = function () {
              /^c/.test(d[j]) && (d.detachEvent(i, b), l());
            }), f ? function (b) {
              self != top ? k ? b() : a.push(b) : (function () {
                try {
                  e.doScroll('left');
                } catch (a) {
                  return setTimeout(function () {
                    ready(b);
                  }, 50);
                }b();
              })();
            } : function (b) {
              k ? b() : a.push(b);
            });
          })();
          if (settings.autocreate) {
            var parse = function parse(element) {
              var child = !element ? document.body : element.firstChild;
              while (child) {
                if (child.nodeType === 1) {
                  parse(child);
                  var attrValue = child.getAttribute(attributes.template);
                  if (attrValue) {
                    var getFunction = new Function('return ' + attrValue + ';');
                    var f = getFunction();
                    if (isFunction(f)) {
                      soma.template.bootstrap(attrValue, child, f);
                    }
                  }
                }
                child = child.nextSibling;
              }
            };
            ready(parse);
          }
        }
        function bootstrapTemplate(attrValue, element, func) {
          var tpl = createTemplate(element);
          func(tpl, tpl.scope, tpl.element, tpl.node);
        }

        function createTemplate(source, target) {
          var element;
          if (isString(source)) {
            // string template
            if (!isElement(target)) {
              throw new Error(soma.template.errors.TEMPLATE_STRING_NO_ELEMENT);
            }
            target.innerHTML = source;
            element = target;
          } else if (isElement(source)) {
            if (isElement(target)) {
              // element template with target
              target.innerHTML = source.innerHTML;
              element = target;
            } else {
              // element template
              element = source;
            }
          } else {
            throw new Error(soma.template.errors.TEMPLATE_NO_PARAM);
          }
          // existing template
          if (getTemplate(element)) {
            getTemplate(element).dispose();
            templates.remove(element);
          }
          // create template
          var template = new Template(element);
          templates.put(element, template);
          return template;
        }

        function getTemplate(element) {
          return templates.get(element);
        }

        function renderAllTemplates() {
          var data = templates.getData();
          for (var key in templates.getData()) {
            if (data.hasOwnProperty(key)) {
              templates.get(key).render();
            }
          }
        }

        function appendHelpers(obj) {
          if (obj === null) {
            helpersObject = {};
            helpersScopeObject = {};
          }
          if (isDefined(obj) && isObject(obj)) {
            for (var key in obj) {
              if (obj.hasOwnProperty(key)) {
                helpersObject[key] = helpersScopeObject[key] = obj[key];
              }
            }
          }
          return helpersObject;
        }

        // set regex
        tokens.start(tokenStart);
        tokens.end(tokenEnd);

        // plugins

        soma.plugins = soma.plugins || {};

        var TemplatePlugin = function TemplatePlugin(instance, injector) {
          instance.constructor.prototype.createTemplate = function (cl, domElement) {
            if (!cl || typeof cl !== 'function') {
              throw new Error('Error creating a template, the first parameter must be a function.');
            }
            if (domElement && isElement(domElement)) {
              var template = soma.template.create(domElement);
              for (var key in template) {
                if (typeof template[key] === 'function') {
                  cl.prototype[key] = template[key].bind(template);
                }
              }
              cl.prototype.render = template.render.bind(template);
              var childInjector = injector.createChild();
              childInjector.mapValue('template', template);
              childInjector.mapValue('scope', template.scope);
              childInjector.mapValue('element', template.element);
              return childInjector.createInstance(cl);
            }
            return null;
          };
          soma.template.bootstrap = function (attrValue, element, func) {
            instance.createTemplate(func, element);
          };
        };
        if (soma.plugins && soma.plugins.add) {
          soma.plugins.add(TemplatePlugin);
        }

        soma.template.Plugin = TemplatePlugin;

        // exports
        soma.template.create = createTemplate;
        soma.template.get = getTemplate;
        soma.template.renderAll = renderAllTemplates;
        soma.template.helpers = appendHelpers;
        soma.template.bootstrap = bootstrapTemplate;
        soma.template.addEvent = _addEvent;
        soma.template.removeEvent = _removeEvent;
        soma.template.parseEvents = parseEvents;
        soma.template.clearEvents = clearEvents;
        soma.template.ready = ready;

        // register for AMD module
        if (typeof define === 'function' && typeof define.amd !== 'undefined') {
          define('soma-template', soma.template);
        }

        // export for node.js
        if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
          module.exports = soma.template;
        }
        if (typeof exports !== 'undefined') {
          exports = soma.template;
        }

        return soma.template;
      })());
    }
  };
});
System.register("src/utils/Utils", [], function (_export) {
  "use strict";

  return {
    setters: [],
    execute: function () {
      _export("default", {

        classToTypeMap: {
          "[object String]": "String",
          "[object Array]": "Array",
          "[object Object]": "Object",
          "[object RegExp]": "RegExp",
          "[object Number]": "Number",
          "[object Boolean]": "Boolean",
          "[object Date]": "Date",
          "[object Function]": "Function",
          "[object Error]": "Error"
        },

        getClass: function getClass(value) {
          // The typeof null and undefined is "object" under IE8
          if (value === undefined) {
            return "Undefined";
          } else if (value === null) {
            return "Null";
          }
          var classString = Object.prototype.toString.call(value);
          return this.classToTypeMap[classString] || classString.slice(8, -1);
        },

        getUID: function getUID() {
          return (new Date().getTime() + "" + Math.floor(Math.random() * 1000000)).substr(0, 18);
        },

        isFunction: function isFunction(obj) {
          return typeof obj === "function";
        },

        equals: function equals(object1, object2) {
          return this.__equals(object1, object2, [], []);
        },

        isObject: function isObject(obj) {
          return Object.prototype.toString.call(obj) == "[object Object]";
        },

        isDate: function isDate(obj) {
          return Object.prototype.toString.call(obj) == "[object Date]";
        },

        camelCase: function camelCase(s) {
          if (s.indexOf("-") != -1) {
            return (s || "").toLowerCase().replace(/(-)\w/g, function (m) {
              return m.toUpperCase().replace(/-/, "");
            });
          }
          return s;
        },

        firstUp: function firstUp(str) {
          return str.charAt(0).toUpperCase() + str.substr(1);
        },

        hyphenate: function hyphenate(str) {
          return str.replace(/\s/g, "-").toLowerCase();
        },

        __equals: function __equals(object1, object2, aStack, bStack) {
          // Identical objects are equal. `0 === -0`, but they aren't identical.
          // See the [Harmony `egal` proposal](http://wiki.ecmascript.org/doku.php?id=harmony:egal).
          if (object1 === object2) {
            return object1 !== 0 || 1 / object1 == 1 / object2;
          }
          // A strict comparison is necessary because `null == undefined`.
          if (object1 === null || object2 === null) {
            return object1 === object2;
          }
          // Compare `[[Class]]` names.
          var className = Object.prototype.toString.call(object1);
          if (className != Object.prototype.toString.call(object2)) {
            return false;
          }
          switch (className) {
            // Strings, numbers, dates, and booleans are compared by value.
            case "[object String]":
              // Primitives and their corresponding object wrappers are equivalent; thus, `"5"` is
              // equivalent to `new String("5")`.
              return object1 == String(object2);
            case "[object Number]":
              // `NaN`s are equivalent, but non-reflexive. An `egal` comparison is performed for
              // other numeric values.
              return object1 != +object1 ? object2 != +object2 : object1 === 0 ? 1 / object1 == 1 / object2 : object1 == +object2;
            case "[object Date]":
            case "[object Boolean]":
              // Coerce dates and booleans to numeric primitive values. Dates are compared by their
              // millisecond representations. Note that invalid dates with millisecond representations
              // of `NaN` are not equivalent.
              return +object1 == +object2;
            // RegExps are compared by their source patterns and flags.
            case "[object RegExp]":
              return object1.source == object2.source && object1.global == object2.global && object1.multiline == object2.multiline && object1.ignoreCase == object2.ignoreCase;
          }
          if (typeof object1 != "object" || typeof object2 != "object") {
            return false;
          }
          // Assume equality for cyclic structures. The algorithm for detecting cyclic
          // structures is adapted from ES 5.1 section 15.12.3, abstract operation `JO`.
          var length = aStack.length;
          while (length--) {
            // Linear search. Performance is inversely proportional to the number of
            // unique nested structures.
            if (aStack[length] == object1) {
              return bStack[length] == object2;
            }
          }
          // Objects with different constructors are not equivalent, but `Object`s
          // from different frames are.
          var aCtor = object1.constructor,
              bCtor = object2.constructor;
          if (aCtor !== bCtor && !(this.isFunction(aCtor) && aCtor instanceof aCtor && this.isFunction(bCtor) && bCtor instanceof bCtor) && ("constructor" in object1 && "constructor" in object2)) {
            return false;
          }
          // Add the first object to the stack of traversed objects.
          aStack.push(object1);
          bStack.push(object2);
          var size = 0,
              result = true;
          // Recursively compare objects and arrays.
          if (className == "[object Array]") {
            // Compare array lengths to determine if a deep comparison is necessary.
            size = object1.length;
            result = size == object2.length;
            if (result) {
              // Deep compare the contents, ignoring non-numeric properties.
              while (size--) {
                if (!(result = this.__equals(object1[size], object2[size], aStack, bStack))) {
                  break;
                }
              }
            }
          } else {
            // Deep compare objects.
            for (var key in object1) {
              if (Object.prototype.hasOwnProperty.call(object1, key)) {
                // Count the expected number of properties.
                size++;
                // Deep compare each member.
                if (!(result = Object.prototype.hasOwnProperty.call(object2, key) && this.__equals(object1[key], object2[key], aStack, bStack))) {
                  break;
                }
              }
            }
            // Ensure that both objects contain the same number of properties.
            if (result) {
              for (key in object2) {
                if (Object.prototype.hasOwnProperty.call(object2, key) && ! size--) {
                  break;
                }
              }
              result = !size;
            }
          }
          // Remove the first object from the stack of traversed objects.
          aStack.pop();
          bStack.pop();

          return result;
        }

      });
    }
  };
});
System.register("src/event/pageReady", [], function (_export) {
  "use strict";

  return {
    setters: [],
    execute: function () {
      _export("default", (function () {

        var __readyCallbacks = [];

        var __executeReadyCallbacks = function __executeReadyCallbacks() {
          window.removeEventListener("load", __executeReadyCallbacks, false);
          __readyCallbacks.forEach(function (callback) {
            callback();
          });
          __readyCallbacks = [];
        };

        if (document.addEventListener) {
          window.addEventListener("load", __executeReadyCallbacks, false);
          document.addEventListener("DOMContentLoaded", __executeReadyCallbacks);
        }

        return {
          ready: function ready(callback) {
            if (document.readyState === "complete") {
              window.setTimeout(callback, 1);
              return;
            }
            __readyCallbacks.push(callback);
          }
        };
      })());
    }
  };
});
System.register("src/css/Class", ["src/css/Helpers"], function (_export) {
  "use strict";

  var cssHelpers;
  return {
    setters: [function (_srcCssHelpers) {
      cssHelpers = _srcCssHelpers["default"];
    }],
    execute: function () {
      _export("default", {

        addClass: function addClass(classToAdd) {
          this.forEach(function (el) {
            cssHelpers.addClass(el, classToAdd);
          });
          return this;
        },

        addClasses: function addClasses(classesToAdd) {
          this.forEach(function (el) {
            cssHelpers.addClasses(el, classesToAdd);
          });
          return this;
        },

        getClass: function getClass() {
          if (this[0] && this[0] instanceof HTMLElement) {
            return this[0].className;
          }
          return "";
        },

        hasClass: function hasClass(classToCheck) {
          var res = false;
          if (this[0]) {
            return cssHelpers.hasClass(this[0], classToCheck);
          }
          return res;
        },

        removeClass: function removeClass(classToRemove) {
          this.forEach(function (el) {
            cssHelpers.removeClass(el, classToRemove);
          });
          return this;
        },

        removeClasses: function removeClasses(classesToRemove) {
          this.forEach(function (el) {
            cssHelpers.removeClasses(el, classesToRemove);
          });
          return this;
        },

        replaceClass: function replaceClass(oldClass, newClass) {
          this.forEach(function (el) {
            if (cssHelpers.hasClass(el, oldClass)) {
              cssHelpers.removeClass(el, oldClass);
              cssHelpers.addClass(el, newClass);
            }
          });
          return this;
        },

        toggleClass: function toggleClass(classToToggle) {
          this.forEach(function (el) {
            cssHelpers.toggleClass(el, classToToggle);
          });
          return this;
        },

        toggleClasses: function toggleClasses(classesToToggle) {
          this.forEach(function (el) {
            cssHelpers.toggleClasses(el, classesToToggle);
          });
          return this;
        }
      });
    }
  };
});
System.register("src/css/Style", ["src/css/Helpers", "src/utils/Utils"], function (_export) {
  "use strict";

  var cssHelpers, utils;
  return {
    setters: [function (_srcCssHelpers) {
      cssHelpers = _srcCssHelpers["default"];
    }, function (_srcUtilsUtils) {
      utils = _srcUtilsUtils["default"];
    }],
    execute: function () {
      _export("default", {

        getStyle: function getStyle(name) {
          name = cssHelpers.getPropertyName(name);
          if (this[0]) {
            return this[0].style[utils.camelcase(name)];
          }
        },

        setStyle: function setStyle(name, value) {
          name = cssHelpers.getPropertyName(name);
          this.forEach(function (el) {
            el.style[name] = value;
          });
          return this;
        },

        setStyles: function setStyles(styleMap) {
          for (var name in styleMap) {
            this.setStyle(name, styleMap[name]);
          }
          return this;
        }

      });
    }
  };
});
System.register("src/core/Traversing", ["src/core/Collection"], function (_export) {
  "use strict";

  var Collection;
  return {
    setters: [function (_srcCoreCollection) {
      Collection = _srcCoreCollection["default"];
    }],
    execute: function () {
      _export("default", {

        find: function find(selector) {
          var res = [];
          this.forEach(function (el) {
            res = res.concat(Array.prototype.slice.call(el.querySelectorAll(selector)));
          });
          return Collection.fromArray(res);
        },

        eq: function eq(index) {
          var res = this[index] ? [this[index]] : [];
          return Collection.fromArray(res);
        },

        getFirst: function getFirst() {
          var res = this[0] ? [this[0]] : [];
          return Collection.fromArray(res);
        },

        getLast: function getLast() {
          var res = this[0] ? [this[this.length - 1]] : [];
          return Collection.fromArray(res);
        },

        getNext: function getNext(selector) {
          var res = Collection();
          var sibling = null;
          this.forEach(function (item) {
            sibling = item.nextSibling;
            if (sibling) {
              while (item.nextSibling && sibling.nodeType !== item.nodeType) {
                sibling = item.nextSibling;
              }
            }
            sibling = sibling ? Collection.fromArray([sibling]) : Collection();
            res = res.concat(sibling.find(selector));
          });
          return res;
        },

        getPrev: function getPrev(selector) {
          var res = Collection();
          var sibling = null;
          this.forEach(function (item) {
            sibling = item.previousSibling;
            if (sibling) {
              while (item.previousSibling && sibling.nodeType !== item.nodeType) {
                sibling = item.previousSibling;
              }
            }
            sibling = sibling ? Collection.fromArray([sibling]) : Collection();
            res = res.concat(sibling.find(selector));
          });
          return res;
        },

        getChildren: function getChildren(selector) {
          var res = Collection();
          var children = null;
          this.forEach(function (item) {
            children = Collection.fromArray(Array.prototype.slice.call(item.childNodes));
            res = res.concat(children.find(selector));
          });
          return res;
        },

        getParents: function getParents(selector) {
          var res = Collection();
          var parent = null;
          this.forEach(function (item) {
            parent = item.parentNode ? Collection.fromArray([item.parentNode]) : Collection();
            res = res.concat(parent.find(selector));
          });
          return res;
        }

      });
    }
  };
});
System.register('src/event/Helpers', [], function (_export) {
  'use strict';

  return {
    setters: [],
    execute: function () {
      _export('default', {

        isEventSupported: function isEventSupported(target, eventName) {
          eventName = 'on' + eventName;
          var isSupported = (eventName in target);
          if (!isSupported) {
            target.setAttribute(eventName, 'return;');
            isSupported = typeof target[eventName] == 'function';
            target.removeAttribute(eventName);
          }
          return isSupported;
        }

      });
    }
  };
});
System.register('src/modules/Logger', [], function (_export) {
    'use strict';

    var scopeLogger;
    return {
        setters: [],
        execute: function () {
            scopeLogger = {};

            /*! loglevel - v1.3.1 - https://github.com/pimterry/loglevel - (c) 2015 Tim Perry - licensed MIT */
            (function (root, definition) {
                if (typeof module === 'object' && module.exports && typeof require === 'function') {
                    module.exports = definition();
                } else if (typeof define === 'function' && typeof define.amd === 'object') {
                    define(definition);
                } else {
                    root.log = definition();
                }
            })(scopeLogger, function () {
                var self = {};
                var noop = function noop() {};
                var undefinedType = 'undefined';

                function realMethod(methodName) {
                    if (typeof console === undefinedType) {
                        return false; // We can't build a real method without a console to log to
                    } else if (console[methodName] !== undefined) {
                        return bindMethod(console, methodName);
                    } else if (console.log !== undefined) {
                        return bindMethod(console, 'log');
                    } else {
                        return noop;
                    }
                }

                function bindMethod(obj, methodName) {
                    var method = obj[methodName];
                    if (typeof method.bind === 'function') {
                        return method.bind(obj);
                    } else {
                        try {
                            return Function.prototype.bind.call(method, obj);
                        } catch (e) {
                            // Missing bind shim or IE8 + Modernizr, fallback to wrapping
                            return function () {
                                return Function.prototype.apply.apply(method, [obj, arguments]);
                            };
                        }
                    }
                }

                function enableLoggingWhenConsoleArrives(methodName, level) {
                    return function () {
                        if (typeof console !== undefinedType) {
                            replaceLoggingMethods(level);
                            self[methodName].apply(self, arguments);
                        }
                    };
                }

                var logMethods = ['trace', 'debug', 'info', 'warn', 'error'];

                function replaceLoggingMethods(level) {
                    for (var i = 0; i < logMethods.length; i++) {
                        var methodName = logMethods[i];
                        self[methodName] = i < level ? noop : self.methodFactory(methodName, level);
                    }
                }

                function persistLevelIfPossible(levelNum) {
                    var levelName = (logMethods[levelNum] || 'silent').toUpperCase();

                    // Use localStorage if available
                    try {
                        window.localStorage['loglevel'] = levelName;
                        return;
                    } catch (ignore) {}

                    // Use session cookie as fallback
                    try {
                        window.document.cookie = 'loglevel=' + levelName + ';';
                    } catch (ignore) {}
                }

                function loadPersistedLevel() {
                    var storedLevel;

                    try {
                        storedLevel = window.localStorage['loglevel'];
                    } catch (ignore) {}

                    if (typeof storedLevel === undefinedType) {
                        try {
                            storedLevel = /loglevel=([^;]+)/.exec(window.document.cookie)[1];
                        } catch (ignore) {}
                    }

                    if (self.levels[storedLevel] === undefined) {
                        storedLevel = 'WARN';
                    }

                    self.setLevel(self.levels[storedLevel], false);
                }

                /*
                 *
                 * Public API
                 *
                 */

                self.levels = { 'TRACE': 0, 'DEBUG': 1, 'INFO': 2, 'WARN': 3,
                    'ERROR': 4, 'SILENT': 5 };

                self.methodFactory = function (methodName, level) {
                    return realMethod(methodName) || enableLoggingWhenConsoleArrives(methodName, level);
                };

                self.setLevel = function (level, persist) {
                    if (typeof level === 'string' && self.levels[level.toUpperCase()] !== undefined) {
                        level = self.levels[level.toUpperCase()];
                    }
                    if (typeof level === 'number' && level >= 0 && level <= self.levels.SILENT) {
                        if (persist !== false) {
                            // defaults to true
                            persistLevelIfPossible(level);
                        }
                        replaceLoggingMethods(level);
                        if (typeof console === undefinedType && level < self.levels.SILENT) {
                            return 'No console available for logging';
                        }
                    } else {
                        throw 'log.setLevel() called with invalid level: ' + level;
                    }
                };

                self.enableAll = function (persist) {
                    self.setLevel(self.levels.TRACE, persist);
                };

                self.disableAll = function (persist) {
                    self.setLevel(self.levels.SILENT, persist);
                };

                // Grab the current global log variable in case of overwrite
                var _log = typeof window !== undefinedType ? window.log : undefined;
                self.noConflict = function () {
                    if (typeof window !== undefinedType && window.log === self) {
                        window.log = _log;
                    }

                    return self;
                };

                loadPersistedLevel();
                return self;
            });

            _export('default', scopeLogger.log);
        }
    };
});
System.register("src/core/Manipulation", ["src/core/Collection"], function (_export) {
  "use strict";

  var Collection;
  return {
    setters: [function (_srcCoreCollection) {
      Collection = _srcCoreCollection["default"];
    }],
    execute: function () {
      _export("default", {

        /**
        *
        */
        append: function append(toBeAppended) {
          var itemToInsert = null;
          toBeAppended = Collection.query(toBeAppended);
          toBeAppended.forEach((function (itemToAppend) {
            this.forEach((function (item, index) {
              itemToInsert = index === 0 ? itemToAppend : itemToAppend.cloneNode(true);
              item.appendChild(itemToInsert);
            }).bind(this));
          }).bind(this));
          return this;
        },

        /**
        *
        */
        appendTo: function appendTo(target) {
          target = Collection.query(target);
          this.forEach(function (item) {
            target.forEach(function (targetItem, index) {
              if (index === 0) {
                targetItem.appendChild(item);
              } else {
                targetItem.appendChild(item.cloneNode(true));
              }
            });
          });
          return this;
        },

        /**
        *
        */
        insertBefore: function insertBefore(target) {
          target = Collection.query(target);
          this.forEach(function (item) {
            target.forEach(function (targetItem, index) {
              if (index === 0) {
                targetItem.parentNode.insertBefore(item, targetItem);
              } else {
                targetItem.parentNode.insertBefore(item.cloneNode(true), targetItem);
              }
            });
          });
          return this;
        },

        /**
        *
        */
        insertAfter: function insertAfter(target) {
          var parent = null;
          var itemToInsert = null;
          target = Collection.query(target);
          this.reverse().forEach(function (item) {
            target.forEach(function (targetItem, index) {
              parent = targetItem.parentNode;
              itemToInsert = index === 0 ? item : item.cloneNode(true);
              if (parent.lastchild == targetItem) {
                parent.appendChild(itemToInsert);
              } else {
                parent.insertBefore(itemToInsert, targetItem.nextSibling);
              }
            });
          });
          return this;
        },

        /**
        *
        */
        remove: function remove() {
          this.forEach(function (item) {
            item.parentNode.removeChild(item);
          });
          return this;
        },

        /**
        *
        */
        empty: function empty() {
          this.forEach(function (item) {
            item.innerHTML = "";
          });
          return this;
        },

        /**
        *
        */
        clone: function clone(copyEvents) {
          var clones = Collection.fromArray([]);
          var index = 0;
          var eventParams = null;
          this.forEach(function (item) {
            clones[index] = item.cloneNode(true);
            if (copyEvents === true) {
              for (var eventName in item.$$__listeners) {
                for (var listernerId in item.$$__listeners[eventName]) {
                  eventParams = item.$$__listeners[eventName][listernerId];
                  Collection.fromArray([clones[index]]).on(eventName, eventParams.listener, eventParams.context, eventParams.useCapture);
                }
              }
            }
            index = clones.length;
          });
          return clones;
        }

      });
    }
  };
});
System.register("src/event/Notifier", ["npm:babel-runtime@5.4.7/helpers/create-class", "npm:babel-runtime@5.4.7/helpers/class-call-check"], function (_export) {
  var _createClass, _classCallCheck, Notifier;

  return {
    setters: [function (_npmBabelRuntime547HelpersCreateClass) {
      _createClass = _npmBabelRuntime547HelpersCreateClass["default"];
    }, function (_npmBabelRuntime547HelpersClassCallCheck) {
      _classCallCheck = _npmBabelRuntime547HelpersClassCallCheck["default"];
    }],
    execute: function () {
      "use strict";

      Notifier = (function () {
        function Notifier() {
          _classCallCheck(this, Notifier);

          this.subscribers = {};
        }

        _createClass(Notifier, [{
          key: "subscribe",
          value: function subscribe(type, callback, ctx) {
            ctx = ctx || window;
            this.subscribers[type] = this.subscribers[type] || [];
            this.subscribers[type].push({
              fn: callback,
              scope: ctx
            });
          }
        }, {
          key: "unsubscribe",
          value: function unsubscribe(type, callback, ctx) {
            ctx = ctx || window;
            this.subscribers[type] = this.subscribers[type].filter(function (subscriber) {
              if (!(subscriber.fn == callback && subscriber.scope == ctx)) {
                return subscriber;
              }
            });
          }
        }, {
          key: "notify",
          value: function notify(type, message) {
            this.subscribers[type] = this.subscribers[type] || [];
            this.subscribers[type].forEach(function (subscriber) {
              subscriber.fn.call(subscriber.scope, message);
            });
          }
        }]);

        return Notifier;
      })();

      _export("default", Notifier);
    }
  };
});
System.register('src/modules/Router', ['src/modules/Logger'], function (_export) {
  'use strict';

  var Logger, scopeRouter, init;
  return {
    setters: [function (_srcModulesLogger) {
      Logger = _srcModulesLogger['default'];
    }],
    execute: function () {
      scopeRouter = {};

      // https://github.com/flatiron/director
      // Generated on Tue Dec 16 2014 12:13:47 GMT+0100 (CET) by Charlie Robbins, Paolo Fragomeni & the Contributors (Using Codesurgeon).
      // Version 1.2.6
      //

      (function (exports) {

        /*
         * browser.js: Browser specific functionality for director.
         *
         * (C) 2011, Charlie Robbins, Paolo Fragomeni, & the Contributors.
         * MIT LICENSE
         *
         */

        var dloc = document.location;

        function dlocHashEmpty() {
          // Non-IE browsers return '' when the address bar shows '#'; Director's logic
          // assumes both mean empty.
          return dloc.hash === '' || dloc.hash === '#';
        }

        var listener = {
          mode: 'modern',
          hash: dloc.hash,
          history: false,

          check: function check() {
            var h = dloc.hash;
            if (h != this.hash) {
              this.hash = h;
              this.onHashChanged();
            }
          },

          fire: function fire() {
            if (this.mode === 'modern') {
              this.history === true ? window.onpopstate() : window.onhashchange();
            } else {
              this.onHashChanged();
            }
          },

          init: function init(fn, history) {
            var self = this;
            this.history = history;

            if (!Router.listeners) {
              Router.listeners = [];
            }

            function onchange(onChangeEvent) {
              for (var i = 0, l = Router.listeners.length; i < l; i++) {
                Router.listeners[i](onChangeEvent);
              }
            }

            //note IE8 is being counted as 'modern' because it has the hashchange event
            if ('onhashchange' in window && (document.documentMode === undefined || document.documentMode > 7)) {
              // At least for now HTML5 history is available for 'modern' browsers only
              if (this.history === true) {
                // There is an old bug in Chrome that causes onpopstate to fire even
                // upon initial page load. Since the handler is run manually in init(),
                // this would cause Chrome to run it twise. Currently the only
                // workaround seems to be to set the handler after the initial page load
                // http://code.google.com/p/chromium/issues/detail?id=63040
                setTimeout(function () {
                  window.onpopstate = onchange;
                }, 500);
              } else {
                window.onhashchange = onchange;
              }
              this.mode = 'modern';
            } else {
              //
              // IE support, based on a concept by Erik Arvidson ...
              //
              var frame = document.createElement('iframe');
              frame.id = 'state-frame';
              frame.style.display = 'none';
              document.body.appendChild(frame);
              this.writeFrame('');

              if ('onpropertychange' in document && 'attachEvent' in document) {
                document.attachEvent('onpropertychange', function () {
                  if (event.propertyName === 'location') {
                    self.check();
                  }
                });
              }

              window.setInterval(function () {
                self.check();
              }, 50);

              this.onHashChanged = onchange;
              this.mode = 'legacy';
            }

            Router.listeners.push(fn);

            return this.mode;
          },

          destroy: function destroy(fn) {
            if (!Router || !Router.listeners) {
              return;
            }

            var listeners = Router.listeners;

            for (var i = listeners.length - 1; i >= 0; i--) {
              if (listeners[i] === fn) {
                listeners.splice(i, 1);
              }
            }
          },

          setHash: function setHash(s) {
            // Mozilla always adds an entry to the history
            if (this.mode === 'legacy') {
              this.writeFrame(s);
            }

            if (this.history === true) {
              window.history.pushState({}, document.title, s);
              // Fire an onpopstate event manually since pushing does not obviously
              // trigger the pop event.
              this.fire();
            } else {
              dloc.hash = s[0] === '/' ? s : '/' + s;
            }
            return this;
          },

          writeFrame: function writeFrame(s) {
            // IE support...
            var f = document.getElementById('state-frame');
            var d = f.contentDocument || f.contentWindow.document;
            d.open();
            d.write('<script>_hash = \'' + s + '\'; onload = parent.listener.syncHash;<script>');
            d.close();
          },

          syncHash: function syncHash() {
            // IE support...
            var s = this._hash;
            if (s != dloc.hash) {
              dloc.hash = s;
            }
            return this;
          },

          onHashChanged: function onHashChanged() {}
        };

        var Router = exports.Router = function (routes) {
          if (!(this instanceof Router)) return new Router(routes);

          this.params = {};
          this.routes = {};
          this.methods = ['on', 'once', 'after', 'before'];
          this.scope = [];
          this._methods = {};

          this._insert = this.insert;
          this.insert = this.insertEx;

          this.historySupport = (window.history != null ? window.history.pushState : null) != null;

          this.configure();
          this.mount(routes || {});
        };

        Router.prototype.init = function (r) {
          var self = this,
              routeTo;
          this.handler = function (onChangeEvent) {
            var newURL = onChangeEvent && onChangeEvent.newURL || window.location.hash;
            var url = self.history === true ? self.getPath() : newURL.replace(/.*#/, '');
            self.dispatch('on', url.charAt(0) === '/' ? url : '/' + url);
          };

          listener.init(this.handler, this.history);

          if (this.history === false) {
            if (dlocHashEmpty() && r) {
              dloc.hash = r;
            } else if (!dlocHashEmpty()) {
              self.dispatch('on', '/' + dloc.hash.replace(/^(#\/|#|\/)/, ''));
            }
          } else {
            if (this.convert_hash_in_init) {
              // Use hash as route
              routeTo = dlocHashEmpty() && r ? r : !dlocHashEmpty() ? dloc.hash.replace(/^#/, '') : null;
              if (routeTo) {
                window.history.replaceState({}, document.title, routeTo);
              }
            } else {
              // Use canonical url
              routeTo = this.getPath();
            }

            // Router has been initialized, but due to the chrome bug it will not
            // yet actually route HTML5 history state changes. Thus, decide if should route.
            if (routeTo || this.run_in_init === true) {
              this.handler();
            }
          }

          return this;
        };

        Router.prototype.explode = function () {
          var v = this.history === true ? this.getPath() : dloc.hash;
          if (v.charAt(1) === '/') {
            v = v.slice(1);
          }
          return v.slice(1, v.length).split('/');
        };

        Router.prototype.setRoute = function (i, v, val) {
          var url = this.explode();

          if (typeof i === 'number' && typeof v === 'string') {
            url[i] = v;
          } else if (typeof val === 'string') {
            url.splice(i, v, s);
          } else {
            url = [i];
          }

          listener.setHash(url.join('/'));
          return url;
        };

        //
        // ### function insertEx(method, path, route, parent)
        // #### @method {string} Method to insert the specific `route`.
        // #### @path {Array} Parsed path to insert the `route` at.
        // #### @route {Array|function} Route handlers to insert.
        // #### @parent {Object} **Optional** Parent "routes" to insert into.
        // insert a callback that will only occur once per the matched route.
        //
        Router.prototype.insertEx = function (method, path, route, parent) {
          if (method === 'once') {
            method = 'on';
            route = (function (route) {
              var once = false;
              return function () {
                if (once) return;
                once = true;
                return route.apply(this, arguments);
              };
            })(route);
          }
          return this._insert(method, path, route, parent);
        };

        Router.prototype.getRoute = function (v) {
          var ret = v;

          if (typeof v === 'number') {
            ret = this.explode()[v];
          } else if (typeof v === 'string') {
            var h = this.explode();
            ret = h.indexOf(v);
          } else {
            ret = this.explode();
          }

          return ret;
        };

        Router.prototype.destroy = function () {
          listener.destroy(this.handler);
          return this;
        };

        Router.prototype.getPath = function () {
          var path = window.location.pathname;
          if (path.substr(0, 1) !== '/') {
            path = '/' + path;
          }
          return path;
        };

        function _every(arr, iterator) {
          for (var i = 0; i < arr.length; i += 1) {
            if (iterator(arr[i], i, arr) === false) {
              return;
            }
          }
        }

        function _flatten(arr) {
          var flat = [];
          for (var i = 0, n = arr.length; i < n; i++) {
            flat = flat.concat(arr[i]);
          }
          return flat;
        }

        function _asyncEverySeries(arr, iterator, callback) {
          if (!arr.length) {
            return callback();
          }
          var completed = 0;
          (function iterate() {
            iterator(arr[completed], function (err) {
              if (err || err === false) {
                callback(err);
                callback = function () {};
              } else {
                completed += 1;
                if (completed === arr.length) {
                  callback();
                } else {
                  iterate();
                }
              }
            });
          })();
        }

        function paramifyString(str, params, mod) {
          mod = str;
          for (var param in params) {
            if (params.hasOwnProperty(param)) {
              mod = params[param](str);
              if (mod !== str) {
                break;
              }
            }
          }
          return mod === str ? '([._a-zA-Z0-9-%()]+)' : mod;
        }

        function regifyString(str, params) {
          var matches,
              last = 0,
              out = '';
          while (matches = str.substr(last).match(/[^\w\d\- %@&]*\*[^\w\d\- %@&]*/)) {
            last = matches.index + matches[0].length;
            matches[0] = matches[0].replace(/^\*/, '([_.()!\\ %@&a-zA-Z0-9-]+)');
            out += str.substr(0, matches.index) + matches[0];
          }
          str = out += str.substr(last);
          var captures = str.match(/:([^\/]+)/ig),
              capture,
              length;
          if (captures) {
            length = captures.length;
            for (var i = 0; i < length; i++) {
              capture = captures[i];
              if (capture.slice(0, 2) === '::') {
                str = capture.slice(1);
              } else {
                str = str.replace(capture, paramifyString(capture, params));
              }
            }
          }
          return str;
        }

        function terminator(routes, delimiter, start, stop) {
          var last = 0,
              left = 0,
              right = 0,
              start = (start || '(').toString(),
              stop = (stop || ')').toString(),
              i;
          for (i = 0; i < routes.length; i++) {
            var chunk = routes[i];
            if (chunk.indexOf(start, last) > chunk.indexOf(stop, last) || ~chunk.indexOf(start, last) && ! ~chunk.indexOf(stop, last) || ! ~chunk.indexOf(start, last) && ~chunk.indexOf(stop, last)) {
              left = chunk.indexOf(start, last);
              right = chunk.indexOf(stop, last);
              if (~left && ! ~right || ! ~left && ~right) {
                var tmp = routes.slice(0, (i || 1) + 1).join(delimiter);
                routes = [tmp].concat(routes.slice((i || 1) + 1));
              }
              last = (right > left ? right : left) + 1;
              i = 0;
            } else {
              last = 0;
            }
          }
          return routes;
        }

        var QUERY_SEPARATOR = /\?.*/;

        Router.prototype.configure = function (options) {
          options = options || {};
          for (var i = 0; i < this.methods.length; i++) {
            this._methods[this.methods[i]] = true;
          }
          this.recurse = options.recurse || this.recurse || false;
          this.async = options.async || false;
          this.delimiter = options.delimiter || '/';
          this.strict = typeof options.strict === 'undefined' ? true : options.strict;
          this.notfound = options.notfound;
          this.resource = options.resource;
          this.history = options.html5history && this.historySupport || false;
          this.run_in_init = this.history === true && options.run_handler_in_init !== false;
          this.convert_hash_in_init = this.history === true && options.convert_hash_in_init !== false;
          this.every = {
            after: options.after || null,
            before: options.before || null,
            on: options.on || null
          };
          return this;
        };

        Router.prototype.param = function (token, matcher) {
          if (token[0] !== ':') {
            token = ':' + token;
          }
          var compiled = new RegExp(token, 'g');
          this.params[token] = function (str) {
            return str.replace(compiled, matcher.source || matcher);
          };
          return this;
        };

        Router.prototype.on = Router.prototype.route = function (method, path, route) {
          var self = this;
          if (!route && typeof path == 'function') {
            route = path;
            path = method;
            method = 'on';
          }
          if (Array.isArray(path)) {
            return path.forEach(function (p) {
              self.on(method, p, route);
            });
          }
          if (path.source) {
            path = path.source.replace(/\\\//ig, '/');
          }
          if (Array.isArray(method)) {
            return method.forEach(function (m) {
              self.on(m.toLowerCase(), path, route);
            });
          }
          path = path.split(new RegExp(this.delimiter));
          path = terminator(path, this.delimiter);
          this.insert(method, this.scope.concat(path), route);
        };

        Router.prototype.path = function (path, routesFn) {
          var self = this,
              length = this.scope.length;
          if (path.source) {
            path = path.source.replace(/\\\//ig, '/');
          }
          path = path.split(new RegExp(this.delimiter));
          path = terminator(path, this.delimiter);
          this.scope = this.scope.concat(path);
          routesFn.call(this, this);
          this.scope.splice(length, path.length);
        };

        Router.prototype.dispatch = function (method, path, callback) {
          var self = this,
              fns = this.traverse(method, path.replace(QUERY_SEPARATOR, ''), this.routes, ''),
              invoked = this._invoked,
              after;
          this._invoked = true;
          if (!fns || fns.length === 0) {
            this.last = [];
            if (typeof this.notfound === 'function') {
              this.invoke([this.notfound], {
                method: method,
                path: path
              }, callback);
            }
            return false;
          }
          if (this.recurse === 'forward') {
            fns = fns.reverse();
          }

          function updateAndInvoke() {
            self.last = fns.after;
            self.invoke(self.runlist(fns), self, callback);
          }
          after = this.every && this.every.after ? [this.every.after].concat(this.last) : [this.last];
          if (after && after.length > 0 && invoked) {
            if (this.async) {
              this.invoke(after, this, updateAndInvoke);
            } else {
              this.invoke(after, this);
              updateAndInvoke();
            }
            return true;
          }
          updateAndInvoke();
          return true;
        };

        Router.prototype.invoke = function (fns, thisArg, callback) {
          var self = this;
          var apply;
          if (this.async) {
            apply = function (fn, next) {
              if (Array.isArray(fn)) {
                return _asyncEverySeries(fn, apply, next);
              } else if (typeof fn == 'function') {
                fn.apply(thisArg, (fns.captures || []).concat(next));
              }
            };
            _asyncEverySeries(fns, apply, function () {
              if (callback) {
                callback.apply(thisArg, arguments);
              }
            });
          } else {
            apply = function (fn) {
              if (Array.isArray(fn)) {
                return _every(fn, apply);
              } else if (typeof fn === 'function') {
                return fn.apply(thisArg, fns.captures || []);
              } else if (typeof fn === 'string' && self.resource) {
                self.resource[fn].apply(thisArg, fns.captures || []);
              }
            };
            _every(fns, apply);
          }
        };

        Router.prototype.traverse = function (method, path, routes, regexp, filter) {
          var fns = [],
              current,
              exact,
              match,
              next,
              that;

          function filterRoutes(routes) {
            if (!filter) {
              return routes;
            }

            function deepCopy(source) {
              var result = [];
              for (var i = 0; i < source.length; i++) {
                result[i] = Array.isArray(source[i]) ? deepCopy(source[i]) : source[i];
              }
              return result;
            }

            function applyFilter(fns) {
              for (var i = fns.length - 1; i >= 0; i--) {
                if (Array.isArray(fns[i])) {
                  applyFilter(fns[i]);
                  if (fns[i].length === 0) {
                    fns.splice(i, 1);
                  }
                } else {
                  if (!filter(fns[i])) {
                    fns.splice(i, 1);
                  }
                }
              }
            }
            var newRoutes = deepCopy(routes);
            newRoutes.matched = routes.matched;
            newRoutes.captures = routes.captures;
            newRoutes.after = routes.after.filter(filter);
            applyFilter(newRoutes);
            return newRoutes;
          }
          if (path === this.delimiter && routes[method]) {
            next = [[routes.before, routes[method]].filter(Boolean)];
            next.after = [routes.after].filter(Boolean);
            next.matched = true;
            next.captures = [];
            return filterRoutes(next);
          }
          for (var r in routes) {
            if (routes.hasOwnProperty(r) && (!this._methods[r] || this._methods[r] && typeof routes[r] === 'object' && !Array.isArray(routes[r]))) {
              current = exact = regexp + this.delimiter + r;
              if (!this.strict) {
                exact += '[' + this.delimiter + ']?';
              }
              match = path.match(new RegExp('^' + exact));
              if (!match) {
                continue;
              }
              if (match[0] && match[0] == path && routes[r][method]) {
                next = [[routes[r].before, routes[r][method]].filter(Boolean)];
                next.after = [routes[r].after].filter(Boolean);
                next.matched = true;
                next.captures = match.slice(1);
                if (this.recurse && routes === this.routes) {
                  next.push([routes.before, routes.on].filter(Boolean));
                  next.after = next.after.concat([routes.after].filter(Boolean));
                }
                return filterRoutes(next);
              }
              next = this.traverse(method, path, routes[r], current);
              if (next.matched) {
                if (next.length > 0) {
                  fns = fns.concat(next);
                }
                if (this.recurse) {
                  fns.push([routes[r].before, routes[r].on].filter(Boolean));
                  next.after = next.after.concat([routes[r].after].filter(Boolean));
                  if (routes === this.routes) {
                    fns.push([routes['before'], routes['on']].filter(Boolean));
                    next.after = next.after.concat([routes['after']].filter(Boolean));
                  }
                }
                fns.matched = true;
                fns.captures = next.captures;
                fns.after = next.after;
                return filterRoutes(fns);
              }
            }
          }
          return false;
        };

        Router.prototype.insert = function (method, path, route, parent) {
          var methodType, parentType, isArray, nested, part;
          path = path.filter(function (p) {
            return p && p.length > 0;
          });
          parent = parent || this.routes;
          part = path.shift();
          if (/\:|\*/.test(part) && !/\\d|\\w/.test(part)) {
            part = regifyString(part, this.params);
          }
          if (path.length > 0) {
            parent[part] = parent[part] || {};
            return this.insert(method, path, route, parent[part]);
          }
          if (!part && !path.length && parent === this.routes) {
            methodType = typeof parent[method];
            switch (methodType) {
              case 'function':
                parent[method] = [parent[method], route];
                return;
              case 'object':
                parent[method].push(route);
                return;
              case 'undefined':
                parent[method] = route;
                return;
            }
            return;
          }
          parentType = typeof parent[part];
          isArray = Array.isArray(parent[part]);
          if (parent[part] && !isArray && parentType == 'object') {
            methodType = typeof parent[part][method];
            switch (methodType) {
              case 'function':
                parent[part][method] = [parent[part][method], route];
                return;
              case 'object':
                parent[part][method].push(route);
                return;
              case 'undefined':
                parent[part][method] = route;
                return;
            }
          } else if (parentType == 'undefined') {
            nested = {};
            nested[method] = route;
            parent[part] = nested;
            return;
          }
          throw new Error('Invalid route context: ' + parentType);
        };

        Router.prototype.extend = function (methods) {
          var self = this,
              len = methods.length,
              i;

          function extend(method) {
            self._methods[method] = true;
            self[method] = function () {
              var extra = arguments.length === 1 ? [method, ''] : [method];
              self.on.apply(self, extra.concat(Array.prototype.slice.call(arguments)));
            };
          }
          for (i = 0; i < len; i++) {
            extend(methods[i]);
          }
        };

        Router.prototype.runlist = function (fns) {
          var runlist = this.every && this.every.before ? [this.every.before].concat(_flatten(fns)) : _flatten(fns);
          if (this.every && this.every.on) {
            runlist.push(this.every.on);
          }
          runlist.captures = fns.captures;
          runlist.source = fns.source;
          return runlist;
        };

        Router.prototype.mount = function (routes, path) {
          if (!routes || typeof routes !== 'object' || Array.isArray(routes)) {
            return;
          }
          var self = this;
          path = path || [];
          if (!Array.isArray(path)) {
            path = path.split(self.delimiter);
          }

          function insertOrMount(route, local) {
            var rename = route,
                parts = route.split(self.delimiter),
                routeType = typeof routes[route],
                isRoute = parts[0] === '' || !self._methods[parts[0]],
                event = isRoute ? 'on' : rename;
            if (isRoute) {
              rename = rename.slice((rename.match(new RegExp('^' + self.delimiter)) || [''])[0].length);
              parts.shift();
            }
            if (isRoute && routeType === 'object' && !Array.isArray(routes[route])) {
              local = local.concat(parts);
              self.mount(routes[route], local);
              return;
            }
            if (isRoute) {
              local = local.concat(rename.split(self.delimiter));
              local = terminator(local, self.delimiter);
            }
            self.insert(event, local, routes[route]);
          }
          for (var route in routes) {
            if (routes.hasOwnProperty(route)) {
              insertOrMount(route, path.slice(0));
            }
          }
        };
      })(typeof exports === 'object' ? exports : scopeRouter);

      init = scopeRouter.Router.prototype.init;

      scopeRouter.Router.prototype.init = function (redirect) {

        redirect = redirect || '/';

        init.apply(this, arguments);

        var initialRoute = window.location.hash.slice(2);
        if (initialRoute) {
          window.setTimeout(function () {
            if (typeof HashChangeEvent != 'undefined') {
              window.dispatchEvent(new HashChangeEvent('hashchange'));
            } else {
              var evt = document.createEvent('Event');
              evt.initEvent('hashchange', true, false);
              window.dispatchEvent(evt);
            }
          }, 0);
        }

        window.addEventListener('hashchange', (function (e) {
          var currRoute = this.getRoute();
          if (currRoute[0].length && !this.routes[currRoute[0]]) {
            Logger.warn('The route \'#/' + currRoute + '\' does not exists ! Redirected to \'#' + redirect + '\'');
            this.setRoute(redirect);
          }
        }).bind(this), false);

        return this;
      };

      _export('default', scopeRouter);
    }
  };
});
System.register('src/modules/Http', [], function (_export) {
  /*! qwest 1.7.0 (https://github.com/pyrsmk/qwest) */

  'use strict';

  var scopeHttp;
  return {
    setters: [],
    execute: function () {
      scopeHttp = {};

      ;(function (context, name, definition) {
        if (typeof module != 'undefined' && module.exports) {
          module.exports = definition;
        } else if (typeof define == 'function' && define.amd) {
          define(definition);
        } else {
          context[name] = definition;
        }
      })(scopeHttp, 'qwest', (function () {

        var win = window,
            doc = document,
            _before,

        // Default response type for XDR in auto mode
        defaultXdrResponseType = 'json',

        // Variables for limit mechanism
        _limit = null,
            requests = 0,
            request_stack = [],

        // Get XMLHttpRequest object
        getXHR = function getXHR() {
          return win.XMLHttpRequest ? new XMLHttpRequest() : new ActiveXObject('Microsoft.XMLHTTP');
        },

        // Guess XHR version
        xhr2 = getXHR().responseType === '',

        // Core function
        qwest = function qwest(method, url, data, options, before) {

          // Format
          method = method.toUpperCase();
          data = data || null;
          options = options || {};

          // Define variables
          var nativeResponseParsing = false,
              crossOrigin,
              xhr,
              xdr = false,
              timeoutInterval,
              aborted = false,
              attempts = 0,
              headers = {},
              mimeTypes = {
            text: '*/*',
            xml: 'text/xml',
            json: 'application/json',
            post: 'application/x-www-form-urlencoded'
          },
              accept = {
            text: '*/*',
            xml: 'application/xml; q=1.0, text/xml; q=0.8, */*; q=0.1',
            json: 'application/json; q=1.0, text/*; q=0.8, */*; q=0.1'
          },
              contentType = 'Content-Type',
              vars = '',
              i,
              j,
              serialized,
              then_stack = [],
              catch_stack = [],
              complete_stack = [],
              response,
              success,
              error,
              func,

          // Define promises
          promises = {
            then: function then(func) {
              if (options.async) {
                then_stack.push(func);
              } else if (success) {
                func.call(xhr, response);
              }
              return promises;
            },
            'catch': function _catch(func) {
              if (options.async) {
                catch_stack.push(func);
              } else if (error) {
                func.call(xhr, response);
              }
              return promises;
            },
            complete: function complete(func) {
              if (options.async) {
                complete_stack.push(func);
              } else {
                func.call(xhr);
              }
              return promises;
            }
          },
              promises_limit = {
            then: function then(func) {
              request_stack[request_stack.length - 1].then.push(func);
              return promises_limit;
            },
            'catch': function _catch(func) {
              request_stack[request_stack.length - 1]['catch'].push(func);
              return promises_limit;
            },
            complete: function complete(func) {
              request_stack[request_stack.length - 1].complete.push(func);
              return promises_limit;
            }
          },

          // Handle the response
          handleResponse = function handleResponse() {
            // Verify request's state
            // --- https://stackoverflow.com/questions/7287706/ie-9-javascript-error-c00c023f
            if (aborted) {
              return;
            }
            // Prepare
            var i, req, p, responseType;
            --requests;
            // Clear the timeout
            clearInterval(timeoutInterval);
            // Launch next stacked request
            if (request_stack.length) {
              req = request_stack.shift();
              p = qwest(req.method, req.url, req.data, req.options, req.before);
              for (i = 0; func = req.then[i]; ++i) {
                p.then(func);
              }
              for (i = 0; func = req['catch'][i]; ++i) {
                p['catch'](func);
              }
              for (i = 0; func = req.complete[i]; ++i) {
                p.complete(func);
              }
            }
            // Handle response
            try {
              // Init
              var responseText = 'responseText',
                  responseXML = 'responseXML',
                  parseError = 'parseError';
              // Process response
              if (nativeResponseParsing && 'response' in xhr && xhr.response !== null) {
                response = xhr.response;
              } else if (options.responseType == 'document') {
                var frame = doc.createElement('iframe');
                frame.style.display = 'none';
                doc.body.appendChild(frame);
                frame.contentDocument.open();
                frame.contentDocument.write(xhr.response);
                frame.contentDocument.close();
                response = frame.contentDocument;
                doc.body.removeChild(frame);
              } else {
                // Guess response type
                responseType = options.responseType;
                if (responseType == 'auto') {
                  if (xdr) {
                    responseType = defaultXdrResponseType;
                  } else {
                    var ct = xhr.getResponseHeader(contentType) || '';
                    if (ct.indexOf(mimeTypes.json) > -1) {
                      responseType = 'json';
                    } else if (ct.indexOf(mimeTypes.xml) > -1) {
                      responseType = 'xml';
                    } else {
                      responseType = 'text';
                    }
                  }
                }
                // Handle response type
                switch (responseType) {
                  case 'json':
                    try {
                      if ('JSON' in win) {
                        response = JSON.parse(xhr[responseText]);
                      } else {
                        response = eval('(' + xhr[responseText] + ')');
                      }
                    } catch (e) {
                      throw 'Error while parsing JSON body : ' + e;
                    }
                    break;
                  case 'xml':
                    // Based on jQuery's parseXML() function
                    try {
                      // Standard
                      if (win.DOMParser) {
                        response = new DOMParser().parseFromString(xhr[responseText], 'text/xml');
                      }
                      // IE<9
                      else {
                        response = new ActiveXObject('Microsoft.XMLDOM');
                        response.async = 'false';
                        response.loadXML(xhr[responseText]);
                      }
                    } catch (e) {
                      response = undefined;
                    }
                    if (!response || !response.documentElement || response.getElementsByTagName('parsererror').length) {
                      throw 'Invalid XML';
                    }
                    break;
                  default:
                    response = xhr[responseText];
                }
              }
              // Late status code verification to allow data when, per example, a 409 is returned
              // --- https://stackoverflow.com/questions/10046972/msie-returns-status-code-of-1223-for-ajax-request
              if ('status' in xhr && !/^2|1223/.test(xhr.status)) {
                throw xhr.status + ' (' + xhr.statusText + ')';
              }
              // Execute 'then' stack
              success = true;
              p = response;
              if (options.async) {
                for (i = 0; func = then_stack[i]; ++i) {
                  p = func.call(xhr, p);
                }
              }
            } catch (e) {
              error = true;
              // Execute 'catch' stack
              if (options.async) {
                for (i = 0; func = catch_stack[i]; ++i) {
                  func.call(xhr, e, response);
                }
              }
            }
            // Execute complete stack
            if (options.async) {
              for (i = 0; func = complete_stack[i]; ++i) {
                func.call(xhr, response);
              }
            }
          },

          // Handle errors
          handleError = function handleError(e) {
            error = true;
            --requests;
            // Clear the timeout
            clearInterval(timeoutInterval);
            // Execute 'catch' stack
            if (options.async) {
              for (i = 0; func = catch_stack[i]; ++i) {
                func.call(xhr, e, null);
              }
            }
          },

          // Recursively build the query string
          buildData = function buildData(data, key) {
            var res = [],
                enc = encodeURIComponent,
                p;
            if (typeof data === 'object' && data != null) {
              for (p in data) {
                if (data.hasOwnProperty(p)) {
                  var built = buildData(data[p], key ? key + '[' + p + ']' : p);
                  if (built !== '') {
                    res = res.concat(built);
                  }
                }
              }
            } else if (data != null && key != null) {
              res.push(enc(key) + '=' + enc(data));
            }
            return res.join('&');
          };

          // New request
          ++requests;

          if ('retries' in options) {
            if (win.console && console.warn) {
              console.warn('[Qwest] The retries option is deprecated. It indicates total number of requests to attempt. Please use the "attempts" option.');
            }
            options.attempts = options.retries;
          }

          // Normalize options
          options.async = 'async' in options ? !!options.async : true;
          options.cache = 'cache' in options ? !!options.cache : method != 'GET';
          options.dataType = 'dataType' in options ? options.dataType.toLowerCase() : 'post';
          options.responseType = 'responseType' in options ? options.responseType.toLowerCase() : 'auto';
          options.user = options.user || '';
          options.password = options.password || '';
          options.withCredentials = !!options.withCredentials;
          options.timeout = 'timeout' in options ? parseInt(options.timeout, 10) : 30000;
          options.attempts = 'attempts' in options ? parseInt(options.attempts, 10) : 1;

          // Guess if we're dealing with a cross-origin request
          i = url.match(/\/\/(.+?)\//);
          crossOrigin = i && i[1] ? i[1] != location.host : false;

          // Prepare data
          if ('ArrayBuffer' in win && data instanceof ArrayBuffer) {
            options.dataType = 'arraybuffer';
          } else if ('Blob' in win && data instanceof Blob) {
            options.dataType = 'blob';
          } else if ('Document' in win && data instanceof Document) {
            options.dataType = 'document';
          } else if ('FormData' in win && data instanceof FormData) {
            options.dataType = 'formdata';
          }
          switch (options.dataType) {
            case 'json':
              data = JSON.stringify(data);
              break;
            case 'post':
              data = buildData(data);
          }

          // Prepare headers
          if (options.headers) {
            var format = function format(match, p1, p2) {
              return p1 + p2.toUpperCase();
            };
            for (i in options.headers) {
              headers[i.replace(/(^|-)([^-])/g, format)] = options.headers[i];
            }
          }
          if (!headers[contentType] && method != 'GET') {
            if (options.dataType in mimeTypes) {
              if (mimeTypes[options.dataType]) {
                headers[contentType] = mimeTypes[options.dataType];
              }
            }
          }
          if (!headers.Accept) {
            headers.Accept = options.responseType in accept ? accept[options.responseType] : '*/*';
          }
          if (!crossOrigin && !headers['X-Requested-With']) {
            // because that header breaks in legacy browsers with CORS
            headers['X-Requested-With'] = 'XMLHttpRequest';
          }

          // Prepare URL
          if (method == 'GET' && data) {
            vars += data;
          }
          if (!options.cache) {
            if (vars) {
              vars += '&';
            }
            vars += '__t=' + +new Date();
          }
          if (vars) {
            url += (/\?/.test(url) ? '&' : '?') + vars;
          }

          // The limit has been reached, stock the request
          if (_limit && requests == _limit) {
            request_stack.push({
              method: method,
              url: url,
              data: data,
              options: options,
              before: before,
              then: [],
              'catch': [],
              complete: []
            });
            return promises_limit;
          }

          // Send the request
          var send = function send() {
            // Get XHR object
            xhr = getXHR();
            if (crossOrigin) {
              if (!('withCredentials' in xhr) && win.XDomainRequest) {
                xhr = new XDomainRequest(); // CORS with IE8/9
                xdr = true;
                if (method != 'GET' && method != 'POST') {
                  method = 'POST';
                }
              }
            }
            // Open connection
            if (xdr) {
              xhr.open(method, url);
            } else {
              xhr.open(method, url, options.async, options.user, options.password);
              if (xhr2 && options.async) {
                xhr.withCredentials = options.withCredentials;
              }
            }
            // Set headers
            if (!xdr) {
              for (var i in headers) {
                xhr.setRequestHeader(i, headers[i]);
              }
            }
            // Verify if the response type is supported by the current browser
            if (xhr2 && options.responseType != 'document' && options.responseType != 'auto') {
              // Don't verify for 'document' since we're using an internal routine
              try {
                xhr.responseType = options.responseType;
                nativeResponseParsing = xhr.responseType == options.responseType;
              } catch (e) {}
            }
            // Plug response handler
            if (xhr2 || xdr) {
              xhr.onload = handleResponse;
              xhr.onerror = handleError;
            } else {
              xhr.onreadystatechange = function () {
                if (xhr.readyState == 4) {
                  handleResponse();
                }
              };
            }
            // Override mime type to ensure the response is well parsed
            if (options.responseType != 'auto' && 'overrideMimeType' in xhr) {
              xhr.overrideMimeType(mimeTypes[options.responseType]);
            }
            // Run 'before' callback
            if (before) {
              before.call(xhr);
            }
            // Send request
            if (xdr) {
              setTimeout(function () {
                // https://developer.mozilla.org/en-US/docs/Web/API/XDomainRequest
                xhr.send(method != 'GET' ? data : null);
              }, 0);
            } else {
              xhr.send(method != 'GET' ? data : null);
            }
          };

          // Timeout/attempts
          var timeout = function timeout() {
            timeoutInterval = setTimeout(function () {
              aborted = true;
              xhr.abort();
              if (!options.attempts || ++attempts != options.attempts) {
                aborted = false;
                timeout();
                send();
              } else {
                aborted = false;
                error = true;
                response = 'Timeout (' + url + ')';
                if (options.async) {
                  for (i = 0; func = catch_stack[i]; ++i) {
                    func.call(xhr, response);
                  }
                }
              }
            }, options.timeout);
          };

          // Start the request
          timeout();
          send();

          // Return promises
          return promises;
        };

        // Return external qwest object
        var create = function create(method) {
          return function (url, data, options) {
            var b = _before;
            _before = null;
            return qwest(method, this.base + url, data, options, b);
          };
        },
            obj = {
          base: '',
          before: function before(callback) {
            _before = callback;
            return obj;
          },
          get: create('GET'),
          post: create('POST'),
          put: create('PUT'),
          'delete': create('DELETE'),
          xhr2: xhr2,
          limit: function limit(by) {
            _limit = by;
          },
          setDefaultXdrResponseType: function setDefaultXdrResponseType(type) {
            defaultXdrResponseType = type.toLowerCase();
          }
        };
        return obj;
      })());

      _export('default', scopeHttp);
    }
  };
});
System.register("src/HTMLParser/HTMLParser", [], function (_export) {
  /*
   * HTML Parser By John Resig (ejohn.org)
   * Original code by Erik Arvidsson, Mozilla Public License
   * http://erik.eae.net/simplehtmlparser/simplehtmlparser.js
   *
   * // Use like so:
   * HTMLParser(htmlString, {
   *     start: function(tag, attrs, unary) {},
   *     end: function(tag) {},
   *     chars: function(text) {},
   *     comment: function(text) {}
   * });
   *
   * // or to get an XML string:
   * HTMLtoXML(htmlString);
   *
   * // or to get an XML DOM Document
   * HTMLtoDOM(htmlString);
   *
   * // or to inject into an existing document/DOM node
   * HTMLtoDOM(htmlString, document);
   * HTMLtoDOM(htmlString, document.body);
   *
   */

  "use strict";

  var scopeHTMLParser;
  return {
    setters: [],
    execute: function () {
      scopeHTMLParser = {};

      (function () {

        // Regular Expressions for parsing tags and attributes
        var startTag = /^<([-A-Za-z0-9_]+)((?:\s+\w+(?:\s*=\s*(?:(?:"[^"]*")|(?:'[^']*')|[^>\s]+))?)*)\s*(\/?)>/,
            endTag = /^<\/([-A-Za-z0-9_]+)[^>]*>/,
            attr = /([-A-Za-z0-9_]+)(?:\s*=\s*(?:(?:"((?:\\.|[^"])*)")|(?:'((?:\\.|[^'])*)')|([^>\s]+)))?/g;

        // Empty Elements - HTML 4.01
        var empty = makeMap("area,base,basefont,br,col,frame,hr,img,input,isindex,link,meta,param,embed");

        // Block Elements - HTML 4.01
        var block = makeMap("address,applet,blockquote,button,center,dd,del,dir,div,dl,dt,fieldset,form,frameset,hr,iframe,ins,isindex,li,map,menu,noframes,noscript,object,ol,p,pre,script,table,tbody,td,tfoot,th,thead,tr,ul");

        // Inline Elements - HTML 4.01
        var inline = makeMap("a,abbr,acronym,applet,b,basefont,bdo,big,br,button,cite,code,del,dfn,em,font,i,iframe,img,input,ins,kbd,label,map,object,q,s,samp,script,select,small,span,strike,strong,sub,sup,textarea,tt,u,var");

        // Elements that you can, intentionally, leave open
        // (and which close themselves)
        var closeSelf = makeMap("colgroup,dd,dt,li,options,p,td,tfoot,th,thead,tr");

        // Attributes that have their values filled in disabled="disabled"
        var fillAttrs = makeMap("checked,compact,declare,defer,disabled,ismap,multiple,nohref,noresize,noshade,nowrap,readonly,selected");

        // Special Elements (can contain anything)
        var special = makeMap("script,style");

        var HTMLParser = this.HTMLParser = function (html, handler) {
          var index,
              chars,
              match,
              stack = [],
              last = html;
          stack.last = function () {
            return this[this.length - 1];
          };

          while (html) {
            chars = true;

            // Make sure we're not in a script or style element
            if (!stack.last() || !special[stack.last()]) {

              // Comment
              if (html.indexOf("<!--") == 0) {
                index = html.indexOf("-->");

                if (index >= 0) {
                  if (handler.comment) handler.comment(html.substring(4, index));
                  html = html.substring(index + 3);
                  chars = false;
                }

                // end tag
              } else if (html.indexOf("</") == 0) {
                match = html.match(endTag);

                if (match) {
                  html = html.substring(match[0].length);
                  match[0].replace(endTag, parseEndTag);
                  chars = false;
                }

                // start tag
              } else if (html.indexOf("<") == 0) {
                match = html.match(startTag);

                if (match) {
                  html = html.substring(match[0].length);
                  match[0].replace(startTag, parseStartTag);
                  chars = false;
                }
              }

              if (chars) {
                index = html.indexOf("<");

                var text = index < 0 ? html : html.substring(0, index);
                html = index < 0 ? "" : html.substring(index);

                if (handler.chars) handler.chars(text);
              }
            } else {
              html = html.replace(new RegExp("(.*)</" + stack.last() + "[^>]*>"), function (all, text) {
                text = text.replace(/<!--(.*?)-->/g, "$1").replace(/<!\[CDATA\[(.*?)]]>/g, "$1");

                if (handler.chars) handler.chars(text);

                return "";
              });

              parseEndTag("", stack.last());
            }

            if (html == last) throw "Parse Error: " + html;
            last = html;
          }

          // Clean up any remaining tags
          parseEndTag();

          function parseStartTag(tag, tagName, rest, unary) {
            tagName = tagName.toLowerCase();

            if (block[tagName]) {
              while (stack.last() && inline[stack.last()]) {
                parseEndTag("", stack.last());
              }
            }

            if (closeSelf[tagName] && stack.last() == tagName) {
              parseEndTag("", tagName);
            }

            unary = empty[tagName] || !!unary;

            if (!unary) stack.push(tagName);

            if (handler.start) {
              var attrs = [];

              rest.replace(attr, function (match, name) {
                var value = arguments[2] ? arguments[2] : arguments[3] ? arguments[3] : arguments[4] ? arguments[4] : fillAttrs[name] ? name : "";

                attrs.push({
                  name: name,
                  value: value,
                  escaped: value.replace(/(^|[^\\])"/g, "$1\\\"") //"
                });
              });

              if (handler.start) handler.start(tagName, attrs, unary);
            }
          }

          function parseEndTag(tag, tagName) {
            // If no tag name is provided, clean shop
            if (!tagName) var pos = 0;

            // Find the closest opened tag of the same type
            else for (var pos = stack.length - 1; pos >= 0; pos--) if (stack[pos] == tagName) break;

            if (pos >= 0) {
              // Close all the open elements, up the stack
              for (var i = stack.length - 1; i >= pos; i--) if (handler.end) handler.end(stack[i]);

              // Remove the open elements from the stack
              stack.length = pos;
            }
          }
        };

        this.HTMLtoXML = function (html) {
          var results = "";

          HTMLParser(html, {
            start: function start(tag, attrs, unary) {
              results += "<" + tag;

              for (var i = 0; i < attrs.length; i++) results += " " + attrs[i].name + "=\"" + attrs[i].escaped + "\"";

              results += (unary ? "/" : "") + ">";
            },
            end: function end(tag) {
              results += "</" + tag + ">";
            },
            chars: function chars(text) {
              results += text;
            },
            comment: function comment(text) {
              results += "<!--" + text + "-->";
            }
          });

          return results;
        };

        this.HTMLtoDOM = function (html, doc) {
          // There can be only one of these elements
          var one = makeMap("html,head,body,title");

          // Enforce a structure for the document
          var structure = {
            link: "head",
            base: "head"
          };

          if (!doc) {
            if (typeof DOMDocument != "undefined") doc = new DOMDocument();else if (typeof document != "undefined" && document.implementation && document.implementation.createDocument) doc = document.implementation.createDocument("", "", null);else if (typeof ActiveX != "undefined") doc = new ActiveXObject("Msxml.DOMDocument");
          } else doc = doc.ownerDocument || doc.getOwnerDocument && doc.getOwnerDocument() || doc;

          var elems = [],
              documentElement = doc.documentElement || doc.getDocumentElement && doc.getDocumentElement();

          // If we're dealing with an empty document then we
          // need to pre-populate it with the HTML document structure
          if (!documentElement && doc.createElement) (function () {
            var html = doc.createElement("html");
            var head = doc.createElement("head");
            head.appendChild(doc.createElement("title"));
            html.appendChild(head);
            html.appendChild(doc.createElement("body"));
            doc.appendChild(html);
          })();

          // Find all the unique elements
          if (doc.getElementsByTagName) for (var i in one) one[i] = doc.getElementsByTagName(i)[0];

          // If we're working with a document, inject contents into
          // the body element
          var curParentNode = one.body;

          HTMLParser(html, {
            start: function start(tagName, attrs, unary) {
              // If it's a pre-built element, then we can ignore
              // its construction
              if (one[tagName]) {
                curParentNode = one[tagName];
                if (!unary) {
                  elems.push(curParentNode);
                }
                return;
              }

              var elem = doc.createElement(tagName);

              for (var attr in attrs) elem.setAttribute(attrs[attr].name, attrs[attr].value);

              if (structure[tagName] && typeof one[structure[tagName]] != "boolean") one[structure[tagName]].appendChild(elem);else if (curParentNode && curParentNode.appendChild) curParentNode.appendChild(elem);

              if (!unary) {
                elems.push(elem);
                curParentNode = elem;
              }
            },
            end: function end(tag) {
              elems.length -= 1;

              // Init the new parentNode
              curParentNode = elems[elems.length - 1];
            },
            chars: function chars(text) {
              curParentNode.appendChild(doc.createTextNode(text));
            },
            comment: function comment(text) {}
          });

          return doc;
        };

        function makeMap(str) {
          var obj = {},
              items = str.split(",");
          for (var i = 0; i < items.length; i++) obj[items[i]] = true;
          return obj;
        }
      }).bind(scopeHTMLParser)();

      _export("default", scopeHTMLParser);
    }
  };
});

// create comment node
System.register("src/databinding/Template", ["npm:babel-runtime@5.4.7/core-js/object/keys", "npm:babel-runtime@5.4.7/core-js/object/get-own-property-descriptor", "src/resources/soma-template"], function (_export) {
  var _Object$keys, _Object$getOwnPropertyDescriptor, somatemplate;

  return {
    setters: [function (_npmBabelRuntime547CoreJsObjectKeys) {
      _Object$keys = _npmBabelRuntime547CoreJsObjectKeys["default"];
    }, function (_npmBabelRuntime547CoreJsObjectGetOwnPropertyDescriptor) {
      _Object$getOwnPropertyDescriptor = _npmBabelRuntime547CoreJsObjectGetOwnPropertyDescriptor["default"];
    }, function (_srcResourcesSomaTemplate) {
      somatemplate = _srcResourcesSomaTemplate["default"];
    }],
    execute: function () {
      "use strict";

      _export("default", (function () {

        var applyChanges = function applyChanges(template, model) {

          var firstCharCode = null;
          var keysArray = _Object$keys(Object(model));
          var changeCount = 0;

          for (var nextIndex = 0, len = keysArray.length; nextIndex < len; nextIndex++) {
            var nextKey = keysArray[nextIndex];
            if (nextKey.toLowerCase().charAt(0) != "_" && nextKey.toLowerCase().charAt(0) != "$") {
              changeCount++;
              var desc = _Object$getOwnPropertyDescriptor(model, nextKey);
              if (desc !== undefined && desc.enumerable) {
                template.scope[nextKey] = model[nextKey];
              }
            }
          }

          if (changeCount > 0) {
            template.render();
          }
        };

        return {
          template: function template(model) {
            var template = somatemplate.create(this[0]);
            applyChanges(template, model);
            Object.observe(model, applyChanges.bind(this, template, model));
            return this;
          }
        };
      })());
    }
  };
});
System.register("src/css/Helpers", ["src/utils/Utils"], function (_export) {
  "use strict";

  var utils;
  return {
    setters: [function (_srcUtilsUtils) {
      utils = _srcUtilsUtils["default"];
    }],
    execute: function () {
      _export("default", (function () {

        var browserPrefix = ["Webkit", "Moz", "O", "ms", "Khtml"];
        var classCache = [];

        return {

          getPropertyName: function getPropertyName(propertyName) {
            var style = document.documentElement.style;
            if (style[propertyName] !== undefined) {
              return propertyName;
            }
            for (var i = 0, l = browserPrefix; i < l; i++) {
              var prefixedProp = browserPrefix + utils.firstUp(propertyName);
              if (style[prefixedProp] !== undefined) {
                return prefixedProp;
              }
            }
            return null;
          },

          classRegEx: function classRegEx(name) {
            return name in classCache ? classCache[name] : classCache[name] = new RegExp("(^|\\s)" + name + "(\\s|$)");
          },

          nodeListToArray: function nodeListToArray(nodeList) {
            return Array.prototype.slice.call(nodeList);
          },

          isWindow: function isWindow(element) {
            return typeof (element && element.document && element.location && element.alert && element.setInterval) !== "undefined";
          },

          isDocument: function isDocument(element) {
            return typeof element.createElement != "undefined";
          },

          isSuportedElement: function isSuportedElement(element) {
            return element instanceof HTMLElement || this.isWindow(element) || this.isDocument(element);
          },

          hasClass: function hasClass(el, classToCheck) {
            var res = false;
            if (el instanceof HTMLElement) {
              if (el.classList) {
                res = el.classList.contains(classToCheck);
              } else {
                res = el.className.split(" ").indexOf(classToCheck) != -1;
              }
            }
            return res;
          },

          addClass: function addClass(el, classToAdd) {
            if (el instanceof HTMLElement) {
              if (el.classList) {
                el.classList.add(classToAdd);
              } else {
                var classes = el.className;
                classes = classes.length > 0 ? classes.split(" ") : [];
                if (classes.indexOf(classToAdd) == -1) {
                  classes.push(classToAdd);
                  el.className = classes.join(" ");
                }
              }
            }
          },

          addClasses: function addClasses(el, classesToAdd) {
            classesToAdd.forEach(function (classToAdd) {
              this.addClass(el, classToAdd.trim());
            });
          },

          removeClass: function removeClass(el, classToRemove) {
            if (el instanceof HTMLElement) {
              if (el.classList) {
                el.classList.remove(classToRemove);
              } else {
                var classes = el.className.split(/\s+/g).join(" ");
                el.className = classes.replace(classRegEx(classToRemove), "");
              }
            }
          },

          removeClasses: function removeClasses(el, classesToRemove) {
            classesToRemove.forEach(function (classToRemove) {
              this.removeClass(el, classToRemove);
            });
          },

          toggleClass: function toggleClass(el, classToToggle) {
            if (el instanceof HTMLElement) {
              if (this.hasClass(el, classToToggle)) {
                this.removeClass(el, classToToggle);
              } else {
                this.addClass(el, classToToggle);
              }
            }
          },

          toggleClasses: function toggleClasses(el, classesToToggle) {
            classesToToggle.forEach(function (classToToggle) {
              this.toggleClass(el, classToToggle);
            });
          }

        };
      })());
    }
  };
});
System.register("src/event/Event", ["src/utils/Utils", "src/event/Helpers"], function (_export) {
  "use strict";

  var utils, helpers;
  return {
    setters: [function (_srcUtilsUtils) {
      utils = _srcUtilsUtils["default"];
    }, function (_srcEventHelpers) {
      helpers = _srcEventHelpers["default"];
    }],
    execute: function () {
      _export("default", {

        on: function on(eventType, listener, context, useCapture) {

          context = context || this;

          this.forEach(function (el) {
            listener.$$__listenerId = listener.$$__listenerId || String(utils.getUID());
            el.$$__listeners = el.$$__listeners || {};
            if (!el.$$__listeners[eventType]) {
              el.$$__listeners[eventType] = [];
            }
            context.$$__boundListeners = context.$$__boundListeners || {};
            if (!context.$$__boundListeners[eventType]) {
              context.$$__boundListeners[eventType] = [];
            }
            context.$$__boundListeners[eventType].push(listener.$$__listenerId);
            var callback = null;
            if (helpers.isEventSupported(el, eventType)) {
              callback = function () {
                listener.apply(context, [].slice.call(arguments));
              };
            } else {
              callback = listener;
            }
            el.addEventListener(eventType, callback, useCapture);
            el.$$__listeners[eventType][listener.$$__listenerId] = {
              listener: callback,
              context: context,
              useCapture: useCapture
            };
          });
          return this;
        },

        off: function off(eventType, listener, context, useCapture) {
          context = context || this;
          var boundListeners = context.$$__boundListeners;
          this.forEach(function (el) {
            var listenerId = listener.$$__listenerId;
            if (listenerId) {
              var observerStore = el.$$__listeners[eventType][listenerId];
              if (observerStore && observerStore.useCapture === useCapture) {
                if (boundListeners && boundListeners[eventType] && boundListeners[eventType].indexOf(listenerId) != -1) {
                  el.removeEventListener(eventType, observerStore.listener, useCapture);
                  var index = el.$$__listeners[eventType].indexOf(listenerId);
                  el.$$__listeners[eventType][listenerId] = undefined;
                  el.$$__listeners[eventType] = el.$$__listeners[eventType].splice(index, 1);
                }
              }
            }
          });
          return this;
        },

        once: function once(eventType, listener, context, useCapture) {
          context = context || this;
          this.forEach(function (el) {
            var callback = null;
            if (isEventSupported(el, eventType)) {
              callback = function () {
                listener.apply(context, [].slice.call(arguments));
                el.removeEventListener(eventType, callback, useCapture);
              };
              el.addEventListener(eventType, callback, useCapture);
            } else {
              callback = listener;
            }
          });
          return this;
        }

      });
    }
  };
});
System.register("src/event/Emitter", ["src/event/Helpers", "src/css/Helpers", "src/modules/Logger"], function (_export) {
  "use strict";

  var eventHelpers, cssHelpers, Logger;
  return {
    setters: [function (_srcEventHelpers) {
      eventHelpers = _srcEventHelpers["default"];
    }, function (_srcCssHelpers) {
      cssHelpers = _srcCssHelpers["default"];
    }, function (_srcModulesLogger) {
      Logger = _srcModulesLogger["default"];
    }],
    execute: function () {
      _export("default", {

        emit: function emit(eventName, data) {

          this.forEach(function (item) {
            if (data || !eventHelpers.isEventSupported(item, eventName)) {
              if (item.dispatchEvent) {
                if (data) {
                  item.dispatchEvent(new CustomEvent(eventName, { detail: data }));
                } else {
                  item.dispatchEvent(new CustomEvent(eventName));
                }
              } else {
                Logger.error("dispatchEvent not supported on " + el);
              }
            } else {
              var evt = document.createEvent("Event");
              evt.initEvent(eventName, true, true);
              item.dispatchEvent(evt);
            }
          });

          return this;
        }

      });
    }
  };
});
System.register("src/databinding/Observable", ["npm:babel-runtime@5.4.7/helpers/create-class", "npm:babel-runtime@5.4.7/helpers/class-call-check", "src/event/Notifier"], function (_export) {
  var _createClass, _classCallCheck, Notifier, Observable;

  return {
    setters: [function (_npmBabelRuntime547HelpersCreateClass) {
      _createClass = _npmBabelRuntime547HelpersCreateClass["default"];
    }, function (_npmBabelRuntime547HelpersClassCallCheck) {
      _classCallCheck = _npmBabelRuntime547HelpersClassCallCheck["default"];
    }, function (_srcEventNotifier) {
      Notifier = _srcEventNotifier["default"];
    }],
    execute: function () {
      "use strict";

      Observable = (function () {
        function Observable() {
          _classCallCheck(this, Observable);

          this.$$__notifier = new Notifier();
          Object.observe(this, this.onChange.bind(this));
        }

        _createClass(Observable, [{
          key: "onChange",
          value: function onChange(changes) {

            var eventName = null;
            changes = this.extractPublicMembers(changes);

            changes.forEach((function (change) {
              eventName = change.name + "Change";
              this.fireEvent(eventName, change);
            }).bind(this));

            if (changes.length > 0) {
              this.fireEvent("change", changes);
            }
          }
        }, {
          key: "extractPublicMembers",
          value: function extractPublicMembers(changes) {
            var firstCharCode = null;
            changes = changes.filter(function (change) {
              firstCharCode = change.name.toLowerCase().charCodeAt(0);
              return firstCharCode >= 97 && firstCharCode <= 122;
            });
            return changes;
          }
        }, {
          key: "addListener",
          value: function addListener(eventType, listener, context) {
            this.$$__notifier.subscribe(eventType, listener, context);
          }
        }, {
          key: "fireEvent",
          value: function fireEvent(eventType, eventData) {
            window.setTimeout(this.$$__notifier.notify.bind(this.$$__notifier, eventType, eventData), 0);
          }
        }, {
          key: "on",
          value: function on(eventType, listener, context) {
            this.addListener(eventType, listener, context);
          }
        }, {
          key: "off",
          value: function off(eventType, listener, context) {
            this.$$__notifier.unsubscribe(eventType, listener, context);
          }
        }, {
          key: "once",
          value: function once(eventType, listener, context) {
            var that = this;
            var callback = (function () {
              listener.apply(context, [].slice.call(arguments));
              this.off(eventType, callback);
            }).bind(this);
            this.addListener(eventType, callback, context);
          }
        }]);

        return Observable;
      })();

      _export("default", Observable);
    }
  };
});
System.register('src/resources/ObjectObserve', ['npm:babel-runtime@5.4.7/core-js/object/create', 'npm:babel-runtime@5.4.7/core-js/object/get-own-property-names', 'npm:babel-runtime@5.4.7/core-js/object/define-property', 'npm:babel-runtime@5.4.7/core-js/object/get-own-property-descriptor', 'npm:babel-runtime@5.4.7/core-js/object/define-properties', 'npm:babel-runtime@5.4.7/core-js/object/keys'], function (_export) {
  var _Object$create, _Object$getOwnPropertyNames, _Object$defineProperty, _Object$getOwnPropertyDescriptor, _Object$defineProperties, _Object$keys;

  return {
    setters: [function (_npmBabelRuntime547CoreJsObjectCreate) {
      _Object$create = _npmBabelRuntime547CoreJsObjectCreate['default'];
    }, function (_npmBabelRuntime547CoreJsObjectGetOwnPropertyNames) {
      _Object$getOwnPropertyNames = _npmBabelRuntime547CoreJsObjectGetOwnPropertyNames['default'];
    }, function (_npmBabelRuntime547CoreJsObjectDefineProperty) {
      _Object$defineProperty = _npmBabelRuntime547CoreJsObjectDefineProperty['default'];
    }, function (_npmBabelRuntime547CoreJsObjectGetOwnPropertyDescriptor) {
      _Object$getOwnPropertyDescriptor = _npmBabelRuntime547CoreJsObjectGetOwnPropertyDescriptor['default'];
    }, function (_npmBabelRuntime547CoreJsObjectDefineProperties) {
      _Object$defineProperties = _npmBabelRuntime547CoreJsObjectDefineProperties['default'];
    }, function (_npmBabelRuntime547CoreJsObjectKeys) {
      _Object$keys = _npmBabelRuntime547CoreJsObjectKeys['default'];
    }],
    execute: function () {
      'use strict';

      _export('default', (function () {

        /*
        * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
        * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
        * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
        * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
        * Code distributed by Google as part of the polymer project is also
        * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
        */

        (function (global) {
          'use strict';

          var testingExposeCycleCount = global.testingExposeCycleCount;

          // Detect and do basic sanity checking on Object/Array.observe.

          function detectObjectObserve() {
            if (typeof Object.observe !== 'function' || typeof Array.observe !== 'function') {
              return false;
            }

            var records = [];

            function callback(recs) {
              records = recs;
            }

            var test = {};
            var arr = [];
            Object.observe(test, callback);
            Array.observe(arr, callback);
            test.id = 1;
            test.id = 2;
            delete test.id;
            arr.push(1, 2);
            arr.length = 0;

            Object.deliverChangeRecords(callback);
            if (records.length !== 5) return false;

            if (records[0].type != 'add' || records[1].type != 'update' || records[2].type != 'delete' || records[3].type != 'splice' || records[4].type != 'splice') {
              return false;
            }

            Object.unobserve(test, callback);
            Array.unobserve(arr, callback);

            return true;
          }

          var hasObserve = detectObjectObserve();

          function detectEval() {
            // Don't test for eval if we're running in a Chrome App environment.
            // We check for APIs set that only exist in a Chrome App context.
            if (typeof chrome !== 'undefined' && chrome.app && chrome.app.runtime) {
              return false;
            }

            // Firefox OS Apps do not allow eval. This feature detection is very hacky
            // but even if some other platform adds support for this function this code
            // will continue to work.
            if (typeof navigator != 'undefined' && navigator.getDeviceStorage) {
              return false;
            }

            try {
              var f = new Function('', 'return true;');
              return f();
            } catch (ex) {
              return false;
            }
          }

          var hasEval = detectEval();

          function isIndex(s) {
            return +s === s >>> 0 && s !== '';
          }

          function toNumber(s) {
            return +s;
          }

          function isObject(obj) {
            return obj === Object(obj);
          }

          var numberIsNaN = global.Number.isNaN || function (value) {
            return typeof value === 'number' && global.isNaN(value);
          };

          function areSameValue(left, right) {
            if (left === right) return left !== 0 || 1 / left === 1 / right;
            if (numberIsNaN(left) && numberIsNaN(right)) return true;

            return left !== left && right !== right;
          }

          var createObject = '__proto__' in {} ? function (obj) {
            return obj;
          } : function (obj) {
            var proto = obj.__proto__;
            if (!proto) return obj;
            var newObject = _Object$create(proto);
            _Object$getOwnPropertyNames(obj).forEach(function (name) {
              _Object$defineProperty(newObject, name, _Object$getOwnPropertyDescriptor(obj, name));
            });
            return newObject;
          };

          var identStart = '[$_a-zA-Z]';
          var identPart = '[$_a-zA-Z0-9]';
          var identRegExp = new RegExp('^' + identStart + '+' + identPart + '*' + '$');

          function getPathCharType(char) {
            if (char === undefined) return 'eof';

            var code = char.charCodeAt(0);

            switch (code) {
              case 91: // [
              case 93: // ]
              case 46: // .
              case 34: // "
              case 39: // '
              case 48:
                // 0
                return char;

              case 95: // _
              case 36:
                // $
                return 'ident';

              case 32: // Space
              case 9: // Tab
              case 10: // Newline
              case 13: // Return
              case 160: // No-break space
              case 65279: // Byte Order Mark
              case 8232: // Line Separator
              case 8233:
                // Paragraph Separator
                return 'ws';
            }

            // a-z, A-Z
            if (97 <= code && code <= 122 || 65 <= code && code <= 90) return 'ident';

            // 1-9
            if (49 <= code && code <= 57) return 'number';

            return 'else';
          }

          var pathStateMachine = {
            'beforePath': {
              'ws': ['beforePath'],
              'ident': ['inIdent', 'append'],
              '[': ['beforeElement'],
              'eof': ['afterPath']
            },

            'inPath': {
              'ws': ['inPath'],
              '.': ['beforeIdent'],
              '[': ['beforeElement'],
              'eof': ['afterPath']
            },

            'beforeIdent': {
              'ws': ['beforeIdent'],
              'ident': ['inIdent', 'append']
            },

            'inIdent': {
              'ident': ['inIdent', 'append'],
              '0': ['inIdent', 'append'],
              'number': ['inIdent', 'append'],
              'ws': ['inPath', 'push'],
              '.': ['beforeIdent', 'push'],
              '[': ['beforeElement', 'push'],
              'eof': ['afterPath', 'push']
            },

            'beforeElement': {
              'ws': ['beforeElement'],
              '0': ['afterZero', 'append'],
              'number': ['inIndex', 'append'],
              '\'': ['inSingleQuote', 'append', ''],
              '"': ['inDoubleQuote', 'append', '']
            },

            'afterZero': {
              'ws': ['afterElement', 'push'],
              ']': ['inPath', 'push']
            },

            'inIndex': {
              '0': ['inIndex', 'append'],
              'number': ['inIndex', 'append'],
              'ws': ['afterElement'],
              ']': ['inPath', 'push']
            },

            'inSingleQuote': {
              '\'': ['afterElement'],
              'eof': ['error'],
              'else': ['inSingleQuote', 'append']
            },

            'inDoubleQuote': {
              '"': ['afterElement'],
              'eof': ['error'],
              'else': ['inDoubleQuote', 'append']
            },

            'afterElement': {
              'ws': ['afterElement'],
              ']': ['inPath', 'push']
            }
          };

          function noop() {}

          function parsePath(path) {
            var keys = [];
            var index = -1;
            var c,
                newChar,
                key,
                type,
                transition,
                action,
                typeMap,
                mode = 'beforePath';

            var actions = {
              push: function push() {
                if (key === undefined) return;

                keys.push(key);
                key = undefined;
              },

              append: function append() {
                if (key === undefined) key = newChar;else key += newChar;
              }
            };

            function maybeUnescapeQuote() {
              if (index >= path.length) return;

              var nextChar = path[index + 1];
              if (mode == 'inSingleQuote' && nextChar == '\'' || mode == 'inDoubleQuote' && nextChar == '"') {
                index++;
                newChar = nextChar;
                actions.append();
                return true;
              }
            }

            while (mode) {
              index++;
              c = path[index];

              if (c == '\\' && maybeUnescapeQuote(mode)) continue;

              type = getPathCharType(c);
              typeMap = pathStateMachine[mode];
              transition = typeMap[type] || typeMap['else'] || 'error';

              if (transition == 'error') return; // parse error;

              mode = transition[0];
              action = actions[transition[1]] || noop;
              newChar = transition[2] === undefined ? c : transition[2];
              action();

              if (mode === 'afterPath') {
                return keys;
              }
            }

            return; // parse error
          }

          function isIdent(s) {
            return identRegExp.test(s);
          }

          var constructorIsPrivate = {};

          function Path(parts, privateToken) {
            if (privateToken !== constructorIsPrivate) throw Error('Use Path.get to retrieve path objects');

            for (var i = 0; i < parts.length; i++) {
              this.push(String(parts[i]));
            }

            if (hasEval && this.length) {
              this.getValueFrom = this.compiledGetValueFromFn();
            }
          }

          // TODO(rafaelw): Make simple LRU cache
          var pathCache = {};

          function getPath(pathString) {
            if (pathString instanceof Path) return pathString;

            if (pathString == null || pathString.length == 0) pathString = '';

            if (typeof pathString != 'string') {
              if (isIndex(pathString.length)) {
                // Constructed with array-like (pre-parsed) keys
                return new Path(pathString, constructorIsPrivate);
              }

              pathString = String(pathString);
            }

            var path = pathCache[pathString];
            if (path) return path;

            var parts = parsePath(pathString);
            if (!parts) return invalidPath;

            var path = new Path(parts, constructorIsPrivate);
            pathCache[pathString] = path;
            return path;
          }

          Path.get = getPath;

          function formatAccessor(key) {
            if (isIndex(key)) {
              return '[' + key + ']';
            } else {
              return '["' + key.replace(/"/g, '\\"') + '"]';
            }
          }

          Path.prototype = createObject({
            __proto__: [],
            valid: true,

            toString: function toString() {
              var pathString = '';
              for (var i = 0; i < this.length; i++) {
                var key = this[i];
                if (isIdent(key)) {
                  pathString += i ? '.' + key : key;
                } else {
                  pathString += formatAccessor(key);
                }
              }

              return pathString;
            },

            getValueFrom: function getValueFrom(obj, directObserver) {
              for (var i = 0; i < this.length; i++) {
                if (obj == null) return;
                obj = obj[this[i]];
              }
              return obj;
            },

            iterateObjects: function iterateObjects(obj, observe) {
              for (var i = 0; i < this.length; i++) {
                if (i) obj = obj[this[i - 1]];
                if (!isObject(obj)) return;
                observe(obj, this[0]);
              }
            },

            compiledGetValueFromFn: function compiledGetValueFromFn() {
              var str = '';
              var pathString = 'obj';
              str += 'if (obj != null';
              var i = 0;
              var key;
              for (; i < this.length - 1; i++) {
                key = this[i];
                pathString += isIdent(key) ? '.' + key : formatAccessor(key);
                str += ' &&\n     ' + pathString + ' != null';
              }
              str += ')\n';

              var key = this[i];
              pathString += isIdent(key) ? '.' + key : formatAccessor(key);

              str += '  return ' + pathString + ';\nelse\n  return undefined;';
              return new Function('obj', str);
            },

            setValueFrom: function setValueFrom(obj, value) {
              if (!this.length) return false;

              for (var i = 0; i < this.length - 1; i++) {
                if (!isObject(obj)) return false;
                obj = obj[this[i]];
              }

              if (!isObject(obj)) return false;

              obj[this[i]] = value;
              return true;
            }
          });

          var invalidPath = new Path('', constructorIsPrivate);
          invalidPath.valid = false;
          invalidPath.getValueFrom = invalidPath.setValueFrom = function () {};

          var MAX_DIRTY_CHECK_CYCLES = 1000;

          function dirtyCheck(observer) {
            var cycles = 0;
            while (cycles < MAX_DIRTY_CHECK_CYCLES && observer.check_()) {
              cycles++;
            }
            if (testingExposeCycleCount) global.dirtyCheckCycleCount = cycles;

            return cycles > 0;
          }

          function objectIsEmpty(object) {
            for (var prop in object) return false;
            return true;
          }

          function diffIsEmpty(diff) {
            return objectIsEmpty(diff.added) && objectIsEmpty(diff.removed) && objectIsEmpty(diff.changed);
          }

          function diffObjectFromOldObject(object, oldObject) {
            var added = {};
            var removed = {};
            var changed = {};

            for (var prop in oldObject) {
              var newValue = object[prop];

              if (newValue !== undefined && newValue === oldObject[prop]) continue;

              if (!(prop in object)) {
                removed[prop] = undefined;
                continue;
              }

              if (newValue !== oldObject[prop]) changed[prop] = newValue;
            }

            for (var prop in object) {
              if (prop in oldObject) continue;

              added[prop] = object[prop];
            }

            if (Array.isArray(object) && object.length !== oldObject.length) changed.length = object.length;

            return {
              added: added,
              removed: removed,
              changed: changed
            };
          }

          var eomTasks = [];

          function runEOMTasks() {
            if (!eomTasks.length) return false;

            for (var i = 0; i < eomTasks.length; i++) {
              eomTasks[i]();
            }
            eomTasks.length = 0;
            return true;
          }

          var runEOM = hasObserve ? (function () {
            var eomObj = {
              pingPong: true
            };
            var eomRunScheduled = false;

            Object.observe(eomObj, function () {
              runEOMTasks();
              eomRunScheduled = false;
            });

            return function (fn) {
              eomTasks.push(fn);
              if (!eomRunScheduled) {
                eomRunScheduled = true;
                eomObj.pingPong = !eomObj.pingPong;
              }
            };
          })() : (function () {
            return function (fn) {
              eomTasks.push(fn);
            };
          })();

          var observedObjectCache = [];

          function newObservedObject() {
            var observer;
            var object;
            var discardRecords = false;
            var first = true;

            function callback(records) {
              if (observer && observer.state_ === OPENED && !discardRecords) observer.check_(records);
            }

            return {
              open: function open(obs) {
                if (observer) throw Error('ObservedObject in use');

                if (!first) Object.deliverChangeRecords(callback);

                observer = obs;
                first = false;
              },
              observe: function observe(obj, arrayObserve) {
                object = obj;
                if (arrayObserve) Array.observe(object, callback);else Object.observe(object, callback);
              },
              deliver: function deliver(discard) {
                discardRecords = discard;
                Object.deliverChangeRecords(callback);
                discardRecords = false;
              },
              close: function close() {
                observer = undefined;
                Object.unobserve(object, callback);
                observedObjectCache.push(this);
              }
            };
          }

          /*
           * The observedSet abstraction is a perf optimization which reduces the total
           * number of Object.observe observations of a set of objects. The idea is that
           * groups of Observers will have some object dependencies in common and this
           * observed set ensures that each object in the transitive closure of
           * dependencies is only observed once. The observedSet acts as a write barrier
           * such that whenever any change comes through, all Observers are checked for
           * changed values.
           *
           * Note that this optimization is explicitly moving work from setup-time to
           * change-time.
           *
           * TODO(rafaelw): Implement "garbage collection". In order to move work off
           * the critical path, when Observers are closed, their observed objects are
           * not Object.unobserve(d). As a result, it's possible that if the observedSet
           * is kept open, but some Observers have been closed, it could cause "leaks"
           * (prevent otherwise collectable objects from being collected). At some
           * point, we should implement incremental "gc" which keeps a list of
           * observedSets which may need clean-up and does small amounts of cleanup on a
           * timeout until all is clean.
           */

          function getObservedObject(observer, object, arrayObserve) {
            var dir = observedObjectCache.pop() || newObservedObject();
            dir.open(observer);
            dir.observe(object, arrayObserve);
            return dir;
          }

          var observedSetCache = [];

          function newObservedSet() {
            var observerCount = 0;
            var observers = [];
            var objects = [];
            var rootObj;
            var rootObjProps;

            function observe(obj, prop) {
              if (!obj) return;

              if (obj === rootObj) rootObjProps[prop] = true;

              if (objects.indexOf(obj) < 0) {
                objects.push(obj);
                Object.observe(obj, callback);
              }

              observe(Object.getPrototypeOf(obj), prop);
            }

            function allRootObjNonObservedProps(recs) {
              for (var i = 0; i < recs.length; i++) {
                var rec = recs[i];
                if (rec.object !== rootObj || rootObjProps[rec.name] || rec.type === 'setPrototype') {
                  return false;
                }
              }
              return true;
            }

            function callback(recs) {
              if (allRootObjNonObservedProps(recs)) return;

              var observer;
              for (var i = 0; i < observers.length; i++) {
                observer = observers[i];
                if (observer.state_ == OPENED) {
                  observer.iterateObjects_(observe);
                }
              }

              for (var i = 0; i < observers.length; i++) {
                observer = observers[i];
                if (observer.state_ == OPENED) {
                  observer.check_();
                }
              }
            }

            var record = {
              object: undefined,
              objects: objects,
              open: function open(obs, object) {
                if (!rootObj) {
                  rootObj = object;
                  rootObjProps = {};
                }

                observers.push(obs);
                observerCount++;
                obs.iterateObjects_(observe);
              },
              close: function close(obs) {
                observerCount--;
                if (observerCount > 0) {
                  return;
                }

                for (var i = 0; i < objects.length; i++) {
                  Object.unobserve(objects[i], callback);
                  Observer.unobservedCount++;
                }

                observers.length = 0;
                objects.length = 0;
                rootObj = undefined;
                rootObjProps = undefined;
                observedSetCache.push(this);
              }
            };

            return record;
          }

          var lastObservedSet;

          function getObservedSet(observer, obj) {
            if (!lastObservedSet || lastObservedSet.object !== obj) {
              lastObservedSet = observedSetCache.pop() || newObservedSet();
              lastObservedSet.object = obj;
            }
            lastObservedSet.open(observer, obj);
            return lastObservedSet;
          }

          var UNOPENED = 0;
          var OPENED = 1;
          var CLOSED = 2;
          var RESETTING = 3;

          var nextObserverId = 1;

          function Observer() {
            this.state_ = UNOPENED;
            this.callback_ = undefined;
            this.target_ = undefined; // TODO(rafaelw): Should be WeakRef
            this.directObserver_ = undefined;
            this.value_ = undefined;
            this.id_ = nextObserverId++;
          }

          Observer.prototype = {
            open: function open(callback, target) {
              if (this.state_ != UNOPENED) throw Error('Observer has already been opened.');

              addToAll(this);
              this.callback_ = callback;
              this.target_ = target;
              this.connect_();
              this.state_ = OPENED;
              return this.value_;
            },

            close: function close() {
              if (this.state_ != OPENED) return;

              removeFromAll(this);
              this.disconnect_();
              this.value_ = undefined;
              this.callback_ = undefined;
              this.target_ = undefined;
              this.state_ = CLOSED;
            },

            deliver: function deliver() {
              if (this.state_ != OPENED) return;

              dirtyCheck(this);
            },

            report_: function report_(changes) {
              try {
                this.callback_.apply(this.target_, changes);
              } catch (ex) {
                Observer._errorThrownDuringCallback = true;
                console.error('Exception caught during observer callback: ' + (ex.stack || ex));
              }
            },

            discardChanges: function discardChanges() {
              this.check_(undefined, true);
              return this.value_;
            }
          };

          var collectObservers = !hasObserve;
          var allObservers;
          Observer._allObserversCount = 0;

          if (collectObservers) {
            allObservers = [];
          }

          function addToAll(observer) {
            Observer._allObserversCount++;
            if (!collectObservers) return;

            allObservers.push(observer);
          }

          function removeFromAll(observer) {
            Observer._allObserversCount--;
          }

          var runningMicrotaskCheckpoint = false;

          global.Platform = global.Platform || {};

          global.Platform.performMicrotaskCheckpoint = function () {
            if (runningMicrotaskCheckpoint) return;

            if (!collectObservers) return;

            runningMicrotaskCheckpoint = true;

            var cycles = 0;
            var anyChanged, toCheck;

            do {
              cycles++;
              toCheck = allObservers;
              allObservers = [];
              anyChanged = false;

              for (var i = 0; i < toCheck.length; i++) {
                var observer = toCheck[i];
                if (observer.state_ != OPENED) continue;

                if (observer.check_()) anyChanged = true;

                allObservers.push(observer);
              }
              if (runEOMTasks()) anyChanged = true;
            } while (cycles < MAX_DIRTY_CHECK_CYCLES && anyChanged);

            if (testingExposeCycleCount) global.dirtyCheckCycleCount = cycles;

            runningMicrotaskCheckpoint = false;
          };

          if (collectObservers) {
            global.Platform.clearObservers = function () {
              allObservers = [];
            };
          }

          function ObjectObserver(object) {
            Observer.call(this);
            this.value_ = object;
            this.oldObject_ = undefined;
          }

          ObjectObserver.prototype = createObject({
            __proto__: Observer.prototype,

            arrayObserve: false,

            connect_: function connect_(callback, target) {
              if (hasObserve) {
                this.directObserver_ = getObservedObject(this, this.value_, this.arrayObserve);
              } else {
                this.oldObject_ = this.copyObject(this.value_);
              }
            },

            copyObject: function copyObject(object) {
              var copy = Array.isArray(object) ? [] : {};
              for (var prop in object) {
                copy[prop] = object[prop];
              };
              if (Array.isArray(object)) copy.length = object.length;
              return copy;
            },

            check_: function check_(changeRecords, skipChanges) {
              var diff;
              var oldValues;
              if (hasObserve) {
                if (!changeRecords) return false;

                oldValues = {};
                diff = diffObjectFromChangeRecords(this.value_, changeRecords, oldValues);
              } else {
                oldValues = this.oldObject_;
                diff = diffObjectFromOldObject(this.value_, this.oldObject_);
              }

              if (diffIsEmpty(diff)) return false;

              if (!hasObserve) this.oldObject_ = this.copyObject(this.value_);

              this.report_([diff.added || {}, diff.removed || {}, diff.changed || {}, function (property) {
                return oldValues[property];
              }]);

              return true;
            },

            disconnect_: function disconnect_() {
              if (hasObserve) {
                this.directObserver_.close();
                this.directObserver_ = undefined;
              } else {
                this.oldObject_ = undefined;
              }
            },

            deliver: function deliver() {
              if (this.state_ != OPENED) return;

              if (hasObserve) this.directObserver_.deliver(false);else dirtyCheck(this);
            },

            discardChanges: function discardChanges() {
              if (this.directObserver_) this.directObserver_.deliver(true);else this.oldObject_ = this.copyObject(this.value_);

              return this.value_;
            }
          });

          function ArrayObserver(array) {
            if (!Array.isArray(array)) throw Error('Provided object is not an Array');
            ObjectObserver.call(this, array);
          }

          ArrayObserver.prototype = createObject({

            __proto__: ObjectObserver.prototype,

            arrayObserve: true,

            copyObject: function copyObject(arr) {
              return arr.slice();
            },

            check_: function check_(changeRecords) {
              var splices;
              if (hasObserve) {
                if (!changeRecords) return false;
                splices = projectArraySplices(this.value_, changeRecords);
              } else {
                splices = calcSplices(this.value_, 0, this.value_.length, this.oldObject_, 0, this.oldObject_.length);
              }

              if (!splices || !splices.length) return false;

              if (!hasObserve) this.oldObject_ = this.copyObject(this.value_);

              this.report_([splices]);
              return true;
            }
          });

          ArrayObserver.applySplices = function (previous, current, splices) {
            splices.forEach(function (splice) {
              var spliceArgs = [splice.index, splice.removed.length];
              var addIndex = splice.index;
              while (addIndex < splice.index + splice.addedCount) {
                spliceArgs.push(current[addIndex]);
                addIndex++;
              }

              Array.prototype.splice.apply(previous, spliceArgs);
            });
          };

          function PathObserver(object, path) {
            Observer.call(this);

            this.object_ = object;
            this.path_ = getPath(path);
            this.directObserver_ = undefined;
          }

          PathObserver.prototype = createObject(_Object$defineProperties({
            __proto__: Observer.prototype,

            connect_: function connect_() {
              if (hasObserve) this.directObserver_ = getObservedSet(this, this.object_);

              this.check_(undefined, true);
            },

            disconnect_: function disconnect_() {
              this.value_ = undefined;

              if (this.directObserver_) {
                this.directObserver_.close(this);
                this.directObserver_ = undefined;
              }
            },

            iterateObjects_: function iterateObjects_(observe) {
              this.path_.iterateObjects(this.object_, observe);
            },

            check_: function check_(changeRecords, skipChanges) {
              var oldValue = this.value_;
              this.value_ = this.path_.getValueFrom(this.object_);
              if (skipChanges || areSameValue(this.value_, oldValue)) return false;

              this.report_([this.value_, oldValue, this]);
              return true;
            },

            setValue: function setValue(newValue) {
              if (this.path_) this.path_.setValueFrom(this.object_, newValue);
            }
          }, {
            path: {
              get: function () {
                return this.path_;
              },
              configurable: true,
              enumerable: true
            }
          }));

          function CompoundObserver(reportChangesOnOpen) {
            Observer.call(this);

            this.reportChangesOnOpen_ = reportChangesOnOpen;
            this.value_ = [];
            this.directObserver_ = undefined;
            this.observed_ = [];
          }

          var observerSentinel = {};

          CompoundObserver.prototype = createObject({
            __proto__: Observer.prototype,

            connect_: function connect_() {
              if (hasObserve) {
                var object;
                var needsDirectObserver = false;
                for (var i = 0; i < this.observed_.length; i += 2) {
                  object = this.observed_[i];
                  if (object !== observerSentinel) {
                    needsDirectObserver = true;
                    break;
                  }
                }

                if (needsDirectObserver) this.directObserver_ = getObservedSet(this, object);
              }

              this.check_(undefined, !this.reportChangesOnOpen_);
            },

            disconnect_: function disconnect_() {
              for (var i = 0; i < this.observed_.length; i += 2) {
                if (this.observed_[i] === observerSentinel) this.observed_[i + 1].close();
              }
              this.observed_.length = 0;
              this.value_.length = 0;

              if (this.directObserver_) {
                this.directObserver_.close(this);
                this.directObserver_ = undefined;
              }
            },

            addPath: function addPath(object, path) {
              if (this.state_ != UNOPENED && this.state_ != RESETTING) throw Error('Cannot add paths once started.');

              var path = getPath(path);
              this.observed_.push(object, path);
              if (!this.reportChangesOnOpen_) return;
              var index = this.observed_.length / 2 - 1;
              this.value_[index] = path.getValueFrom(object);
            },

            addObserver: function addObserver(observer) {
              if (this.state_ != UNOPENED && this.state_ != RESETTING) throw Error('Cannot add observers once started.');

              this.observed_.push(observerSentinel, observer);
              if (!this.reportChangesOnOpen_) return;
              var index = this.observed_.length / 2 - 1;
              this.value_[index] = observer.open(this.deliver, this);
            },

            startReset: function startReset() {
              if (this.state_ != OPENED) throw Error('Can only reset while open');

              this.state_ = RESETTING;
              this.disconnect_();
            },

            finishReset: function finishReset() {
              if (this.state_ != RESETTING) throw Error('Can only finishReset after startReset');
              this.state_ = OPENED;
              this.connect_();

              return this.value_;
            },

            iterateObjects_: function iterateObjects_(observe) {
              var object;
              for (var i = 0; i < this.observed_.length; i += 2) {
                object = this.observed_[i];
                if (object !== observerSentinel) this.observed_[i + 1].iterateObjects(object, observe);
              }
            },

            check_: function check_(changeRecords, skipChanges) {
              var oldValues;
              for (var i = 0; i < this.observed_.length; i += 2) {
                var object = this.observed_[i];
                var path = this.observed_[i + 1];
                var value;
                if (object === observerSentinel) {
                  var observable = path;
                  value = this.state_ === UNOPENED ? observable.open(this.deliver, this) : observable.discardChanges();
                } else {
                  value = path.getValueFrom(object);
                }

                if (skipChanges) {
                  this.value_[i / 2] = value;
                  continue;
                }

                if (areSameValue(value, this.value_[i / 2])) continue;

                oldValues = oldValues || [];
                oldValues[i / 2] = this.value_[i / 2];
                this.value_[i / 2] = value;
              }

              if (!oldValues) return false;

              // TODO(rafaelw): Having observed_ as the third callback arg here is
              // pretty lame API. Fix.
              this.report_([this.value_, oldValues, this.observed_]);
              return true;
            }
          });

          function identFn(value) {
            return value;
          }

          function ObserverTransform(observable, getValueFn, setValueFn, dontPassThroughSet) {
            this.callback_ = undefined;
            this.target_ = undefined;
            this.value_ = undefined;
            this.observable_ = observable;
            this.getValueFn_ = getValueFn || identFn;
            this.setValueFn_ = setValueFn || identFn;
            // TODO(rafaelw): This is a temporary hack. PolymerExpressions needs this
            // at the moment because of a bug in it's dependency tracking.
            this.dontPassThroughSet_ = dontPassThroughSet;
          }

          ObserverTransform.prototype = {
            open: function open(callback, target) {
              this.callback_ = callback;
              this.target_ = target;
              this.value_ = this.getValueFn_(this.observable_.open(this.observedCallback_, this));
              return this.value_;
            },

            observedCallback_: function observedCallback_(value) {
              value = this.getValueFn_(value);
              if (areSameValue(value, this.value_)) return;
              var oldValue = this.value_;
              this.value_ = value;
              this.callback_.call(this.target_, this.value_, oldValue);
            },

            discardChanges: function discardChanges() {
              this.value_ = this.getValueFn_(this.observable_.discardChanges());
              return this.value_;
            },

            deliver: function deliver() {
              return this.observable_.deliver();
            },

            setValue: function setValue(value) {
              value = this.setValueFn_(value);
              if (!this.dontPassThroughSet_ && this.observable_.setValue) return this.observable_.setValue(value);
            },

            close: function close() {
              if (this.observable_) this.observable_.close();
              this.callback_ = undefined;
              this.target_ = undefined;
              this.observable_ = undefined;
              this.value_ = undefined;
              this.getValueFn_ = undefined;
              this.setValueFn_ = undefined;
            }
          };

          var expectedRecordTypes = {
            add: true,
            update: true,
            'delete': true
          };

          function diffObjectFromChangeRecords(object, changeRecords, oldValues) {
            var added = {};
            var removed = {};

            for (var i = 0; i < changeRecords.length; i++) {
              var record = changeRecords[i];
              if (!expectedRecordTypes[record.type]) {
                console.error('Unknown changeRecord type: ' + record.type);
                console.error(record);
                continue;
              }

              if (!(record.name in oldValues)) oldValues[record.name] = record.oldValue;

              if (record.type == 'update') continue;

              if (record.type == 'add') {
                if (record.name in removed) delete removed[record.name];else added[record.name] = true;

                continue;
              }

              // type = 'delete'
              if (record.name in added) {
                delete added[record.name];
                delete oldValues[record.name];
              } else {
                removed[record.name] = true;
              }
            }

            for (var prop in added) added[prop] = object[prop];

            for (var prop in removed) removed[prop] = undefined;

            var changed = {};
            for (var prop in oldValues) {
              if (prop in added || prop in removed) continue;

              var newValue = object[prop];
              if (oldValues[prop] !== newValue) changed[prop] = newValue;
            }

            return {
              added: added,
              removed: removed,
              changed: changed
            };
          }

          function newSplice(index, removed, addedCount) {
            return {
              index: index,
              removed: removed,
              addedCount: addedCount
            };
          }

          var EDIT_LEAVE = 0;
          var EDIT_UPDATE = 1;
          var EDIT_ADD = 2;
          var EDIT_DELETE = 3;

          function ArraySplice() {}

          ArraySplice.prototype = {

            // Note: This function is *based* on the computation of the Levenshtein
            // "edit" distance. The one change is that "updates" are treated as two
            // edits - not one. With Array splices, an update is really a delete
            // followed by an add. By retaining this, we optimize for "keeping" the
            // maximum array items in the original array. For example:
            //
            //   'xxxx123' -> '123yyyy'
            //
            // With 1-edit updates, the shortest path would be just to update all seven
            // characters. With 2-edit updates, we delete 4, leave 3, and add 4. This
            // leaves the substring '123' intact.
            calcEditDistances: function calcEditDistances(current, currentStart, currentEnd, old, oldStart, oldEnd) {
              // "Deletion" columns
              var rowCount = oldEnd - oldStart + 1;
              var columnCount = currentEnd - currentStart + 1;
              var distances = new Array(rowCount);

              // "Addition" rows. Initialize null column.
              for (var i = 0; i < rowCount; i++) {
                distances[i] = new Array(columnCount);
                distances[i][0] = i;
              }

              // Initialize null row
              for (var j = 0; j < columnCount; j++) distances[0][j] = j;

              for (var i = 1; i < rowCount; i++) {
                for (var j = 1; j < columnCount; j++) {
                  if (this.equals(current[currentStart + j - 1], old[oldStart + i - 1])) distances[i][j] = distances[i - 1][j - 1];else {
                    var north = distances[i - 1][j] + 1;
                    var west = distances[i][j - 1] + 1;
                    distances[i][j] = north < west ? north : west;
                  }
                }
              }

              return distances;
            },

            // This starts at the final weight, and walks "backward" by finding
            // the minimum previous weight recursively until the origin of the weight
            // matrix.
            spliceOperationsFromEditDistances: function spliceOperationsFromEditDistances(distances) {
              var i = distances.length - 1;
              var j = distances[0].length - 1;
              var current = distances[i][j];
              var edits = [];
              while (i > 0 || j > 0) {
                if (i == 0) {
                  edits.push(EDIT_ADD);
                  j--;
                  continue;
                }
                if (j == 0) {
                  edits.push(EDIT_DELETE);
                  i--;
                  continue;
                }
                var northWest = distances[i - 1][j - 1];
                var west = distances[i - 1][j];
                var north = distances[i][j - 1];

                var min;
                if (west < north) min = west < northWest ? west : northWest;else min = north < northWest ? north : northWest;

                if (min == northWest) {
                  if (northWest == current) {
                    edits.push(EDIT_LEAVE);
                  } else {
                    edits.push(EDIT_UPDATE);
                    current = northWest;
                  }
                  i--;
                  j--;
                } else if (min == west) {
                  edits.push(EDIT_DELETE);
                  i--;
                  current = west;
                } else {
                  edits.push(EDIT_ADD);
                  j--;
                  current = north;
                }
              }

              edits.reverse();
              return edits;
            },

            /**
             * Splice Projection functions:
             *
             * A splice map is a representation of how a previous array of items
             * was transformed into a new array of items. Conceptually it is a list of
             * tuples of
             *
             *   <index, removed, addedCount>
             *
             * which are kept in ascending index order of. The tuple represents that at
             * the |index|, |removed| sequence of items were removed, and counting forward
             * from |index|, |addedCount| items were added.
             */

            /**
             * Lacking individual splice mutation information, the minimal set of
             * splices can be synthesized given the previous state and final state of an
             * array. The basic approach is to calculate the edit distance matrix and
             * choose the shortest path through it.
             *
             * Complexity: O(l * p)
             *   l: The length of the current array
             *   p: The length of the old array
             */
            calcSplices: function calcSplices(current, currentStart, currentEnd, old, oldStart, oldEnd) {
              var prefixCount = 0;
              var suffixCount = 0;

              var minLength = Math.min(currentEnd - currentStart, oldEnd - oldStart);
              if (currentStart == 0 && oldStart == 0) prefixCount = this.sharedPrefix(current, old, minLength);

              if (currentEnd == current.length && oldEnd == old.length) suffixCount = this.sharedSuffix(current, old, minLength - prefixCount);

              currentStart += prefixCount;
              oldStart += prefixCount;
              currentEnd -= suffixCount;
              oldEnd -= suffixCount;

              if (currentEnd - currentStart == 0 && oldEnd - oldStart == 0) return [];

              if (currentStart == currentEnd) {
                var splice = newSplice(currentStart, [], 0);
                while (oldStart < oldEnd) splice.removed.push(old[oldStart++]);

                return [splice];
              } else if (oldStart == oldEnd) return [newSplice(currentStart, [], currentEnd - currentStart)];

              var ops = this.spliceOperationsFromEditDistances(this.calcEditDistances(current, currentStart, currentEnd, old, oldStart, oldEnd));

              var splice = undefined;
              var splices = [];
              var index = currentStart;
              var oldIndex = oldStart;
              for (var i = 0; i < ops.length; i++) {
                switch (ops[i]) {
                  case EDIT_LEAVE:
                    if (splice) {
                      splices.push(splice);
                      splice = undefined;
                    }

                    index++;
                    oldIndex++;
                    break;
                  case EDIT_UPDATE:
                    if (!splice) splice = newSplice(index, [], 0);

                    splice.addedCount++;
                    index++;

                    splice.removed.push(old[oldIndex]);
                    oldIndex++;
                    break;
                  case EDIT_ADD:
                    if (!splice) splice = newSplice(index, [], 0);

                    splice.addedCount++;
                    index++;
                    break;
                  case EDIT_DELETE:
                    if (!splice) splice = newSplice(index, [], 0);

                    splice.removed.push(old[oldIndex]);
                    oldIndex++;
                    break;
                }
              }

              if (splice) {
                splices.push(splice);
              }
              return splices;
            },

            sharedPrefix: function sharedPrefix(current, old, searchLength) {
              for (var i = 0; i < searchLength; i++) if (!this.equals(current[i], old[i])) return i;
              return searchLength;
            },

            sharedSuffix: function sharedSuffix(current, old, searchLength) {
              var index1 = current.length;
              var index2 = old.length;
              var count = 0;
              while (count < searchLength && this.equals(current[--index1], old[--index2])) count++;

              return count;
            },

            calculateSplices: function calculateSplices(current, previous) {
              return this.calcSplices(current, 0, current.length, previous, 0, previous.length);
            },

            equals: function equals(currentValue, previousValue) {
              return currentValue === previousValue;
            }
          };

          var arraySplice = new ArraySplice();

          function calcSplices(current, currentStart, currentEnd, old, oldStart, oldEnd) {
            return arraySplice.calcSplices(current, currentStart, currentEnd, old, oldStart, oldEnd);
          }

          function intersect(start1, end1, start2, end2) {
            // Disjoint
            if (end1 < start2 || end2 < start1) return -1;

            // Adjacent
            if (end1 == start2 || end2 == start1) return 0;

            // Non-zero intersect, span1 first
            if (start1 < start2) {
              if (end1 < end2) return end1 - start2; // Overlap
              else return end2 - start2; // Contained
            } else {
              // Non-zero intersect, span2 first
              if (end2 < end1) return end2 - start1; // Overlap
              else return end1 - start1; // Contained
            }
          }

          function mergeSplice(splices, index, removed, addedCount) {

            var splice = newSplice(index, removed, addedCount);

            var inserted = false;
            var insertionOffset = 0;

            for (var i = 0; i < splices.length; i++) {
              var current = splices[i];
              current.index += insertionOffset;

              if (inserted) continue;

              var intersectCount = intersect(splice.index, splice.index + splice.removed.length, current.index, current.index + current.addedCount);

              if (intersectCount >= 0) {
                // Merge the two splices

                splices.splice(i, 1);
                i--;

                insertionOffset -= current.addedCount - current.removed.length;

                splice.addedCount += current.addedCount - intersectCount;
                var deleteCount = splice.removed.length + current.removed.length - intersectCount;

                if (!splice.addedCount && !deleteCount) {
                  // merged splice is a noop. discard.
                  inserted = true;
                } else {
                  var removed = current.removed;

                  if (splice.index < current.index) {
                    // some prefix of splice.removed is prepended to current.removed.
                    var prepend = splice.removed.slice(0, current.index - splice.index);
                    Array.prototype.push.apply(prepend, removed);
                    removed = prepend;
                  }

                  if (splice.index + splice.removed.length > current.index + current.addedCount) {
                    // some suffix of splice.removed is appended to current.removed.
                    var append = splice.removed.slice(current.index + current.addedCount - splice.index);
                    Array.prototype.push.apply(removed, append);
                  }

                  splice.removed = removed;
                  if (current.index < splice.index) {
                    splice.index = current.index;
                  }
                }
              } else if (splice.index < current.index) {
                // Insert splice here.

                inserted = true;

                splices.splice(i, 0, splice);
                i++;

                var offset = splice.addedCount - splice.removed.length;
                current.index += offset;
                insertionOffset += offset;
              }
            }

            if (!inserted) splices.push(splice);
          }

          function createInitialSplices(array, changeRecords) {
            var splices = [];

            for (var i = 0; i < changeRecords.length; i++) {
              var record = changeRecords[i];
              switch (record.type) {
                case 'splice':
                  mergeSplice(splices, record.index, record.removed.slice(), record.addedCount);
                  break;
                case 'add':
                case 'update':
                case 'delete':
                  if (!isIndex(record.name)) continue;
                  var index = toNumber(record.name);
                  if (index < 0) continue;
                  mergeSplice(splices, index, [record.oldValue], 1);
                  break;
                default:
                  console.error('Unexpected record type: ' + JSON.stringify(record));
                  break;
              }
            }

            return splices;
          }

          function projectArraySplices(array, changeRecords) {
            var splices = [];

            createInitialSplices(array, changeRecords).forEach(function (splice) {
              if (splice.addedCount == 1 && splice.removed.length == 1) {
                if (splice.removed[0] !== array[splice.index]) splices.push(splice);

                return;
              };

              splices = splices.concat(calcSplices(array, splice.index, splice.index + splice.addedCount, splice.removed, 0, splice.removed.length));
            });

            return splices;
          }

          global.Observer = Observer;
          global.Observer.runEOM_ = runEOM;
          global.Observer.observerSentinel_ = observerSentinel; // for testing.
          global.Observer.hasObjectObserve = hasObserve;
          global.ArrayObserver = ArrayObserver;
          global.ArrayObserver.calculateSplices = function (current, previous) {
            return arraySplice.calculateSplices(current, previous);
          };

          global.ArraySplice = ArraySplice;
          global.ObjectObserver = ObjectObserver;
          global.PathObserver = PathObserver;
          global.CompoundObserver = CompoundObserver;
          global.Path = Path;
          global.ObserverTransform = ObserverTransform;
        })(typeof global !== 'undefined' && global && typeof module !== 'undefined' && module ? global : this || window);

        /**
        
        The MIT License (MIT)
        
        Copyright (c) 2015 Romeo Kenfack Tsakem
        Permission is hereby granted, free of charge, to any person obtaining a copy of this software
        and associated documentation files (the "Software"), to deal in the Software without restriction,
        including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
        nd/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
        subject to the following conditions:
        
        The above copyright notice and this permission notice shall be included in all copies or substantial
        ortions of the Software.
        
        THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
        IMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
        IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
        WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
        SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
        
        */

        var $$__Hooks = [Platform.performMicrotaskCheckpoint];
        var hasNativeObjectObserve = Observer.hasObjectObserve;

        var maxCheckDuration = 300;
        var checkerTheshold = 60;
        var checkerTimer = null;
        var checkStartTime = null;
        var checkDuration = 0;

        var checkerStep = function checkerStep() {
          if (checkDuration < maxCheckDuration) {
            window.nativeSetTimeout(function () {
              $$__Hooks.forEach(function (hook) {
                hook();
              });
              checkerTimer = window.nativeSetTimeout(function () {
                checkerStep();
              }, checkerTheshold);

              checkDuration += checkerTheshold;
            }, 0);
          } else {
            window.clearTimeout(checkerTimer);
            checkerTimer = null;
            checkDuration = 0;
          }
        };

        var executeHooks = function executeHooks() {
          if (!hasNativeObjectObserve) {
            if (checkerTimer) {
              checkDuration = 0;
              return;
            } else {
              checkerStep();
            }
          }
        };

        /**
        
        The MIT License (MIT)
        
        Copyright (c) 2015 Romeo Kenfack Tsakem
        Permission is hereby granted, free of charge, to any person obtaining a copy of this software
        and associated documentation files (the "Software"), to deal in the Software without restriction,
        including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
        nd/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
        subject to the following conditions:
        
        The above copyright notice and this permission notice shall be included in all copies or substantial
        ortions of the Software.
        
        THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
        IMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
        IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
        WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
        SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
        
        */

        // From https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/keys
        if (!_Object$keys) {
          _Object$keys = (function () {
            'use strict';
            var hasOwnProperty = Object.prototype.hasOwnProperty,
                hasDontEnumBug = !({
              toString: null
            }).propertyIsEnumerable('toString'),
                dontEnums = ['toString', 'toLocaleString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'constructor'],
                dontEnumsLength = dontEnums.length;

            return function (obj) {
              if (typeof obj !== 'object' && (typeof obj !== 'function' || obj === null)) {
                throw new TypeError('Object.keys called on non-object');
              }

              var result = [],
                  prop,
                  i;

              for (prop in obj) {
                if (hasOwnProperty.call(obj, prop)) {
                  result.push(prop);
                }
              }

              if (hasDontEnumBug) {
                for (i = 0; i < dontEnumsLength; i++) {
                  if (hasOwnProperty.call(obj, dontEnums[i])) {
                    result.push(dontEnums[i]);
                  }
                }
              }
              return result;
            };
          })();
        };

        if (!Object.changes) {

          Object.changes = function (oldObject, object) {

            var added = {};
            var removed = {};
            var changed = {};

            var internalPrefix = '$$__';

            for (var prop in oldObject) {
              if (prop.indexOf(internalPrefix) == 0) {
                continue;
              }
              var newValue = object[prop];
              if (newValue !== undefined && newValue === oldObject[prop]) {
                continue;
              }
              if (!(prop in object)) {
                removed[prop] = undefined;
                continue;
              }
              if (newValue !== oldObject[prop]) {
                changed[prop] = newValue;
              }
            }

            for (var prop in object) {
              if (prop.indexOf(internalPrefix) == 0) {
                continue;
              }
              if (prop in oldObject) {
                continue;
              }
              added[prop] = object[prop];
            }

            if (Array.isArray(object) && object.length !== oldObject.length) {
              changed.length = object.length;
            }

            return {
              added: added,
              removed: removed,
              changed: changed
            };
          };
        }

        /**
        
        The MIT License (MIT)
        
        Copyright (c) 2015 Romeo Kenfack Tsakem
        Permission is hereby granted, free of charge, to any person obtaining a copy of this software
        and associated documentation files (the "Software"), to deal in the Software without restriction,
        including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
        nd/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
        subject to the following conditions:
        
        The above copyright notice and this permission notice shall be included in all copies or substantial
        ortions of the Software.
        
        THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
        IMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
        IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
        WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
        SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
        
        */

        var utils = {

          classToTypeMap: {
            '[object String]': 'String',
            '[object Array]': 'Array',
            '[object Object]': 'Object',
            '[object RegExp]': 'RegExp',
            '[object Number]': 'Number',
            '[object Boolean]': 'Boolean',
            '[object Date]': 'Date',
            '[object Function]': 'Function',
            '[object Error]': 'Error'
          },

          getClass: function getClass(value) {
            // The typeof null and undefined is "object" under IE8
            if (value === undefined) {
              return 'Undefined';
            } else if (value === null) {
              return 'Null';
            }
            var classString = Object.prototype.toString.call(value);
            return this.classToTypeMap[classString] || classString.slice(8, -1);
          },

          getUID: function getUID() {
            return (new Date().getTime() + '' + Math.floor(Math.random() * 1000000)).substr(0, 18);
          },

          isFunction: function isFunction(obj) {
            return typeof obj === 'function';
          },

          equals: function equals(object1, object2) {
            return this.__equals(object1, object2, [], []);
          },

          isObject: function isObject(obj) {
            return Object.prototype.toString.call(obj) == '[object Object]';
          },

          isDate: function isDate(obj) {
            return Object.prototype.toString.call(obj) == '[object Date]';
          },

          camelCase: function camelCase(s) {
            return (s || '').toLowerCase().replace(/(-)\w/g, function (m) {
              return m.toUpperCase().replace(/-/, '');
            });
          },

          hyphenate: function hyphenate(str) {
            return str.replace(/\s/g, '-').toLowerCase();
          },

          __equals: function __equals(object1, object2, aStack, bStack) {
            // Identical objects are equal. `0 === -0`, but they aren't identical.
            // See the [Harmony `egal` proposal](http://wiki.ecmascript.org/doku.php?id=harmony:egal).
            if (object1 === object2) {
              return object1 !== 0 || 1 / object1 == 1 / object2;
            }
            // A strict comparison is necessary because `null == undefined`.
            if (object1 == null || object2 == null) {
              return object1 === object2;
            }
            // Compare `[[Class]]` names.
            var className = Object.prototype.toString.call(object1);
            if (className != Object.prototype.toString.call(object2)) {
              return false;
            }
            switch (className) {
              // Strings, numbers, dates, and booleans are compared by value.
              case '[object String]':
                // Primitives and their corresponding object wrappers are equivalent; thus, `"5"` is
                // equivalent to `new String("5")`.
                return object1 == String(object2);
              case '[object Number]':
                // `NaN`s are equivalent, but non-reflexive. An `egal` comparison is performed for
                // other numeric values.
                return object1 != +object1 ? object2 != +object2 : object1 == 0 ? 1 / object1 == 1 / object2 : object1 == +object2;
              case '[object Date]':
              case '[object Boolean]':
                // Coerce dates and booleans to numeric primitive values. Dates are compared by their
                // millisecond representations. Note that invalid dates with millisecond representations
                // of `NaN` are not equivalent.
                return +object1 == +object2;
              // RegExps are compared by their source patterns and flags.
              case '[object RegExp]':
                return object1.source == object2.source && object1.global == object2.global && object1.multiline == object2.multiline && object1.ignoreCase == object2.ignoreCase;
            }
            if (typeof object1 != 'object' || typeof object2 != 'object') {
              return false;
            }
            // Assume equality for cyclic structures. The algorithm for detecting cyclic
            // structures is adapted from ES 5.1 section 15.12.3, abstract operation `JO`.
            var length = aStack.length;
            while (length--) {
              // Linear search. Performance is inversely proportional to the number of
              // unique nested structures.
              if (aStack[length] == object1) {
                return bStack[length] == object2;
              }
            }
            // Objects with different constructors are not equivalent, but `Object`s
            // from different frames are.
            var aCtor = object1.constructor,
                bCtor = object2.constructor;
            if (aCtor !== bCtor && !(this.isFunction(aCtor) && aCtor instanceof aCtor && this.isFunction(bCtor) && bCtor instanceof bCtor) && ('constructor' in object1 && 'constructor' in object2)) {
              return false;
            }
            // Add the first object to the stack of traversed objects.
            aStack.push(object1);
            bStack.push(object2);
            var size = 0,
                result = true;
            // Recursively compare objects and arrays.
            if (className == '[object Array]') {
              // Compare array lengths to determine if a deep comparison is necessary.
              size = object1.length;
              result = size == object2.length;
              if (result) {
                // Deep compare the contents, ignoring non-numeric properties.
                while (size--) {
                  if (!(result = this.__equals(object1[size], object2[size], aStack, bStack))) {
                    break;
                  }
                }
              }
            } else {
              // Deep compare objects.
              for (var key in object1) {
                if (Object.prototype.hasOwnProperty.call(object1, key)) {
                  // Count the expected number of properties.
                  size++;
                  // Deep compare each member.
                  if (!(result = Object.prototype.hasOwnProperty.call(object2, key) && this.__equals(object1[key], object2[key], aStack, bStack))) {
                    break;
                  }
                }
              }
              // Ensure that both objects contain the same number of properties.
              if (result) {
                for (key in object2) {
                  if (Object.prototype.hasOwnProperty.call(object2, key) && ! size--) {
                    break;
                  }
                }
                result = !size;
              }
            }
            // Remove the first object from the stack of traversed objects.
            aStack.pop();
            bStack.pop();

            return result;
          }

        };

        /**
        
        The MIT License (MIT)
        
        Copyright (c) 2015 Romeo Kenfack Tsakem
        Permission is hereby granted, free of charge, to any person obtaining a copy of this software
        and associated documentation files (the "Software"), to deal in the Software without restriction,
        including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
        nd/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
        subject to the following conditions:
        
        The above copyright notice and this permission notice shall be included in all copies or substantial
        ortions of the Software.
        
        THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
        IMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
        IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
        WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
        SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
        
        */

        /**
        * This code ovewrite the native addEventLitener as well as removeEventLitener
        * to te able to react on any changes. Some people don't like this but it's was the only way
        * for me to get this work.
        */

        if (!hasNativeObjectObserve) {

          window.addEventListener('load', function () {
            window.nativeSetTimeout(executeHooks, 0);
          }, false);

          [window, document, Element.prototype].forEach(function (eventTargetObject) {

            (function () {

              var __addEventListener = eventTargetObject.addEventListener;

              eventTargetObject.addEventListener = function (type, listener, useCapture) {

                if (typeof listener == 'function') {

                  listener.$$__observerId = listener.$$__observerId || utils.getUID();
                  this.$$__observers = this.$$__observers || {};

                  if (!this.$$__observers[type]) {
                    this.$$__observers[type] = [];
                  }

                  var callback = function callback() {
                    listener.apply(this, [].slice.call(arguments));
                    executeHooks();
                  };

                  this.$$__observers[type][listener.$$__observerId] = {
                    callback: callback,
                    useCapture: useCapture
                  };
                  __addEventListener.call(this, type, callback, useCapture);
                } else {
                  __addEventListener.call(this, type, listener, useCapture);
                }
              };
            })();
          });

          [window, document, Element.prototype].forEach(function (eventTargetObject) {
            (function () {
              var __removeEventListener = eventTargetObject.removeEventListener;
              eventTargetObject.removeEventListener = function (type, listener, useCapture) {
                if (typeof listener == 'function' && listener.$$__observerId && this.$$__observers) {
                  var listenerId = listener.$$__observerId;
                  if (listenerId && this.$$__observers[type]) {
                    var observerStore = this.$$__observers[type][listenerId];
                    if (observerStore && observerStore.useCapture === useCapture) {
                      __removeEventListener.call(this, type, observerStore.callback, useCapture);
                    } else {
                      __removeEventListener.call(this, type, listener, useCapture);
                    }
                  } else {
                    __removeEventListener.call(this, type, listener, useCapture);
                  }
                };
              };
            })();
          });
        }

        /**
        
        The MIT License (MIT)
        
        Copyright (c) 2015 Romeo Kenfack Tsakem
        Permission is hereby granted, free of charge, to any person obtaining a copy of this software
        and associated documentation files (the "Software"), to deal in the Software without restriction,
        including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
        nd/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
        subject to the following conditions:
        
        The above copyright notice and this permission notice shall be included in all copies or substantial
        ortions of the Software.
        
        THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
        IMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
        IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
        WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
        SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
        
        */

        if (!hasNativeObjectObserve) {
          (function (send) {
            XMLHttpRequest.prototype.send = function () {
              var readystatechange = this.onreadystatechange;
              var newReadyStateChange = function newReadyStateChange() {
                readystatechange();
                executeHooks();
              };
              this.onreadystatechange = newReadyStateChange;
              send.apply(this, arguments);
            };
          })(XMLHttpRequest.prototype.send);
        }

        /**
        
        The MIT License (MIT)
        
        Copyright (c) 2015 Romeo Kenfack Tsakem
        Permission is hereby granted, free of charge, to any person obtaining a copy of this software
        and associated documentation files (the "Software"), to deal in the Software without restriction,
        including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
        nd/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
        subject to the following conditions:
        
        The above copyright notice and this permission notice shall be included in all copies or substantial
        ortions of the Software.
        
        THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
        IMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
        IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
        WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
        SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
        
        */

        if (!hasNativeObjectObserve) {

          window.nativeSetTimeout = window.setTimeout;
          window.nativeSetInterval = window.setInterval;

          window.setTimeout = function (listener, delay) {
            window.nativeSetTimeout(function () {
              listener.apply(this, [].slice.call(arguments));
              executeHooks();
            }, delay);
          };

          window.setInterval = function (listener, delay) {
            window.nativeSetInterval(function () {
              listener.apply(this, [].slice.call(arguments));
              executeHooks();
            }, delay);
          };
        }

        /**
        
        The MIT License (MIT)
        
        Copyright (c) 2015 Romeo Kenfack Tsakem
        Permission is hereby granted, free of charge, to any person obtaining a copy of this software
        and associated documentation files (the "Software"), to deal in the Software without restriction,
        including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
        nd/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
        subject to the following conditions:
        
        The above copyright notice and this permission notice shall be included in all copies or substantial
        ortions of the Software.
        
        THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
        IMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
        IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
        WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
        SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
        
        */

        var hasNativeRequestAninationFrame = false;

        (function () {

          var lastTime = 0;
          var vendors = ['webkit', 'moz'];
          for (var x = 0; x < vendors.length && !window.requestAnimationFrame; ++x) {
            window.requestAnimationFrame = window[vendors[x] + 'RequestAnimationFrame'];
            window.cancelAnimationFrame = window[vendors[x] + 'CancelAnimationFrame'] || window[vendors[x] + 'CancelRequestAnimationFrame'];
          }

          hasNativeRequestAninationFrame = typeof window.requestAnimationFrame != 'undefined';

          if (!window.requestAnimationFrame) {
            window.requestAnimationFrame = function (callback, element) {
              var currTime = new Date().getTime();
              var timeToCall = Math.max(0, 16 - (currTime - lastTime));
              var id = window.setTimeout(function () {
                callback(currTime + timeToCall);
              }, timeToCall);
              lastTime = currTime + timeToCall;
              return id;
            };
          }

          if (!window.cancelAnimationFrame) {
            window.cancelAnimationFrame = function (id) {
              clearTimeout(id);
            };
          }
        })();

        (function () {
          if (hasNativeObjectObserve && hasNativeRequestAninationFrame) {
            var requestAnimationFrameNative = window.requestAnimationFrame;
            window.requestAnimationFrame = function (callback, element) {
              var internalCallback = function internalCallback() {
                callback();
                executeHooks();
              };
              requestAnimationFrameNative.call(this, internalCallback, element);
            };
            var cancelAnimationFrameNative = window.cancelAnimationFrame;
            window.cancelAnimationFrame = function (id) {
              cancelAnimationFrameNative.call(this, id);
              executeHooks();
            };
          }
        })();

        /**
        
        The MIT License (MIT)
        
        Copyright (c) 2015 Romeo Kenfack Tsakem
        Permission is hereby granted, free of charge, to any person obtaining a copy of this software
        and associated documentation files (the "Software"), to deal in the Software without restriction,
        including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
        nd/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
        subject to the following conditions:
        
        The above copyright notice and this permission notice shall be included in all copies or substantial
        ortions of the Software.
        
        THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
        IMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
        IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
        WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
        SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
        
        */

        (function () {

          /**
          * Normalizing observe-js behaviour to fit the spec of Object.observe
          * I have also added Object.watch/Object.unwatch for path observation
          *
          */

          /**
            ######################### Object.observe START ###################################
            Browser support : from IE9
            */
          if (!hasNativeObjectObserve) {

            if (!Object.observe) {

              Object.getNotifier = function (targetObject) {
                return {
                  notify: function notify(notification) {
                    var observers = targetObject.$$__observers || {};
                    for (var observer in observers) {
                      observers[observer].callback.call(observers[observer].scope, notification);
                    }
                  }
                };
              };

              var isRecordValid = function isRecordValid(type, acceptList) {
                return acceptList.length == 0 || acceptList.indexOf(type) != -1;
              };

              Object.observe = function (model, callback, acceptList) {

                var changes = [];
                var internalCallback = null;
                var observer = null;
                acceptList = acceptList || [];

                callback.$$__observerId = callback.$$__observerId || utils.getUID();
                model.$$__observers = model.$$__observers || {};

                if (Array.isArray(model)) {

                  var modelLength = model.length;
                  observer = new ArrayObserver(model);
                  var arrayCopy = JSON.parse(JSON.stringify(model));

                  internalCallback = function (splice) {

                    splice = splice[0];

                    if (model.length < modelLength) {

                      if (isRecordValid('update', acceptList)) {
                        for (var i = splice.index; i < model.length; i++) {
                          changes[i - splice.index] = {
                            name: '' + i,
                            object: model,
                            oldValue: arrayCopy[i],
                            type: 'update'
                          };
                        }
                      }

                      if (isRecordValid('delete', acceptList)) {
                        var removedStart = model.length;
                        splice.removed.forEach(function (removed, index) {
                          changes[changes.length] = {
                            name: '' + (removedStart + index),
                            object: model,
                            oldValue: arrayCopy[removedStart + index],
                            type: 'delete'
                          };
                        });
                      }
                    } else if (model.length > modelLength) {

                      if (isRecordValid('add', acceptList)) {
                        for (var i = 0; i < splice.addedCount; i++) {
                          changes[changes.length] = {
                            name: splice.index + i,
                            object: model,
                            type: 'add'
                          };
                        }
                      }
                    } else {

                      var changeStart = splice.index;
                      var type = null;

                      for (var i = 0; i < splice.addedCount; i++) {

                        type = model[splice.index + i] === undefined ? 'delete' : 'update';

                        if (isRecordValid(type, acceptList)) {
                          changes[changes.length] = {
                            name: splice.index + i + '',
                            object: model,
                            oldValue: arrayCopy[splice.index + i],
                            type: type
                          };
                        }
                      }
                    }

                    if (isRecordValid('update', acceptList)) {
                      if (model.length != modelLength) {
                        changes[changes.length] = {
                          name: 'length',
                          object: model,
                          oldValue: arrayCopy.length,
                          type: 'update'
                        };
                      }
                    }

                    callback.call(this, changes);
                    executeHooks();
                  };
                } else if (utils.isObject(model)) {

                  changes = [];
                  observer = new ObjectObserver(model);

                  internalCallback = function (added, removed, changed, getOldValueFn) {

                    if (isRecordValid('add', acceptList)) {
                      _Object$keys(added).forEach(function (addedKey) {
                        changes[changes.length] = {
                          name: addedKey,
                          object: model,
                          type: 'add'
                        };
                      });
                    }

                    if (isRecordValid('update', acceptList)) {
                      _Object$keys(changed).forEach(function (changedKey) {
                        changes[changes.length] = {
                          name: changedKey,
                          object: model,
                          oldValue: getOldValueFn(changedKey),
                          type: 'update'
                        };
                      });
                    }

                    if (isRecordValid('delete', acceptList)) {
                      _Object$keys(removed).forEach(function (removedKey) {
                        changes[changes.length] = {
                          name: removedKey,
                          object: model,
                          oldValue: getOldValueFn(removedKey),
                          type: 'delete'
                        };
                      });
                    }

                    callback.call(this, changes);
                    executeHooks();
                  };
                }

                if (internalCallback && observer) {

                  model.$$__observers[callback.$$__observerId] = {
                    callback: internalCallback,
                    scope: this,
                    observer: observer
                  };
                  observer.open(internalCallback);
                } else {
                  if (!utils.isDate(model)) {
                    throw new Error('TypeError: Object.observe cannot observe non-object');
                  }
                }
                return model;
              };

              Object.unobserve = function (model, callback) {
                var observerId = callback.$$__observerId;
                if (model.$$__observers && callback.$$__observerId && model.$$__observers[observerId]) {
                  model.$$__observers[observerId].observer.close();
                }
                return model;
              };
            }
          }

          /**
          ######################### Object.observe END ###################################
          */

          Object.watch = function (obj, path, callback) {

            callback.$$__observerId = callback.$$__observerId || utils.getUID();
            obj.$$__observers = obj.$$__observers || {};

            internalCallback = function () {
              callback.apply(this, [path].slice.call(arguments));
              executeHooks();
            };

            var observer = new PathObserver(obj, path);
            obj.$$__observers[callback.$$__observerId] = {
              callback: internalCallback,
              observer: observer,
              path: path
            };

            observer.open(internalCallback);

            return obj;
          };

          Object.unwatch = function (obj, path, callback) {
            var observerId = callback.$$__observerId;
            if (obj.$$__observers && callback.$$__observerId) {
              var store = obj.$$__observers[observerId];
              if (store && path == store.path) {
                obj.$$__observers[observerId].observer.close();
              }
            }
            return obj;
          };
        })();
      })());
    }
  };
});
System.register("src/core/Collection", ["npm:babel-runtime@5.4.7/core-js/object/create", "npm:babel-runtime@5.4.7/core-js/object/assign", "src/resources/ObjectObserve", "src/databinding/Template", "src/css/Helpers", "src/event/pageReady", "src/css/Class", "src/css/Style", "src/core/Traversing", "src/event/Event", "src/event/Emitter", "src/modules/Logger", "src/core/Manipulation"], function (_export) {
  var _Object$create, _Object$assign, objectobserve, template, cssHelpers, pageready, clazz, style, traversing, events, emitter, Logger, manipulation, Collection;

  return {
    setters: [function (_npmBabelRuntime547CoreJsObjectCreate) {
      _Object$create = _npmBabelRuntime547CoreJsObjectCreate["default"];
    }, function (_npmBabelRuntime547CoreJsObjectAssign) {
      _Object$assign = _npmBabelRuntime547CoreJsObjectAssign["default"];
    }, function (_srcResourcesObjectObserve) {
      objectobserve = _srcResourcesObjectObserve["default"];
    }, function (_srcDatabindingTemplate) {
      template = _srcDatabindingTemplate["default"];
    }, function (_srcCssHelpers) {
      cssHelpers = _srcCssHelpers["default"];
    }, function (_srcEventPageReady) {
      pageready = _srcEventPageReady["default"];
    }, function (_srcCssClass) {
      clazz = _srcCssClass["default"];
    }, function (_srcCssStyle) {
      style = _srcCssStyle["default"];
    }, function (_srcCoreTraversing) {
      traversing = _srcCoreTraversing["default"];
    }, function (_srcEventEvent) {
      events = _srcEventEvent["default"];
    }, function (_srcEventEmitter) {
      emitter = _srcEventEmitter["default"];
    }, function (_srcModulesLogger) {
      Logger = _srcModulesLogger["default"];
    }, function (_srcCoreManipulation) {
      manipulation = _srcCoreManipulation["default"];
    }],
    execute: function () {
      "use strict";

      Collection = function Collection() {
        var collection = _Object$create(Array.prototype);
        collection = Array.apply(collection, arguments) || collection;
        for (var method in Collection.prototype) {
          if (Collection.prototype.hasOwnProperty(method)) {
            collection[method] = Collection.prototype[method];
          }
        }
        return collection;
      };

      /**
      * Return a new Collection from the given array.
      * @param array {Array} The array to be converted into a collection.
      * @return {Collection} The created collection
      */
      Collection.fromArray = function (array) {
        var collection = Collection.apply(null, array);
        return collection;
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
      Collection.create = function (htmlString) {
        var container = document.createElement("div");
        container.innerHTML = htmlString;
        var children = Array.prototype.slice.call(container.childNodes, 0);
        children = children.filter(function (child) {
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
      Collection.addModule = function (module, override) {
        for (var name in module) {
          if ((Collection.prototype[name] !== undefined || Array.prototype[name] !== undefined) && override !== true) {
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
      Collection.addStaticModule = function (module, override) {
        for (var name in module) {
          if (Collection[name] !== undefined && override !== true) {
            Collection[name] = module[name];
          } else {
            Logger.error("Method '" + name + "' already available as static method.");
          }
        }
      };

      _Object$assign(Collection, pageready);
      _Object$assign(Collection.prototype, clazz);
      _Object$assign(Collection.prototype, style);
      _Object$assign(Collection.prototype, traversing);
      _Object$assign(Collection.prototype, events);
      _Object$assign(Collection.prototype, emitter);
      _Object$assign(Collection.prototype, template);
      _Object$assign(Collection.prototype, manipulation);

      _export("default", Collection);
    }
  };
});
System.register('src/polyfill/Object', ['npm:babel-runtime@5.4.7/core-js/object/assign', 'npm:babel-runtime@5.4.7/core-js/object/define-property', 'npm:babel-runtime@5.4.7/core-js/object/keys', 'npm:babel-runtime@5.4.7/core-js/object/get-own-property-descriptor'], function (_export) {
  var _Object$assign, _Object$defineProperty, _Object$keys, _Object$getOwnPropertyDescriptor;

  return {
    setters: [function (_npmBabelRuntime547CoreJsObjectAssign) {
      _Object$assign = _npmBabelRuntime547CoreJsObjectAssign['default'];
    }, function (_npmBabelRuntime547CoreJsObjectDefineProperty) {
      _Object$defineProperty = _npmBabelRuntime547CoreJsObjectDefineProperty['default'];
    }, function (_npmBabelRuntime547CoreJsObjectKeys) {
      _Object$keys = _npmBabelRuntime547CoreJsObjectKeys['default'];
    }, function (_npmBabelRuntime547CoreJsObjectGetOwnPropertyDescriptor) {
      _Object$getOwnPropertyDescriptor = _npmBabelRuntime547CoreJsObjectGetOwnPropertyDescriptor['default'];
    }],
    execute: function () {
      'use strict';

      _export('default', (function () {

        if (!_Object$assign) {

          _Object$defineProperty(Object, 'assign', {
            enumerable: false,
            configurable: true,
            writable: true,
            value: function value(target, firstSource) {
              'use strict';
              if (target === undefined || target === null) {
                throw new TypeError('Cannot convert first argument to object');
              }
              var to = Object(target);
              for (var i = 1; i < arguments.length; i++) {
                var nextSource = arguments[i];
                if (nextSource === undefined || nextSource === null) {
                  continue;
                }
                nextSource = Object(nextSource);

                var keysArray = _Object$keys(Object(nextSource));
                for (var nextIndex = 0, len = keysArray.length; nextIndex < len; nextIndex++) {
                  var nextKey = keysArray[nextIndex];
                  var desc = _Object$getOwnPropertyDescriptor(nextSource, nextKey);
                  if (desc !== undefined && desc.enumerable) {
                    to[nextKey] = nextSource[nextKey];
                  }
                }
              }
              return to;
            }
          });
        }

        return true;
      })());
    }
  };
});
System.register("src/App", ["src/polyfill/Object", "src/polyfill/CustomEvent", "src/polyfill/Promise", "src/core/Collection", "src/databinding/Observable", "src/modules/Router", "src/modules/Http", "src/modules/Logger", "src/HTMLParser/HTMLParser"], function (_export) {
  /**
    Browser support : IE10, Chrome , Firefox
    @version 0.0.1
    @author Romeo Kenfack Tsakem
  */

  // http://casperjs.org/

  "use strict";

  var polyfill, customEvent, promise, Collection, Observable, Router, Http, Logger, HTMLParser;
  return {
    setters: [function (_srcPolyfillObject) {
      polyfill = _srcPolyfillObject["default"];
    }, function (_srcPolyfillCustomEvent) {
      customEvent = _srcPolyfillCustomEvent["default"];
    }, function (_srcPolyfillPromise) {
      promise = _srcPolyfillPromise["default"];
    }, function (_srcCoreCollection) {
      Collection = _srcCoreCollection["default"];
    }, function (_srcDatabindingObservable) {
      Observable = _srcDatabindingObservable["default"];
    }, function (_srcModulesRouter) {
      Router = _srcModulesRouter["default"];
    }, function (_srcModulesHttp) {
      Http = _srcModulesHttp["default"];
    }, function (_srcModulesLogger) {
      Logger = _srcModulesLogger["default"];
    }, function (_srcHTMLParserHTMLParser) {
      HTMLParser = _srcHTMLParserHTMLParser["default"];
    }],
    execute: function () {

      (function (global) {

        var scope = function scope(selector, ctx) {
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

        global.scope = scope;
        global.Observable = Observable;

        global.$ = global.scope;
      })(window);
    }
  };
});
(function() {
  var loader = System;
  var hasOwnProperty = loader.global.hasOwnProperty;
  var moduleGlobals = {};
  var curGlobalObj;
  var ignoredGlobalProps;
  if (typeof indexOf == 'undefined')
    indexOf = Array.prototype.indexOf;
  System.set("@@global-helpers", System.newModule({
    prepareGlobal: function(moduleName, deps) {
      for (var i = 0; i < deps.length; i++) {
        var moduleGlobal = moduleGlobals[deps[i]];
        if (moduleGlobal)
          for (var m in moduleGlobal)
            loader.global[m] = moduleGlobal[m];
      }
      curGlobalObj = {};
      ignoredGlobalProps = ["indexedDB", "sessionStorage", "localStorage", "clipboardData", "frames", "webkitStorageInfo"];
      for (var g in loader.global) {
        if (indexOf.call(ignoredGlobalProps, g) != -1) { continue; }
        if (!hasOwnProperty || loader.global.hasOwnProperty(g)) {
          try {
            curGlobalObj[g] = loader.global[g];
          } catch (e) {
            ignoredGlobalProps.push(g);
          }
        }
      }
    },
    retrieveGlobal: function(moduleName, exportName, init) {
      var singleGlobal;
      var multipleExports;
      var exports = {};
      if (init) {
        var depModules = [];
        for (var i = 0; i < deps.length; i++)
          depModules.push(require(deps[i]));
        singleGlobal = init.apply(loader.global, depModules);
      }
      else if (exportName) {
        var firstPart = exportName.split(".")[0];
        singleGlobal = eval.call(loader.global, exportName);
        exports[firstPart] = loader.global[firstPart];
      }
      else {
        for (var g in loader.global) {
          if (indexOf.call(ignoredGlobalProps, g) != -1)
            continue;
          if ((!hasOwnProperty || loader.global.hasOwnProperty(g)) && g != loader.global && curGlobalObj[g] != loader.global[g]) {
            exports[g] = loader.global[g];
            if (singleGlobal) {
              if (singleGlobal !== loader.global[g])
                multipleExports = true;
            }
            else if (singleGlobal !== false) {
              singleGlobal = loader.global[g];
            }
          }
        }
      }
      moduleGlobals[moduleName] = exports;
      return multipleExports ? exports : singleGlobal;
    }
  }));
})();

});
//# sourceMappingURL=scope.js.map