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

(['test/Test', 'test/run'], function(System) {


System.register("test/run", [], false, function(__require, __exports, __module) {
  System.get("@@global-helpers").prepareGlobal(__module.id, []);
  (function() {
    (function() {
      scope.ready(mocha.run);
    })();
  }).call(System.global);
  return System.get("@@global-helpers").retrieveGlobal(__module.id, false);
});

System.register("npm:assertion-error@1.0.1/index", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  function exclude() {
    var excludes = [].slice.call(arguments);
    function excludeProps(res, obj) {
      Object.keys(obj).forEach(function(key) {
        if (!~excludes.indexOf(key))
          res[key] = obj[key];
      });
    }
    return function extendExclude() {
      var args = [].slice.call(arguments),
          i = 0,
          res = {};
      for (; i < args.length; i++) {
        excludeProps(res, args[i]);
      }
      return res;
    };
  }
  ;
  module.exports = AssertionError;
  function AssertionError(message, _props, ssf) {
    var extend = exclude('name', 'message', 'stack', 'constructor', 'toJSON'),
        props = extend(_props || {});
    this.message = message || 'Unspecified AssertionError';
    this.showDiff = false;
    for (var key in props) {
      this[key] = props[key];
    }
    ssf = ssf || arguments.callee;
    if (ssf && Error.captureStackTrace) {
      Error.captureStackTrace(this, ssf);
    } else {
      this.stack = new Error().stack;
    }
  }
  AssertionError.prototype = Object.create(Error.prototype);
  AssertionError.prototype.name = 'AssertionError';
  AssertionError.prototype.constructor = AssertionError;
  AssertionError.prototype.toJSON = function(stack) {
    var extend = exclude('constructor', 'toJSON', 'stack'),
        props = extend({name: this.name}, this);
    if (false !== stack && this.stack) {
      props.stack = this.stack;
    }
    return props;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/lib/chai/utils/flag", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = function(obj, key, value) {
    var flags = obj.__flags || (obj.__flags = Object.create(null));
    if (arguments.length === 3) {
      flags[key] = value;
    } else {
      return flags[key];
    }
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:type-detect@1.0.0/lib/type", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var exports = module.exports = getType;
  var objectTypeRegexp = /^\[object (.*)\]$/;
  function getType(obj) {
    var type = Object.prototype.toString.call(obj).match(objectTypeRegexp)[1].toLowerCase();
    if (typeof Promise === 'function' && obj instanceof Promise)
      return 'promise';
    if (obj === null)
      return 'null';
    if (obj === undefined)
      return 'undefined';
    return type;
  }
  exports.Library = Library;
  function Library() {
    if (!(this instanceof Library))
      return new Library();
    this.tests = {};
  }
  Library.prototype.of = getType;
  Library.prototype.define = function(type, test) {
    if (arguments.length === 1)
      return this.tests[type];
    this.tests[type] = test;
    return this;
  };
  Library.prototype.test = function(obj, type) {
    if (type === getType(obj))
      return true;
    var test = this.tests[type];
    if (test && 'regexp' === getType(test)) {
      return test.test(obj);
    } else if (test && 'function' === getType(test)) {
      return test(obj);
    } else {
      throw new ReferenceError('Type test "' + type + '" not defined or invalid.');
    }
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/lib/chai/utils/getActual", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = function(obj, args) {
    return args.length > 4 ? args[4] : obj._obj;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/lib/chai/utils/getName", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = function(func) {
    if (func.name)
      return func.name;
    var match = /^\s?function ([^(]*)\(/.exec(func);
    return match && match[1] ? match[1] : "";
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/lib/chai/utils/getProperties", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = function getProperties(object) {
    var result = Object.getOwnPropertyNames(subject);
    function addProperty(property) {
      if (result.indexOf(property) === -1) {
        result.push(property);
      }
    }
    var proto = Object.getPrototypeOf(subject);
    while (proto !== null) {
      Object.getOwnPropertyNames(proto).forEach(addProperty);
      proto = Object.getPrototypeOf(proto);
    }
    return result;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/lib/chai/utils/getEnumerableProperties", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = function getEnumerableProperties(object) {
    var result = [];
    for (var name in object) {
      result.push(name);
    }
    return result;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/lib/chai/config", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    includeStack: false,
    showDiff: true,
    truncateThreshold: 40
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/lib/chai/utils/transferFlags", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = function(assertion, object, includeAll) {
    var flags = assertion.__flags || (assertion.__flags = Object.create(null));
    if (!object.__flags) {
      object.__flags = Object.create(null);
    }
    includeAll = arguments.length === 3 ? includeAll : true;
    for (var flag in flags) {
      if (includeAll || (flag !== 'object' && flag !== 'ssfi' && flag != 'message')) {
        object.__flags[flag] = flags[flag];
      }
    }
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:type-detect@0.1.1/lib/type", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var exports = module.exports = getType;
  var natives = {
    '[object Array]': 'array',
    '[object RegExp]': 'regexp',
    '[object Function]': 'function',
    '[object Arguments]': 'arguments',
    '[object Date]': 'date'
  };
  function getType(obj) {
    var str = Object.prototype.toString.call(obj);
    if (natives[str])
      return natives[str];
    if (obj === null)
      return 'null';
    if (obj === undefined)
      return 'undefined';
    if (obj === Object(obj))
      return 'object';
    return typeof obj;
  }
  exports.Library = Library;
  function Library() {
    this.tests = {};
  }
  Library.prototype.of = getType;
  Library.prototype.define = function(type, test) {
    if (arguments.length === 1)
      return this.tests[type];
    this.tests[type] = test;
    return this;
  };
  Library.prototype.test = function(obj, type) {
    if (type === getType(obj))
      return true;
    var test = this.tests[type];
    if (test && 'regexp' === getType(test)) {
      return test.test(obj);
    } else if (test && 'function' === getType(test)) {
      return test(obj);
    } else {
      throw new ReferenceError('Type test "' + type + '" not defined or invalid.');
    }
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:base64-js@0.0.8/lib/b64", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  ;
  (function(exports) {
    'use strict';
    var Arr = (typeof Uint8Array !== 'undefined') ? Uint8Array : Array;
    var PLUS = '+'.charCodeAt(0);
    var SLASH = '/'.charCodeAt(0);
    var NUMBER = '0'.charCodeAt(0);
    var LOWER = 'a'.charCodeAt(0);
    var UPPER = 'A'.charCodeAt(0);
    var PLUS_URL_SAFE = '-'.charCodeAt(0);
    var SLASH_URL_SAFE = '_'.charCodeAt(0);
    function decode(elt) {
      var code = elt.charCodeAt(0);
      if (code === PLUS || code === PLUS_URL_SAFE)
        return 62;
      if (code === SLASH || code === SLASH_URL_SAFE)
        return 63;
      if (code < NUMBER)
        return -1;
      if (code < NUMBER + 10)
        return code - NUMBER + 26 + 26;
      if (code < UPPER + 26)
        return code - UPPER;
      if (code < LOWER + 26)
        return code - LOWER + 26;
    }
    function b64ToByteArray(b64) {
      var i,
          j,
          l,
          tmp,
          placeHolders,
          arr;
      if (b64.length % 4 > 0) {
        throw new Error('Invalid string. Length must be a multiple of 4');
      }
      var len = b64.length;
      placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0;
      arr = new Arr(b64.length * 3 / 4 - placeHolders);
      l = placeHolders > 0 ? b64.length - 4 : b64.length;
      var L = 0;
      function push(v) {
        arr[L++] = v;
      }
      for (i = 0, j = 0; i < l; i += 4, j += 3) {
        tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3));
        push((tmp & 0xFF0000) >> 16);
        push((tmp & 0xFF00) >> 8);
        push(tmp & 0xFF);
      }
      if (placeHolders === 2) {
        tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4);
        push(tmp & 0xFF);
      } else if (placeHolders === 1) {
        tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2);
        push((tmp >> 8) & 0xFF);
        push(tmp & 0xFF);
      }
      return arr;
    }
    function uint8ToBase64(uint8) {
      var i,
          extraBytes = uint8.length % 3,
          output = "",
          temp,
          length;
      function encode(num) {
        return lookup.charAt(num);
      }
      function tripletToBase64(num) {
        return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F);
      }
      for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
        temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2]);
        output += tripletToBase64(temp);
      }
      switch (extraBytes) {
        case 1:
          temp = uint8[uint8.length - 1];
          output += encode(temp >> 2);
          output += encode((temp << 4) & 0x3F);
          output += '==';
          break;
        case 2:
          temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1]);
          output += encode(temp >> 10);
          output += encode((temp >> 4) & 0x3F);
          output += encode((temp << 2) & 0x3F);
          output += '=';
          break;
      }
      return output;
    }
    exports.toByteArray = b64ToByteArray;
    exports.fromByteArray = uint8ToBase64;
  }(typeof exports === 'undefined' ? (this.base64js = {}) : exports));
  global.define = __define;
  return module.exports;
});

System.register("npm:ieee754@1.1.6/index", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  exports.read = function(buffer, offset, isLE, mLen, nBytes) {
    var e,
        m;
    var eLen = nBytes * 8 - mLen - 1;
    var eMax = (1 << eLen) - 1;
    var eBias = eMax >> 1;
    var nBits = -7;
    var i = isLE ? (nBytes - 1) : 0;
    var d = isLE ? -1 : 1;
    var s = buffer[offset + i];
    i += d;
    e = s & ((1 << (-nBits)) - 1);
    s >>= (-nBits);
    nBits += eLen;
    for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}
    m = e & ((1 << (-nBits)) - 1);
    e >>= (-nBits);
    nBits += mLen;
    for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}
    if (e === 0) {
      e = 1 - eBias;
    } else if (e === eMax) {
      return m ? NaN : ((s ? -1 : 1) * Infinity);
    } else {
      m = m + Math.pow(2, mLen);
      e = e - eBias;
    }
    return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
  };
  exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
    var e,
        m,
        c;
    var eLen = nBytes * 8 - mLen - 1;
    var eMax = (1 << eLen) - 1;
    var eBias = eMax >> 1;
    var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0);
    var i = isLE ? 0 : (nBytes - 1);
    var d = isLE ? 1 : -1;
    var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;
    value = Math.abs(value);
    if (isNaN(value) || value === Infinity) {
      m = isNaN(value) ? 1 : 0;
      e = eMax;
    } else {
      e = Math.floor(Math.log(value) / Math.LN2);
      if (value * (c = Math.pow(2, -e)) < 1) {
        e--;
        c *= 2;
      }
      if (e + eBias >= 1) {
        value += rt / c;
      } else {
        value += rt * Math.pow(2, 1 - eBias);
      }
      if (value * c >= 2) {
        e++;
        c /= 2;
      }
      if (e + eBias >= eMax) {
        m = 0;
        e = eMax;
      } else if (e + eBias >= 1) {
        m = (value * c - 1) * Math.pow(2, mLen);
        e = e + eBias;
      } else {
        m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
        e = 0;
      }
    }
    for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}
    e = (e << mLen) | m;
    eLen += mLen;
    for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}
    buffer[offset + i - d] |= s * 128;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:is-array@1.0.1/index", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var isArray = Array.isArray;
  var str = Object.prototype.toString;
  module.exports = isArray || function(val) {
    return !!val && '[object Array]' == str.call(val);
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/lib/chai/utils/hasProperty", ["npm:type-detect@1.0.0"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var type = require("npm:type-detect@1.0.0");
  var literals = {
    'number': Number,
    'string': String
  };
  module.exports = function hasProperty(name, obj) {
    var ot = type(obj);
    if (ot === 'null' || ot === 'undefined')
      return false;
    if (literals[ot] && typeof obj !== 'object')
      obj = new literals[ot](obj);
    return name in obj;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/lib/chai/utils/addProperty", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = function(ctx, name, getter) {
    Object.defineProperty(ctx, name, {
      get: function() {
        var result = getter.call(this);
        return result === undefined ? this : result;
      },
      configurable: true
    });
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/lib/chai/utils/addMethod", ["npm:chai@3.0.0/lib/chai/config", "npm:chai@3.0.0/lib/chai/utils/flag"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var config = require("npm:chai@3.0.0/lib/chai/config");
  var flag = require("npm:chai@3.0.0/lib/chai/utils/flag");
  module.exports = function(ctx, name, method) {
    ctx[name] = function() {
      var old_ssfi = flag(this, 'ssfi');
      if (old_ssfi && config.includeStack === false)
        flag(this, 'ssfi', ctx[name]);
      var result = method.apply(this, arguments);
      return result === undefined ? this : result;
    };
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/lib/chai/utils/overwriteProperty", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = function(ctx, name, getter) {
    var _get = Object.getOwnPropertyDescriptor(ctx, name),
        _super = function() {};
    if (_get && 'function' === typeof _get.get)
      _super = _get.get;
    Object.defineProperty(ctx, name, {
      get: function() {
        var result = getter(_super).call(this);
        return result === undefined ? this : result;
      },
      configurable: true
    });
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/lib/chai/utils/overwriteMethod", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = function(ctx, name, method) {
    var _method = ctx[name],
        _super = function() {
          return this;
        };
    if (_method && 'function' === typeof _method)
      _super = _method;
    ctx[name] = function() {
      var result = method(_super).apply(this, arguments);
      return result === undefined ? this : result;
    };
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/lib/chai/utils/addChainableMethod", ["npm:chai@3.0.0/lib/chai/utils/transferFlags", "npm:chai@3.0.0/lib/chai/utils/flag", "npm:chai@3.0.0/lib/chai/config"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var transferFlags = require("npm:chai@3.0.0/lib/chai/utils/transferFlags");
  var flag = require("npm:chai@3.0.0/lib/chai/utils/flag");
  var config = require("npm:chai@3.0.0/lib/chai/config");
  var hasProtoSupport = '__proto__' in Object;
  var excludeNames = /^(?:length|name|arguments|caller)$/;
  var call = Function.prototype.call,
      apply = Function.prototype.apply;
  module.exports = function(ctx, name, method, chainingBehavior) {
    if (typeof chainingBehavior !== 'function') {
      chainingBehavior = function() {};
    }
    var chainableBehavior = {
      method: method,
      chainingBehavior: chainingBehavior
    };
    if (!ctx.__methods) {
      ctx.__methods = {};
    }
    ctx.__methods[name] = chainableBehavior;
    Object.defineProperty(ctx, name, {
      get: function() {
        chainableBehavior.chainingBehavior.call(this);
        var assert = function assert() {
          var old_ssfi = flag(this, 'ssfi');
          if (old_ssfi && config.includeStack === false)
            flag(this, 'ssfi', assert);
          var result = chainableBehavior.method.apply(this, arguments);
          return result === undefined ? this : result;
        };
        if (hasProtoSupport) {
          var prototype = assert.__proto__ = Object.create(this);
          prototype.call = call;
          prototype.apply = apply;
        } else {
          var asserterNames = Object.getOwnPropertyNames(ctx);
          asserterNames.forEach(function(asserterName) {
            if (!excludeNames.test(asserterName)) {
              var pd = Object.getOwnPropertyDescriptor(ctx, asserterName);
              Object.defineProperty(assert, asserterName, pd);
            }
          });
        }
        transferFlags(this, assert);
        return assert;
      },
      configurable: true
    });
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/lib/chai/utils/overwriteChainableMethod", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = function(ctx, name, method, chainingBehavior) {
    var chainableBehavior = ctx.__methods[name];
    var _chainingBehavior = chainableBehavior.chainingBehavior;
    chainableBehavior.chainingBehavior = function() {
      var result = chainingBehavior(_chainingBehavior).call(this);
      return result === undefined ? this : result;
    };
    var _method = chainableBehavior.method;
    chainableBehavior.method = function() {
      var result = method(_method).apply(this, arguments);
      return result === undefined ? this : result;
    };
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/lib/chai/assertion", ["npm:chai@3.0.0/lib/chai/config"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var config = require("npm:chai@3.0.0/lib/chai/config");
  module.exports = function(_chai, util) {
    var AssertionError = _chai.AssertionError,
        flag = util.flag;
    _chai.Assertion = Assertion;
    function Assertion(obj, msg, stack) {
      flag(this, 'ssfi', stack || arguments.callee);
      flag(this, 'object', obj);
      flag(this, 'message', msg);
    }
    Object.defineProperty(Assertion, 'includeStack', {
      get: function() {
        console.warn('Assertion.includeStack is deprecated, use chai.config.includeStack instead.');
        return config.includeStack;
      },
      set: function(value) {
        console.warn('Assertion.includeStack is deprecated, use chai.config.includeStack instead.');
        config.includeStack = value;
      }
    });
    Object.defineProperty(Assertion, 'showDiff', {
      get: function() {
        console.warn('Assertion.showDiff is deprecated, use chai.config.showDiff instead.');
        return config.showDiff;
      },
      set: function(value) {
        console.warn('Assertion.showDiff is deprecated, use chai.config.showDiff instead.');
        config.showDiff = value;
      }
    });
    Assertion.addProperty = function(name, fn) {
      util.addProperty(this.prototype, name, fn);
    };
    Assertion.addMethod = function(name, fn) {
      util.addMethod(this.prototype, name, fn);
    };
    Assertion.addChainableMethod = function(name, fn, chainingBehavior) {
      util.addChainableMethod(this.prototype, name, fn, chainingBehavior);
    };
    Assertion.overwriteProperty = function(name, fn) {
      util.overwriteProperty(this.prototype, name, fn);
    };
    Assertion.overwriteMethod = function(name, fn) {
      util.overwriteMethod(this.prototype, name, fn);
    };
    Assertion.overwriteChainableMethod = function(name, fn, chainingBehavior) {
      util.overwriteChainableMethod(this.prototype, name, fn, chainingBehavior);
    };
    Assertion.prototype.assert = function(expr, msg, negateMsg, expected, _actual, showDiff) {
      var ok = util.test(this, arguments);
      if (true !== showDiff)
        showDiff = false;
      if (true !== config.showDiff)
        showDiff = false;
      if (!ok) {
        var msg = util.getMessage(this, arguments),
            actual = util.getActual(this, arguments);
        throw new AssertionError(msg, {
          actual: actual,
          expected: expected,
          showDiff: showDiff
        }, (config.includeStack) ? this.assert : flag(this, 'ssfi'));
      }
    };
    Object.defineProperty(Assertion.prototype, '_obj', {
      get: function() {
        return flag(this, 'object');
      },
      set: function(val) {
        flag(this, 'object', val);
      }
    });
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/lib/chai/core/assertions", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = function(chai, _) {
    var Assertion = chai.Assertion,
        toString = Object.prototype.toString,
        flag = _.flag;
    ['to', 'be', 'been', 'is', 'and', 'has', 'have', 'with', 'that', 'which', 'at', 'of', 'same'].forEach(function(chain) {
      Assertion.addProperty(chain, function() {
        return this;
      });
    });
    Assertion.addProperty('not', function() {
      flag(this, 'negate', true);
    });
    Assertion.addProperty('deep', function() {
      flag(this, 'deep', true);
    });
    Assertion.addProperty('any', function() {
      flag(this, 'any', true);
      flag(this, 'all', false);
    });
    Assertion.addProperty('all', function() {
      flag(this, 'all', true);
      flag(this, 'any', false);
    });
    function an(type, msg) {
      if (msg)
        flag(this, 'message', msg);
      type = type.toLowerCase();
      var obj = flag(this, 'object'),
          article = ~['a', 'e', 'i', 'o', 'u'].indexOf(type.charAt(0)) ? 'an ' : 'a ';
      this.assert(type === _.type(obj), 'expected #{this} to be ' + article + type, 'expected #{this} not to be ' + article + type);
    }
    Assertion.addChainableMethod('an', an);
    Assertion.addChainableMethod('a', an);
    function includeChainingBehavior() {
      flag(this, 'contains', true);
    }
    function include(val, msg) {
      if (msg)
        flag(this, 'message', msg);
      var obj = flag(this, 'object');
      var expected = false;
      if (_.type(obj) === 'array' && _.type(val) === 'object') {
        for (var i in obj) {
          if (_.eql(obj[i], val)) {
            expected = true;
            break;
          }
        }
      } else if (_.type(val) === 'object') {
        if (!flag(this, 'negate')) {
          for (var k in val)
            new Assertion(obj).property(k, val[k]);
          return ;
        }
        var subset = {};
        for (var k in val)
          subset[k] = obj[k];
        expected = _.eql(subset, val);
      } else {
        expected = obj && ~obj.indexOf(val);
      }
      this.assert(expected, 'expected #{this} to include ' + _.inspect(val), 'expected #{this} to not include ' + _.inspect(val));
    }
    Assertion.addChainableMethod('include', include, includeChainingBehavior);
    Assertion.addChainableMethod('contain', include, includeChainingBehavior);
    Assertion.addChainableMethod('contains', include, includeChainingBehavior);
    Assertion.addChainableMethod('includes', include, includeChainingBehavior);
    Assertion.addProperty('ok', function() {
      this.assert(flag(this, 'object'), 'expected #{this} to be truthy', 'expected #{this} to be falsy');
    });
    Assertion.addProperty('true', function() {
      this.assert(true === flag(this, 'object'), 'expected #{this} to be true', 'expected #{this} to be false', this.negate ? false : true);
    });
    Assertion.addProperty('false', function() {
      this.assert(false === flag(this, 'object'), 'expected #{this} to be false', 'expected #{this} to be true', this.negate ? true : false);
    });
    Assertion.addProperty('null', function() {
      this.assert(null === flag(this, 'object'), 'expected #{this} to be null', 'expected #{this} not to be null');
    });
    Assertion.addProperty('undefined', function() {
      this.assert(undefined === flag(this, 'object'), 'expected #{this} to be undefined', 'expected #{this} not to be undefined');
    });
    Assertion.addProperty('exist', function() {
      this.assert(null != flag(this, 'object'), 'expected #{this} to exist', 'expected #{this} to not exist');
    });
    Assertion.addProperty('empty', function() {
      var obj = flag(this, 'object'),
          expected = obj;
      if (Array.isArray(obj) || 'string' === typeof object) {
        expected = obj.length;
      } else if (typeof obj === 'object') {
        expected = Object.keys(obj).length;
      }
      this.assert(!expected, 'expected #{this} to be empty', 'expected #{this} not to be empty');
    });
    function checkArguments() {
      var obj = flag(this, 'object'),
          type = Object.prototype.toString.call(obj);
      this.assert('[object Arguments]' === type, 'expected #{this} to be arguments but got ' + type, 'expected #{this} to not be arguments');
    }
    Assertion.addProperty('arguments', checkArguments);
    Assertion.addProperty('Arguments', checkArguments);
    function assertEqual(val, msg) {
      if (msg)
        flag(this, 'message', msg);
      var obj = flag(this, 'object');
      if (flag(this, 'deep')) {
        return this.eql(val);
      } else {
        this.assert(val === obj, 'expected #{this} to equal #{exp}', 'expected #{this} to not equal #{exp}', val, this._obj, true);
      }
    }
    Assertion.addMethod('equal', assertEqual);
    Assertion.addMethod('equals', assertEqual);
    Assertion.addMethod('eq', assertEqual);
    function assertEql(obj, msg) {
      if (msg)
        flag(this, 'message', msg);
      this.assert(_.eql(obj, flag(this, 'object')), 'expected #{this} to deeply equal #{exp}', 'expected #{this} to not deeply equal #{exp}', obj, this._obj, true);
    }
    Assertion.addMethod('eql', assertEql);
    Assertion.addMethod('eqls', assertEql);
    function assertAbove(n, msg) {
      if (msg)
        flag(this, 'message', msg);
      var obj = flag(this, 'object');
      if (flag(this, 'doLength')) {
        new Assertion(obj, msg).to.have.property('length');
        var len = obj.length;
        this.assert(len > n, 'expected #{this} to have a length above #{exp} but got #{act}', 'expected #{this} to not have a length above #{exp}', n, len);
      } else {
        this.assert(obj > n, 'expected #{this} to be above ' + n, 'expected #{this} to be at most ' + n);
      }
    }
    Assertion.addMethod('above', assertAbove);
    Assertion.addMethod('gt', assertAbove);
    Assertion.addMethod('greaterThan', assertAbove);
    function assertLeast(n, msg) {
      if (msg)
        flag(this, 'message', msg);
      var obj = flag(this, 'object');
      if (flag(this, 'doLength')) {
        new Assertion(obj, msg).to.have.property('length');
        var len = obj.length;
        this.assert(len >= n, 'expected #{this} to have a length at least #{exp} but got #{act}', 'expected #{this} to have a length below #{exp}', n, len);
      } else {
        this.assert(obj >= n, 'expected #{this} to be at least ' + n, 'expected #{this} to be below ' + n);
      }
    }
    Assertion.addMethod('least', assertLeast);
    Assertion.addMethod('gte', assertLeast);
    function assertBelow(n, msg) {
      if (msg)
        flag(this, 'message', msg);
      var obj = flag(this, 'object');
      if (flag(this, 'doLength')) {
        new Assertion(obj, msg).to.have.property('length');
        var len = obj.length;
        this.assert(len < n, 'expected #{this} to have a length below #{exp} but got #{act}', 'expected #{this} to not have a length below #{exp}', n, len);
      } else {
        this.assert(obj < n, 'expected #{this} to be below ' + n, 'expected #{this} to be at least ' + n);
      }
    }
    Assertion.addMethod('below', assertBelow);
    Assertion.addMethod('lt', assertBelow);
    Assertion.addMethod('lessThan', assertBelow);
    function assertMost(n, msg) {
      if (msg)
        flag(this, 'message', msg);
      var obj = flag(this, 'object');
      if (flag(this, 'doLength')) {
        new Assertion(obj, msg).to.have.property('length');
        var len = obj.length;
        this.assert(len <= n, 'expected #{this} to have a length at most #{exp} but got #{act}', 'expected #{this} to have a length above #{exp}', n, len);
      } else {
        this.assert(obj <= n, 'expected #{this} to be at most ' + n, 'expected #{this} to be above ' + n);
      }
    }
    Assertion.addMethod('most', assertMost);
    Assertion.addMethod('lte', assertMost);
    Assertion.addMethod('within', function(start, finish, msg) {
      if (msg)
        flag(this, 'message', msg);
      var obj = flag(this, 'object'),
          range = start + '..' + finish;
      if (flag(this, 'doLength')) {
        new Assertion(obj, msg).to.have.property('length');
        var len = obj.length;
        this.assert(len >= start && len <= finish, 'expected #{this} to have a length within ' + range, 'expected #{this} to not have a length within ' + range);
      } else {
        this.assert(obj >= start && obj <= finish, 'expected #{this} to be within ' + range, 'expected #{this} to not be within ' + range);
      }
    });
    function assertInstanceOf(constructor, msg) {
      if (msg)
        flag(this, 'message', msg);
      var name = _.getName(constructor);
      this.assert(flag(this, 'object') instanceof constructor, 'expected #{this} to be an instance of ' + name, 'expected #{this} to not be an instance of ' + name);
    }
    ;
    Assertion.addMethod('instanceof', assertInstanceOf);
    Assertion.addMethod('instanceOf', assertInstanceOf);
    Assertion.addMethod('property', function(name, val, msg) {
      if (msg)
        flag(this, 'message', msg);
      var isDeep = !!flag(this, 'deep'),
          descriptor = isDeep ? 'deep property ' : 'property ',
          negate = flag(this, 'negate'),
          obj = flag(this, 'object'),
          pathInfo = isDeep ? _.getPathInfo(name, obj) : null,
          hasProperty = isDeep ? pathInfo.exists : _.hasProperty(name, obj),
          value = isDeep ? pathInfo.value : obj[name];
      if (negate && arguments.length > 1) {
        if (undefined === value) {
          msg = (msg != null) ? msg + ': ' : '';
          throw new Error(msg + _.inspect(obj) + ' has no ' + descriptor + _.inspect(name));
        }
      } else {
        this.assert(hasProperty, 'expected #{this} to have a ' + descriptor + _.inspect(name), 'expected #{this} to not have ' + descriptor + _.inspect(name));
      }
      if (arguments.length > 1) {
        this.assert(val === value, 'expected #{this} to have a ' + descriptor + _.inspect(name) + ' of #{exp}, but got #{act}', 'expected #{this} to not have a ' + descriptor + _.inspect(name) + ' of #{act}', val, value);
      }
      flag(this, 'object', value);
    });
    function assertOwnProperty(name, msg) {
      if (msg)
        flag(this, 'message', msg);
      var obj = flag(this, 'object');
      this.assert(obj.hasOwnProperty(name), 'expected #{this} to have own property ' + _.inspect(name), 'expected #{this} to not have own property ' + _.inspect(name));
    }
    Assertion.addMethod('ownProperty', assertOwnProperty);
    Assertion.addMethod('haveOwnProperty', assertOwnProperty);
    function assertOwnPropertyDescriptor(name, descriptor, msg) {
      if (typeof descriptor === 'string') {
        msg = descriptor;
        descriptor = null;
      }
      if (msg)
        flag(this, 'message', msg);
      var obj = flag(this, 'object');
      var actualDescriptor = Object.getOwnPropertyDescriptor(Object(obj), name);
      if (actualDescriptor && descriptor) {
        this.assert(_.eql(descriptor, actualDescriptor), 'expected the own property descriptor for ' + _.inspect(name) + ' on #{this} to match ' + _.inspect(descriptor) + ', got ' + _.inspect(actualDescriptor), 'expected the own property descriptor for ' + _.inspect(name) + ' on #{this} to not match ' + _.inspect(descriptor), descriptor, actualDescriptor, true);
      } else {
        this.assert(actualDescriptor, 'expected #{this} to have an own property descriptor for ' + _.inspect(name), 'expected #{this} to not have an own property descriptor for ' + _.inspect(name));
      }
      flag(this, 'object', actualDescriptor);
    }
    Assertion.addMethod('ownPropertyDescriptor', assertOwnPropertyDescriptor);
    Assertion.addMethod('haveOwnPropertyDescriptor', assertOwnPropertyDescriptor);
    function assertLengthChain() {
      flag(this, 'doLength', true);
    }
    function assertLength(n, msg) {
      if (msg)
        flag(this, 'message', msg);
      var obj = flag(this, 'object');
      new Assertion(obj, msg).to.have.property('length');
      var len = obj.length;
      this.assert(len == n, 'expected #{this} to have a length of #{exp} but got #{act}', 'expected #{this} to not have a length of #{act}', n, len);
    }
    Assertion.addChainableMethod('length', assertLength, assertLengthChain);
    Assertion.addMethod('lengthOf', assertLength);
    function assertMatch(re, msg) {
      if (msg)
        flag(this, 'message', msg);
      var obj = flag(this, 'object');
      this.assert(re.exec(obj), 'expected #{this} to match ' + re, 'expected #{this} not to match ' + re);
    }
    Assertion.addMethod('match', assertMatch);
    Assertion.addMethod('matches', assertMatch);
    Assertion.addMethod('string', function(str, msg) {
      if (msg)
        flag(this, 'message', msg);
      var obj = flag(this, 'object');
      new Assertion(obj, msg).is.a('string');
      this.assert(~obj.indexOf(str), 'expected #{this} to contain ' + _.inspect(str), 'expected #{this} to not contain ' + _.inspect(str));
    });
    function assertKeys(keys) {
      var obj = flag(this, 'object'),
          str,
          ok = true,
          mixedArgsMsg = 'keys must be given single argument of Array|Object|String, or multiple String arguments';
      switch (_.type(keys)) {
        case "array":
          if (arguments.length > 1)
            throw (new Error(mixedArgsMsg));
          break;
        case "object":
          if (arguments.length > 1)
            throw (new Error(mixedArgsMsg));
          keys = Object.keys(keys);
          break;
        default:
          keys = Array.prototype.slice.call(arguments);
      }
      if (!keys.length)
        throw new Error('keys required');
      var actual = Object.keys(obj),
          expected = keys,
          len = keys.length,
          any = flag(this, 'any'),
          all = flag(this, 'all');
      if (!any && !all) {
        all = true;
      }
      if (any) {
        var intersection = expected.filter(function(key) {
          return ~actual.indexOf(key);
        });
        ok = intersection.length > 0;
      }
      if (all) {
        ok = keys.every(function(key) {
          return ~actual.indexOf(key);
        });
        if (!flag(this, 'negate') && !flag(this, 'contains')) {
          ok = ok && keys.length == actual.length;
        }
      }
      if (len > 1) {
        keys = keys.map(function(key) {
          return _.inspect(key);
        });
        var last = keys.pop();
        if (all) {
          str = keys.join(', ') + ', and ' + last;
        }
        if (any) {
          str = keys.join(', ') + ', or ' + last;
        }
      } else {
        str = _.inspect(keys[0]);
      }
      str = (len > 1 ? 'keys ' : 'key ') + str;
      str = (flag(this, 'contains') ? 'contain ' : 'have ') + str;
      this.assert(ok, 'expected #{this} to ' + str, 'expected #{this} to not ' + str, expected.slice(0).sort(), actual.sort(), true);
    }
    Assertion.addMethod('keys', assertKeys);
    Assertion.addMethod('key', assertKeys);
    function assertThrows(constructor, errMsg, msg) {
      if (msg)
        flag(this, 'message', msg);
      var obj = flag(this, 'object');
      new Assertion(obj, msg).is.a('function');
      var thrown = false,
          desiredError = null,
          name = null,
          thrownError = null;
      if (arguments.length === 0) {
        errMsg = null;
        constructor = null;
      } else if (constructor && (constructor instanceof RegExp || 'string' === typeof constructor)) {
        errMsg = constructor;
        constructor = null;
      } else if (constructor && constructor instanceof Error) {
        desiredError = constructor;
        constructor = null;
        errMsg = null;
      } else if (typeof constructor === 'function') {
        name = constructor.prototype.name || constructor.name;
        if (name === 'Error' && constructor !== Error) {
          name = (new constructor()).name;
        }
      } else {
        constructor = null;
      }
      try {
        obj();
      } catch (err) {
        if (desiredError) {
          this.assert(err === desiredError, 'expected #{this} to throw #{exp} but #{act} was thrown', 'expected #{this} to not throw #{exp}', (desiredError instanceof Error ? desiredError.toString() : desiredError), (err instanceof Error ? err.toString() : err));
          flag(this, 'object', err);
          return this;
        }
        if (constructor) {
          this.assert(err instanceof constructor, 'expected #{this} to throw #{exp} but #{act} was thrown', 'expected #{this} to not throw #{exp} but #{act} was thrown', name, (err instanceof Error ? err.toString() : err));
          if (!errMsg) {
            flag(this, 'object', err);
            return this;
          }
        }
        var message = 'error' === _.type(err) && "message" in err ? err.message : '' + err;
        if ((message != null) && errMsg && errMsg instanceof RegExp) {
          this.assert(errMsg.exec(message), 'expected #{this} to throw error matching #{exp} but got #{act}', 'expected #{this} to throw error not matching #{exp}', errMsg, message);
          flag(this, 'object', err);
          return this;
        } else if ((message != null) && errMsg && 'string' === typeof errMsg) {
          this.assert(~message.indexOf(errMsg), 'expected #{this} to throw error including #{exp} but got #{act}', 'expected #{this} to throw error not including #{act}', errMsg, message);
          flag(this, 'object', err);
          return this;
        } else {
          thrown = true;
          thrownError = err;
        }
      }
      var actuallyGot = '',
          expectedThrown = name !== null ? name : desiredError ? '#{exp}' : 'an error';
      if (thrown) {
        actuallyGot = ' but #{act} was thrown';
      }
      this.assert(thrown === true, 'expected #{this} to throw ' + expectedThrown + actuallyGot, 'expected #{this} to not throw ' + expectedThrown + actuallyGot, (desiredError instanceof Error ? desiredError.toString() : desiredError), (thrownError instanceof Error ? thrownError.toString() : thrownError));
      flag(this, 'object', thrownError);
    }
    ;
    Assertion.addMethod('throw', assertThrows);
    Assertion.addMethod('throws', assertThrows);
    Assertion.addMethod('Throw', assertThrows);
    Assertion.addMethod('respondTo', function(method, msg) {
      if (msg)
        flag(this, 'message', msg);
      var obj = flag(this, 'object'),
          itself = flag(this, 'itself'),
          context = ('function' === _.type(obj) && !itself) ? obj.prototype[method] : obj[method];
      this.assert('function' === typeof context, 'expected #{this} to respond to ' + _.inspect(method), 'expected #{this} to not respond to ' + _.inspect(method));
    });
    Assertion.addProperty('itself', function() {
      flag(this, 'itself', true);
    });
    Assertion.addMethod('satisfy', function(matcher, msg) {
      if (msg)
        flag(this, 'message', msg);
      var obj = flag(this, 'object');
      var result = matcher(obj);
      this.assert(result, 'expected #{this} to satisfy ' + _.objDisplay(matcher), 'expected #{this} to not satisfy' + _.objDisplay(matcher), this.negate ? false : true, result);
    });
    Assertion.addMethod('closeTo', function(expected, delta, msg) {
      if (msg)
        flag(this, 'message', msg);
      var obj = flag(this, 'object');
      new Assertion(obj, msg).is.a('number');
      if (_.type(expected) !== 'number' || _.type(delta) !== 'number') {
        throw new Error('the arguments to closeTo must be numbers');
      }
      this.assert(Math.abs(obj - expected) <= delta, 'expected #{this} to be close to ' + expected + ' +/- ' + delta, 'expected #{this} not to be close to ' + expected + ' +/- ' + delta);
    });
    function isSubsetOf(subset, superset, cmp) {
      return subset.every(function(elem) {
        if (!cmp)
          return superset.indexOf(elem) !== -1;
        return superset.some(function(elem2) {
          return cmp(elem, elem2);
        });
      });
    }
    Assertion.addMethod('members', function(subset, msg) {
      if (msg)
        flag(this, 'message', msg);
      var obj = flag(this, 'object');
      new Assertion(obj).to.be.an('array');
      new Assertion(subset).to.be.an('array');
      var cmp = flag(this, 'deep') ? _.eql : undefined;
      if (flag(this, 'contains')) {
        return this.assert(isSubsetOf(subset, obj, cmp), 'expected #{this} to be a superset of #{act}', 'expected #{this} to not be a superset of #{act}', obj, subset);
      }
      this.assert(isSubsetOf(obj, subset, cmp) && isSubsetOf(subset, obj, cmp), 'expected #{this} to have the same members as #{act}', 'expected #{this} to not have the same members as #{act}', obj, subset);
    });
    function assertChanges(object, prop, msg) {
      if (msg)
        flag(this, 'message', msg);
      var fn = flag(this, 'object');
      new Assertion(object, msg).to.have.property(prop);
      new Assertion(fn).is.a('function');
      var initial = object[prop];
      fn();
      this.assert(initial !== object[prop], 'expected .' + prop + ' to change', 'expected .' + prop + ' to not change');
    }
    Assertion.addChainableMethod('change', assertChanges);
    Assertion.addChainableMethod('changes', assertChanges);
    function assertIncreases(object, prop, msg) {
      if (msg)
        flag(this, 'message', msg);
      var fn = flag(this, 'object');
      new Assertion(object, msg).to.have.property(prop);
      new Assertion(fn).is.a('function');
      var initial = object[prop];
      fn();
      this.assert(object[prop] - initial > 0, 'expected .' + prop + ' to increase', 'expected .' + prop + ' to not increase');
    }
    Assertion.addChainableMethod('increase', assertIncreases);
    Assertion.addChainableMethod('increases', assertIncreases);
    function assertDecreases(object, prop, msg) {
      if (msg)
        flag(this, 'message', msg);
      var fn = flag(this, 'object');
      new Assertion(object, msg).to.have.property(prop);
      new Assertion(fn).is.a('function');
      var initial = object[prop];
      fn();
      this.assert(object[prop] - initial < 0, 'expected .' + prop + ' to decrease', 'expected .' + prop + ' to not decrease');
    }
    Assertion.addChainableMethod('decrease', assertDecreases);
    Assertion.addChainableMethod('decreases', assertDecreases);
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/lib/chai/interface/expect", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = function(chai, util) {
    chai.expect = function(val, message) {
      return new chai.Assertion(val, message);
    };
    chai.expect.fail = function(actual, expected, message, operator) {
      message = message || 'expect.fail()';
      throw new chai.AssertionError(message, {
        actual: actual,
        expected: expected,
        operator: operator
      }, chai.expect.fail);
    };
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/lib/chai/interface/should", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = function(chai, util) {
    var Assertion = chai.Assertion;
    function loadShould() {
      function shouldGetter() {
        if (this instanceof String || this instanceof Number || this instanceof Boolean) {
          return new Assertion(this.valueOf(), null, shouldGetter);
        }
        return new Assertion(this, null, shouldGetter);
      }
      function shouldSetter(value) {
        Object.defineProperty(this, 'should', {
          value: value,
          enumerable: true,
          configurable: true,
          writable: true
        });
      }
      Object.defineProperty(Object.prototype, 'should', {
        set: shouldSetter,
        get: shouldGetter,
        configurable: true
      });
      var should = {};
      should.fail = function(actual, expected, message, operator) {
        message = message || 'should.fail()';
        throw new chai.AssertionError(message, {
          actual: actual,
          expected: expected,
          operator: operator
        }, should.fail);
      };
      should.equal = function(val1, val2, msg) {
        new Assertion(val1, msg).to.equal(val2);
      };
      should.Throw = function(fn, errt, errs, msg) {
        new Assertion(fn, msg).to.Throw(errt, errs);
      };
      should.exist = function(val, msg) {
        new Assertion(val, msg).to.exist;
      };
      should.not = {};
      should.not.equal = function(val1, val2, msg) {
        new Assertion(val1, msg).to.not.equal(val2);
      };
      should.not.Throw = function(fn, errt, errs, msg) {
        new Assertion(fn, msg).to.not.Throw(errt, errs);
      };
      should.not.exist = function(val, msg) {
        new Assertion(val, msg).to.not.exist;
      };
      should['throw'] = should['Throw'];
      should.not['throw'] = should.not['Throw'];
      return should;
    }
    ;
    chai.should = loadShould;
    chai.Should = loadShould;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/lib/chai/interface/assert", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = function(chai, util) {
    var Assertion = chai.Assertion,
        flag = util.flag;
    var assert = chai.assert = function(express, errmsg) {
      var test = new Assertion(null, null, chai.assert);
      test.assert(express, errmsg, '[ negation message unavailable ]');
    };
    assert.fail = function(actual, expected, message, operator) {
      message = message || 'assert.fail()';
      throw new chai.AssertionError(message, {
        actual: actual,
        expected: expected,
        operator: operator
      }, assert.fail);
    };
    assert.ok = function(val, msg) {
      new Assertion(val, msg).is.ok;
    };
    assert.notOk = function(val, msg) {
      new Assertion(val, msg).is.not.ok;
    };
    assert.equal = function(act, exp, msg) {
      var test = new Assertion(act, msg, assert.equal);
      test.assert(exp == flag(test, 'object'), 'expected #{this} to equal #{exp}', 'expected #{this} to not equal #{act}', exp, act);
    };
    assert.notEqual = function(act, exp, msg) {
      var test = new Assertion(act, msg, assert.notEqual);
      test.assert(exp != flag(test, 'object'), 'expected #{this} to not equal #{exp}', 'expected #{this} to equal #{act}', exp, act);
    };
    assert.strictEqual = function(act, exp, msg) {
      new Assertion(act, msg).to.equal(exp);
    };
    assert.notStrictEqual = function(act, exp, msg) {
      new Assertion(act, msg).to.not.equal(exp);
    };
    assert.deepEqual = function(act, exp, msg) {
      new Assertion(act, msg).to.eql(exp);
    };
    assert.notDeepEqual = function(act, exp, msg) {
      new Assertion(act, msg).to.not.eql(exp);
    };
    assert.isAbove = function(val, abv, msg) {
      new Assertion(val, msg).to.be.above(abv);
    };
    assert.isBelow = function(val, blw, msg) {
      new Assertion(val, msg).to.be.below(blw);
    };
    assert.isTrue = function(val, msg) {
      new Assertion(val, msg).is['true'];
    };
    assert.isFalse = function(val, msg) {
      new Assertion(val, msg).is['false'];
    };
    assert.isNull = function(val, msg) {
      new Assertion(val, msg).to.equal(null);
    };
    assert.isNotNull = function(val, msg) {
      new Assertion(val, msg).to.not.equal(null);
    };
    assert.isUndefined = function(val, msg) {
      new Assertion(val, msg).to.equal(undefined);
    };
    assert.isDefined = function(val, msg) {
      new Assertion(val, msg).to.not.equal(undefined);
    };
    assert.isFunction = function(val, msg) {
      new Assertion(val, msg).to.be.a('function');
    };
    assert.isNotFunction = function(val, msg) {
      new Assertion(val, msg).to.not.be.a('function');
    };
    assert.isObject = function(val, msg) {
      new Assertion(val, msg).to.be.a('object');
    };
    assert.isNotObject = function(val, msg) {
      new Assertion(val, msg).to.not.be.a('object');
    };
    assert.isArray = function(val, msg) {
      new Assertion(val, msg).to.be.an('array');
    };
    assert.isNotArray = function(val, msg) {
      new Assertion(val, msg).to.not.be.an('array');
    };
    assert.isString = function(val, msg) {
      new Assertion(val, msg).to.be.a('string');
    };
    assert.isNotString = function(val, msg) {
      new Assertion(val, msg).to.not.be.a('string');
    };
    assert.isNumber = function(val, msg) {
      new Assertion(val, msg).to.be.a('number');
    };
    assert.isNotNumber = function(val, msg) {
      new Assertion(val, msg).to.not.be.a('number');
    };
    assert.isBoolean = function(val, msg) {
      new Assertion(val, msg).to.be.a('boolean');
    };
    assert.isNotBoolean = function(val, msg) {
      new Assertion(val, msg).to.not.be.a('boolean');
    };
    assert.typeOf = function(val, type, msg) {
      new Assertion(val, msg).to.be.a(type);
    };
    assert.notTypeOf = function(val, type, msg) {
      new Assertion(val, msg).to.not.be.a(type);
    };
    assert.instanceOf = function(val, type, msg) {
      new Assertion(val, msg).to.be.instanceOf(type);
    };
    assert.notInstanceOf = function(val, type, msg) {
      new Assertion(val, msg).to.not.be.instanceOf(type);
    };
    assert.include = function(exp, inc, msg) {
      new Assertion(exp, msg, assert.include).include(inc);
    };
    assert.notInclude = function(exp, inc, msg) {
      new Assertion(exp, msg, assert.notInclude).not.include(inc);
    };
    assert.match = function(exp, re, msg) {
      new Assertion(exp, msg).to.match(re);
    };
    assert.notMatch = function(exp, re, msg) {
      new Assertion(exp, msg).to.not.match(re);
    };
    assert.property = function(obj, prop, msg) {
      new Assertion(obj, msg).to.have.property(prop);
    };
    assert.notProperty = function(obj, prop, msg) {
      new Assertion(obj, msg).to.not.have.property(prop);
    };
    assert.deepProperty = function(obj, prop, msg) {
      new Assertion(obj, msg).to.have.deep.property(prop);
    };
    assert.notDeepProperty = function(obj, prop, msg) {
      new Assertion(obj, msg).to.not.have.deep.property(prop);
    };
    assert.propertyVal = function(obj, prop, val, msg) {
      new Assertion(obj, msg).to.have.property(prop, val);
    };
    assert.propertyNotVal = function(obj, prop, val, msg) {
      new Assertion(obj, msg).to.not.have.property(prop, val);
    };
    assert.deepPropertyVal = function(obj, prop, val, msg) {
      new Assertion(obj, msg).to.have.deep.property(prop, val);
    };
    assert.deepPropertyNotVal = function(obj, prop, val, msg) {
      new Assertion(obj, msg).to.not.have.deep.property(prop, val);
    };
    assert.lengthOf = function(exp, len, msg) {
      new Assertion(exp, msg).to.have.length(len);
    };
    assert.Throw = function(fn, errt, errs, msg) {
      if ('string' === typeof errt || errt instanceof RegExp) {
        errs = errt;
        errt = null;
      }
      var assertErr = new Assertion(fn, msg).to.Throw(errt, errs);
      return flag(assertErr, 'object');
    };
    assert.doesNotThrow = function(fn, type, msg) {
      if ('string' === typeof type) {
        msg = type;
        type = null;
      }
      new Assertion(fn, msg).to.not.Throw(type);
    };
    assert.operator = function(val, operator, val2, msg) {
      var ok;
      switch (operator) {
        case '==':
          ok = val == val2;
          break;
        case '===':
          ok = val === val2;
          break;
        case '>':
          ok = val > val2;
          break;
        case '>=':
          ok = val >= val2;
          break;
        case '<':
          ok = val < val2;
          break;
        case '<=':
          ok = val <= val2;
          break;
        case '!=':
          ok = val != val2;
          break;
        case '!==':
          ok = val !== val2;
          break;
        default:
          throw new Error('Invalid operator "' + operator + '"');
      }
      var test = new Assertion(ok, msg);
      test.assert(true === flag(test, 'object'), 'expected ' + util.inspect(val) + ' to be ' + operator + ' ' + util.inspect(val2), 'expected ' + util.inspect(val) + ' to not be ' + operator + ' ' + util.inspect(val2));
    };
    assert.closeTo = function(act, exp, delta, msg) {
      new Assertion(act, msg).to.be.closeTo(exp, delta);
    };
    assert.sameMembers = function(set1, set2, msg) {
      new Assertion(set1, msg).to.have.same.members(set2);
    };
    assert.sameDeepMembers = function(set1, set2, msg) {
      new Assertion(set1, msg).to.have.same.deep.members(set2);
    };
    assert.includeMembers = function(superset, subset, msg) {
      new Assertion(superset, msg).to.include.members(subset);
    };
    assert.changes = function(fn, obj, prop) {
      new Assertion(fn).to.change(obj, prop);
    };
    assert.doesNotChange = function(fn, obj, prop) {
      new Assertion(fn).to.not.change(obj, prop);
    };
    assert.increases = function(fn, obj, prop) {
      new Assertion(fn).to.increase(obj, prop);
    };
    assert.doesNotIncrease = function(fn, obj, prop) {
      new Assertion(fn).to.not.increase(obj, prop);
    };
    assert.decreases = function(fn, obj, prop) {
      new Assertion(fn).to.decrease(obj, prop);
    };
    assert.doesNotDecrease = function(fn, obj, prop) {
      new Assertion(fn).to.not.decrease(obj, prop);
    };
    assert.ifError = function(val) {
      if (val) {
        throw (val);
      }
    };
    (function alias(name, as) {
      assert[as] = assert[name];
      return alias;
    })('Throw', 'throw')('Throw', 'throws');
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:assertion-error@1.0.1", ["npm:assertion-error@1.0.1/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:assertion-error@1.0.1/index");
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/lib/chai/utils/test", ["npm:chai@3.0.0/lib/chai/utils/flag"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var flag = require("npm:chai@3.0.0/lib/chai/utils/flag");
  module.exports = function(obj, args) {
    var negate = flag(obj, 'negate'),
        expr = args[0];
    return negate ? !expr : expr;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:type-detect@1.0.0/index", ["npm:type-detect@1.0.0/lib/type"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:type-detect@1.0.0/lib/type");
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/lib/chai/utils/inspect", ["npm:chai@3.0.0/lib/chai/utils/getName", "npm:chai@3.0.0/lib/chai/utils/getProperties", "npm:chai@3.0.0/lib/chai/utils/getEnumerableProperties"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var getName = require("npm:chai@3.0.0/lib/chai/utils/getName");
  var getProperties = require("npm:chai@3.0.0/lib/chai/utils/getProperties");
  var getEnumerableProperties = require("npm:chai@3.0.0/lib/chai/utils/getEnumerableProperties");
  module.exports = inspect;
  function inspect(obj, showHidden, depth, colors) {
    var ctx = {
      showHidden: showHidden,
      seen: [],
      stylize: function(str) {
        return str;
      }
    };
    return formatValue(ctx, obj, (typeof depth === 'undefined' ? 2 : depth));
  }
  var isDOMElement = function(object) {
    if (typeof HTMLElement === 'object') {
      return object instanceof HTMLElement;
    } else {
      return object && typeof object === 'object' && object.nodeType === 1 && typeof object.nodeName === 'string';
    }
  };
  function formatValue(ctx, value, recurseTimes) {
    if (value && typeof value.inspect === 'function' && value.inspect !== exports.inspect && !(value.constructor && value.constructor.prototype === value)) {
      var ret = value.inspect(recurseTimes);
      if (typeof ret !== 'string') {
        ret = formatValue(ctx, ret, recurseTimes);
      }
      return ret;
    }
    var primitive = formatPrimitive(ctx, value);
    if (primitive) {
      return primitive;
    }
    if (isDOMElement(value)) {
      if ('outerHTML' in value) {
        return value.outerHTML;
      } else {
        try {
          if (document.xmlVersion) {
            var xmlSerializer = new XMLSerializer();
            return xmlSerializer.serializeToString(value);
          } else {
            var ns = "http://www.w3.org/1999/xhtml";
            var container = document.createElementNS(ns, '_');
            container.appendChild(value.cloneNode(false));
            html = container.innerHTML.replace('><', '>' + value.innerHTML + '<');
            container.innerHTML = '';
            return html;
          }
        } catch (err) {}
      }
    }
    var visibleKeys = getEnumerableProperties(value);
    var keys = ctx.showHidden ? getProperties(value) : visibleKeys;
    if (keys.length === 0 || (isError(value) && ((keys.length === 1 && keys[0] === 'stack') || (keys.length === 2 && keys[0] === 'description' && keys[1] === 'stack')))) {
      if (typeof value === 'function') {
        var name = getName(value);
        var nameSuffix = name ? ': ' + name : '';
        return ctx.stylize('[Function' + nameSuffix + ']', 'special');
      }
      if (isRegExp(value)) {
        return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
      }
      if (isDate(value)) {
        return ctx.stylize(Date.prototype.toUTCString.call(value), 'date');
      }
      if (isError(value)) {
        return formatError(value);
      }
    }
    var base = '',
        array = false,
        braces = ['{', '}'];
    if (isArray(value)) {
      array = true;
      braces = ['[', ']'];
    }
    if (typeof value === 'function') {
      var name = getName(value);
      var nameSuffix = name ? ': ' + name : '';
      base = ' [Function' + nameSuffix + ']';
    }
    if (isRegExp(value)) {
      base = ' ' + RegExp.prototype.toString.call(value);
    }
    if (isDate(value)) {
      base = ' ' + Date.prototype.toUTCString.call(value);
    }
    if (isError(value)) {
      return formatError(value);
    }
    if (keys.length === 0 && (!array || value.length == 0)) {
      return braces[0] + base + braces[1];
    }
    if (recurseTimes < 0) {
      if (isRegExp(value)) {
        return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
      } else {
        return ctx.stylize('[Object]', 'special');
      }
    }
    ctx.seen.push(value);
    var output;
    if (array) {
      output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
    } else {
      output = keys.map(function(key) {
        return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
      });
    }
    ctx.seen.pop();
    return reduceToSingleString(output, base, braces);
  }
  function formatPrimitive(ctx, value) {
    switch (typeof value) {
      case 'undefined':
        return ctx.stylize('undefined', 'undefined');
      case 'string':
        var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '').replace(/'/g, "\\'").replace(/\\"/g, '"') + '\'';
        return ctx.stylize(simple, 'string');
      case 'number':
        if (value === 0 && (1 / value) === -Infinity) {
          return ctx.stylize('-0', 'number');
        }
        return ctx.stylize('' + value, 'number');
      case 'boolean':
        return ctx.stylize('' + value, 'boolean');
    }
    if (value === null) {
      return ctx.stylize('null', 'null');
    }
  }
  function formatError(value) {
    return '[' + Error.prototype.toString.call(value) + ']';
  }
  function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
    var output = [];
    for (var i = 0,
        l = value.length; i < l; ++i) {
      if (Object.prototype.hasOwnProperty.call(value, String(i))) {
        output.push(formatProperty(ctx, value, recurseTimes, visibleKeys, String(i), true));
      } else {
        output.push('');
      }
    }
    keys.forEach(function(key) {
      if (!key.match(/^\d+$/)) {
        output.push(formatProperty(ctx, value, recurseTimes, visibleKeys, key, true));
      }
    });
    return output;
  }
  function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
    var name,
        str;
    if (value.__lookupGetter__) {
      if (value.__lookupGetter__(key)) {
        if (value.__lookupSetter__(key)) {
          str = ctx.stylize('[Getter/Setter]', 'special');
        } else {
          str = ctx.stylize('[Getter]', 'special');
        }
      } else {
        if (value.__lookupSetter__(key)) {
          str = ctx.stylize('[Setter]', 'special');
        }
      }
    }
    if (visibleKeys.indexOf(key) < 0) {
      name = '[' + key + ']';
    }
    if (!str) {
      if (ctx.seen.indexOf(value[key]) < 0) {
        if (recurseTimes === null) {
          str = formatValue(ctx, value[key], null);
        } else {
          str = formatValue(ctx, value[key], recurseTimes - 1);
        }
        if (str.indexOf('\n') > -1) {
          if (array) {
            str = str.split('\n').map(function(line) {
              return '  ' + line;
            }).join('\n').substr(2);
          } else {
            str = '\n' + str.split('\n').map(function(line) {
              return '   ' + line;
            }).join('\n');
          }
        }
      } else {
        str = ctx.stylize('[Circular]', 'special');
      }
    }
    if (typeof name === 'undefined') {
      if (array && key.match(/^\d+$/)) {
        return str;
      }
      name = JSON.stringify('' + key);
      if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
        name = name.substr(1, name.length - 2);
        name = ctx.stylize(name, 'name');
      } else {
        name = name.replace(/'/g, "\\'").replace(/\\"/g, '"').replace(/(^"|"$)/g, "'");
        name = ctx.stylize(name, 'string');
      }
    }
    return name + ': ' + str;
  }
  function reduceToSingleString(output, base, braces) {
    var numLinesEst = 0;
    var length = output.reduce(function(prev, cur) {
      numLinesEst++;
      if (cur.indexOf('\n') >= 0)
        numLinesEst++;
      return prev + cur.length + 1;
    }, 0);
    if (length > 60) {
      return braces[0] + (base === '' ? '' : base + '\n ') + ' ' + output.join(',\n  ') + ' ' + braces[1];
    }
    return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
  }
  function isArray(ar) {
    return Array.isArray(ar) || (typeof ar === 'object' && objectToString(ar) === '[object Array]');
  }
  function isRegExp(re) {
    return typeof re === 'object' && objectToString(re) === '[object RegExp]';
  }
  function isDate(d) {
    return typeof d === 'object' && objectToString(d) === '[object Date]';
  }
  function isError(e) {
    return typeof e === 'object' && objectToString(e) === '[object Error]';
  }
  function objectToString(o) {
    return Object.prototype.toString.call(o);
  }
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/lib/chai/utils/objDisplay", ["npm:chai@3.0.0/lib/chai/utils/inspect", "npm:chai@3.0.0/lib/chai/config"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var inspect = require("npm:chai@3.0.0/lib/chai/utils/inspect");
  var config = require("npm:chai@3.0.0/lib/chai/config");
  module.exports = function(obj) {
    var str = inspect(obj),
        type = Object.prototype.toString.call(obj);
    if (config.truncateThreshold && str.length >= config.truncateThreshold) {
      if (type === '[object Function]') {
        return !obj.name || obj.name === '' ? '[Function]' : '[Function: ' + obj.name + ']';
      } else if (type === '[object Array]') {
        return '[ Array(' + obj.length + ') ]';
      } else if (type === '[object Object]') {
        var keys = Object.keys(obj),
            kstr = keys.length > 2 ? keys.splice(0, 2).join(', ') + ', ...' : keys.join(', ');
        return '{ Object (' + kstr + ') }';
      } else {
        return str;
      }
    } else {
      return str;
    }
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:type-detect@0.1.1/index", ["npm:type-detect@0.1.1/lib/type"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:type-detect@0.1.1/lib/type");
  global.define = __define;
  return module.exports;
});

System.register("npm:base64-js@0.0.8", ["npm:base64-js@0.0.8/lib/b64"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:base64-js@0.0.8/lib/b64");
  global.define = __define;
  return module.exports;
});

System.register("npm:ieee754@1.1.6", ["npm:ieee754@1.1.6/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:ieee754@1.1.6/index");
  global.define = __define;
  return module.exports;
});

System.register("npm:is-array@1.0.1", ["npm:is-array@1.0.1/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:is-array@1.0.1/index");
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/lib/chai/utils/getPathInfo", ["npm:chai@3.0.0/lib/chai/utils/hasProperty"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var hasProperty = require("npm:chai@3.0.0/lib/chai/utils/hasProperty");
  module.exports = function getPathInfo(path, obj) {
    var parsed = parsePath(path),
        last = parsed[parsed.length - 1];
    var info = {
      parent: parsed.length > 1 ? _getPathValue(parsed, obj, parsed.length - 1) : obj,
      name: last.p || last.i,
      value: _getPathValue(parsed, obj)
    };
    info.exists = hasProperty(info.name, info.parent);
    return info;
  };
  function parsePath(path) {
    var str = path.replace(/([^\\])\[/g, '$1.['),
        parts = str.match(/(\\\.|[^.]+?)+/g);
    return parts.map(function(value) {
      var re = /^\[(\d+)\]$/,
          mArr = re.exec(value);
      if (mArr)
        return {i: parseFloat(mArr[1])};
      else
        return {p: value.replace(/\\([.\[\]])/g, '$1')};
    });
  }
  function _getPathValue(parsed, obj, index) {
    var tmp = obj,
        res;
    index = (index === undefined ? parsed.length : index);
    for (var i = 0,
        l = index; i < l; i++) {
      var part = parsed[i];
      if (tmp) {
        if ('undefined' !== typeof part.p)
          tmp = tmp[part.p];
        else if ('undefined' !== typeof part.i)
          tmp = tmp[part.i];
        if (i == (l - 1))
          res = tmp;
      } else {
        res = undefined;
      }
    }
    return res;
  }
  global.define = __define;
  return module.exports;
});

System.register("npm:mocha@2.2.5/mocha", ["npm:mocha@2.2.5/mocha.css!github:systemjs/plugin-css@0.1.13"], false, function(__require, __exports, __module) {
  System.get("@@global-helpers").prepareGlobal(__module.id, ["npm:mocha@2.2.5/mocha.css!github:systemjs/plugin-css@0.1.13"]);
  (function() {
    "format global";
    "deps ./mocha.css!";
    "exports mocha";
    ;
    (function() {
      function require(p) {
        var path = require.resolve(p),
            mod = require.modules[path];
        if (!mod)
          throw new Error('failed to require "' + p + '"');
        if (!mod.exports) {
          mod.exports = {};
          mod.call(mod.exports, mod, mod.exports, require.relative(path));
        }
        return mod.exports;
      }
      require.modules = {};
      require.resolve = function(path) {
        var orig = path,
            reg = path + '.js',
            index = path + '/index.js';
        return require.modules[reg] && reg || require.modules[index] && index || orig;
      };
      require.register = function(path, fn) {
        require.modules[path] = fn;
      };
      require.relative = function(parent) {
        return function(p) {
          if ('.' != p.charAt(0))
            return require(p);
          var path = parent.split('/'),
              segs = p.split('/');
          path.pop();
          for (var i = 0; i < segs.length; i++) {
            var seg = segs[i];
            if ('..' == seg)
              path.pop();
            else if ('.' != seg)
              path.push(seg);
          }
          return require(path.join('/'));
        };
      };
      require.register("browser/debug.js", function(module, exports, require) {
        module.exports = function(type) {
          return function() {};
        };
      });
      require.register("browser/diff.js", function(module, exports, require) {
        var JsDiff = (function() {
          function clonePath(path) {
            return {
              newPos: path.newPos,
              components: path.components.slice(0)
            };
          }
          function removeEmpty(array) {
            var ret = [];
            for (var i = 0; i < array.length; i++) {
              if (array[i]) {
                ret.push(array[i]);
              }
            }
            return ret;
          }
          function escapeHTML(s) {
            var n = s;
            n = n.replace(/&/g, '&amp;');
            n = n.replace(/</g, '&lt;');
            n = n.replace(/>/g, '&gt;');
            n = n.replace(/"/g, '&quot;');
            return n;
          }
          var Diff = function(ignoreWhitespace) {
            this.ignoreWhitespace = ignoreWhitespace;
          };
          Diff.prototype = {
            diff: function(oldString, newString) {
              if (newString === oldString) {
                return [{value: newString}];
              }
              if (!newString) {
                return [{
                  value: oldString,
                  removed: true
                }];
              }
              if (!oldString) {
                return [{
                  value: newString,
                  added: true
                }];
              }
              newString = this.tokenize(newString);
              oldString = this.tokenize(oldString);
              var newLen = newString.length,
                  oldLen = oldString.length;
              var maxEditLength = newLen + oldLen;
              var bestPath = [{
                newPos: -1,
                components: []
              }];
              var oldPos = this.extractCommon(bestPath[0], newString, oldString, 0);
              if (bestPath[0].newPos + 1 >= newLen && oldPos + 1 >= oldLen) {
                return bestPath[0].components;
              }
              for (var editLength = 1; editLength <= maxEditLength; editLength++) {
                for (var diagonalPath = -1 * editLength; diagonalPath <= editLength; diagonalPath += 2) {
                  var basePath;
                  var addPath = bestPath[diagonalPath - 1],
                      removePath = bestPath[diagonalPath + 1];
                  oldPos = (removePath ? removePath.newPos : 0) - diagonalPath;
                  if (addPath) {
                    bestPath[diagonalPath - 1] = undefined;
                  }
                  var canAdd = addPath && addPath.newPos + 1 < newLen;
                  var canRemove = removePath && 0 <= oldPos && oldPos < oldLen;
                  if (!canAdd && !canRemove) {
                    bestPath[diagonalPath] = undefined;
                    continue;
                  }
                  if (!canAdd || (canRemove && addPath.newPos < removePath.newPos)) {
                    basePath = clonePath(removePath);
                    this.pushComponent(basePath.components, oldString[oldPos], undefined, true);
                  } else {
                    basePath = clonePath(addPath);
                    basePath.newPos++;
                    this.pushComponent(basePath.components, newString[basePath.newPos], true, undefined);
                  }
                  var oldPos = this.extractCommon(basePath, newString, oldString, diagonalPath);
                  if (basePath.newPos + 1 >= newLen && oldPos + 1 >= oldLen) {
                    return basePath.components;
                  } else {
                    bestPath[diagonalPath] = basePath;
                  }
                }
              }
            },
            pushComponent: function(components, value, added, removed) {
              var last = components[components.length - 1];
              if (last && last.added === added && last.removed === removed) {
                components[components.length - 1] = {
                  value: this.join(last.value, value),
                  added: added,
                  removed: removed
                };
              } else {
                components.push({
                  value: value,
                  added: added,
                  removed: removed
                });
              }
            },
            extractCommon: function(basePath, newString, oldString, diagonalPath) {
              var newLen = newString.length,
                  oldLen = oldString.length,
                  newPos = basePath.newPos,
                  oldPos = newPos - diagonalPath;
              while (newPos + 1 < newLen && oldPos + 1 < oldLen && this.equals(newString[newPos + 1], oldString[oldPos + 1])) {
                newPos++;
                oldPos++;
                this.pushComponent(basePath.components, newString[newPos], undefined, undefined);
              }
              basePath.newPos = newPos;
              return oldPos;
            },
            equals: function(left, right) {
              var reWhitespace = /\S/;
              if (this.ignoreWhitespace && !reWhitespace.test(left) && !reWhitespace.test(right)) {
                return true;
              } else {
                return left === right;
              }
            },
            join: function(left, right) {
              return left + right;
            },
            tokenize: function(value) {
              return value;
            }
          };
          var CharDiff = new Diff();
          var WordDiff = new Diff(true);
          var WordWithSpaceDiff = new Diff();
          WordDiff.tokenize = WordWithSpaceDiff.tokenize = function(value) {
            return removeEmpty(value.split(/(\s+|\b)/));
          };
          var CssDiff = new Diff(true);
          CssDiff.tokenize = function(value) {
            return removeEmpty(value.split(/([{}:;,]|\s+)/));
          };
          var LineDiff = new Diff();
          LineDiff.tokenize = function(value) {
            var retLines = [],
                lines = value.split(/^/m);
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i],
                  lastLine = lines[i - 1];
              if (line == '\n' && lastLine && lastLine[lastLine.length - 1] === '\r') {
                retLines[retLines.length - 1] += '\n';
              } else if (line) {
                retLines.push(line);
              }
            }
            return retLines;
          };
          return {
            Diff: Diff,
            diffChars: function(oldStr, newStr) {
              return CharDiff.diff(oldStr, newStr);
            },
            diffWords: function(oldStr, newStr) {
              return WordDiff.diff(oldStr, newStr);
            },
            diffWordsWithSpace: function(oldStr, newStr) {
              return WordWithSpaceDiff.diff(oldStr, newStr);
            },
            diffLines: function(oldStr, newStr) {
              return LineDiff.diff(oldStr, newStr);
            },
            diffCss: function(oldStr, newStr) {
              return CssDiff.diff(oldStr, newStr);
            },
            createPatch: function(fileName, oldStr, newStr, oldHeader, newHeader) {
              var ret = [];
              ret.push('Index: ' + fileName);
              ret.push('===================================================================');
              ret.push('--- ' + fileName + (typeof oldHeader === 'undefined' ? '' : '\t' + oldHeader));
              ret.push('+++ ' + fileName + (typeof newHeader === 'undefined' ? '' : '\t' + newHeader));
              var diff = LineDiff.diff(oldStr, newStr);
              if (!diff[diff.length - 1].value) {
                diff.pop();
              }
              diff.push({
                value: '',
                lines: []
              });
              function contextLines(lines) {
                return lines.map(function(entry) {
                  return ' ' + entry;
                });
              }
              function eofNL(curRange, i, current) {
                var last = diff[diff.length - 2],
                    isLast = i === diff.length - 2,
                    isLastOfType = i === diff.length - 3 && (current.added !== last.added || current.removed !== last.removed);
                if (!/\n$/.test(current.value) && (isLast || isLastOfType)) {
                  curRange.push('\\ No newline at end of file');
                }
              }
              var oldRangeStart = 0,
                  newRangeStart = 0,
                  curRange = [],
                  oldLine = 1,
                  newLine = 1;
              for (var i = 0; i < diff.length; i++) {
                var current = diff[i],
                    lines = current.lines || current.value.replace(/\n$/, '').split('\n');
                current.lines = lines;
                if (current.added || current.removed) {
                  if (!oldRangeStart) {
                    var prev = diff[i - 1];
                    oldRangeStart = oldLine;
                    newRangeStart = newLine;
                    if (prev) {
                      curRange = contextLines(prev.lines.slice(-4));
                      oldRangeStart -= curRange.length;
                      newRangeStart -= curRange.length;
                    }
                  }
                  curRange.push.apply(curRange, lines.map(function(entry) {
                    return (current.added ? '+' : '-') + entry;
                  }));
                  eofNL(curRange, i, current);
                  if (current.added) {
                    newLine += lines.length;
                  } else {
                    oldLine += lines.length;
                  }
                } else {
                  if (oldRangeStart) {
                    if (lines.length <= 8 && i < diff.length - 2) {
                      curRange.push.apply(curRange, contextLines(lines));
                    } else {
                      var contextSize = Math.min(lines.length, 4);
                      ret.push('@@ -' + oldRangeStart + ',' + (oldLine - oldRangeStart + contextSize) + ' +' + newRangeStart + ',' + (newLine - newRangeStart + contextSize) + ' @@');
                      ret.push.apply(ret, curRange);
                      ret.push.apply(ret, contextLines(lines.slice(0, contextSize)));
                      if (lines.length <= 4) {
                        eofNL(ret, i, current);
                      }
                      oldRangeStart = 0;
                      newRangeStart = 0;
                      curRange = [];
                    }
                  }
                  oldLine += lines.length;
                  newLine += lines.length;
                }
              }
              return ret.join('\n') + '\n';
            },
            applyPatch: function(oldStr, uniDiff) {
              var diffstr = uniDiff.split('\n');
              var diff = [];
              var remEOFNL = false,
                  addEOFNL = false;
              for (var i = (diffstr[0][0] === 'I' ? 4 : 0); i < diffstr.length; i++) {
                if (diffstr[i][0] === '@') {
                  var meh = diffstr[i].split(/@@ -(\d+),(\d+) \+(\d+),(\d+) @@/);
                  diff.unshift({
                    start: meh[3],
                    oldlength: meh[2],
                    oldlines: [],
                    newlength: meh[4],
                    newlines: []
                  });
                } else if (diffstr[i][0] === '+') {
                  diff[0].newlines.push(diffstr[i].substr(1));
                } else if (diffstr[i][0] === '-') {
                  diff[0].oldlines.push(diffstr[i].substr(1));
                } else if (diffstr[i][0] === ' ') {
                  diff[0].newlines.push(diffstr[i].substr(1));
                  diff[0].oldlines.push(diffstr[i].substr(1));
                } else if (diffstr[i][0] === '\\') {
                  if (diffstr[i - 1][0] === '+') {
                    remEOFNL = true;
                  } else if (diffstr[i - 1][0] === '-') {
                    addEOFNL = true;
                  }
                }
              }
              var str = oldStr.split('\n');
              for (var i = diff.length - 1; i >= 0; i--) {
                var d = diff[i];
                for (var j = 0; j < d.oldlength; j++) {
                  if (str[d.start - 1 + j] !== d.oldlines[j]) {
                    return false;
                  }
                }
                Array.prototype.splice.apply(str, [d.start - 1, +d.oldlength].concat(d.newlines));
              }
              if (remEOFNL) {
                while (!str[str.length - 1]) {
                  str.pop();
                }
              } else if (addEOFNL) {
                str.push('');
              }
              return str.join('\n');
            },
            convertChangesToXML: function(changes) {
              var ret = [];
              for (var i = 0; i < changes.length; i++) {
                var change = changes[i];
                if (change.added) {
                  ret.push('<ins>');
                } else if (change.removed) {
                  ret.push('<del>');
                }
                ret.push(escapeHTML(change.value));
                if (change.added) {
                  ret.push('</ins>');
                } else if (change.removed) {
                  ret.push('</del>');
                }
              }
              return ret.join('');
            },
            convertChangesToDMP: function(changes) {
              var ret = [],
                  change;
              for (var i = 0; i < changes.length; i++) {
                change = changes[i];
                ret.push([(change.added ? 1 : change.removed ? -1 : 0), change.value]);
              }
              return ret;
            }
          };
        })();
        if (typeof module !== 'undefined') {
          module.exports = JsDiff;
        }
      });
      require.register("browser/escape-string-regexp.js", function(module, exports, require) {
        'use strict';
        var matchOperatorsRe = /[|\\{}()[\]^$+*?.]/g;
        module.exports = function(str) {
          if (typeof str !== 'string') {
            throw new TypeError('Expected a string');
          }
          return str.replace(matchOperatorsRe, '\\$&');
        };
      });
      require.register("browser/events.js", function(module, exports, require) {
        exports.EventEmitter = EventEmitter;
        function isArray(obj) {
          return '[object Array]' == {}.toString.call(obj);
        }
        function EventEmitter() {}
        ;
        EventEmitter.prototype.on = function(name, fn) {
          if (!this.$events) {
            this.$events = {};
          }
          if (!this.$events[name]) {
            this.$events[name] = fn;
          } else if (isArray(this.$events[name])) {
            this.$events[name].push(fn);
          } else {
            this.$events[name] = [this.$events[name], fn];
          }
          return this;
        };
        EventEmitter.prototype.addListener = EventEmitter.prototype.on;
        EventEmitter.prototype.once = function(name, fn) {
          var self = this;
          function on() {
            self.removeListener(name, on);
            fn.apply(this, arguments);
          }
          ;
          on.listener = fn;
          this.on(name, on);
          return this;
        };
        EventEmitter.prototype.removeListener = function(name, fn) {
          if (this.$events && this.$events[name]) {
            var list = this.$events[name];
            if (isArray(list)) {
              var pos = -1;
              for (var i = 0,
                  l = list.length; i < l; i++) {
                if (list[i] === fn || (list[i].listener && list[i].listener === fn)) {
                  pos = i;
                  break;
                }
              }
              if (pos < 0) {
                return this;
              }
              list.splice(pos, 1);
              if (!list.length) {
                delete this.$events[name];
              }
            } else if (list === fn || (list.listener && list.listener === fn)) {
              delete this.$events[name];
            }
          }
          return this;
        };
        EventEmitter.prototype.removeAllListeners = function(name) {
          if (name === undefined) {
            this.$events = {};
            return this;
          }
          if (this.$events && this.$events[name]) {
            this.$events[name] = null;
          }
          return this;
        };
        EventEmitter.prototype.listeners = function(name) {
          if (!this.$events) {
            this.$events = {};
          }
          if (!this.$events[name]) {
            this.$events[name] = [];
          }
          if (!isArray(this.$events[name])) {
            this.$events[name] = [this.$events[name]];
          }
          return this.$events[name];
        };
        EventEmitter.prototype.emit = function(name) {
          if (!this.$events) {
            return false;
          }
          var handler = this.$events[name];
          if (!handler) {
            return false;
          }
          var args = [].slice.call(arguments, 1);
          if ('function' == typeof handler) {
            handler.apply(this, args);
          } else if (isArray(handler)) {
            var listeners = handler.slice();
            for (var i = 0,
                l = listeners.length; i < l; i++) {
              listeners[i].apply(this, args);
            }
          } else {
            return false;
          }
          return true;
        };
      });
      require.register("browser/fs.js", function(module, exports, require) {});
      require.register("browser/glob.js", function(module, exports, require) {});
      require.register("browser/path.js", function(module, exports, require) {});
      require.register("browser/progress.js", function(module, exports, require) {
        module.exports = Progress;
        function Progress() {
          this.percent = 0;
          this.size(0);
          this.fontSize(11);
          this.font('helvetica, arial, sans-serif');
        }
        Progress.prototype.size = function(n) {
          this._size = n;
          return this;
        };
        Progress.prototype.text = function(str) {
          this._text = str;
          return this;
        };
        Progress.prototype.fontSize = function(n) {
          this._fontSize = n;
          return this;
        };
        Progress.prototype.font = function(family) {
          this._font = family;
          return this;
        };
        Progress.prototype.update = function(n) {
          this.percent = n;
          return this;
        };
        Progress.prototype.draw = function(ctx) {
          try {
            var percent = Math.min(this.percent, 100),
                size = this._size,
                half = size / 2,
                x = half,
                y = half,
                rad = half - 1,
                fontSize = this._fontSize;
            ctx.font = fontSize + 'px ' + this._font;
            var angle = Math.PI * 2 * (percent / 100);
            ctx.clearRect(0, 0, size, size);
            ctx.strokeStyle = '#9f9f9f';
            ctx.beginPath();
            ctx.arc(x, y, rad, 0, angle, false);
            ctx.stroke();
            ctx.strokeStyle = '#eee';
            ctx.beginPath();
            ctx.arc(x, y, rad - 1, 0, angle, true);
            ctx.stroke();
            var text = this._text || (percent | 0) + '%',
                w = ctx.measureText(text).width;
            ctx.fillText(text, x - w / 2 + 1, y + fontSize / 2 - 1);
          } catch (ex) {}
          return this;
        };
      });
      require.register("browser/tty.js", function(module, exports, require) {
        exports.isatty = function() {
          return true;
        };
        exports.getWindowSize = function() {
          if ('innerHeight' in global) {
            return [global.innerHeight, global.innerWidth];
          } else {
            return [640, 480];
          }
        };
      });
      require.register("context.js", function(module, exports, require) {
        module.exports = Context;
        function Context() {}
        Context.prototype.runnable = function(runnable) {
          if (0 == arguments.length)
            return this._runnable;
          this.test = this._runnable = runnable;
          return this;
        };
        Context.prototype.timeout = function(ms) {
          if (arguments.length === 0)
            return this.runnable().timeout();
          this.runnable().timeout(ms);
          return this;
        };
        Context.prototype.enableTimeouts = function(enabled) {
          this.runnable().enableTimeouts(enabled);
          return this;
        };
        Context.prototype.slow = function(ms) {
          this.runnable().slow(ms);
          return this;
        };
        Context.prototype.skip = function() {
          this.runnable().skip();
          return this;
        };
        Context.prototype.inspect = function() {
          return JSON.stringify(this, function(key, val) {
            if ('_runnable' == key)
              return ;
            if ('test' == key)
              return ;
            return val;
          }, 2);
        };
      });
      require.register("hook.js", function(module, exports, require) {
        var Runnable = require('./runnable');
        module.exports = Hook;
        function Hook(title, fn) {
          Runnable.call(this, title, fn);
          this.type = 'hook';
        }
        function F() {}
        ;
        F.prototype = Runnable.prototype;
        Hook.prototype = new F;
        Hook.prototype.constructor = Hook;
        Hook.prototype.error = function(err) {
          if (0 == arguments.length) {
            var err = this._error;
            this._error = null;
            return err;
          }
          this._error = err;
        };
      });
      require.register("interfaces/bdd.js", function(module, exports, require) {
        var Suite = require('../suite'),
            Test = require('../test'),
            utils = require('../utils'),
            escapeRe = require('browser/escape-string-regexp');
        module.exports = function(suite) {
          var suites = [suite];
          suite.on('pre-require', function(context, file, mocha) {
            var common = require('./common')(suites, context);
            context.before = common.before;
            context.after = common.after;
            context.beforeEach = common.beforeEach;
            context.afterEach = common.afterEach;
            context.run = mocha.options.delay && common.runWithSuite(suite);
            context.describe = context.context = function(title, fn) {
              var suite = Suite.create(suites[0], title);
              suite.file = file;
              suites.unshift(suite);
              fn.call(suite);
              suites.shift();
              return suite;
            };
            context.xdescribe = context.xcontext = context.describe.skip = function(title, fn) {
              var suite = Suite.create(suites[0], title);
              suite.pending = true;
              suites.unshift(suite);
              fn.call(suite);
              suites.shift();
            };
            context.describe.only = function(title, fn) {
              var suite = context.describe(title, fn);
              mocha.grep(suite.fullTitle());
              return suite;
            };
            context.it = context.specify = function(title, fn) {
              var suite = suites[0];
              if (suite.pending)
                fn = null;
              var test = new Test(title, fn);
              test.file = file;
              suite.addTest(test);
              return test;
            };
            context.it.only = function(title, fn) {
              var test = context.it(title, fn);
              var reString = '^' + escapeRe(test.fullTitle()) + '$';
              mocha.grep(new RegExp(reString));
              return test;
            };
            context.xit = context.xspecify = context.it.skip = function(title) {
              context.it(title);
            };
          });
        };
      });
      require.register("interfaces/common.js", function(module, exports, require) {
        'use strict';
        module.exports = function(suites, context) {
          return {
            runWithSuite: function runWithSuite(suite) {
              return function run() {
                suite.run();
              };
            },
            before: function(name, fn) {
              suites[0].beforeAll(name, fn);
            },
            after: function(name, fn) {
              suites[0].afterAll(name, fn);
            },
            beforeEach: function(name, fn) {
              suites[0].beforeEach(name, fn);
            },
            afterEach: function(name, fn) {
              suites[0].afterEach(name, fn);
            },
            test: {skip: function(title) {
                context.test(title);
              }}
          };
        };
      });
      require.register("interfaces/exports.js", function(module, exports, require) {
        var Suite = require('../suite'),
            Test = require('../test');
        module.exports = function(suite) {
          var suites = [suite];
          suite.on('require', visit);
          function visit(obj, file) {
            var suite;
            for (var key in obj) {
              if ('function' == typeof obj[key]) {
                var fn = obj[key];
                switch (key) {
                  case 'before':
                    suites[0].beforeAll(fn);
                    break;
                  case 'after':
                    suites[0].afterAll(fn);
                    break;
                  case 'beforeEach':
                    suites[0].beforeEach(fn);
                    break;
                  case 'afterEach':
                    suites[0].afterEach(fn);
                    break;
                  default:
                    var test = new Test(key, fn);
                    test.file = file;
                    suites[0].addTest(test);
                }
              } else {
                suite = Suite.create(suites[0], key);
                suites.unshift(suite);
                visit(obj[key]);
                suites.shift();
              }
            }
          }
        };
      });
      require.register("interfaces/index.js", function(module, exports, require) {
        exports.bdd = require('./bdd');
        exports.tdd = require('./tdd');
        exports.qunit = require('./qunit');
        exports.exports = require('./exports');
      });
      require.register("interfaces/qunit.js", function(module, exports, require) {
        var Suite = require('../suite'),
            Test = require('../test'),
            escapeRe = require('browser/escape-string-regexp'),
            utils = require('../utils');
        module.exports = function(suite) {
          var suites = [suite];
          suite.on('pre-require', function(context, file, mocha) {
            var common = require('./common')(suites, context);
            context.before = common.before;
            context.after = common.after;
            context.beforeEach = common.beforeEach;
            context.afterEach = common.afterEach;
            context.run = mocha.options.delay && common.runWithSuite(suite);
            context.suite = function(title) {
              if (suites.length > 1)
                suites.shift();
              var suite = Suite.create(suites[0], title);
              suite.file = file;
              suites.unshift(suite);
              return suite;
            };
            context.suite.only = function(title, fn) {
              var suite = context.suite(title, fn);
              mocha.grep(suite.fullTitle());
            };
            context.test = function(title, fn) {
              var test = new Test(title, fn);
              test.file = file;
              suites[0].addTest(test);
              return test;
            };
            context.test.only = function(title, fn) {
              var test = context.test(title, fn);
              var reString = '^' + escapeRe(test.fullTitle()) + '$';
              mocha.grep(new RegExp(reString));
            };
            context.test.skip = common.test.skip;
          });
        };
      });
      require.register("interfaces/tdd.js", function(module, exports, require) {
        var Suite = require('../suite'),
            Test = require('../test'),
            escapeRe = require('browser/escape-string-regexp'),
            utils = require('../utils');
        module.exports = function(suite) {
          var suites = [suite];
          suite.on('pre-require', function(context, file, mocha) {
            var common = require('./common')(suites, context);
            context.setup = common.beforeEach;
            context.teardown = common.afterEach;
            context.suiteSetup = common.before;
            context.suiteTeardown = common.after;
            context.run = mocha.options.delay && common.runWithSuite(suite);
            context.suite = function(title, fn) {
              var suite = Suite.create(suites[0], title);
              suite.file = file;
              suites.unshift(suite);
              fn.call(suite);
              suites.shift();
              return suite;
            };
            context.suite.skip = function(title, fn) {
              var suite = Suite.create(suites[0], title);
              suite.pending = true;
              suites.unshift(suite);
              fn.call(suite);
              suites.shift();
            };
            context.suite.only = function(title, fn) {
              var suite = context.suite(title, fn);
              mocha.grep(suite.fullTitle());
            };
            context.test = function(title, fn) {
              var suite = suites[0];
              if (suite.pending)
                fn = null;
              var test = new Test(title, fn);
              test.file = file;
              suite.addTest(test);
              return test;
            };
            context.test.only = function(title, fn) {
              var test = context.test(title, fn);
              var reString = '^' + escapeRe(test.fullTitle()) + '$';
              mocha.grep(new RegExp(reString));
            };
            context.test.skip = common.test.skip;
          });
        };
      });
      require.register("mocha.js", function(module, exports, require) {
        var path = require('browser/path'),
            escapeRe = require('browser/escape-string-regexp'),
            utils = require('./utils');
        exports = module.exports = Mocha;
        if (typeof process !== 'undefined' && typeof process.cwd === 'function') {
          var join = path.join,
              cwd = process.cwd();
          module.paths.push(cwd, join(cwd, 'node_modules'));
        }
        exports.utils = utils;
        exports.interfaces = require('./interfaces');
        exports.reporters = require('./reporters');
        exports.Runnable = require('./runnable');
        exports.Context = require('./context');
        exports.Runner = require('./runner');
        exports.Suite = require('./suite');
        exports.Hook = require('./hook');
        exports.Test = require('./test');
        function image(name) {
          return __dirname + '/../images/' + name + '.png';
        }
        function Mocha(options) {
          options = options || {};
          this.files = [];
          this.options = options;
          if (options.grep)
            this.grep(new RegExp(options.grep));
          if (options.fgrep)
            this.grep(options.fgrep);
          this.suite = new exports.Suite('', new exports.Context);
          this.ui(options.ui);
          this.bail(options.bail);
          this.reporter(options.reporter, options.reporterOptions);
          if (null != options.timeout)
            this.timeout(options.timeout);
          this.useColors(options.useColors);
          if (options.enableTimeouts !== null)
            this.enableTimeouts(options.enableTimeouts);
          if (options.slow)
            this.slow(options.slow);
          this.suite.on('pre-require', function(context) {
            exports.afterEach = context.afterEach || context.teardown;
            exports.after = context.after || context.suiteTeardown;
            exports.beforeEach = context.beforeEach || context.setup;
            exports.before = context.before || context.suiteSetup;
            exports.describe = context.describe || context.suite;
            exports.it = context.it || context.test;
            exports.setup = context.setup || context.beforeEach;
            exports.suiteSetup = context.suiteSetup || context.before;
            exports.suiteTeardown = context.suiteTeardown || context.after;
            exports.suite = context.suite || context.describe;
            exports.teardown = context.teardown || context.afterEach;
            exports.test = context.test || context.it;
            exports.run = context.run;
          });
        }
        Mocha.prototype.bail = function(bail) {
          if (0 == arguments.length)
            bail = true;
          this.suite.bail(bail);
          return this;
        };
        Mocha.prototype.addFile = function(file) {
          this.files.push(file);
          return this;
        };
        Mocha.prototype.reporter = function(reporter, reporterOptions) {
          if ('function' == typeof reporter) {
            this._reporter = reporter;
          } else {
            reporter = reporter || 'spec';
            var _reporter;
            try {
              _reporter = require('./reporters/' + reporter);
            } catch (err) {}
            if (!_reporter)
              try {
                _reporter = require(reporter);
              } catch (err) {
                err.message.indexOf('Cannot find module') !== -1 ? console.warn('"' + reporter + '" reporter not found') : console.warn('"' + reporter + '" reporter blew up with error:\n' + err.stack);
              }
            if (!_reporter && reporter === 'teamcity')
              console.warn('The Teamcity reporter was moved to a package named ' + 'mocha-teamcity-reporter ' + '(https://npmjs.org/package/mocha-teamcity-reporter).');
            if (!_reporter)
              throw new Error('invalid reporter "' + reporter + '"');
            this._reporter = _reporter;
          }
          this.options.reporterOptions = reporterOptions;
          return this;
        };
        Mocha.prototype.ui = function(name) {
          name = name || 'bdd';
          this._ui = exports.interfaces[name];
          if (!this._ui)
            try {
              this._ui = require(name);
            } catch (err) {}
          if (!this._ui)
            throw new Error('invalid interface "' + name + '"');
          this._ui = this._ui(this.suite);
          return this;
        };
        Mocha.prototype.loadFiles = function(fn) {
          var self = this;
          var suite = this.suite;
          var pending = this.files.length;
          this.files.forEach(function(file) {
            file = path.resolve(file);
            suite.emit('pre-require', global, file, self);
            suite.emit('require', require(file), file, self);
            suite.emit('post-require', global, file, self);
            --pending || (fn && fn());
          });
        };
        Mocha.prototype._growl = function(runner, reporter) {
          var notify = require('growl');
          runner.on('end', function() {
            var stats = reporter.stats;
            if (stats.failures) {
              var msg = stats.failures + ' of ' + runner.total + ' tests failed';
              notify(msg, {
                name: 'mocha',
                title: 'Failed',
                image: image('error')
              });
            } else {
              notify(stats.passes + ' tests passed in ' + stats.duration + 'ms', {
                name: 'mocha',
                title: 'Passed',
                image: image('ok')
              });
            }
          });
        };
        Mocha.prototype.grep = function(re) {
          this.options.grep = 'string' == typeof re ? new RegExp(escapeRe(re)) : re;
          return this;
        };
        Mocha.prototype.invert = function() {
          this.options.invert = true;
          return this;
        };
        Mocha.prototype.ignoreLeaks = function(ignore) {
          this.options.ignoreLeaks = !!ignore;
          return this;
        };
        Mocha.prototype.checkLeaks = function() {
          this.options.ignoreLeaks = false;
          return this;
        };
        Mocha.prototype.fullTrace = function() {
          this.options.fullStackTrace = true;
          return this;
        };
        Mocha.prototype.growl = function() {
          this.options.growl = true;
          return this;
        };
        Mocha.prototype.globals = function(globals) {
          this.options.globals = (this.options.globals || []).concat(globals);
          return this;
        };
        Mocha.prototype.useColors = function(colors) {
          if (colors !== undefined) {
            this.options.useColors = colors;
          }
          return this;
        };
        Mocha.prototype.useInlineDiffs = function(inlineDiffs) {
          this.options.useInlineDiffs = arguments.length && inlineDiffs != undefined ? inlineDiffs : false;
          return this;
        };
        Mocha.prototype.timeout = function(timeout) {
          this.suite.timeout(timeout);
          return this;
        };
        Mocha.prototype.slow = function(slow) {
          this.suite.slow(slow);
          return this;
        };
        Mocha.prototype.enableTimeouts = function(enabled) {
          this.suite.enableTimeouts(arguments.length && enabled !== undefined ? enabled : true);
          return this;
        };
        Mocha.prototype.asyncOnly = function() {
          this.options.asyncOnly = true;
          return this;
        };
        Mocha.prototype.noHighlighting = function() {
          this.options.noHighlighting = true;
          return this;
        };
        Mocha.prototype.delay = function delay() {
          this.options.delay = true;
          return this;
        };
        Mocha.prototype.run = function(fn) {
          if (this.files.length)
            this.loadFiles();
          var suite = this.suite;
          var options = this.options;
          options.files = this.files;
          var runner = new exports.Runner(suite, options.delay);
          var reporter = new this._reporter(runner, options);
          runner.ignoreLeaks = false !== options.ignoreLeaks;
          runner.fullStackTrace = options.fullStackTrace;
          runner.asyncOnly = options.asyncOnly;
          if (options.grep)
            runner.grep(options.grep, options.invert);
          if (options.globals)
            runner.globals(options.globals);
          if (options.growl)
            this._growl(runner, reporter);
          if (options.useColors !== undefined) {
            exports.reporters.Base.useColors = options.useColors;
          }
          exports.reporters.Base.inlineDiffs = options.useInlineDiffs;
          function done(failures) {
            if (reporter.done) {
              reporter.done(failures, fn);
            } else
              fn && fn(failures);
          }
          return runner.run(done);
        };
      });
      require.register("ms.js", function(module, exports, require) {
        var s = 1000;
        var m = s * 60;
        var h = m * 60;
        var d = h * 24;
        var y = d * 365.25;
        module.exports = function(val, options) {
          options = options || {};
          if ('string' == typeof val)
            return parse(val);
          return options['long'] ? longFormat(val) : shortFormat(val);
        };
        function parse(str) {
          var match = /^((?:\d+)?\.?\d+) *(ms|seconds?|s|minutes?|m|hours?|h|days?|d|years?|y)?$/i.exec(str);
          if (!match)
            return ;
          var n = parseFloat(match[1]);
          var type = (match[2] || 'ms').toLowerCase();
          switch (type) {
            case 'years':
            case 'year':
            case 'y':
              return n * y;
            case 'days':
            case 'day':
            case 'd':
              return n * d;
            case 'hours':
            case 'hour':
            case 'h':
              return n * h;
            case 'minutes':
            case 'minute':
            case 'm':
              return n * m;
            case 'seconds':
            case 'second':
            case 's':
              return n * s;
            case 'ms':
              return n;
          }
        }
        function shortFormat(ms) {
          if (ms >= d)
            return Math.round(ms / d) + 'd';
          if (ms >= h)
            return Math.round(ms / h) + 'h';
          if (ms >= m)
            return Math.round(ms / m) + 'm';
          if (ms >= s)
            return Math.round(ms / s) + 's';
          return ms + 'ms';
        }
        function longFormat(ms) {
          return plural(ms, d, 'day') || plural(ms, h, 'hour') || plural(ms, m, 'minute') || plural(ms, s, 'second') || ms + ' ms';
        }
        function plural(ms, n, name) {
          if (ms < n)
            return ;
          if (ms < n * 1.5)
            return Math.floor(ms / n) + ' ' + name;
          return Math.ceil(ms / n) + ' ' + name + 's';
        }
      });
      require.register("pending.js", function(module, exports, require) {
        module.exports = Pending;
        function Pending(message) {
          this.message = message;
        }
      });
      require.register("reporters/base.js", function(module, exports, require) {
        var tty = require('browser/tty'),
            diff = require('browser/diff'),
            ms = require('../ms'),
            utils = require('../utils'),
            supportsColor = process.env ? require('supports-color') : null;
        var Date = global.Date,
            setTimeout = global.setTimeout,
            setInterval = global.setInterval,
            clearTimeout = global.clearTimeout,
            clearInterval = global.clearInterval;
        var isatty = tty.isatty(1) && tty.isatty(2);
        exports = module.exports = Base;
        exports.useColors = process.env ? (supportsColor || (process.env.MOCHA_COLORS !== undefined)) : false;
        exports.inlineDiffs = false;
        exports.colors = {
          'pass': 90,
          'fail': 31,
          'bright pass': 92,
          'bright fail': 91,
          'bright yellow': 93,
          'pending': 36,
          'suite': 0,
          'error title': 0,
          'error message': 31,
          'error stack': 90,
          'checkmark': 32,
          'fast': 90,
          'medium': 33,
          'slow': 31,
          'green': 32,
          'light': 90,
          'diff gutter': 90,
          'diff added': 42,
          'diff removed': 41
        };
        exports.symbols = {
          ok: '✓',
          err: '✖',
          dot: '․'
        };
        if ('win32' == process.platform) {
          exports.symbols.ok = '\u221A';
          exports.symbols.err = '\u00D7';
          exports.symbols.dot = '.';
        }
        var color = exports.color = function(type, str) {
          if (!exports.useColors)
            return String(str);
          return '\u001b[' + exports.colors[type] + 'm' + str + '\u001b[0m';
        };
        exports.window = {width: isatty ? process.stdout.getWindowSize ? process.stdout.getWindowSize(1)[0] : tty.getWindowSize()[1] : 75};
        exports.cursor = {
          hide: function() {
            isatty && process.stdout.write('\u001b[?25l');
          },
          show: function() {
            isatty && process.stdout.write('\u001b[?25h');
          },
          deleteLine: function() {
            isatty && process.stdout.write('\u001b[2K');
          },
          beginningOfLine: function() {
            isatty && process.stdout.write('\u001b[0G');
          },
          CR: function() {
            if (isatty) {
              exports.cursor.deleteLine();
              exports.cursor.beginningOfLine();
            } else {
              process.stdout.write('\r');
            }
          }
        };
        exports.list = function(failures) {
          console.log();
          failures.forEach(function(test, i) {
            var fmt = color('error title', '  %s) %s:\n') + color('error message', '     %s') + color('error stack', '\n%s\n');
            var err = test.err,
                message = err.message || '',
                stack = err.stack || message,
                index = stack.indexOf(message),
                actual = err.actual,
                expected = err.expected,
                escape = true;
            if (index === -1) {
              msg = message;
            } else {
              index += message.length;
              msg = stack.slice(0, index);
              stack = stack.slice(index + 1);
            }
            if (err.uncaught) {
              msg = 'Uncaught ' + msg;
            }
            if (err.showDiff !== false && sameType(actual, expected) && expected !== undefined) {
              if ('string' !== typeof actual) {
                escape = false;
                err.actual = actual = utils.stringify(actual);
                err.expected = expected = utils.stringify(expected);
              }
              fmt = color('error title', '  %s) %s:\n%s') + color('error stack', '\n%s\n');
              var match = message.match(/^([^:]+): expected/);
              msg = '\n      ' + color('error message', match ? match[1] : msg);
              if (exports.inlineDiffs) {
                msg += inlineDiff(err, escape);
              } else {
                msg += unifiedDiff(err, escape);
              }
            }
            stack = stack.replace(/^/gm, '  ');
            console.log(fmt, (i + 1), test.fullTitle(), msg, stack);
          });
        };
        function Base(runner) {
          var self = this,
              stats = this.stats = {
                suites: 0,
                tests: 0,
                passes: 0,
                pending: 0,
                failures: 0
              },
              failures = this.failures = [];
          if (!runner)
            return ;
          this.runner = runner;
          runner.stats = stats;
          runner.on('start', function() {
            stats.start = new Date;
          });
          runner.on('suite', function(suite) {
            stats.suites = stats.suites || 0;
            suite.root || stats.suites++;
          });
          runner.on('test end', function(test) {
            stats.tests = stats.tests || 0;
            stats.tests++;
          });
          runner.on('pass', function(test) {
            stats.passes = stats.passes || 0;
            var medium = test.slow() / 2;
            test.speed = test.duration > test.slow() ? 'slow' : test.duration > medium ? 'medium' : 'fast';
            stats.passes++;
          });
          runner.on('fail', function(test, err) {
            stats.failures = stats.failures || 0;
            stats.failures++;
            test.err = err;
            failures.push(test);
          });
          runner.on('end', function() {
            stats.end = new Date;
            stats.duration = new Date - stats.start;
          });
          runner.on('pending', function() {
            stats.pending++;
          });
        }
        Base.prototype.epilogue = function() {
          var stats = this.stats;
          var tests;
          var fmt;
          console.log();
          fmt = color('bright pass', ' ') + color('green', ' %d passing') + color('light', ' (%s)');
          console.log(fmt, stats.passes || 0, ms(stats.duration));
          if (stats.pending) {
            fmt = color('pending', ' ') + color('pending', ' %d pending');
            console.log(fmt, stats.pending);
          }
          if (stats.failures) {
            fmt = color('fail', '  %d failing');
            console.log(fmt, stats.failures);
            Base.list(this.failures);
            console.log();
          }
          console.log();
        };
        function pad(str, len) {
          str = String(str);
          return Array(len - str.length + 1).join(' ') + str;
        }
        function inlineDiff(err, escape) {
          var msg = errorDiff(err, 'WordsWithSpace', escape);
          var lines = msg.split('\n');
          if (lines.length > 4) {
            var width = String(lines.length).length;
            msg = lines.map(function(str, i) {
              return pad(++i, width) + ' |' + ' ' + str;
            }).join('\n');
          }
          msg = '\n' + color('diff removed', 'actual') + ' ' + color('diff added', 'expected') + '\n\n' + msg + '\n';
          msg = msg.replace(/^/gm, '      ');
          return msg;
        }
        function unifiedDiff(err, escape) {
          var indent = '      ';
          function cleanUp(line) {
            if (escape) {
              line = escapeInvisibles(line);
            }
            if (line[0] === '+')
              return indent + colorLines('diff added', line);
            if (line[0] === '-')
              return indent + colorLines('diff removed', line);
            if (line.match(/\@\@/))
              return null;
            if (line.match(/\\ No newline/))
              return null;
            else
              return indent + line;
          }
          function notBlank(line) {
            return line != null;
          }
          var msg = diff.createPatch('string', err.actual, err.expected);
          var lines = msg.split('\n').splice(4);
          return '\n      ' + colorLines('diff added', '+ expected') + ' ' + colorLines('diff removed', '- actual') + '\n\n' + lines.map(cleanUp).filter(notBlank).join('\n');
        }
        function errorDiff(err, type, escape) {
          var actual = escape ? escapeInvisibles(err.actual) : err.actual;
          var expected = escape ? escapeInvisibles(err.expected) : err.expected;
          return diff['diff' + type](actual, expected).map(function(str) {
            if (str.added)
              return colorLines('diff added', str.value);
            if (str.removed)
              return colorLines('diff removed', str.value);
            return str.value;
          }).join('');
        }
        function escapeInvisibles(line) {
          return line.replace(/\t/g, '<tab>').replace(/\r/g, '<CR>').replace(/\n/g, '<LF>\n');
        }
        function colorLines(name, str) {
          return str.split('\n').map(function(str) {
            return color(name, str);
          }).join('\n');
        }
        function sameType(a, b) {
          a = Object.prototype.toString.call(a);
          b = Object.prototype.toString.call(b);
          return a == b;
        }
      });
      require.register("reporters/doc.js", function(module, exports, require) {
        var Base = require('./base'),
            utils = require('../utils');
        exports = module.exports = Doc;
        function Doc(runner) {
          Base.call(this, runner);
          var self = this,
              stats = this.stats,
              total = runner.total,
              indents = 2;
          function indent() {
            return Array(indents).join('  ');
          }
          runner.on('suite', function(suite) {
            if (suite.root)
              return ;
            ++indents;
            console.log('%s<section class="suite">', indent());
            ++indents;
            console.log('%s<h1>%s</h1>', indent(), utils.escape(suite.title));
            console.log('%s<dl>', indent());
          });
          runner.on('suite end', function(suite) {
            if (suite.root)
              return ;
            console.log('%s</dl>', indent());
            --indents;
            console.log('%s</section>', indent());
            --indents;
          });
          runner.on('pass', function(test) {
            console.log('%s  <dt>%s</dt>', indent(), utils.escape(test.title));
            var code = utils.escape(utils.clean(test.fn.toString()));
            console.log('%s  <dd><pre><code>%s</code></pre></dd>', indent(), code);
          });
          runner.on('fail', function(test, err) {
            console.log('%s  <dt class="error">%s</dt>', indent(), utils.escape(test.title));
            var code = utils.escape(utils.clean(test.fn.toString()));
            console.log('%s  <dd class="error"><pre><code>%s</code></pre></dd>', indent(), code);
            console.log('%s  <dd class="error">%s</dd>', indent(), utils.escape(err));
          });
        }
      });
      require.register("reporters/dot.js", function(module, exports, require) {
        var Base = require('./base'),
            color = Base.color;
        exports = module.exports = Dot;
        function Dot(runner) {
          Base.call(this, runner);
          var self = this,
              stats = this.stats,
              width = Base.window.width * .75 | 0,
              n = -1;
          runner.on('start', function() {
            process.stdout.write('\n');
          });
          runner.on('pending', function(test) {
            if (++n % width == 0)
              process.stdout.write('\n  ');
            process.stdout.write(color('pending', Base.symbols.dot));
          });
          runner.on('pass', function(test) {
            if (++n % width == 0)
              process.stdout.write('\n  ');
            if ('slow' == test.speed) {
              process.stdout.write(color('bright yellow', Base.symbols.dot));
            } else {
              process.stdout.write(color(test.speed, Base.symbols.dot));
            }
          });
          runner.on('fail', function(test, err) {
            if (++n % width == 0)
              process.stdout.write('\n  ');
            process.stdout.write(color('fail', Base.symbols.dot));
          });
          runner.on('end', function() {
            console.log();
            self.epilogue();
          });
        }
        function F() {}
        ;
        F.prototype = Base.prototype;
        Dot.prototype = new F;
        Dot.prototype.constructor = Dot;
      });
      require.register("reporters/html-cov.js", function(module, exports, require) {
        var JSONCov = require('./json-cov'),
            fs = require('browser/fs');
        exports = module.exports = HTMLCov;
        function HTMLCov(runner) {
          var jade = require('jade'),
              file = __dirname + '/templates/coverage.jade',
              str = fs.readFileSync(file, 'utf8'),
              fn = jade.compile(str, {filename: file}),
              self = this;
          JSONCov.call(this, runner, false);
          runner.on('end', function() {
            process.stdout.write(fn({
              cov: self.cov,
              coverageClass: coverageClass
            }));
          });
        }
        function coverageClass(n) {
          if (n >= 75)
            return 'high';
          if (n >= 50)
            return 'medium';
          if (n >= 25)
            return 'low';
          return 'terrible';
        }
      });
      require.register("reporters/html.js", function(module, exports, require) {
        var Base = require('./base'),
            utils = require('../utils'),
            Progress = require('../browser/progress'),
            escape = utils.escape;
        var Date = global.Date,
            setTimeout = global.setTimeout,
            setInterval = global.setInterval,
            clearTimeout = global.clearTimeout,
            clearInterval = global.clearInterval;
        exports = module.exports = HTML;
        var statsTemplate = '<ul id="mocha-stats">' + '<li class="progress"><canvas width="40" height="40"></canvas></li>' + '<li class="passes"><a href="#">passes:</a> <em>0</em></li>' + '<li class="failures"><a href="#">failures:</a> <em>0</em></li>' + '<li class="duration">duration: <em>0</em>s</li>' + '</ul>';
        function HTML(runner) {
          Base.call(this, runner);
          var self = this,
              stats = this.stats,
              total = runner.total,
              stat = fragment(statsTemplate),
              items = stat.getElementsByTagName('li'),
              passes = items[1].getElementsByTagName('em')[0],
              passesLink = items[1].getElementsByTagName('a')[0],
              failures = items[2].getElementsByTagName('em')[0],
              failuresLink = items[2].getElementsByTagName('a')[0],
              duration = items[3].getElementsByTagName('em')[0],
              canvas = stat.getElementsByTagName('canvas')[0],
              report = fragment('<ul id="mocha-report"></ul>'),
              stack = [report],
              progress,
              ctx,
              root = document.getElementById('mocha');
          if (canvas.getContext) {
            var ratio = window.devicePixelRatio || 1;
            canvas.style.width = canvas.width;
            canvas.style.height = canvas.height;
            canvas.width *= ratio;
            canvas.height *= ratio;
            ctx = canvas.getContext('2d');
            ctx.scale(ratio, ratio);
            progress = new Progress;
          }
          if (!root)
            return error('#mocha div missing, add it to your document');
          on(passesLink, 'click', function() {
            unhide();
            var name = /pass/.test(report.className) ? '' : ' pass';
            report.className = report.className.replace(/fail|pass/g, '') + name;
            if (report.className.trim())
              hideSuitesWithout('test pass');
          });
          on(failuresLink, 'click', function() {
            unhide();
            var name = /fail/.test(report.className) ? '' : ' fail';
            report.className = report.className.replace(/fail|pass/g, '') + name;
            if (report.className.trim())
              hideSuitesWithout('test fail');
          });
          root.appendChild(stat);
          root.appendChild(report);
          if (progress)
            progress.size(40);
          runner.on('suite', function(suite) {
            if (suite.root)
              return ;
            var url = self.suiteURL(suite);
            var el = fragment('<li class="suite"><h1><a href="%s">%s</a></h1></li>', url, escape(suite.title));
            stack[0].appendChild(el);
            stack.unshift(document.createElement('ul'));
            el.appendChild(stack[0]);
          });
          runner.on('suite end', function(suite) {
            if (suite.root)
              return ;
            stack.shift();
          });
          runner.on('fail', function(test, err) {
            if ('hook' == test.type)
              runner.emit('test end', test);
          });
          runner.on('test end', function(test) {
            var percent = stats.tests / this.total * 100 | 0;
            if (progress)
              progress.update(percent).draw(ctx);
            var ms = new Date - stats.start;
            text(passes, stats.passes);
            text(failures, stats.failures);
            text(duration, (ms / 1000).toFixed(2));
            if ('passed' == test.state) {
              var url = self.testURL(test);
              var el = fragment('<li class="test pass %e"><h2>%e<span class="duration">%ems</span> <a href="%s" class="replay">‣</a></h2></li>', test.speed, test.title, test.duration, url);
            } else if (test.pending) {
              var el = fragment('<li class="test pass pending"><h2>%e</h2></li>', test.title);
            } else {
              var el = fragment('<li class="test fail"><h2>%e <a href="%e" class="replay">‣</a></h2></li>', test.title, self.testURL(test));
              var str = test.err.stack || test.err.toString();
              if (!~str.indexOf(test.err.message)) {
                str = test.err.message + '\n' + str;
              }
              if ('[object Error]' == str)
                str = test.err.message;
              if (!test.err.stack && test.err.sourceURL && test.err.line !== undefined) {
                str += "\n(" + test.err.sourceURL + ":" + test.err.line + ")";
              }
              el.appendChild(fragment('<pre class="error">%e</pre>', str));
            }
            if (!test.pending) {
              var h2 = el.getElementsByTagName('h2')[0];
              on(h2, 'click', function() {
                pre.style.display = 'none' == pre.style.display ? 'block' : 'none';
              });
              var pre = fragment('<pre><code>%e</code></pre>', utils.clean(test.fn.toString()));
              el.appendChild(pre);
              pre.style.display = 'none';
            }
            if (stack[0])
              stack[0].appendChild(el);
          });
        }
        var makeUrl = function makeUrl(s) {
          var search = window.location.search;
          if (search) {
            search = search.replace(/[?&]grep=[^&\s]*/g, '').replace(/^&/, '?');
          }
          return window.location.pathname + (search ? search + '&' : '?') + 'grep=' + encodeURIComponent(s);
        };
        HTML.prototype.suiteURL = function(suite) {
          return makeUrl(suite.fullTitle());
        };
        HTML.prototype.testURL = function(test) {
          return makeUrl(test.fullTitle());
        };
        function error(msg) {
          document.body.appendChild(fragment('<div id="mocha-error">%s</div>', msg));
        }
        function fragment(html) {
          var args = arguments,
              div = document.createElement('div'),
              i = 1;
          div.innerHTML = html.replace(/%([se])/g, function(_, type) {
            switch (type) {
              case 's':
                return String(args[i++]);
              case 'e':
                return escape(args[i++]);
            }
          });
          return div.firstChild;
        }
        function hideSuitesWithout(classname) {
          var suites = document.getElementsByClassName('suite');
          for (var i = 0; i < suites.length; i++) {
            var els = suites[i].getElementsByClassName(classname);
            if (0 == els.length)
              suites[i].className += ' hidden';
          }
        }
        function unhide() {
          var els = document.getElementsByClassName('suite hidden');
          for (var i = 0; i < els.length; ++i) {
            els[i].className = els[i].className.replace('suite hidden', 'suite');
          }
        }
        function text(el, str) {
          if (el.textContent) {
            el.textContent = str;
          } else {
            el.innerText = str;
          }
        }
        function on(el, event, fn) {
          if (el.addEventListener) {
            el.addEventListener(event, fn, false);
          } else {
            el.attachEvent('on' + event, fn);
          }
        }
      });
      require.register("reporters/index.js", function(module, exports, require) {
        exports.Base = require('./base');
        exports.Dot = require('./dot');
        exports.Doc = require('./doc');
        exports.TAP = require('./tap');
        exports.JSON = require('./json');
        exports.HTML = require('./html');
        exports.List = require('./list');
        exports.Min = require('./min');
        exports.Spec = require('./spec');
        exports.Nyan = require('./nyan');
        exports.XUnit = require('./xunit');
        exports.Markdown = require('./markdown');
        exports.Progress = require('./progress');
        exports.Landing = require('./landing');
        exports.JSONCov = require('./json-cov');
        exports.HTMLCov = require('./html-cov');
        exports.JSONStream = require('./json-stream');
      });
      require.register("reporters/json-cov.js", function(module, exports, require) {
        var Base = require('./base');
        exports = module.exports = JSONCov;
        function JSONCov(runner, output) {
          var self = this,
              output = 1 == arguments.length ? true : output;
          Base.call(this, runner);
          var tests = [],
              failures = [],
              passes = [];
          runner.on('test end', function(test) {
            tests.push(test);
          });
          runner.on('pass', function(test) {
            passes.push(test);
          });
          runner.on('fail', function(test) {
            failures.push(test);
          });
          runner.on('end', function() {
            var cov = global._$jscoverage || {};
            var result = self.cov = map(cov);
            result.stats = self.stats;
            result.tests = tests.map(clean);
            result.failures = failures.map(clean);
            result.passes = passes.map(clean);
            if (!output)
              return ;
            process.stdout.write(JSON.stringify(result, null, 2));
          });
        }
        function map(cov) {
          var ret = {
            instrumentation: 'node-jscoverage',
            sloc: 0,
            hits: 0,
            misses: 0,
            coverage: 0,
            files: []
          };
          for (var filename in cov) {
            var data = coverage(filename, cov[filename]);
            ret.files.push(data);
            ret.hits += data.hits;
            ret.misses += data.misses;
            ret.sloc += data.sloc;
          }
          ret.files.sort(function(a, b) {
            return a.filename.localeCompare(b.filename);
          });
          if (ret.sloc > 0) {
            ret.coverage = (ret.hits / ret.sloc) * 100;
          }
          return ret;
        }
        function coverage(filename, data) {
          var ret = {
            filename: filename,
            coverage: 0,
            hits: 0,
            misses: 0,
            sloc: 0,
            source: {}
          };
          data.source.forEach(function(line, num) {
            num++;
            if (data[num] === 0) {
              ret.misses++;
              ret.sloc++;
            } else if (data[num] !== undefined) {
              ret.hits++;
              ret.sloc++;
            }
            ret.source[num] = {
              source: line,
              coverage: data[num] === undefined ? '' : data[num]
            };
          });
          ret.coverage = ret.hits / ret.sloc * 100;
          return ret;
        }
        function clean(test) {
          return {
            title: test.title,
            fullTitle: test.fullTitle(),
            duration: test.duration
          };
        }
      });
      require.register("reporters/json-stream.js", function(module, exports, require) {
        var Base = require('./base'),
            color = Base.color;
        exports = module.exports = List;
        function List(runner) {
          Base.call(this, runner);
          var self = this,
              stats = this.stats,
              total = runner.total;
          runner.on('start', function() {
            console.log(JSON.stringify(['start', {total: total}]));
          });
          runner.on('pass', function(test) {
            console.log(JSON.stringify(['pass', clean(test)]));
          });
          runner.on('fail', function(test, err) {
            test = clean(test);
            test.err = err.message;
            console.log(JSON.stringify(['fail', test]));
          });
          runner.on('end', function() {
            process.stdout.write(JSON.stringify(['end', self.stats]));
          });
        }
        function clean(test) {
          return {
            title: test.title,
            fullTitle: test.fullTitle(),
            duration: test.duration
          };
        }
      });
      require.register("reporters/json.js", function(module, exports, require) {
        var Base = require('./base'),
            cursor = Base.cursor,
            color = Base.color;
        exports = module.exports = JSONReporter;
        function JSONReporter(runner) {
          var self = this;
          Base.call(this, runner);
          var tests = [],
              pending = [],
              failures = [],
              passes = [];
          runner.on('test end', function(test) {
            tests.push(test);
          });
          runner.on('pass', function(test) {
            passes.push(test);
          });
          runner.on('fail', function(test) {
            failures.push(test);
          });
          runner.on('pending', function(test) {
            pending.push(test);
          });
          runner.on('end', function() {
            var obj = {
              stats: self.stats,
              tests: tests.map(clean),
              pending: pending.map(clean),
              failures: failures.map(clean),
              passes: passes.map(clean)
            };
            runner.testResults = obj;
            process.stdout.write(JSON.stringify(obj, null, 2));
          });
        }
        function clean(test) {
          return {
            title: test.title,
            fullTitle: test.fullTitle(),
            duration: test.duration,
            err: errorJSON(test.err || {})
          };
        }
        function errorJSON(err) {
          var res = {};
          Object.getOwnPropertyNames(err).forEach(function(key) {
            res[key] = err[key];
          }, err);
          return res;
        }
      });
      require.register("reporters/landing.js", function(module, exports, require) {
        var Base = require('./base'),
            cursor = Base.cursor,
            color = Base.color;
        exports = module.exports = Landing;
        Base.colors.plane = 0;
        Base.colors['plane crash'] = 31;
        Base.colors.runway = 90;
        function Landing(runner) {
          Base.call(this, runner);
          var self = this,
              stats = this.stats,
              width = Base.window.width * .75 | 0,
              total = runner.total,
              stream = process.stdout,
              plane = color('plane', '✈'),
              crashed = -1,
              n = 0;
          function runway() {
            var buf = Array(width).join('-');
            return '  ' + color('runway', buf);
          }
          runner.on('start', function() {
            stream.write('\n\n\n  ');
            cursor.hide();
          });
          runner.on('test end', function(test) {
            var col = -1 == crashed ? width * ++n / total | 0 : crashed;
            if ('failed' == test.state) {
              plane = color('plane crash', '✈');
              crashed = col;
            }
            stream.write('\u001b[' + (width + 1) + 'D\u001b[2A');
            stream.write(runway());
            stream.write('\n  ');
            stream.write(color('runway', Array(col).join('⋅')));
            stream.write(plane);
            stream.write(color('runway', Array(width - col).join('⋅') + '\n'));
            stream.write(runway());
            stream.write('\u001b[0m');
          });
          runner.on('end', function() {
            cursor.show();
            console.log();
            self.epilogue();
          });
        }
        function F() {}
        ;
        F.prototype = Base.prototype;
        Landing.prototype = new F;
        Landing.prototype.constructor = Landing;
      });
      require.register("reporters/list.js", function(module, exports, require) {
        var Base = require('./base'),
            cursor = Base.cursor,
            color = Base.color;
        exports = module.exports = List;
        function List(runner) {
          Base.call(this, runner);
          var self = this,
              stats = this.stats,
              n = 0;
          runner.on('start', function() {
            console.log();
          });
          runner.on('test', function(test) {
            process.stdout.write(color('pass', '    ' + test.fullTitle() + ': '));
          });
          runner.on('pending', function(test) {
            var fmt = color('checkmark', '  -') + color('pending', ' %s');
            console.log(fmt, test.fullTitle());
          });
          runner.on('pass', function(test) {
            var fmt = color('checkmark', '  ' + Base.symbols.dot) + color('pass', ' %s: ') + color(test.speed, '%dms');
            cursor.CR();
            console.log(fmt, test.fullTitle(), test.duration);
          });
          runner.on('fail', function(test, err) {
            cursor.CR();
            console.log(color('fail', '  %d) %s'), ++n, test.fullTitle());
          });
          runner.on('end', self.epilogue.bind(self));
        }
        function F() {}
        ;
        F.prototype = Base.prototype;
        List.prototype = new F;
        List.prototype.constructor = List;
      });
      require.register("reporters/markdown.js", function(module, exports, require) {
        var Base = require('./base'),
            utils = require('../utils');
        var SUITE_PREFIX = '$';
        exports = module.exports = Markdown;
        function Markdown(runner) {
          Base.call(this, runner);
          var self = this,
              stats = this.stats,
              level = 0,
              buf = '';
          function title(str) {
            return Array(level).join('#') + ' ' + str;
          }
          function indent() {
            return Array(level).join('  ');
          }
          function mapTOC(suite, obj) {
            var ret = obj,
                key = SUITE_PREFIX + suite.title;
            obj = obj[key] = obj[key] || {suite: suite};
            suite.suites.forEach(function(suite) {
              mapTOC(suite, obj);
            });
            return ret;
          }
          function stringifyTOC(obj, level) {
            ++level;
            var buf = '';
            var link;
            for (var key in obj) {
              if ('suite' == key)
                continue;
              if (key !== SUITE_PREFIX) {
                link = ' - [' + key.substring(1) + ']';
                link += '(#' + utils.slug(obj[key].suite.fullTitle()) + ')\n';
                buf += Array(level).join('  ') + link;
              }
              buf += stringifyTOC(obj[key], level);
            }
            return buf;
          }
          function generateTOC(suite) {
            var obj = mapTOC(suite, {});
            return stringifyTOC(obj, 0);
          }
          generateTOC(runner.suite);
          runner.on('suite', function(suite) {
            ++level;
            var slug = utils.slug(suite.fullTitle());
            buf += '<a name="' + slug + '"></a>' + '\n';
            buf += title(suite.title) + '\n';
          });
          runner.on('suite end', function(suite) {
            --level;
          });
          runner.on('pass', function(test) {
            var code = utils.clean(test.fn.toString());
            buf += test.title + '.\n';
            buf += '\n```js\n';
            buf += code + '\n';
            buf += '```\n\n';
          });
          runner.on('end', function() {
            process.stdout.write('# TOC\n');
            process.stdout.write(generateTOC(runner.suite));
            process.stdout.write(buf);
          });
        }
      });
      require.register("reporters/min.js", function(module, exports, require) {
        var Base = require('./base');
        exports = module.exports = Min;
        function Min(runner) {
          Base.call(this, runner);
          runner.on('start', function() {
            process.stdout.write('\u001b[2J');
            process.stdout.write('\u001b[1;3H');
          });
          runner.on('end', this.epilogue.bind(this));
        }
        function F() {}
        ;
        F.prototype = Base.prototype;
        Min.prototype = new F;
        Min.prototype.constructor = Min;
      });
      require.register("reporters/nyan.js", function(module, exports, require) {
        var Base = require('./base');
        exports = module.exports = NyanCat;
        function NyanCat(runner) {
          Base.call(this, runner);
          var self = this,
              stats = this.stats,
              width = Base.window.width * .75 | 0,
              rainbowColors = this.rainbowColors = self.generateColors(),
              colorIndex = this.colorIndex = 0,
              numerOfLines = this.numberOfLines = 4,
              trajectories = this.trajectories = [[], [], [], []],
              nyanCatWidth = this.nyanCatWidth = 11,
              trajectoryWidthMax = this.trajectoryWidthMax = (width - nyanCatWidth),
              scoreboardWidth = this.scoreboardWidth = 5,
              tick = this.tick = 0,
              n = 0;
          runner.on('start', function() {
            Base.cursor.hide();
            self.draw();
          });
          runner.on('pending', function(test) {
            self.draw();
          });
          runner.on('pass', function(test) {
            self.draw();
          });
          runner.on('fail', function(test, err) {
            self.draw();
          });
          runner.on('end', function() {
            Base.cursor.show();
            for (var i = 0; i < self.numberOfLines; i++)
              write('\n');
            self.epilogue();
          });
        }
        NyanCat.prototype.draw = function() {
          this.appendRainbow();
          this.drawScoreboard();
          this.drawRainbow();
          this.drawNyanCat();
          this.tick = !this.tick;
        };
        NyanCat.prototype.drawScoreboard = function() {
          var stats = this.stats;
          function draw(type, n) {
            write(' ');
            write(Base.color(type, n));
            write('\n');
          }
          draw('green', stats.passes);
          draw('fail', stats.failures);
          draw('pending', stats.pending);
          write('\n');
          this.cursorUp(this.numberOfLines);
        };
        NyanCat.prototype.appendRainbow = function() {
          var segment = this.tick ? '_' : '-';
          var rainbowified = this.rainbowify(segment);
          for (var index = 0; index < this.numberOfLines; index++) {
            var trajectory = this.trajectories[index];
            if (trajectory.length >= this.trajectoryWidthMax)
              trajectory.shift();
            trajectory.push(rainbowified);
          }
        };
        NyanCat.prototype.drawRainbow = function() {
          var self = this;
          this.trajectories.forEach(function(line, index) {
            write('\u001b[' + self.scoreboardWidth + 'C');
            write(line.join(''));
            write('\n');
          });
          this.cursorUp(this.numberOfLines);
        };
        NyanCat.prototype.drawNyanCat = function() {
          var self = this;
          var startWidth = this.scoreboardWidth + this.trajectories[0].length;
          var dist = '\u001b[' + startWidth + 'C';
          var padding = '';
          write(dist);
          write('_,------,');
          write('\n');
          write(dist);
          padding = self.tick ? '  ' : '   ';
          write('_|' + padding + '/\\_/\\ ');
          write('\n');
          write(dist);
          padding = self.tick ? '_' : '__';
          var tail = self.tick ? '~' : '^';
          var face;
          write(tail + '|' + padding + this.face() + ' ');
          write('\n');
          write(dist);
          padding = self.tick ? ' ' : '  ';
          write(padding + '""  "" ');
          write('\n');
          this.cursorUp(this.numberOfLines);
        };
        NyanCat.prototype.face = function() {
          var stats = this.stats;
          if (stats.failures) {
            return '( x .x)';
          } else if (stats.pending) {
            return '( o .o)';
          } else if (stats.passes) {
            return '( ^ .^)';
          } else {
            return '( - .-)';
          }
        };
        NyanCat.prototype.cursorUp = function(n) {
          write('\u001b[' + n + 'A');
        };
        NyanCat.prototype.cursorDown = function(n) {
          write('\u001b[' + n + 'B');
        };
        NyanCat.prototype.generateColors = function() {
          var colors = [];
          for (var i = 0; i < (6 * 7); i++) {
            var pi3 = Math.floor(Math.PI / 3);
            var n = (i * (1.0 / 6));
            var r = Math.floor(3 * Math.sin(n) + 3);
            var g = Math.floor(3 * Math.sin(n + 2 * pi3) + 3);
            var b = Math.floor(3 * Math.sin(n + 4 * pi3) + 3);
            colors.push(36 * r + 6 * g + b + 16);
          }
          return colors;
        };
        NyanCat.prototype.rainbowify = function(str) {
          if (!Base.useColors)
            return str;
          var color = this.rainbowColors[this.colorIndex % this.rainbowColors.length];
          this.colorIndex += 1;
          return '\u001b[38;5;' + color + 'm' + str + '\u001b[0m';
        };
        function write(string) {
          process.stdout.write(string);
        }
        function F() {}
        ;
        F.prototype = Base.prototype;
        NyanCat.prototype = new F;
        NyanCat.prototype.constructor = NyanCat;
      });
      require.register("reporters/progress.js", function(module, exports, require) {
        var Base = require('./base'),
            cursor = Base.cursor,
            color = Base.color;
        exports = module.exports = Progress;
        Base.colors.progress = 90;
        function Progress(runner, options) {
          Base.call(this, runner);
          var self = this,
              options = options || {},
              stats = this.stats,
              width = Base.window.width * .50 | 0,
              total = runner.total,
              complete = 0,
              max = Math.max,
              lastN = -1;
          options.open = options.open || '[';
          options.complete = options.complete || '▬';
          options.incomplete = options.incomplete || Base.symbols.dot;
          options.close = options.close || ']';
          options.verbose = false;
          runner.on('start', function() {
            console.log();
            cursor.hide();
          });
          runner.on('test end', function() {
            complete++;
            var incomplete = total - complete,
                percent = complete / total,
                n = width * percent | 0,
                i = width - n;
            if (lastN === n && !options.verbose) {
              return ;
            }
            lastN = n;
            cursor.CR();
            process.stdout.write('\u001b[J');
            process.stdout.write(color('progress', '  ' + options.open));
            process.stdout.write(Array(n).join(options.complete));
            process.stdout.write(Array(i).join(options.incomplete));
            process.stdout.write(color('progress', options.close));
            if (options.verbose) {
              process.stdout.write(color('progress', ' ' + complete + ' of ' + total));
            }
          });
          runner.on('end', function() {
            cursor.show();
            console.log();
            self.epilogue();
          });
        }
        function F() {}
        ;
        F.prototype = Base.prototype;
        Progress.prototype = new F;
        Progress.prototype.constructor = Progress;
      });
      require.register("reporters/spec.js", function(module, exports, require) {
        var Base = require('./base'),
            cursor = Base.cursor,
            color = Base.color;
        exports = module.exports = Spec;
        function Spec(runner) {
          Base.call(this, runner);
          var self = this,
              stats = this.stats,
              indents = 0,
              n = 0;
          function indent() {
            return Array(indents).join('  ');
          }
          runner.on('start', function() {
            console.log();
          });
          runner.on('suite', function(suite) {
            ++indents;
            console.log(color('suite', '%s%s'), indent(), suite.title);
          });
          runner.on('suite end', function(suite) {
            --indents;
            if (1 == indents)
              console.log();
          });
          runner.on('pending', function(test) {
            var fmt = indent() + color('pending', '  - %s');
            console.log(fmt, test.title);
          });
          runner.on('pass', function(test) {
            if ('fast' == test.speed) {
              var fmt = indent() + color('checkmark', '  ' + Base.symbols.ok) + color('pass', ' %s');
              cursor.CR();
              console.log(fmt, test.title);
            } else {
              var fmt = indent() + color('checkmark', '  ' + Base.symbols.ok) + color('pass', ' %s') + color(test.speed, ' (%dms)');
              cursor.CR();
              console.log(fmt, test.title, test.duration);
            }
          });
          runner.on('fail', function(test, err) {
            cursor.CR();
            console.log(indent() + color('fail', '  %d) %s'), ++n, test.title);
          });
          runner.on('end', self.epilogue.bind(self));
        }
        function F() {}
        ;
        F.prototype = Base.prototype;
        Spec.prototype = new F;
        Spec.prototype.constructor = Spec;
      });
      require.register("reporters/tap.js", function(module, exports, require) {
        var Base = require('./base'),
            cursor = Base.cursor,
            color = Base.color;
        exports = module.exports = TAP;
        function TAP(runner) {
          Base.call(this, runner);
          var self = this,
              stats = this.stats,
              n = 1,
              passes = 0,
              failures = 0;
          runner.on('start', function() {
            var total = runner.grepTotal(runner.suite);
            console.log('%d..%d', 1, total);
          });
          runner.on('test end', function() {
            ++n;
          });
          runner.on('pending', function(test) {
            console.log('ok %d %s # SKIP -', n, title(test));
          });
          runner.on('pass', function(test) {
            passes++;
            console.log('ok %d %s', n, title(test));
          });
          runner.on('fail', function(test, err) {
            failures++;
            console.log('not ok %d %s', n, title(test));
            if (err.stack)
              console.log(err.stack.replace(/^/gm, '  '));
          });
          runner.on('end', function() {
            console.log('# tests ' + (passes + failures));
            console.log('# pass ' + passes);
            console.log('# fail ' + failures);
          });
        }
        function title(test) {
          return test.fullTitle().replace(/#/g, '');
        }
      });
      require.register("reporters/xunit.js", function(module, exports, require) {
        var Base = require('./base'),
            utils = require('../utils'),
            fs = require('browser/fs'),
            escape = utils.escape;
        var Date = global.Date,
            setTimeout = global.setTimeout,
            setInterval = global.setInterval,
            clearTimeout = global.clearTimeout,
            clearInterval = global.clearInterval;
        exports = module.exports = XUnit;
        function XUnit(runner, options) {
          Base.call(this, runner);
          var stats = this.stats,
              tests = [],
              self = this;
          if (options.reporterOptions && options.reporterOptions.output) {
            if (!fs.createWriteStream) {
              throw new Error('file output not supported in browser');
            }
            self.fileStream = fs.createWriteStream(options.reporterOptions.output);
          }
          runner.on('pending', function(test) {
            tests.push(test);
          });
          runner.on('pass', function(test) {
            tests.push(test);
          });
          runner.on('fail', function(test) {
            tests.push(test);
          });
          runner.on('end', function() {
            self.write(tag('testsuite', {
              name: 'Mocha Tests',
              tests: stats.tests,
              failures: stats.failures,
              errors: stats.failures,
              skipped: stats.tests - stats.failures - stats.passes,
              timestamp: (new Date).toUTCString(),
              time: (stats.duration / 1000) || 0
            }, false));
            tests.forEach(function(t) {
              self.test(t);
            });
            self.write('</testsuite>');
          });
        }
        XUnit.prototype.done = function(failures, fn) {
          if (this.fileStream) {
            this.fileStream.end(function() {
              fn(failures);
            });
          } else {
            fn(failures);
          }
        };
        function F() {}
        ;
        F.prototype = Base.prototype;
        XUnit.prototype = new F;
        XUnit.prototype.constructor = XUnit;
        XUnit.prototype.write = function(line) {
          if (this.fileStream) {
            this.fileStream.write(line + '\n');
          } else {
            console.log(line);
          }
        };
        XUnit.prototype.test = function(test, ostream) {
          var attrs = {
            classname: test.parent.fullTitle(),
            name: test.title,
            time: (test.duration / 1000) || 0
          };
          if ('failed' == test.state) {
            var err = test.err;
            this.write(tag('testcase', attrs, false, tag('failure', {}, false, cdata(escape(err.message) + "\n" + err.stack))));
          } else if (test.pending) {
            this.write(tag('testcase', attrs, false, tag('skipped', {}, true)));
          } else {
            this.write(tag('testcase', attrs, true));
          }
        };
        function tag(name, attrs, close, content) {
          var end = close ? '/>' : '>',
              pairs = [],
              tag;
          for (var key in attrs) {
            pairs.push(key + '="' + escape(attrs[key]) + '"');
          }
          tag = '<' + name + (pairs.length ? ' ' + pairs.join(' ') : '') + end;
          if (content)
            tag += content + '</' + name + end;
          return tag;
        }
        function cdata(str) {
          return '<![CDATA[' + escape(str) + ']]>';
        }
      });
      require.register("runnable.js", function(module, exports, require) {
        var EventEmitter = require('browser/events').EventEmitter,
            debug = require('browser/debug')('mocha:runnable'),
            Pending = require('./pending'),
            milliseconds = require('./ms'),
            utils = require('./utils');
        var Date = global.Date,
            setTimeout = global.setTimeout,
            setInterval = global.setInterval,
            clearTimeout = global.clearTimeout,
            clearInterval = global.clearInterval;
        var toString = Object.prototype.toString;
        module.exports = Runnable;
        function Runnable(title, fn) {
          this.title = title;
          this.fn = fn;
          this.async = fn && fn.length;
          this.sync = !this.async;
          this._timeout = 2000;
          this._slow = 75;
          this._enableTimeouts = true;
          this.timedOut = false;
          this._trace = new Error('done() called multiple times');
        }
        function F() {}
        ;
        F.prototype = EventEmitter.prototype;
        Runnable.prototype = new F;
        Runnable.prototype.constructor = Runnable;
        Runnable.prototype.timeout = function(ms) {
          if (0 == arguments.length)
            return this._timeout;
          if (ms === 0)
            this._enableTimeouts = false;
          if ('string' == typeof ms)
            ms = milliseconds(ms);
          debug('timeout %d', ms);
          this._timeout = ms;
          if (this.timer)
            this.resetTimeout();
          return this;
        };
        Runnable.prototype.slow = function(ms) {
          if (0 === arguments.length)
            return this._slow;
          if ('string' == typeof ms)
            ms = milliseconds(ms);
          debug('timeout %d', ms);
          this._slow = ms;
          return this;
        };
        Runnable.prototype.enableTimeouts = function(enabled) {
          if (arguments.length === 0)
            return this._enableTimeouts;
          debug('enableTimeouts %s', enabled);
          this._enableTimeouts = enabled;
          return this;
        };
        Runnable.prototype.skip = function() {
          throw new Pending();
        };
        Runnable.prototype.fullTitle = function() {
          return this.parent.fullTitle() + ' ' + this.title;
        };
        Runnable.prototype.clearTimeout = function() {
          clearTimeout(this.timer);
        };
        Runnable.prototype.inspect = function() {
          return JSON.stringify(this, function(key, val) {
            if ('_' == key[0])
              return ;
            if ('parent' == key)
              return '#<Suite>';
            if ('ctx' == key)
              return '#<Context>';
            return val;
          }, 2);
        };
        Runnable.prototype.resetTimeout = function() {
          var self = this;
          var ms = this.timeout() || 1e9;
          if (!this._enableTimeouts)
            return ;
          this.clearTimeout();
          this.timer = setTimeout(function() {
            if (!self._enableTimeouts)
              return ;
            self.callback(new Error('timeout of ' + ms + 'ms exceeded. Ensure the done() callback is being called in this test.'));
            self.timedOut = true;
          }, ms);
        };
        Runnable.prototype.globals = function(arr) {
          var self = this;
          this._allowedGlobals = arr;
        };
        Runnable.prototype.run = function(fn) {
          var self = this,
              start = new Date,
              ctx = this.ctx,
              finished,
              emitted;
          if (ctx && ctx.runnable)
            ctx.runnable(this);
          function multiple(err) {
            if (emitted)
              return ;
            emitted = true;
            self.emit('error', err || new Error('done() called multiple times; stacktrace may be inaccurate'));
          }
          function done(err) {
            var ms = self.timeout();
            if (self.timedOut)
              return ;
            if (finished)
              return multiple(err || self._trace);
            if (self.state)
              return ;
            self.clearTimeout();
            self.duration = new Date - start;
            finished = true;
            if (!err && self.duration > ms && self._enableTimeouts)
              err = new Error('timeout of ' + ms + 'ms exceeded. Ensure the done() callback is being called in this test.');
            fn(err);
          }
          this.callback = done;
          if (this.async) {
            this.resetTimeout();
            try {
              this.fn.call(ctx, function(err) {
                if (err instanceof Error || toString.call(err) === "[object Error]")
                  return done(err);
                if (null != err) {
                  if (Object.prototype.toString.call(err) === '[object Object]') {
                    return done(new Error('done() invoked with non-Error: ' + JSON.stringify(err)));
                  } else {
                    return done(new Error('done() invoked with non-Error: ' + err));
                  }
                }
                done();
              });
            } catch (err) {
              done(utils.getError(err));
            }
            return ;
          }
          if (this.asyncOnly) {
            return done(new Error('--async-only option in use without declaring `done()`'));
          }
          try {
            if (this.pending) {
              done();
            } else {
              callFn(this.fn);
            }
          } catch (err) {
            done(utils.getError(err));
          }
          function callFn(fn) {
            var result = fn.call(ctx);
            if (result && typeof result.then === 'function') {
              self.resetTimeout();
              result.then(function() {
                done();
              }, function(reason) {
                done(reason || new Error('Promise rejected with no or falsy reason'));
              });
            } else {
              done();
            }
          }
        };
      });
      require.register("runner.js", function(module, exports, require) {
        var EventEmitter = require('browser/events').EventEmitter,
            debug = require('browser/debug')('mocha:runner'),
            Pending = require('./pending'),
            Test = require('./test'),
            utils = require('./utils'),
            filter = utils.filter,
            keys = utils.keys,
            type = utils.type,
            stringify = utils.stringify,
            stackFilter = utils.stackTraceFilter();
        var globals = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'XMLHttpRequest', 'Date', 'setImmediate', 'clearImmediate'];
        module.exports = Runner;
        function Runner(suite, delay) {
          var self = this;
          this._globals = [];
          this._abort = false;
          this._delay = delay;
          this.suite = suite;
          this.total = suite.total();
          this.failures = 0;
          this.on('test end', function(test) {
            self.checkGlobals(test);
          });
          this.on('hook end', function(hook) {
            self.checkGlobals(hook);
          });
          this.grep(/.*/);
          this.globals(this.globalProps().concat(extraGlobals()));
        }
        Runner.immediately = global.setImmediate || process.nextTick;
        function F() {}
        ;
        F.prototype = EventEmitter.prototype;
        Runner.prototype = new F;
        Runner.prototype.constructor = Runner;
        Runner.prototype.grep = function(re, invert) {
          debug('grep %s', re);
          this._grep = re;
          this._invert = invert;
          this.total = this.grepTotal(this.suite);
          return this;
        };
        Runner.prototype.grepTotal = function(suite) {
          var self = this;
          var total = 0;
          suite.eachTest(function(test) {
            var match = self._grep.test(test.fullTitle());
            if (self._invert)
              match = !match;
            if (match)
              total++;
          });
          return total;
        };
        Runner.prototype.globalProps = function() {
          var props = utils.keys(global);
          for (var i = 0; i < globals.length; ++i) {
            if (~utils.indexOf(props, globals[i]))
              continue;
            props.push(globals[i]);
          }
          return props;
        };
        Runner.prototype.globals = function(arr) {
          if (0 == arguments.length)
            return this._globals;
          debug('globals %j', arr);
          this._globals = this._globals.concat(arr);
          return this;
        };
        Runner.prototype.checkGlobals = function(test) {
          if (this.ignoreLeaks)
            return ;
          var ok = this._globals;
          var globals = this.globalProps();
          var leaks;
          if (test) {
            ok = ok.concat(test._allowedGlobals || []);
          }
          if (this.prevGlobalsLength == globals.length)
            return ;
          this.prevGlobalsLength = globals.length;
          leaks = filterLeaks(ok, globals);
          this._globals = this._globals.concat(leaks);
          if (leaks.length > 1) {
            this.fail(test, new Error('global leaks detected: ' + leaks.join(', ') + ''));
          } else if (leaks.length) {
            this.fail(test, new Error('global leak detected: ' + leaks[0]));
          }
        };
        Runner.prototype.fail = function(test, err) {
          ++this.failures;
          test.state = 'failed';
          if (!(err instanceof Error)) {
            err = new Error('the ' + type(err) + ' ' + stringify(err) + ' was thrown, throw an Error :)');
          }
          err.stack = (this.fullStackTrace || !err.stack) ? err.stack : stackFilter(err.stack);
          this.emit('fail', test, err);
        };
        Runner.prototype.failHook = function(hook, err) {
          this.fail(hook, err);
          if (this.suite.bail()) {
            this.emit('end');
          }
        };
        Runner.prototype.hook = function(name, fn) {
          var suite = this.suite,
              hooks = suite['_' + name],
              self = this,
              timer;
          function next(i) {
            var hook = hooks[i];
            if (!hook)
              return fn();
            self.currentRunnable = hook;
            hook.ctx.currentTest = self.test;
            self.emit('hook', hook);
            hook.on('error', function(err) {
              self.failHook(hook, err);
            });
            hook.run(function(err) {
              hook.removeAllListeners('error');
              var testError = hook.error();
              if (testError)
                self.fail(self.test, testError);
              if (err) {
                if (err instanceof Pending) {
                  suite.pending = true;
                } else {
                  self.failHook(hook, err);
                  return fn(err);
                }
              }
              self.emit('hook end', hook);
              delete hook.ctx.currentTest;
              next(++i);
            });
          }
          Runner.immediately(function() {
            next(0);
          });
        };
        Runner.prototype.hooks = function(name, suites, fn) {
          var self = this,
              orig = this.suite;
          function next(suite) {
            self.suite = suite;
            if (!suite) {
              self.suite = orig;
              return fn();
            }
            self.hook(name, function(err) {
              if (err) {
                var errSuite = self.suite;
                self.suite = orig;
                return fn(err, errSuite);
              }
              next(suites.pop());
            });
          }
          next(suites.pop());
        };
        Runner.prototype.hookUp = function(name, fn) {
          var suites = [this.suite].concat(this.parents()).reverse();
          this.hooks(name, suites, fn);
        };
        Runner.prototype.hookDown = function(name, fn) {
          var suites = [this.suite].concat(this.parents());
          this.hooks(name, suites, fn);
        };
        Runner.prototype.parents = function() {
          var suite = this.suite,
              suites = [];
          while (suite = suite.parent)
            suites.push(suite);
          return suites;
        };
        Runner.prototype.runTest = function(fn) {
          var test = this.test,
              self = this;
          if (this.asyncOnly)
            test.asyncOnly = true;
          try {
            test.on('error', function(err) {
              self.fail(test, err);
            });
            test.run(fn);
          } catch (err) {
            fn(err);
          }
        };
        Runner.prototype.runTests = function(suite, fn) {
          var self = this,
              tests = suite.tests.slice(),
              test;
          function hookErr(err, errSuite, after) {
            var orig = self.suite;
            self.suite = after ? errSuite.parent : errSuite;
            if (self.suite) {
              self.hookUp('afterEach', function(err2, errSuite2) {
                self.suite = orig;
                if (err2)
                  return hookErr(err2, errSuite2, true);
                fn(errSuite);
              });
            } else {
              self.suite = orig;
              fn(errSuite);
            }
          }
          function next(err, errSuite) {
            if (self.failures && suite._bail)
              return fn();
            if (self._abort)
              return fn();
            if (err)
              return hookErr(err, errSuite, true);
            test = tests.shift();
            if (!test)
              return fn();
            var match = self._grep.test(test.fullTitle());
            if (self._invert)
              match = !match;
            if (!match)
              return next();
            if (test.pending) {
              self.emit('pending', test);
              self.emit('test end', test);
              return next();
            }
            self.emit('test', self.test = test);
            self.hookDown('beforeEach', function(err, errSuite) {
              if (suite.pending) {
                self.emit('pending', test);
                self.emit('test end', test);
                return next();
              }
              if (err)
                return hookErr(err, errSuite, false);
              self.currentRunnable = self.test;
              self.runTest(function(err) {
                test = self.test;
                if (err) {
                  if (err instanceof Pending) {
                    self.emit('pending', test);
                  } else {
                    self.fail(test, err);
                  }
                  self.emit('test end', test);
                  if (err instanceof Pending) {
                    return next();
                  }
                  return self.hookUp('afterEach', next);
                }
                test.state = 'passed';
                self.emit('pass', test);
                self.emit('test end', test);
                self.hookUp('afterEach', next);
              });
            });
          }
          this.next = next;
          next();
        };
        Runner.prototype.runSuite = function(suite, fn) {
          var total = this.grepTotal(suite),
              self = this,
              i = 0;
          debug('run suite %s', suite.fullTitle());
          if (!total)
            return fn();
          this.emit('suite', this.suite = suite);
          function next(errSuite) {
            if (errSuite) {
              if (errSuite == suite) {
                return done();
              } else {
                return done(errSuite);
              }
            }
            if (self._abort)
              return done();
            var curr = suite.suites[i++];
            if (!curr)
              return done();
            self.runSuite(curr, next);
          }
          function done(errSuite) {
            self.suite = suite;
            self.hook('afterAll', function() {
              self.emit('suite end', suite);
              fn(errSuite);
            });
          }
          this.hook('beforeAll', function(err) {
            if (err)
              return done();
            self.runTests(suite, next);
          });
        };
        Runner.prototype.uncaught = function(err) {
          if (err) {
            debug('uncaught exception %s', err !== function() {
              return this;
            }.call(err) ? err : (err.message || err));
          } else {
            debug('uncaught undefined exception');
            err = utils.undefinedError();
          }
          err.uncaught = true;
          var runnable = this.currentRunnable;
          if (!runnable)
            return ;
          runnable.clearTimeout();
          if (runnable.state)
            return ;
          this.fail(runnable, err);
          if ('test' == runnable.type) {
            this.emit('test end', runnable);
            this.hookUp('afterEach', this.next);
            return ;
          }
          this.emit('end');
        };
        Runner.prototype.run = function(fn) {
          var self = this,
              rootSuite = this.suite;
          fn = fn || function() {};
          function uncaught(err) {
            self.uncaught(err);
          }
          function start() {
            self.emit('start');
            self.runSuite(rootSuite, function() {
              debug('finished running');
              self.emit('end');
            });
          }
          debug('start');
          this.on('end', function() {
            debug('end');
            process.removeListener('uncaughtException', uncaught);
            fn(self.failures);
          });
          process.on('uncaughtException', uncaught);
          if (this._delay) {
            this.emit('waiting', rootSuite);
            rootSuite.once('run', start);
          } else {
            start();
          }
          return this;
        };
        Runner.prototype.abort = function() {
          debug('aborting');
          this._abort = true;
        };
        function filterLeaks(ok, globals) {
          return filter(globals, function(key) {
            if (/^d+/.test(key))
              return false;
            if (global.navigator && /^getInterface/.test(key))
              return false;
            if (global.navigator && /^\d+/.test(key))
              return false;
            if (/^mocha-/.test(key))
              return false;
            var matched = filter(ok, function(ok) {
              if (~ok.indexOf('*'))
                return 0 == key.indexOf(ok.split('*')[0]);
              return key == ok;
            });
            return matched.length == 0 && (!global.navigator || 'onerror' !== key);
          });
        }
        function extraGlobals() {
          if (typeof(process) === 'object' && typeof(process.version) === 'string') {
            var nodeVersion = process.version.split('.').reduce(function(a, v) {
              return a << 8 | v;
            });
            if (nodeVersion < 0x00090B) {
              return ['errno'];
            }
          }
          return [];
        }
      });
      require.register("suite.js", function(module, exports, require) {
        var EventEmitter = require('browser/events').EventEmitter,
            debug = require('browser/debug')('mocha:suite'),
            milliseconds = require('./ms'),
            utils = require('./utils'),
            Hook = require('./hook');
        exports = module.exports = Suite;
        exports.create = function(parent, title) {
          var suite = new Suite(title, parent.ctx);
          suite.parent = parent;
          if (parent.pending)
            suite.pending = true;
          title = suite.fullTitle();
          parent.addSuite(suite);
          return suite;
        };
        function Suite(title, parentContext) {
          this.title = title;
          var context = function() {};
          context.prototype = parentContext;
          this.ctx = new context();
          this.suites = [];
          this.tests = [];
          this.pending = false;
          this._beforeEach = [];
          this._beforeAll = [];
          this._afterEach = [];
          this._afterAll = [];
          this.root = !title;
          this._timeout = 2000;
          this._enableTimeouts = true;
          this._slow = 75;
          this._bail = false;
          this.delayed = false;
        }
        function F() {}
        ;
        F.prototype = EventEmitter.prototype;
        Suite.prototype = new F;
        Suite.prototype.constructor = Suite;
        Suite.prototype.clone = function() {
          var suite = new Suite(this.title);
          debug('clone');
          suite.ctx = this.ctx;
          suite.timeout(this.timeout());
          suite.enableTimeouts(this.enableTimeouts());
          suite.slow(this.slow());
          suite.bail(this.bail());
          return suite;
        };
        Suite.prototype.timeout = function(ms) {
          if (0 == arguments.length)
            return this._timeout;
          if (ms.toString() === '0')
            this._enableTimeouts = false;
          if ('string' == typeof ms)
            ms = milliseconds(ms);
          debug('timeout %d', ms);
          this._timeout = parseInt(ms, 10);
          return this;
        };
        Suite.prototype.enableTimeouts = function(enabled) {
          if (arguments.length === 0)
            return this._enableTimeouts;
          debug('enableTimeouts %s', enabled);
          this._enableTimeouts = enabled;
          return this;
        };
        Suite.prototype.slow = function(ms) {
          if (0 === arguments.length)
            return this._slow;
          if ('string' == typeof ms)
            ms = milliseconds(ms);
          debug('slow %d', ms);
          this._slow = ms;
          return this;
        };
        Suite.prototype.bail = function(bail) {
          if (0 == arguments.length)
            return this._bail;
          debug('bail %s', bail);
          this._bail = bail;
          return this;
        };
        Suite.prototype.beforeAll = function(title, fn) {
          if (this.pending)
            return this;
          if ('function' === typeof title) {
            fn = title;
            title = fn.name;
          }
          title = '"before all" hook' + (title ? ': ' + title : '');
          var hook = new Hook(title, fn);
          hook.parent = this;
          hook.timeout(this.timeout());
          hook.enableTimeouts(this.enableTimeouts());
          hook.slow(this.slow());
          hook.ctx = this.ctx;
          this._beforeAll.push(hook);
          this.emit('beforeAll', hook);
          return this;
        };
        Suite.prototype.afterAll = function(title, fn) {
          if (this.pending)
            return this;
          if ('function' === typeof title) {
            fn = title;
            title = fn.name;
          }
          title = '"after all" hook' + (title ? ': ' + title : '');
          var hook = new Hook(title, fn);
          hook.parent = this;
          hook.timeout(this.timeout());
          hook.enableTimeouts(this.enableTimeouts());
          hook.slow(this.slow());
          hook.ctx = this.ctx;
          this._afterAll.push(hook);
          this.emit('afterAll', hook);
          return this;
        };
        Suite.prototype.beforeEach = function(title, fn) {
          if (this.pending)
            return this;
          if ('function' === typeof title) {
            fn = title;
            title = fn.name;
          }
          title = '"before each" hook' + (title ? ': ' + title : '');
          var hook = new Hook(title, fn);
          hook.parent = this;
          hook.timeout(this.timeout());
          hook.enableTimeouts(this.enableTimeouts());
          hook.slow(this.slow());
          hook.ctx = this.ctx;
          this._beforeEach.push(hook);
          this.emit('beforeEach', hook);
          return this;
        };
        Suite.prototype.afterEach = function(title, fn) {
          if (this.pending)
            return this;
          if ('function' === typeof title) {
            fn = title;
            title = fn.name;
          }
          title = '"after each" hook' + (title ? ': ' + title : '');
          var hook = new Hook(title, fn);
          hook.parent = this;
          hook.timeout(this.timeout());
          hook.enableTimeouts(this.enableTimeouts());
          hook.slow(this.slow());
          hook.ctx = this.ctx;
          this._afterEach.push(hook);
          this.emit('afterEach', hook);
          return this;
        };
        Suite.prototype.addSuite = function(suite) {
          suite.parent = this;
          suite.timeout(this.timeout());
          suite.enableTimeouts(this.enableTimeouts());
          suite.slow(this.slow());
          suite.bail(this.bail());
          this.suites.push(suite);
          this.emit('suite', suite);
          return this;
        };
        Suite.prototype.addTest = function(test) {
          test.parent = this;
          test.timeout(this.timeout());
          test.enableTimeouts(this.enableTimeouts());
          test.slow(this.slow());
          test.ctx = this.ctx;
          this.tests.push(test);
          this.emit('test', test);
          return this;
        };
        Suite.prototype.fullTitle = function() {
          if (this.parent) {
            var full = this.parent.fullTitle();
            if (full)
              return full + ' ' + this.title;
          }
          return this.title;
        };
        Suite.prototype.total = function() {
          return utils.reduce(this.suites, function(sum, suite) {
            return sum + suite.total();
          }, 0) + this.tests.length;
        };
        Suite.prototype.eachTest = function(fn) {
          utils.forEach(this.tests, fn);
          utils.forEach(this.suites, function(suite) {
            suite.eachTest(fn);
          });
          return this;
        };
        Suite.prototype.run = function run() {
          if (this.root) {
            this.emit('run');
          }
        };
      });
      require.register("test.js", function(module, exports, require) {
        var Runnable = require('./runnable');
        module.exports = Test;
        function Test(title, fn) {
          Runnable.call(this, title, fn);
          this.pending = !fn;
          this.type = 'test';
        }
        function F() {}
        ;
        F.prototype = Runnable.prototype;
        Test.prototype = new F;
        Test.prototype.constructor = Test;
      });
      require.register("utils.js", function(module, exports, require) {
        var fs = require('browser/fs'),
            path = require('browser/path'),
            basename = path.basename,
            exists = fs.existsSync || path.existsSync,
            glob = require('browser/glob'),
            join = path.join,
            debug = require('browser/debug')('mocha:watch');
        var ignore = ['node_modules', '.git'];
        exports.escape = function(html) {
          return String(html).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        };
        exports.forEach = function(arr, fn, scope) {
          for (var i = 0,
              l = arr.length; i < l; i++)
            fn.call(scope, arr[i], i);
        };
        exports.map = function(arr, fn, scope) {
          var result = [];
          for (var i = 0,
              l = arr.length; i < l; i++)
            result.push(fn.call(scope, arr[i], i, arr));
          return result;
        };
        exports.indexOf = function(arr, obj, start) {
          for (var i = start || 0,
              l = arr.length; i < l; i++) {
            if (arr[i] === obj)
              return i;
          }
          return -1;
        };
        exports.reduce = function(arr, fn, val) {
          var rval = val;
          for (var i = 0,
              l = arr.length; i < l; i++) {
            rval = fn(rval, arr[i], i, arr);
          }
          return rval;
        };
        exports.filter = function(arr, fn) {
          var ret = [];
          for (var i = 0,
              l = arr.length; i < l; i++) {
            var val = arr[i];
            if (fn(val, i, arr))
              ret.push(val);
          }
          return ret;
        };
        exports.keys = Object.keys || function(obj) {
          var keys = [],
              has = Object.prototype.hasOwnProperty;
          for (var key in obj) {
            if (has.call(obj, key)) {
              keys.push(key);
            }
          }
          return keys;
        };
        exports.watch = function(files, fn) {
          var options = {interval: 100};
          files.forEach(function(file) {
            debug('file %s', file);
            fs.watchFile(file, options, function(curr, prev) {
              if (prev.mtime < curr.mtime)
                fn(file);
            });
          });
        };
        var isArray = Array.isArray || function(obj) {
          return '[object Array]' == {}.toString.call(obj);
        };
        if (typeof Buffer !== 'undefined' && Buffer.prototype) {
          Buffer.prototype.toJSON = Buffer.prototype.toJSON || function() {
            return Array.prototype.slice.call(this, 0);
          };
        }
        function ignored(path) {
          return !~ignore.indexOf(path);
        }
        exports.files = function(dir, ext, ret) {
          ret = ret || [];
          ext = ext || ['js'];
          var re = new RegExp('\\.(' + ext.join('|') + ')$');
          fs.readdirSync(dir).filter(ignored).forEach(function(path) {
            path = join(dir, path);
            if (fs.statSync(path).isDirectory()) {
              exports.files(path, ext, ret);
            } else if (path.match(re)) {
              ret.push(path);
            }
          });
          return ret;
        };
        exports.slug = function(str) {
          return str.toLowerCase().replace(/ +/g, '-').replace(/[^-\w]/g, '');
        };
        exports.clean = function(str) {
          str = str.replace(/\r\n?|[\n\u2028\u2029]/g, "\n").replace(/^\uFEFF/, '').replace(/^function *\(.*\)\s*{|\(.*\) *=> *{?/, '').replace(/\s+\}$/, '');
          var spaces = str.match(/^\n?( *)/)[1].length,
              tabs = str.match(/^\n?(\t*)/)[1].length,
              re = new RegExp('^\n?' + (tabs ? '\t' : ' ') + '{' + (tabs ? tabs : spaces) + '}', 'gm');
          str = str.replace(re, '');
          return exports.trim(str);
        };
        exports.trim = function(str) {
          return str.replace(/^\s+|\s+$/g, '');
        };
        exports.parseQuery = function(qs) {
          return exports.reduce(qs.replace('?', '').split('&'), function(obj, pair) {
            var i = pair.indexOf('='),
                key = pair.slice(0, i),
                val = pair.slice(++i);
            obj[key] = decodeURIComponent(val);
            return obj;
          }, {});
        };
        function highlight(js) {
          return js.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\/\/(.*)/gm, '<span class="comment">//$1</span>').replace(/('.*?')/gm, '<span class="string">$1</span>').replace(/(\d+\.\d+)/gm, '<span class="number">$1</span>').replace(/(\d+)/gm, '<span class="number">$1</span>').replace(/\bnew[ \t]+(\w+)/gm, '<span class="keyword">new</span> <span class="init">$1</span>').replace(/\b(function|new|throw|return|var|if|else)\b/gm, '<span class="keyword">$1</span>');
        }
        exports.highlightTags = function(name) {
          var code = document.getElementById('mocha').getElementsByTagName(name);
          for (var i = 0,
              len = code.length; i < len; ++i) {
            code[i].innerHTML = highlight(code[i].innerHTML);
          }
        };
        var emptyRepresentation = function emptyRepresentation(value, type) {
          type = type || exports.type(value);
          switch (type) {
            case 'function':
              return '[Function]';
            case 'object':
              return '{}';
            case 'array':
              return '[]';
            default:
              return value.toString();
          }
        };
        exports.type = function type(value) {
          if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
            return 'buffer';
          }
          return Object.prototype.toString.call(value).replace(/^\[.+\s(.+?)\]$/, '$1').toLowerCase();
        };
        exports.stringify = function(value) {
          var type = exports.type(value);
          if (!~exports.indexOf(['object', 'array', 'function'], type)) {
            if (type != 'buffer') {
              return jsonStringify(value);
            }
            var json = value.toJSON();
            return jsonStringify(json.data && json.type ? json.data : json, 2).replace(/,(\n|$)/g, '$1');
          }
          for (var prop in value) {
            if (Object.prototype.hasOwnProperty.call(value, prop)) {
              return jsonStringify(exports.canonicalize(value), 2).replace(/,(\n|$)/g, '$1');
            }
          }
          return emptyRepresentation(value, type);
        };
        function jsonStringify(object, spaces, depth) {
          if (typeof spaces == 'undefined')
            return _stringify(object);
          depth = depth || 1;
          var space = spaces * depth,
              str = isArray(object) ? '[' : '{',
              end = isArray(object) ? ']' : '}',
              length = object.length || exports.keys(object).length,
              repeat = function(s, n) {
                return new Array(n).join(s);
              };
          function _stringify(val) {
            switch (exports.type(val)) {
              case 'null':
              case 'undefined':
                val = '[' + val + ']';
                break;
              case 'array':
              case 'object':
                val = jsonStringify(val, spaces, depth + 1);
                break;
              case 'boolean':
              case 'regexp':
              case 'number':
                val = val === 0 && (1 / val) === -Infinity ? '-0' : val.toString();
                break;
              case 'date':
                val = '[Date: ' + val.toISOString() + ']';
                break;
              case 'buffer':
                var json = val.toJSON();
                json = json.data && json.type ? json.data : json;
                val = '[Buffer: ' + jsonStringify(json, 2, depth + 1) + ']';
                break;
              default:
                val = (val == '[Function]' || val == '[Circular]') ? val : '"' + val + '"';
            }
            return val;
          }
          for (var i in object) {
            if (!object.hasOwnProperty(i))
              continue;
            --length;
            str += '\n ' + repeat(' ', space) + (isArray(object) ? '' : '"' + i + '": ') + _stringify(object[i]) + (length ? ',' : '');
          }
          return str + (str.length != 1 ? '\n' + repeat(' ', --space) + end : end);
        }
        exports.isBuffer = function(arg) {
          return typeof Buffer !== 'undefined' && Buffer.isBuffer(arg);
        };
        exports.canonicalize = function(value, stack) {
          var canonicalizedObj,
              type = exports.type(value),
              prop,
              withStack = function withStack(value, fn) {
                stack.push(value);
                fn();
                stack.pop();
              };
          stack = stack || [];
          if (exports.indexOf(stack, value) !== -1) {
            return '[Circular]';
          }
          switch (type) {
            case 'undefined':
            case 'buffer':
            case 'null':
              canonicalizedObj = value;
              break;
            case 'array':
              withStack(value, function() {
                canonicalizedObj = exports.map(value, function(item) {
                  return exports.canonicalize(item, stack);
                });
              });
              break;
            case 'function':
              for (prop in value) {
                canonicalizedObj = {};
                break;
              }
              if (!canonicalizedObj) {
                canonicalizedObj = emptyRepresentation(value, type);
                break;
              }
            case 'object':
              canonicalizedObj = canonicalizedObj || {};
              withStack(value, function() {
                exports.forEach(exports.keys(value).sort(), function(key) {
                  canonicalizedObj[key] = exports.canonicalize(value[key], stack);
                });
              });
              break;
            case 'date':
            case 'number':
            case 'regexp':
            case 'boolean':
              canonicalizedObj = value;
              break;
            default:
              canonicalizedObj = value.toString();
          }
          return canonicalizedObj;
        };
        exports.lookupFiles = function lookupFiles(path, extensions, recursive) {
          var files = [];
          var re = new RegExp('\\.(' + extensions.join('|') + ')$');
          if (!exists(path)) {
            if (exists(path + '.js')) {
              path += '.js';
            } else {
              files = glob.sync(path);
              if (!files.length)
                throw new Error("cannot resolve path (or pattern) '" + path + "'");
              return files;
            }
          }
          try {
            var stat = fs.statSync(path);
            if (stat.isFile())
              return path;
          } catch (ignored) {
            return ;
          }
          fs.readdirSync(path).forEach(function(file) {
            file = join(path, file);
            try {
              var stat = fs.statSync(file);
              if (stat.isDirectory()) {
                if (recursive) {
                  files = files.concat(lookupFiles(file, extensions, recursive));
                }
                return ;
              }
            } catch (ignored) {
              return ;
            }
            if (!stat.isFile() || !re.test(file) || basename(file)[0] === '.')
              return ;
            files.push(file);
          });
          return files;
        };
        exports.undefinedError = function() {
          return new Error('Caught undefined error, did you throw without specifying what?');
        };
        exports.getError = function(err) {
          return err || exports.undefinedError();
        };
        exports.stackTraceFilter = function() {
          var slash = '/',
              is = typeof document === 'undefined' ? {node: true} : {browser: true},
              cwd = is.node ? process.cwd() + slash : location.href.replace(/\/[^\/]*$/, '/');
          function isNodeModule(line) {
            return (~line.indexOf('node_modules'));
          }
          function isMochaInternal(line) {
            return (~line.indexOf('node_modules' + slash + 'mocha')) || (~line.indexOf('components' + slash + 'mochajs')) || (~line.indexOf('components' + slash + 'mocha'));
          }
          function isBrowserModule(line) {
            return (~line.indexOf('node_modules')) || (~line.indexOf('components'));
          }
          function isNodeInternal(line) {
            return (~line.indexOf('(timers.js:')) || (~line.indexOf('(events.js:')) || (~line.indexOf('(node.js:')) || (~line.indexOf('(module.js:')) || (~line.indexOf('GeneratorFunctionPrototype.next (native)')) || false;
          }
          return function(stack) {
            stack = stack.split('\n');
            stack = exports.reduce(stack, function(list, line) {
              if (is.node && (isNodeModule(line) || isMochaInternal(line) || isNodeInternal(line)))
                return list;
              if (is.browser && (isBrowserModule(line)))
                return list;
              list.push(line.replace(cwd, ''));
              return list;
            }, []);
            return stack.join('\n');
          };
        };
      });
      var global = (function() {
        return this;
      })();
      var Date = global.Date;
      var setTimeout = global.setTimeout;
      var setInterval = global.setInterval;
      var clearTimeout = global.clearTimeout;
      var clearInterval = global.clearInterval;
      var process = {};
      process.exit = function(status) {};
      process.stdout = {};
      var uncaughtExceptionHandlers = [];
      var originalOnerrorHandler = global.onerror;
      process.removeListener = function(e, fn) {
        if ('uncaughtException' == e) {
          if (originalOnerrorHandler) {
            global.onerror = originalOnerrorHandler;
          } else {
            global.onerror = function() {};
          }
          var i = Mocha.utils.indexOf(uncaughtExceptionHandlers, fn);
          if (i != -1) {
            uncaughtExceptionHandlers.splice(i, 1);
          }
        }
      };
      process.on = function(e, fn) {
        if ('uncaughtException' == e) {
          global.onerror = function(err, url, line) {
            fn(new Error(err + ' (' + url + ':' + line + ')'));
            return true;
          };
          uncaughtExceptionHandlers.push(fn);
        }
      };
      var Mocha = global.Mocha = require('mocha'),
          mocha = global.mocha = new Mocha({reporter: 'html'});
      mocha.suite.removeAllListeners('pre-require');
      var immediateQueue = [],
          immediateTimeout;
      function timeslice() {
        var immediateStart = new Date().getTime();
        while (immediateQueue.length && (new Date().getTime() - immediateStart) < 100) {
          immediateQueue.shift()();
        }
        if (immediateQueue.length) {
          immediateTimeout = setTimeout(timeslice, 0);
        } else {
          immediateTimeout = null;
        }
      }
      Mocha.Runner.immediately = function(callback) {
        immediateQueue.push(callback);
        if (!immediateTimeout) {
          immediateTimeout = setTimeout(timeslice, 0);
        }
      };
      mocha.throwError = function(err) {
        Mocha.utils.forEach(uncaughtExceptionHandlers, function(fn) {
          fn(err);
        });
        throw err;
      };
      mocha.ui = function(ui) {
        Mocha.prototype.ui.call(this, ui);
        this.suite.emit('pre-require', global, null, this);
        return this;
      };
      mocha.setup = function(opts) {
        if ('string' == typeof opts)
          opts = {ui: opts};
        for (var opt in opts)
          this[opt](opts[opt]);
        return this;
      };
      mocha.run = function(fn) {
        var options = mocha.options;
        mocha.globals('location');
        var query = Mocha.utils.parseQuery(global.location.search || '');
        if (query.grep)
          mocha.grep(new RegExp(query.grep));
        if (query.fgrep)
          mocha.grep(query.fgrep);
        if (query.invert)
          mocha.invert();
        return Mocha.prototype.run.call(mocha, function(err) {
          var document = global.document;
          if (document && document.getElementById('mocha') && options.noHighlighting !== true) {
            Mocha.utils.highlightTags('code');
          }
          if (fn)
            fn(err);
        });
      };
      Mocha.process = process;
    })();
  }).call(System.global);
  return System.get("@@global-helpers").retrieveGlobal(__module.id, "mocha");
});

System.register("npm:type-detect@1.0.0", ["npm:type-detect@1.0.0/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:type-detect@1.0.0/index");
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/lib/chai/utils/getMessage", ["npm:chai@3.0.0/lib/chai/utils/flag", "npm:chai@3.0.0/lib/chai/utils/getActual", "npm:chai@3.0.0/lib/chai/utils/inspect", "npm:chai@3.0.0/lib/chai/utils/objDisplay"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var flag = require("npm:chai@3.0.0/lib/chai/utils/flag"),
      getActual = require("npm:chai@3.0.0/lib/chai/utils/getActual"),
      inspect = require("npm:chai@3.0.0/lib/chai/utils/inspect"),
      objDisplay = require("npm:chai@3.0.0/lib/chai/utils/objDisplay");
  module.exports = function(obj, args) {
    var negate = flag(obj, 'negate'),
        val = flag(obj, 'object'),
        expected = args[3],
        actual = getActual(obj, args),
        msg = negate ? args[2] : args[1],
        flagMsg = flag(obj, 'message');
    if (typeof msg === "function")
      msg = msg();
    msg = msg || '';
    msg = msg.replace(/#{this}/g, objDisplay(val)).replace(/#{act}/g, objDisplay(actual)).replace(/#{exp}/g, objDisplay(expected));
    return flagMsg ? flagMsg + ': ' + msg : msg;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:type-detect@0.1.1", ["npm:type-detect@0.1.1/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:type-detect@0.1.1/index");
  global.define = __define;
  return module.exports;
});

System.register("npm:buffer@3.3.0/index", ["npm:base64-js@0.0.8", "npm:ieee754@1.1.6", "npm:is-array@1.0.1"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var base64 = require("npm:base64-js@0.0.8");
  var ieee754 = require("npm:ieee754@1.1.6");
  var isArray = require("npm:is-array@1.0.1");
  exports.Buffer = Buffer;
  exports.SlowBuffer = SlowBuffer;
  exports.INSPECT_MAX_BYTES = 50;
  Buffer.poolSize = 8192;
  var rootParent = {};
  Buffer.TYPED_ARRAY_SUPPORT = (function() {
    try {
      var buf = new ArrayBuffer(0);
      var arr = new Uint8Array(buf);
      arr.foo = function() {
        return 42;
      };
      return arr.foo() === 42 && typeof arr.subarray === 'function' && new Uint8Array(1).subarray(1, 1).byteLength === 0;
    } catch (e) {
      return false;
    }
  })();
  function kMaxLength() {
    return Buffer.TYPED_ARRAY_SUPPORT ? 0x7fffffff : 0x3fffffff;
  }
  function Buffer(arg) {
    if (!(this instanceof Buffer)) {
      if (arguments.length > 1)
        return new Buffer(arg, arguments[1]);
      return new Buffer(arg);
    }
    this.length = 0;
    this.parent = undefined;
    if (typeof arg === 'number') {
      return fromNumber(this, arg);
    }
    if (typeof arg === 'string') {
      return fromString(this, arg, arguments.length > 1 ? arguments[1] : 'utf8');
    }
    return fromObject(this, arg);
  }
  function fromNumber(that, length) {
    that = allocate(that, length < 0 ? 0 : checked(length) | 0);
    if (!Buffer.TYPED_ARRAY_SUPPORT) {
      for (var i = 0; i < length; i++) {
        that[i] = 0;
      }
    }
    return that;
  }
  function fromString(that, string, encoding) {
    if (typeof encoding !== 'string' || encoding === '')
      encoding = 'utf8';
    var length = byteLength(string, encoding) | 0;
    that = allocate(that, length);
    that.write(string, encoding);
    return that;
  }
  function fromObject(that, object) {
    if (Buffer.isBuffer(object))
      return fromBuffer(that, object);
    if (isArray(object))
      return fromArray(that, object);
    if (object == null) {
      throw new TypeError('must start with number, buffer, array or string');
    }
    if (typeof ArrayBuffer !== 'undefined' && object.buffer instanceof ArrayBuffer) {
      return fromTypedArray(that, object);
    }
    if (object.length)
      return fromArrayLike(that, object);
    return fromJsonObject(that, object);
  }
  function fromBuffer(that, buffer) {
    var length = checked(buffer.length) | 0;
    that = allocate(that, length);
    buffer.copy(that, 0, 0, length);
    return that;
  }
  function fromArray(that, array) {
    var length = checked(array.length) | 0;
    that = allocate(that, length);
    for (var i = 0; i < length; i += 1) {
      that[i] = array[i] & 255;
    }
    return that;
  }
  function fromTypedArray(that, array) {
    var length = checked(array.length) | 0;
    that = allocate(that, length);
    for (var i = 0; i < length; i += 1) {
      that[i] = array[i] & 255;
    }
    return that;
  }
  function fromArrayLike(that, array) {
    var length = checked(array.length) | 0;
    that = allocate(that, length);
    for (var i = 0; i < length; i += 1) {
      that[i] = array[i] & 255;
    }
    return that;
  }
  function fromJsonObject(that, object) {
    var array;
    var length = 0;
    if (object.type === 'Buffer' && isArray(object.data)) {
      array = object.data;
      length = checked(array.length) | 0;
    }
    that = allocate(that, length);
    for (var i = 0; i < length; i += 1) {
      that[i] = array[i] & 255;
    }
    return that;
  }
  function allocate(that, length) {
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      that = Buffer._augment(new Uint8Array(length));
    } else {
      that.length = length;
      that._isBuffer = true;
    }
    var fromPool = length !== 0 && length <= Buffer.poolSize >>> 1;
    if (fromPool)
      that.parent = rootParent;
    return that;
  }
  function checked(length) {
    if (length >= kMaxLength()) {
      throw new RangeError('Attempt to allocate Buffer larger than maximum ' + 'size: 0x' + kMaxLength().toString(16) + ' bytes');
    }
    return length | 0;
  }
  function SlowBuffer(subject, encoding) {
    if (!(this instanceof SlowBuffer))
      return new SlowBuffer(subject, encoding);
    var buf = new Buffer(subject, encoding);
    delete buf.parent;
    return buf;
  }
  Buffer.isBuffer = function isBuffer(b) {
    return !!(b != null && b._isBuffer);
  };
  Buffer.compare = function compare(a, b) {
    if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
      throw new TypeError('Arguments must be Buffers');
    }
    if (a === b)
      return 0;
    var x = a.length;
    var y = b.length;
    var i = 0;
    var len = Math.min(x, y);
    while (i < len) {
      if (a[i] !== b[i])
        break;
      ++i;
    }
    if (i !== len) {
      x = a[i];
      y = b[i];
    }
    if (x < y)
      return -1;
    if (y < x)
      return 1;
    return 0;
  };
  Buffer.isEncoding = function isEncoding(encoding) {
    switch (String(encoding).toLowerCase()) {
      case 'hex':
      case 'utf8':
      case 'utf-8':
      case 'ascii':
      case 'binary':
      case 'base64':
      case 'raw':
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return true;
      default:
        return false;
    }
  };
  Buffer.concat = function concat(list, length) {
    if (!isArray(list))
      throw new TypeError('list argument must be an Array of Buffers.');
    if (list.length === 0) {
      return new Buffer(0);
    } else if (list.length === 1) {
      return list[0];
    }
    var i;
    if (length === undefined) {
      length = 0;
      for (i = 0; i < list.length; i++) {
        length += list[i].length;
      }
    }
    var buf = new Buffer(length);
    var pos = 0;
    for (i = 0; i < list.length; i++) {
      var item = list[i];
      item.copy(buf, pos);
      pos += item.length;
    }
    return buf;
  };
  function byteLength(string, encoding) {
    if (typeof string !== 'string')
      string = '' + string;
    var len = string.length;
    if (len === 0)
      return 0;
    var loweredCase = false;
    for (; ; ) {
      switch (encoding) {
        case 'ascii':
        case 'binary':
        case 'raw':
        case 'raws':
          return len;
        case 'utf8':
        case 'utf-8':
          return utf8ToBytes(string).length;
        case 'ucs2':
        case 'ucs-2':
        case 'utf16le':
        case 'utf-16le':
          return len * 2;
        case 'hex':
          return len >>> 1;
        case 'base64':
          return base64ToBytes(string).length;
        default:
          if (loweredCase)
            return utf8ToBytes(string).length;
          encoding = ('' + encoding).toLowerCase();
          loweredCase = true;
      }
    }
  }
  Buffer.byteLength = byteLength;
  Buffer.prototype.length = undefined;
  Buffer.prototype.parent = undefined;
  function slowToString(encoding, start, end) {
    var loweredCase = false;
    start = start | 0;
    end = end === undefined || end === Infinity ? this.length : end | 0;
    if (!encoding)
      encoding = 'utf8';
    if (start < 0)
      start = 0;
    if (end > this.length)
      end = this.length;
    if (end <= start)
      return '';
    while (true) {
      switch (encoding) {
        case 'hex':
          return hexSlice(this, start, end);
        case 'utf8':
        case 'utf-8':
          return utf8Slice(this, start, end);
        case 'ascii':
          return asciiSlice(this, start, end);
        case 'binary':
          return binarySlice(this, start, end);
        case 'base64':
          return base64Slice(this, start, end);
        case 'ucs2':
        case 'ucs-2':
        case 'utf16le':
        case 'utf-16le':
          return utf16leSlice(this, start, end);
        default:
          if (loweredCase)
            throw new TypeError('Unknown encoding: ' + encoding);
          encoding = (encoding + '').toLowerCase();
          loweredCase = true;
      }
    }
  }
  Buffer.prototype.toString = function toString() {
    var length = this.length | 0;
    if (length === 0)
      return '';
    if (arguments.length === 0)
      return utf8Slice(this, 0, length);
    return slowToString.apply(this, arguments);
  };
  Buffer.prototype.equals = function equals(b) {
    if (!Buffer.isBuffer(b))
      throw new TypeError('Argument must be a Buffer');
    if (this === b)
      return true;
    return Buffer.compare(this, b) === 0;
  };
  Buffer.prototype.inspect = function inspect() {
    var str = '';
    var max = exports.INSPECT_MAX_BYTES;
    if (this.length > 0) {
      str = this.toString('hex', 0, max).match(/.{2}/g).join(' ');
      if (this.length > max)
        str += ' ... ';
    }
    return '<Buffer ' + str + '>';
  };
  Buffer.prototype.compare = function compare(b) {
    if (!Buffer.isBuffer(b))
      throw new TypeError('Argument must be a Buffer');
    if (this === b)
      return 0;
    return Buffer.compare(this, b);
  };
  Buffer.prototype.indexOf = function indexOf(val, byteOffset) {
    if (byteOffset > 0x7fffffff)
      byteOffset = 0x7fffffff;
    else if (byteOffset < -0x80000000)
      byteOffset = -0x80000000;
    byteOffset >>= 0;
    if (this.length === 0)
      return -1;
    if (byteOffset >= this.length)
      return -1;
    if (byteOffset < 0)
      byteOffset = Math.max(this.length + byteOffset, 0);
    if (typeof val === 'string') {
      if (val.length === 0)
        return -1;
      return String.prototype.indexOf.call(this, val, byteOffset);
    }
    if (Buffer.isBuffer(val)) {
      return arrayIndexOf(this, val, byteOffset);
    }
    if (typeof val === 'number') {
      if (Buffer.TYPED_ARRAY_SUPPORT && Uint8Array.prototype.indexOf === 'function') {
        return Uint8Array.prototype.indexOf.call(this, val, byteOffset);
      }
      return arrayIndexOf(this, [val], byteOffset);
    }
    function arrayIndexOf(arr, val, byteOffset) {
      var foundIndex = -1;
      for (var i = 0; byteOffset + i < arr.length; i++) {
        if (arr[byteOffset + i] === val[foundIndex === -1 ? 0 : i - foundIndex]) {
          if (foundIndex === -1)
            foundIndex = i;
          if (i - foundIndex + 1 === val.length)
            return byteOffset + foundIndex;
        } else {
          foundIndex = -1;
        }
      }
      return -1;
    }
    throw new TypeError('val must be string, number or Buffer');
  };
  Buffer.prototype.get = function get(offset) {
    console.log('.get() is deprecated. Access using array indexes instead.');
    return this.readUInt8(offset);
  };
  Buffer.prototype.set = function set(v, offset) {
    console.log('.set() is deprecated. Access using array indexes instead.');
    return this.writeUInt8(v, offset);
  };
  function hexWrite(buf, string, offset, length) {
    offset = Number(offset) || 0;
    var remaining = buf.length - offset;
    if (!length) {
      length = remaining;
    } else {
      length = Number(length);
      if (length > remaining) {
        length = remaining;
      }
    }
    var strLen = string.length;
    if (strLen % 2 !== 0)
      throw new Error('Invalid hex string');
    if (length > strLen / 2) {
      length = strLen / 2;
    }
    for (var i = 0; i < length; i++) {
      var parsed = parseInt(string.substr(i * 2, 2), 16);
      if (isNaN(parsed))
        throw new Error('Invalid hex string');
      buf[offset + i] = parsed;
    }
    return i;
  }
  function utf8Write(buf, string, offset, length) {
    return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length);
  }
  function asciiWrite(buf, string, offset, length) {
    return blitBuffer(asciiToBytes(string), buf, offset, length);
  }
  function binaryWrite(buf, string, offset, length) {
    return asciiWrite(buf, string, offset, length);
  }
  function base64Write(buf, string, offset, length) {
    return blitBuffer(base64ToBytes(string), buf, offset, length);
  }
  function ucs2Write(buf, string, offset, length) {
    return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length);
  }
  Buffer.prototype.write = function write(string, offset, length, encoding) {
    if (offset === undefined) {
      encoding = 'utf8';
      length = this.length;
      offset = 0;
    } else if (length === undefined && typeof offset === 'string') {
      encoding = offset;
      length = this.length;
      offset = 0;
    } else if (isFinite(offset)) {
      offset = offset | 0;
      if (isFinite(length)) {
        length = length | 0;
        if (encoding === undefined)
          encoding = 'utf8';
      } else {
        encoding = length;
        length = undefined;
      }
    } else {
      var swap = encoding;
      encoding = offset;
      offset = length | 0;
      length = swap;
    }
    var remaining = this.length - offset;
    if (length === undefined || length > remaining)
      length = remaining;
    if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
      throw new RangeError('attempt to write outside buffer bounds');
    }
    if (!encoding)
      encoding = 'utf8';
    var loweredCase = false;
    for (; ; ) {
      switch (encoding) {
        case 'hex':
          return hexWrite(this, string, offset, length);
        case 'utf8':
        case 'utf-8':
          return utf8Write(this, string, offset, length);
        case 'ascii':
          return asciiWrite(this, string, offset, length);
        case 'binary':
          return binaryWrite(this, string, offset, length);
        case 'base64':
          return base64Write(this, string, offset, length);
        case 'ucs2':
        case 'ucs-2':
        case 'utf16le':
        case 'utf-16le':
          return ucs2Write(this, string, offset, length);
        default:
          if (loweredCase)
            throw new TypeError('Unknown encoding: ' + encoding);
          encoding = ('' + encoding).toLowerCase();
          loweredCase = true;
      }
    }
  };
  Buffer.prototype.toJSON = function toJSON() {
    return {
      type: 'Buffer',
      data: Array.prototype.slice.call(this._arr || this, 0)
    };
  };
  function base64Slice(buf, start, end) {
    if (start === 0 && end === buf.length) {
      return base64.fromByteArray(buf);
    } else {
      return base64.fromByteArray(buf.slice(start, end));
    }
  }
  function utf8Slice(buf, start, end) {
    var res = '';
    var tmp = '';
    end = Math.min(buf.length, end);
    for (var i = start; i < end; i++) {
      if (buf[i] <= 0x7F) {
        res += decodeUtf8Char(tmp) + String.fromCharCode(buf[i]);
        tmp = '';
      } else {
        tmp += '%' + buf[i].toString(16);
      }
    }
    return res + decodeUtf8Char(tmp);
  }
  function asciiSlice(buf, start, end) {
    var ret = '';
    end = Math.min(buf.length, end);
    for (var i = start; i < end; i++) {
      ret += String.fromCharCode(buf[i] & 0x7F);
    }
    return ret;
  }
  function binarySlice(buf, start, end) {
    var ret = '';
    end = Math.min(buf.length, end);
    for (var i = start; i < end; i++) {
      ret += String.fromCharCode(buf[i]);
    }
    return ret;
  }
  function hexSlice(buf, start, end) {
    var len = buf.length;
    if (!start || start < 0)
      start = 0;
    if (!end || end < 0 || end > len)
      end = len;
    var out = '';
    for (var i = start; i < end; i++) {
      out += toHex(buf[i]);
    }
    return out;
  }
  function utf16leSlice(buf, start, end) {
    var bytes = buf.slice(start, end);
    var res = '';
    for (var i = 0; i < bytes.length; i += 2) {
      res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256);
    }
    return res;
  }
  Buffer.prototype.slice = function slice(start, end) {
    var len = this.length;
    start = ~~start;
    end = end === undefined ? len : ~~end;
    if (start < 0) {
      start += len;
      if (start < 0)
        start = 0;
    } else if (start > len) {
      start = len;
    }
    if (end < 0) {
      end += len;
      if (end < 0)
        end = 0;
    } else if (end > len) {
      end = len;
    }
    if (end < start)
      end = start;
    var newBuf;
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      newBuf = Buffer._augment(this.subarray(start, end));
    } else {
      var sliceLen = end - start;
      newBuf = new Buffer(sliceLen, undefined);
      for (var i = 0; i < sliceLen; i++) {
        newBuf[i] = this[i + start];
      }
    }
    if (newBuf.length)
      newBuf.parent = this.parent || this;
    return newBuf;
  };
  function checkOffset(offset, ext, length) {
    if ((offset % 1) !== 0 || offset < 0)
      throw new RangeError('offset is not uint');
    if (offset + ext > length)
      throw new RangeError('Trying to access beyond buffer length');
  }
  Buffer.prototype.readUIntLE = function readUIntLE(offset, byteLength, noAssert) {
    offset = offset | 0;
    byteLength = byteLength | 0;
    if (!noAssert)
      checkOffset(offset, byteLength, this.length);
    var val = this[offset];
    var mul = 1;
    var i = 0;
    while (++i < byteLength && (mul *= 0x100)) {
      val += this[offset + i] * mul;
    }
    return val;
  };
  Buffer.prototype.readUIntBE = function readUIntBE(offset, byteLength, noAssert) {
    offset = offset | 0;
    byteLength = byteLength | 0;
    if (!noAssert) {
      checkOffset(offset, byteLength, this.length);
    }
    var val = this[offset + --byteLength];
    var mul = 1;
    while (byteLength > 0 && (mul *= 0x100)) {
      val += this[offset + --byteLength] * mul;
    }
    return val;
  };
  Buffer.prototype.readUInt8 = function readUInt8(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 1, this.length);
    return this[offset];
  };
  Buffer.prototype.readUInt16LE = function readUInt16LE(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 2, this.length);
    return this[offset] | (this[offset + 1] << 8);
  };
  Buffer.prototype.readUInt16BE = function readUInt16BE(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 2, this.length);
    return (this[offset] << 8) | this[offset + 1];
  };
  Buffer.prototype.readUInt32LE = function readUInt32LE(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 4, this.length);
    return ((this[offset]) | (this[offset + 1] << 8) | (this[offset + 2] << 16)) + (this[offset + 3] * 0x1000000);
  };
  Buffer.prototype.readUInt32BE = function readUInt32BE(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 4, this.length);
    return (this[offset] * 0x1000000) + ((this[offset + 1] << 16) | (this[offset + 2] << 8) | this[offset + 3]);
  };
  Buffer.prototype.readIntLE = function readIntLE(offset, byteLength, noAssert) {
    offset = offset | 0;
    byteLength = byteLength | 0;
    if (!noAssert)
      checkOffset(offset, byteLength, this.length);
    var val = this[offset];
    var mul = 1;
    var i = 0;
    while (++i < byteLength && (mul *= 0x100)) {
      val += this[offset + i] * mul;
    }
    mul *= 0x80;
    if (val >= mul)
      val -= Math.pow(2, 8 * byteLength);
    return val;
  };
  Buffer.prototype.readIntBE = function readIntBE(offset, byteLength, noAssert) {
    offset = offset | 0;
    byteLength = byteLength | 0;
    if (!noAssert)
      checkOffset(offset, byteLength, this.length);
    var i = byteLength;
    var mul = 1;
    var val = this[offset + --i];
    while (i > 0 && (mul *= 0x100)) {
      val += this[offset + --i] * mul;
    }
    mul *= 0x80;
    if (val >= mul)
      val -= Math.pow(2, 8 * byteLength);
    return val;
  };
  Buffer.prototype.readInt8 = function readInt8(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 1, this.length);
    if (!(this[offset] & 0x80))
      return (this[offset]);
    return ((0xff - this[offset] + 1) * -1);
  };
  Buffer.prototype.readInt16LE = function readInt16LE(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 2, this.length);
    var val = this[offset] | (this[offset + 1] << 8);
    return (val & 0x8000) ? val | 0xFFFF0000 : val;
  };
  Buffer.prototype.readInt16BE = function readInt16BE(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 2, this.length);
    var val = this[offset + 1] | (this[offset] << 8);
    return (val & 0x8000) ? val | 0xFFFF0000 : val;
  };
  Buffer.prototype.readInt32LE = function readInt32LE(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 4, this.length);
    return (this[offset]) | (this[offset + 1] << 8) | (this[offset + 2] << 16) | (this[offset + 3] << 24);
  };
  Buffer.prototype.readInt32BE = function readInt32BE(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 4, this.length);
    return (this[offset] << 24) | (this[offset + 1] << 16) | (this[offset + 2] << 8) | (this[offset + 3]);
  };
  Buffer.prototype.readFloatLE = function readFloatLE(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 4, this.length);
    return ieee754.read(this, offset, true, 23, 4);
  };
  Buffer.prototype.readFloatBE = function readFloatBE(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 4, this.length);
    return ieee754.read(this, offset, false, 23, 4);
  };
  Buffer.prototype.readDoubleLE = function readDoubleLE(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 8, this.length);
    return ieee754.read(this, offset, true, 52, 8);
  };
  Buffer.prototype.readDoubleBE = function readDoubleBE(offset, noAssert) {
    if (!noAssert)
      checkOffset(offset, 8, this.length);
    return ieee754.read(this, offset, false, 52, 8);
  };
  function checkInt(buf, value, offset, ext, max, min) {
    if (!Buffer.isBuffer(buf))
      throw new TypeError('buffer must be a Buffer instance');
    if (value > max || value < min)
      throw new RangeError('value is out of bounds');
    if (offset + ext > buf.length)
      throw new RangeError('index out of range');
  }
  Buffer.prototype.writeUIntLE = function writeUIntLE(value, offset, byteLength, noAssert) {
    value = +value;
    offset = offset | 0;
    byteLength = byteLength | 0;
    if (!noAssert)
      checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0);
    var mul = 1;
    var i = 0;
    this[offset] = value & 0xFF;
    while (++i < byteLength && (mul *= 0x100)) {
      this[offset + i] = (value / mul) & 0xFF;
    }
    return offset + byteLength;
  };
  Buffer.prototype.writeUIntBE = function writeUIntBE(value, offset, byteLength, noAssert) {
    value = +value;
    offset = offset | 0;
    byteLength = byteLength | 0;
    if (!noAssert)
      checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0);
    var i = byteLength - 1;
    var mul = 1;
    this[offset + i] = value & 0xFF;
    while (--i >= 0 && (mul *= 0x100)) {
      this[offset + i] = (value / mul) & 0xFF;
    }
    return offset + byteLength;
  };
  Buffer.prototype.writeUInt8 = function writeUInt8(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert)
      checkInt(this, value, offset, 1, 0xff, 0);
    if (!Buffer.TYPED_ARRAY_SUPPORT)
      value = Math.floor(value);
    this[offset] = value;
    return offset + 1;
  };
  function objectWriteUInt16(buf, value, offset, littleEndian) {
    if (value < 0)
      value = 0xffff + value + 1;
    for (var i = 0,
        j = Math.min(buf.length - offset, 2); i < j; i++) {
      buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>> (littleEndian ? i : 1 - i) * 8;
    }
  }
  Buffer.prototype.writeUInt16LE = function writeUInt16LE(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert)
      checkInt(this, value, offset, 2, 0xffff, 0);
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      this[offset] = value;
      this[offset + 1] = (value >>> 8);
    } else {
      objectWriteUInt16(this, value, offset, true);
    }
    return offset + 2;
  };
  Buffer.prototype.writeUInt16BE = function writeUInt16BE(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert)
      checkInt(this, value, offset, 2, 0xffff, 0);
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      this[offset] = (value >>> 8);
      this[offset + 1] = value;
    } else {
      objectWriteUInt16(this, value, offset, false);
    }
    return offset + 2;
  };
  function objectWriteUInt32(buf, value, offset, littleEndian) {
    if (value < 0)
      value = 0xffffffff + value + 1;
    for (var i = 0,
        j = Math.min(buf.length - offset, 4); i < j; i++) {
      buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff;
    }
  }
  Buffer.prototype.writeUInt32LE = function writeUInt32LE(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert)
      checkInt(this, value, offset, 4, 0xffffffff, 0);
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      this[offset + 3] = (value >>> 24);
      this[offset + 2] = (value >>> 16);
      this[offset + 1] = (value >>> 8);
      this[offset] = value;
    } else {
      objectWriteUInt32(this, value, offset, true);
    }
    return offset + 4;
  };
  Buffer.prototype.writeUInt32BE = function writeUInt32BE(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert)
      checkInt(this, value, offset, 4, 0xffffffff, 0);
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      this[offset] = (value >>> 24);
      this[offset + 1] = (value >>> 16);
      this[offset + 2] = (value >>> 8);
      this[offset + 3] = value;
    } else {
      objectWriteUInt32(this, value, offset, false);
    }
    return offset + 4;
  };
  Buffer.prototype.writeIntLE = function writeIntLE(value, offset, byteLength, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert) {
      var limit = Math.pow(2, 8 * byteLength - 1);
      checkInt(this, value, offset, byteLength, limit - 1, -limit);
    }
    var i = 0;
    var mul = 1;
    var sub = value < 0 ? 1 : 0;
    this[offset] = value & 0xFF;
    while (++i < byteLength && (mul *= 0x100)) {
      this[offset + i] = ((value / mul) >> 0) - sub & 0xFF;
    }
    return offset + byteLength;
  };
  Buffer.prototype.writeIntBE = function writeIntBE(value, offset, byteLength, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert) {
      var limit = Math.pow(2, 8 * byteLength - 1);
      checkInt(this, value, offset, byteLength, limit - 1, -limit);
    }
    var i = byteLength - 1;
    var mul = 1;
    var sub = value < 0 ? 1 : 0;
    this[offset + i] = value & 0xFF;
    while (--i >= 0 && (mul *= 0x100)) {
      this[offset + i] = ((value / mul) >> 0) - sub & 0xFF;
    }
    return offset + byteLength;
  };
  Buffer.prototype.writeInt8 = function writeInt8(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert)
      checkInt(this, value, offset, 1, 0x7f, -0x80);
    if (!Buffer.TYPED_ARRAY_SUPPORT)
      value = Math.floor(value);
    if (value < 0)
      value = 0xff + value + 1;
    this[offset] = value;
    return offset + 1;
  };
  Buffer.prototype.writeInt16LE = function writeInt16LE(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert)
      checkInt(this, value, offset, 2, 0x7fff, -0x8000);
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      this[offset] = value;
      this[offset + 1] = (value >>> 8);
    } else {
      objectWriteUInt16(this, value, offset, true);
    }
    return offset + 2;
  };
  Buffer.prototype.writeInt16BE = function writeInt16BE(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert)
      checkInt(this, value, offset, 2, 0x7fff, -0x8000);
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      this[offset] = (value >>> 8);
      this[offset + 1] = value;
    } else {
      objectWriteUInt16(this, value, offset, false);
    }
    return offset + 2;
  };
  Buffer.prototype.writeInt32LE = function writeInt32LE(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert)
      checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000);
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      this[offset] = value;
      this[offset + 1] = (value >>> 8);
      this[offset + 2] = (value >>> 16);
      this[offset + 3] = (value >>> 24);
    } else {
      objectWriteUInt32(this, value, offset, true);
    }
    return offset + 4;
  };
  Buffer.prototype.writeInt32BE = function writeInt32BE(value, offset, noAssert) {
    value = +value;
    offset = offset | 0;
    if (!noAssert)
      checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000);
    if (value < 0)
      value = 0xffffffff + value + 1;
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      this[offset] = (value >>> 24);
      this[offset + 1] = (value >>> 16);
      this[offset + 2] = (value >>> 8);
      this[offset + 3] = value;
    } else {
      objectWriteUInt32(this, value, offset, false);
    }
    return offset + 4;
  };
  function checkIEEE754(buf, value, offset, ext, max, min) {
    if (value > max || value < min)
      throw new RangeError('value is out of bounds');
    if (offset + ext > buf.length)
      throw new RangeError('index out of range');
    if (offset < 0)
      throw new RangeError('index out of range');
  }
  function writeFloat(buf, value, offset, littleEndian, noAssert) {
    if (!noAssert) {
      checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38);
    }
    ieee754.write(buf, value, offset, littleEndian, 23, 4);
    return offset + 4;
  }
  Buffer.prototype.writeFloatLE = function writeFloatLE(value, offset, noAssert) {
    return writeFloat(this, value, offset, true, noAssert);
  };
  Buffer.prototype.writeFloatBE = function writeFloatBE(value, offset, noAssert) {
    return writeFloat(this, value, offset, false, noAssert);
  };
  function writeDouble(buf, value, offset, littleEndian, noAssert) {
    if (!noAssert) {
      checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308);
    }
    ieee754.write(buf, value, offset, littleEndian, 52, 8);
    return offset + 8;
  }
  Buffer.prototype.writeDoubleLE = function writeDoubleLE(value, offset, noAssert) {
    return writeDouble(this, value, offset, true, noAssert);
  };
  Buffer.prototype.writeDoubleBE = function writeDoubleBE(value, offset, noAssert) {
    return writeDouble(this, value, offset, false, noAssert);
  };
  Buffer.prototype.copy = function copy(target, targetStart, start, end) {
    if (!start)
      start = 0;
    if (!end && end !== 0)
      end = this.length;
    if (targetStart >= target.length)
      targetStart = target.length;
    if (!targetStart)
      targetStart = 0;
    if (end > 0 && end < start)
      end = start;
    if (end === start)
      return 0;
    if (target.length === 0 || this.length === 0)
      return 0;
    if (targetStart < 0) {
      throw new RangeError('targetStart out of bounds');
    }
    if (start < 0 || start >= this.length)
      throw new RangeError('sourceStart out of bounds');
    if (end < 0)
      throw new RangeError('sourceEnd out of bounds');
    if (end > this.length)
      end = this.length;
    if (target.length - targetStart < end - start) {
      end = target.length - targetStart + start;
    }
    var len = end - start;
    if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
      for (var i = 0; i < len; i++) {
        target[i + targetStart] = this[i + start];
      }
    } else {
      target._set(this.subarray(start, start + len), targetStart);
    }
    return len;
  };
  Buffer.prototype.fill = function fill(value, start, end) {
    if (!value)
      value = 0;
    if (!start)
      start = 0;
    if (!end)
      end = this.length;
    if (end < start)
      throw new RangeError('end < start');
    if (end === start)
      return ;
    if (this.length === 0)
      return ;
    if (start < 0 || start >= this.length)
      throw new RangeError('start out of bounds');
    if (end < 0 || end > this.length)
      throw new RangeError('end out of bounds');
    var i;
    if (typeof value === 'number') {
      for (i = start; i < end; i++) {
        this[i] = value;
      }
    } else {
      var bytes = utf8ToBytes(value.toString());
      var len = bytes.length;
      for (i = start; i < end; i++) {
        this[i] = bytes[i % len];
      }
    }
    return this;
  };
  Buffer.prototype.toArrayBuffer = function toArrayBuffer() {
    if (typeof Uint8Array !== 'undefined') {
      if (Buffer.TYPED_ARRAY_SUPPORT) {
        return (new Buffer(this)).buffer;
      } else {
        var buf = new Uint8Array(this.length);
        for (var i = 0,
            len = buf.length; i < len; i += 1) {
          buf[i] = this[i];
        }
        return buf.buffer;
      }
    } else {
      throw new TypeError('Buffer.toArrayBuffer not supported in this browser');
    }
  };
  var BP = Buffer.prototype;
  Buffer._augment = function _augment(arr) {
    arr.constructor = Buffer;
    arr._isBuffer = true;
    arr._set = arr.set;
    arr.get = BP.get;
    arr.set = BP.set;
    arr.write = BP.write;
    arr.toString = BP.toString;
    arr.toLocaleString = BP.toString;
    arr.toJSON = BP.toJSON;
    arr.equals = BP.equals;
    arr.compare = BP.compare;
    arr.indexOf = BP.indexOf;
    arr.copy = BP.copy;
    arr.slice = BP.slice;
    arr.readUIntLE = BP.readUIntLE;
    arr.readUIntBE = BP.readUIntBE;
    arr.readUInt8 = BP.readUInt8;
    arr.readUInt16LE = BP.readUInt16LE;
    arr.readUInt16BE = BP.readUInt16BE;
    arr.readUInt32LE = BP.readUInt32LE;
    arr.readUInt32BE = BP.readUInt32BE;
    arr.readIntLE = BP.readIntLE;
    arr.readIntBE = BP.readIntBE;
    arr.readInt8 = BP.readInt8;
    arr.readInt16LE = BP.readInt16LE;
    arr.readInt16BE = BP.readInt16BE;
    arr.readInt32LE = BP.readInt32LE;
    arr.readInt32BE = BP.readInt32BE;
    arr.readFloatLE = BP.readFloatLE;
    arr.readFloatBE = BP.readFloatBE;
    arr.readDoubleLE = BP.readDoubleLE;
    arr.readDoubleBE = BP.readDoubleBE;
    arr.writeUInt8 = BP.writeUInt8;
    arr.writeUIntLE = BP.writeUIntLE;
    arr.writeUIntBE = BP.writeUIntBE;
    arr.writeUInt16LE = BP.writeUInt16LE;
    arr.writeUInt16BE = BP.writeUInt16BE;
    arr.writeUInt32LE = BP.writeUInt32LE;
    arr.writeUInt32BE = BP.writeUInt32BE;
    arr.writeIntLE = BP.writeIntLE;
    arr.writeIntBE = BP.writeIntBE;
    arr.writeInt8 = BP.writeInt8;
    arr.writeInt16LE = BP.writeInt16LE;
    arr.writeInt16BE = BP.writeInt16BE;
    arr.writeInt32LE = BP.writeInt32LE;
    arr.writeInt32BE = BP.writeInt32BE;
    arr.writeFloatLE = BP.writeFloatLE;
    arr.writeFloatBE = BP.writeFloatBE;
    arr.writeDoubleLE = BP.writeDoubleLE;
    arr.writeDoubleBE = BP.writeDoubleBE;
    arr.fill = BP.fill;
    arr.inspect = BP.inspect;
    arr.toArrayBuffer = BP.toArrayBuffer;
    return arr;
  };
  var INVALID_BASE64_RE = /[^+\/0-9A-z\-]/g;
  function base64clean(str) {
    str = stringtrim(str).replace(INVALID_BASE64_RE, '');
    if (str.length < 2)
      return '';
    while (str.length % 4 !== 0) {
      str = str + '=';
    }
    return str;
  }
  function stringtrim(str) {
    if (str.trim)
      return str.trim();
    return str.replace(/^\s+|\s+$/g, '');
  }
  function toHex(n) {
    if (n < 16)
      return '0' + n.toString(16);
    return n.toString(16);
  }
  function utf8ToBytes(string, units) {
    units = units || Infinity;
    var codePoint;
    var length = string.length;
    var leadSurrogate = null;
    var bytes = [];
    var i = 0;
    for (; i < length; i++) {
      codePoint = string.charCodeAt(i);
      if (codePoint > 0xD7FF && codePoint < 0xE000) {
        if (leadSurrogate) {
          if (codePoint < 0xDC00) {
            if ((units -= 3) > -1)
              bytes.push(0xEF, 0xBF, 0xBD);
            leadSurrogate = codePoint;
            continue;
          } else {
            codePoint = leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00 | 0x10000;
            leadSurrogate = null;
          }
        } else {
          if (codePoint > 0xDBFF) {
            if ((units -= 3) > -1)
              bytes.push(0xEF, 0xBF, 0xBD);
            continue;
          } else if (i + 1 === length) {
            if ((units -= 3) > -1)
              bytes.push(0xEF, 0xBF, 0xBD);
            continue;
          } else {
            leadSurrogate = codePoint;
            continue;
          }
        }
      } else if (leadSurrogate) {
        if ((units -= 3) > -1)
          bytes.push(0xEF, 0xBF, 0xBD);
        leadSurrogate = null;
      }
      if (codePoint < 0x80) {
        if ((units -= 1) < 0)
          break;
        bytes.push(codePoint);
      } else if (codePoint < 0x800) {
        if ((units -= 2) < 0)
          break;
        bytes.push(codePoint >> 0x6 | 0xC0, codePoint & 0x3F | 0x80);
      } else if (codePoint < 0x10000) {
        if ((units -= 3) < 0)
          break;
        bytes.push(codePoint >> 0xC | 0xE0, codePoint >> 0x6 & 0x3F | 0x80, codePoint & 0x3F | 0x80);
      } else if (codePoint < 0x200000) {
        if ((units -= 4) < 0)
          break;
        bytes.push(codePoint >> 0x12 | 0xF0, codePoint >> 0xC & 0x3F | 0x80, codePoint >> 0x6 & 0x3F | 0x80, codePoint & 0x3F | 0x80);
      } else {
        throw new Error('Invalid code point');
      }
    }
    return bytes;
  }
  function asciiToBytes(str) {
    var byteArray = [];
    for (var i = 0; i < str.length; i++) {
      byteArray.push(str.charCodeAt(i) & 0xFF);
    }
    return byteArray;
  }
  function utf16leToBytes(str, units) {
    var c,
        hi,
        lo;
    var byteArray = [];
    for (var i = 0; i < str.length; i++) {
      if ((units -= 2) < 0)
        break;
      c = str.charCodeAt(i);
      hi = c >> 8;
      lo = c % 256;
      byteArray.push(lo);
      byteArray.push(hi);
    }
    return byteArray;
  }
  function base64ToBytes(str) {
    return base64.toByteArray(base64clean(str));
  }
  function blitBuffer(src, dst, offset, length) {
    for (var i = 0; i < length; i++) {
      if ((i + offset >= dst.length) || (i >= src.length))
        break;
      dst[i + offset] = src[i];
    }
    return i;
  }
  function decodeUtf8Char(str) {
    try {
      return decodeURIComponent(str);
    } catch (err) {
      return String.fromCharCode(0xFFFD);
    }
  }
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/lib/chai/utils/getPathValue", ["npm:chai@3.0.0/lib/chai/utils/getPathInfo"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var getPathInfo = require("npm:chai@3.0.0/lib/chai/utils/getPathInfo");
  module.exports = function(path, obj) {
    var info = getPathInfo(path, obj);
    return info.value;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:mocha@2.2.5", ["npm:mocha@2.2.5/mocha"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:mocha@2.2.5/mocha");
  global.define = __define;
  return module.exports;
});

System.register("npm:buffer@3.3.0", ["npm:buffer@3.3.0/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:buffer@3.3.0/index");
  global.define = __define;
  return module.exports;
});

System.register("github:jspm/nodelibs-buffer@0.1.0/index", ["npm:buffer@3.3.0"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = System._nodeRequire ? System._nodeRequire('buffer') : require("npm:buffer@3.3.0");
  global.define = __define;
  return module.exports;
});

System.register("github:jspm/nodelibs-buffer@0.1.0", ["github:jspm/nodelibs-buffer@0.1.0/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("github:jspm/nodelibs-buffer@0.1.0/index");
  global.define = __define;
  return module.exports;
});

System.register("npm:deep-eql@0.1.3/lib/eql", ["npm:type-detect@0.1.1", "github:jspm/nodelibs-buffer@0.1.0", "github:jspm/nodelibs-buffer@0.1.0"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  (function(Buffer) {
    var type = require("npm:type-detect@0.1.1");
    var Buffer;
    try {
      Buffer = require("github:jspm/nodelibs-buffer@0.1.0").Buffer;
    } catch (ex) {
      Buffer = {};
      Buffer.isBuffer = function() {
        return false;
      };
    }
    module.exports = deepEqual;
    function deepEqual(a, b, m) {
      if (sameValue(a, b)) {
        return true;
      } else if ('date' === type(a)) {
        return dateEqual(a, b);
      } else if ('regexp' === type(a)) {
        return regexpEqual(a, b);
      } else if (Buffer.isBuffer(a)) {
        return bufferEqual(a, b);
      } else if ('arguments' === type(a)) {
        return argumentsEqual(a, b, m);
      } else if (!typeEqual(a, b)) {
        return false;
      } else if (('object' !== type(a) && 'object' !== type(b)) && ('array' !== type(a) && 'array' !== type(b))) {
        return sameValue(a, b);
      } else {
        return objectEqual(a, b, m);
      }
    }
    function sameValue(a, b) {
      if (a === b)
        return a !== 0 || 1 / a === 1 / b;
      return a !== a && b !== b;
    }
    function typeEqual(a, b) {
      return type(a) === type(b);
    }
    function dateEqual(a, b) {
      if ('date' !== type(b))
        return false;
      return sameValue(a.getTime(), b.getTime());
    }
    function regexpEqual(a, b) {
      if ('regexp' !== type(b))
        return false;
      return sameValue(a.toString(), b.toString());
    }
    function argumentsEqual(a, b, m) {
      if ('arguments' !== type(b))
        return false;
      a = [].slice.call(a);
      b = [].slice.call(b);
      return deepEqual(a, b, m);
    }
    function enumerable(a) {
      var res = [];
      for (var key in a)
        res.push(key);
      return res;
    }
    function iterableEqual(a, b) {
      if (a.length !== b.length)
        return false;
      var i = 0;
      var match = true;
      for (; i < a.length; i++) {
        if (a[i] !== b[i]) {
          match = false;
          break;
        }
      }
      return match;
    }
    function bufferEqual(a, b) {
      if (!Buffer.isBuffer(b))
        return false;
      return iterableEqual(a, b);
    }
    function isValue(a) {
      return a !== null && a !== undefined;
    }
    function objectEqual(a, b, m) {
      if (!isValue(a) || !isValue(b)) {
        return false;
      }
      if (a.prototype !== b.prototype) {
        return false;
      }
      var i;
      if (m) {
        for (i = 0; i < m.length; i++) {
          if ((m[i][0] === a && m[i][1] === b) || (m[i][0] === b && m[i][1] === a)) {
            return true;
          }
        }
      } else {
        m = [];
      }
      try {
        var ka = enumerable(a);
        var kb = enumerable(b);
      } catch (ex) {
        return false;
      }
      ka.sort();
      kb.sort();
      if (!iterableEqual(ka, kb)) {
        return false;
      }
      m.push([a, b]);
      var key;
      for (i = ka.length - 1; i >= 0; i--) {
        key = ka[i];
        if (!deepEqual(a[key], b[key], m)) {
          return false;
        }
      }
      return true;
    }
  })(require("github:jspm/nodelibs-buffer@0.1.0").Buffer);
  global.define = __define;
  return module.exports;
});

System.register("npm:deep-eql@0.1.3/index", ["npm:deep-eql@0.1.3/lib/eql"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:deep-eql@0.1.3/lib/eql");
  global.define = __define;
  return module.exports;
});

System.register("npm:deep-eql@0.1.3", ["npm:deep-eql@0.1.3/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:deep-eql@0.1.3/index");
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/lib/chai/utils/index", ["npm:chai@3.0.0/lib/chai/utils/test", "npm:type-detect@1.0.0", "npm:chai@3.0.0/lib/chai/utils/getMessage", "npm:chai@3.0.0/lib/chai/utils/getActual", "npm:chai@3.0.0/lib/chai/utils/inspect", "npm:chai@3.0.0/lib/chai/utils/objDisplay", "npm:chai@3.0.0/lib/chai/utils/flag", "npm:chai@3.0.0/lib/chai/utils/transferFlags", "npm:deep-eql@0.1.3", "npm:chai@3.0.0/lib/chai/utils/getPathValue", "npm:chai@3.0.0/lib/chai/utils/getPathInfo", "npm:chai@3.0.0/lib/chai/utils/hasProperty", "npm:chai@3.0.0/lib/chai/utils/getName", "npm:chai@3.0.0/lib/chai/utils/addProperty", "npm:chai@3.0.0/lib/chai/utils/addMethod", "npm:chai@3.0.0/lib/chai/utils/overwriteProperty", "npm:chai@3.0.0/lib/chai/utils/overwriteMethod", "npm:chai@3.0.0/lib/chai/utils/addChainableMethod", "npm:chai@3.0.0/lib/chai/utils/overwriteChainableMethod"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var exports = module.exports = {};
  exports.test = require("npm:chai@3.0.0/lib/chai/utils/test");
  exports.type = require("npm:type-detect@1.0.0");
  exports.getMessage = require("npm:chai@3.0.0/lib/chai/utils/getMessage");
  exports.getActual = require("npm:chai@3.0.0/lib/chai/utils/getActual");
  exports.inspect = require("npm:chai@3.0.0/lib/chai/utils/inspect");
  exports.objDisplay = require("npm:chai@3.0.0/lib/chai/utils/objDisplay");
  exports.flag = require("npm:chai@3.0.0/lib/chai/utils/flag");
  exports.transferFlags = require("npm:chai@3.0.0/lib/chai/utils/transferFlags");
  exports.eql = require("npm:deep-eql@0.1.3");
  exports.getPathValue = require("npm:chai@3.0.0/lib/chai/utils/getPathValue");
  exports.getPathInfo = require("npm:chai@3.0.0/lib/chai/utils/getPathInfo");
  exports.hasProperty = require("npm:chai@3.0.0/lib/chai/utils/hasProperty");
  exports.getName = require("npm:chai@3.0.0/lib/chai/utils/getName");
  exports.addProperty = require("npm:chai@3.0.0/lib/chai/utils/addProperty");
  exports.addMethod = require("npm:chai@3.0.0/lib/chai/utils/addMethod");
  exports.overwriteProperty = require("npm:chai@3.0.0/lib/chai/utils/overwriteProperty");
  exports.overwriteMethod = require("npm:chai@3.0.0/lib/chai/utils/overwriteMethod");
  exports.addChainableMethod = require("npm:chai@3.0.0/lib/chai/utils/addChainableMethod");
  exports.overwriteChainableMethod = require("npm:chai@3.0.0/lib/chai/utils/overwriteChainableMethod");
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/lib/chai", ["npm:assertion-error@1.0.1", "npm:chai@3.0.0/lib/chai/utils/index", "npm:chai@3.0.0/lib/chai/config", "npm:chai@3.0.0/lib/chai/assertion", "npm:chai@3.0.0/lib/chai/core/assertions", "npm:chai@3.0.0/lib/chai/interface/expect", "npm:chai@3.0.0/lib/chai/interface/should", "npm:chai@3.0.0/lib/chai/interface/assert"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var used = [],
      exports = module.exports = {};
  exports.version = '3.0.0';
  exports.AssertionError = require("npm:assertion-error@1.0.1");
  var util = require("npm:chai@3.0.0/lib/chai/utils/index");
  exports.use = function(fn) {
    if (!~used.indexOf(fn)) {
      fn(this, util);
      used.push(fn);
    }
    return this;
  };
  exports.util = util;
  var config = require("npm:chai@3.0.0/lib/chai/config");
  exports.config = config;
  var assertion = require("npm:chai@3.0.0/lib/chai/assertion");
  exports.use(assertion);
  var core = require("npm:chai@3.0.0/lib/chai/core/assertions");
  exports.use(core);
  var expect = require("npm:chai@3.0.0/lib/chai/interface/expect");
  exports.use(expect);
  var should = require("npm:chai@3.0.0/lib/chai/interface/should");
  exports.use(should);
  var assert = require("npm:chai@3.0.0/lib/chai/interface/assert");
  exports.use(assert);
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0/index", ["npm:chai@3.0.0/lib/chai"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:chai@3.0.0/lib/chai");
  global.define = __define;
  return module.exports;
});

System.register("npm:chai@3.0.0", ["npm:chai@3.0.0/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:chai@3.0.0/index");
  global.define = __define;
  return module.exports;
});

System.register("test/core/Collection", [], function (_export) {
    "use strict";

    return {
        setters: [],
        execute: function () {
            _export("default", (function () {

                describe("core:Collection", function () {

                    it("fromArray", function () {
                        var testArray = [];
                    });

                    it("query", function () {});

                    it("create", function () {});

                    it("addModule", function () {});

                    it("addStaticModule", function () {});

                    it("addModuleOverride", function () {});

                    it("addStaticModuleOverride", function () {});
                });
            })());
        }
    };
});
System.register('test/Setup', ['npm:chai@3.0.0', 'npm:mocha@2.2.5'], function (_export) {
  'use strict';

  var chai, mocha;
  return {
    setters: [function (_npmChai300) {
      chai = _npmChai300['default'];
    }, function (_npmMocha225) {
      mocha = _npmMocha225['default'];
    }],
    execute: function () {
      _export('default', (function () {

        var globalSetup = function globalSetup() {
          testEnv.sandbox = q.create('<div id=\'sandbox\'></div>');
          testEnv.sandbox.appendTo(document.body);
          // CSS metrics should be integer by default in IE10 Release Preview, but
          // getBoundingClientRect will randomly return float values unless this
          // feature is explicitly deactivated:
          if (document.msCSSOMElementFloatMetrics) {
            document.msCSSOMElementFloatMetrics = null;
          }
        };

        var globalTeardown = function globalTeardown() {
          testEnv.sandbox.remove();
        };

        chai.config.includeStack = true;
        mocha.setup('bdd');

        return {
          chai: chai,
          mocha: mocha,
          globalSetup: globalSetup,
          globalTeardown: globalTeardown
        };
      })());
    }
  };
});
System.register("test/Test", ["test/Setup", "test/core/Collection"], function (_export) {
  "use strict";

  var setup, coreCollection;
  return {
    setters: [function (_testSetup) {
      setup = _testSetup["default"];
    }, function (_testCoreCollection) {
      coreCollection = _testCoreCollection["default"];
    }],
    execute: function () {}
  };
});
System.register('npm:mocha@2.2.5/mocha.css!github:systemjs/plugin-css@0.1.13', [], false, function() {});
(function(c){var d=document,a='appendChild',i='styleSheet',s=d.createElement('style');s.type='text/css';d.getElementsByTagName('head')[0][a](s);s[i]?s[i].cssText=c:s[a](d.createTextNode(c));})
("@charset \"utf-8\";#mocha ul,#mocha-stats li{list-style:none}#mocha h1,#mocha h2,body{margin:0}#mocha{font:20px/1.5 \"Helvetica Neue\",Helvetica,Arial,sans-serif;margin:60px 50px}#mocha li,#mocha ul{margin:0;padding:0}#mocha .suite,#mocha .test{margin-left:15px}#mocha h1{margin-top:15px;font-size:1em;font-weight:200}#mocha h1 a{text-decoration:none;color:inherit}#mocha h1 a:hover{text-decoration:underline}#mocha .suite .suite h1{margin-top:0;font-size:.8em}#mocha .hidden{display:none}#mocha h2{font-size:12px;font-weight:400;cursor:pointer}#mocha .test{overflow:hidden}#mocha .test.pending:hover h2::after{content:'(pending)';font-family:arial,sans-serif}#mocha .test.pass.medium .duration{background:#c09853}#mocha .test.pass.slow .duration{background:#b94a48}#mocha .test.pass::before{content:'✓';font-size:12px;display:block;float:left;margin-right:5px;color:#00d6b2}#mocha .test.pass .duration{font-size:9px;margin-left:5px;padding:2px 5px;color:#fff;-webkit-box-shadow:inset 0 1px 1px rgba(0,0,0,.2);-moz-box-shadow:inset 0 1px 1px rgba(0,0,0,.2);box-shadow:inset 0 1px 1px rgba(0,0,0,.2);-webkit-border-radius:5px;-moz-border-radius:5px;-ms-border-radius:5px;-o-border-radius:5px;border-radius:5px}#mocha .test.pass.fast .duration{display:none}#mocha .test.pending{color:#0b97c4}#mocha .test.pending::before{content:'◦';color:#0b97c4}#mocha .test.fail{color:#c00}#mocha .test.fail pre{color:#000}#mocha .test.fail::before{content:'✖';font-size:12px;display:block;float:left;margin-right:5px;color:#c00}#mocha .test pre.error{color:#c00;max-height:300px;overflow:auto}#mocha .test pre{display:block;float:left;clear:left;font:12px/1.5 monaco,monospace;margin:5px;padding:15px;border:1px solid #eee;max-width:85%;max-width:calc(100% - 42px);word-wrap:break-word;border-bottom-color:#ddd;-webkit-border-radius:3px;-webkit-box-shadow:0 1px 3px #eee;-moz-border-radius:3px;-moz-box-shadow:0 1px 3px #eee;border-radius:3px}#mocha .test h2{position:relative}#mocha .test a.replay{position:absolute;top:3px;right:0;text-decoration:none;vertical-align:middle;display:block;width:15px;height:15px;line-height:15px;text-align:center;background:#eee;font-size:15px;-moz-border-radius:15px;border-radius:15px;-webkit-transition:opacity 200ms;-moz-transition:opacity 200ms;transition:opacity 200ms;opacity:.3;color:#888}#mocha .test:hover a.replay{opacity:1}#mocha-report.fail .test.pass,#mocha-report.pass .test.fail,#mocha-report.pending .test.fail,#mocha-report.pending .test.pass{display:none}#mocha-report.pending .test.pass.pending{display:block}#mocha-error{color:#c00;font-size:1.5em;font-weight:100;letter-spacing:1px}#mocha-stats{position:fixed;top:15px;right:10px;font-size:12px;margin:0;color:#888;z-index:1}#mocha-stats .progress{float:right;padding-top:0}#mocha-stats em{color:#000}#mocha-stats a{text-decoration:none;color:inherit}#mocha-stats a:hover{border-bottom:1px solid #eee}#mocha-stats li{display:inline-block;margin:0 5px;padding-top:11px}#mocha-stats canvas{width:40px;height:40px}#mocha code .comment{color:#ddd}#mocha code .init{color:#2f6fad}#mocha code .string{color:#5890ad}#mocha code .keyword{color:#8a6343}#mocha code .number{color:#2f6fad}@media screen and (max-device-width:480px){#mocha{margin:60px 0}#mocha #stats{position:absolute}}");
(function() {
  var loader = System;
  if (typeof indexOf == 'undefined')
    indexOf = Array.prototype.indexOf;

  function readGlobalProperty(p, value) {
    var pParts = p.split('.');
    while (pParts.length)
      value = value[pParts.shift()];
    return value;
  }

  var ignoredGlobalProps = ['sessionStorage', 'localStorage', 'clipboardData', 'frames', 'external'];

  var hasOwnProperty = loader.global.hasOwnProperty;

  function iterateGlobals(callback) {
    if (Object.keys)
      Object.keys(loader.global).forEach(callback);
    else
      for (var g in loader.global) {
        if (!hasOwnProperty.call(loader.global, g))
          continue;
        callback(g);
      }
  }

  function forEachGlobal(callback) {
    iterateGlobals(function(globalName) {
      if (indexOf.call(ignoredGlobalProps, globalName) != -1)
        return;
      try {
        var value = loader.global[globalName];
      }
      catch(e) {
        ignoredGlobalProps.push(globalName);
      }
      callback(globalName, value);
    });
  }

  var moduleGlobals = {};

  var globalSnapshot;

  loader.set('@@global-helpers', loader.newModule({
    prepareGlobal: function(moduleName, deps) {
      // first, we add all the dependency modules to the global
      for (var i = 0; i < deps.length; i++) {
        var moduleGlobal = moduleGlobals[deps[i]];
        if (moduleGlobal)
          for (var m in moduleGlobal)
            loader.global[m] = moduleGlobal[m];
      }

      // now store a complete copy of the global object
      // in order to detect changes
      globalSnapshot = {};
      
      forEachGlobal(function(name, value) {
        globalSnapshot[name] = value;
      });
    },
    retrieveGlobal: function(moduleName, exportName, init) {
      var singleGlobal;
      var multipleExports;
      var exports = {};

      // run init
      if (init)
        singleGlobal = init.call(loader.global);

      // check for global changes, creating the globalObject for the module
      // if many globals, then a module object for those is created
      // if one global, then that is the module directly
      else if (exportName) {
        var firstPart = exportName.split('.')[0];
        singleGlobal = readGlobalProperty(exportName, loader.global);
        exports[firstPart] = loader.global[firstPart];
      }

      else {
        forEachGlobal(function(name, value) {
          if (globalSnapshot[name] === value)
            return;
          if (typeof value === 'undefined')
            return;
          exports[name] = value;
          if (typeof singleGlobal !== 'undefined') {
            if (!multipleExports && singleGlobal !== value)
              multipleExports = true;
          }
          else {
            singleGlobal = value;
          }
        });
      }

      moduleGlobals[moduleName] = exports;

      return multipleExports ? exports : singleGlobal;
    }
  }));
})();
});
//# sourceMappingURL=test.js.map