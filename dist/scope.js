"format global";
(function(global) {

  var defined = {};

  // indexOf polyfill for IE8
  var indexOf = Array.prototype.indexOf || function(item) {
    for (var i = 0, l = this.length; i < l; i++)
      if (this[i] === item)
        return i;
    return -1;
  }

  var getOwnPropertyDescriptor = true;
  try {
    Object.getOwnPropertyDescriptor({ a: 0 }, 'a');
  }
  catch(e) {
    getOwnPropertyDescriptor = false;
  }

  var defineProperty;
  (function () {
    try {
      if (!!Object.defineProperty({}, 'a', {}))
        defineProperty = Object.defineProperty;
    }
    catch (e) {
      defineProperty = function(obj, prop, opt) {
        try {
          obj[prop] = opt.value || opt.get.call(obj);
        }
        catch(e) {}
      }
    }
  })();

  function register(name, deps, declare) {
    if (arguments.length === 4)
      return registerDynamic.apply(this, arguments);
    doRegister(name, {
      declarative: true,
      deps: deps,
      declare: declare
    });
  }

  function registerDynamic(name, deps, executingRequire, execute) {
    doRegister(name, {
      declarative: false,
      deps: deps,
      executingRequire: executingRequire,
      execute: execute
    });
  }

  function doRegister(name, entry) {
    entry.name = name;

    // we never overwrite an existing define
    if (!(name in defined))
      defined[name] = entry;

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
          for (var j = 0; j < importerModule.dependencies.length; ++j) {
            if (importerModule.dependencies[j] === module) {
              importerModule.setters[j](exports);
            }
          }
        }
      }

      module.locked = false;
      return value;
    });

    module.setters = declaration.setters;
    module.execute = declaration.execute;

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
        depExports = depEntry.esModule;
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

    // create the esModule object, which allows ES6 named imports of dynamics
    exports = module.exports;
 
    if (exports && exports.__esModule) {
      entry.esModule = exports;
    }
    else {
      entry.esModule = {};
      
      // don't trigger getters/setters in environments that support them
      if (typeof exports == 'object' || typeof exports == 'function') {
        if (getOwnPropertyDescriptor) {
          var d;
          for (var p in exports)
            if (d = Object.getOwnPropertyDescriptor(exports, p))
              defineProperty(entry.esModule, p, d);
        }
        else {
          var hasOwnProperty = exports && exports.hasOwnProperty;
          for (var p in exports) {
            if (!hasOwnProperty || exports.hasOwnProperty(p))
              entry.esModule[p] = exports[p];
          }
         }
       }
      entry.esModule['default'] = exports;
      defineProperty(entry.esModule, '__useDefault', {
        value: true
      });
    }
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

    // exported modules get __esModule defined for interop
    if (entry.declarative)
      defineProperty(entry.module.exports, '__esModule', { value: true });

    // return the defined module object
    return modules[name] = entry.declarative ? entry.module.exports : entry.esModule;
  };

  return function(mains, depNames, declare) {
    return function(formatDetect) {
      formatDetect(function(deps) {
        var System = {
          _nodeRequire: typeof require != 'undefined' && require.resolve && typeof process != 'undefined' && require,
          register: register,
          registerDynamic: registerDynamic,
          get: load, 
          set: function(name, module) {
            modules[name] = module; 
          },
          newModule: function(module) {
            return module;
          }
        };
        System.set('@empty', {});

        // register external dependencies
        for (var i = 0; i < depNames.length; i++) (function(depName, dep) {
          if (dep && dep.__esModule)
            System.register(depName, [], function(_export) {
              return {
                setters: [],
                execute: function() {
                  for (var p in dep)
                    if (p != '__esModule' && !(typeof p == 'object' && p + '' == 'Module'))
                      _export(p, dep[p]);
                }
              };
            });
          else
            System.registerDynamic(depName, [], false, function() {
              return dep;
            });
        })(depNames[i], arguments[i]);

        // register modules in this bundle
        declare(System);

        // load mains
        var firstLoad = load(mains[0]);
        if (mains.length > 1)
          for (var i = 1; i < mains.length; i++)
            load(mains[i]);

        if (firstLoad.__useDefault)
          return firstLoad['default'];
        else
          return firstLoad;
      });
    };
  };

})(typeof self != 'undefined' ? self : global)
/* (['mainModule'], ['external-dep'], function($__System) {
  System.register(...);
})
(function(factory) {
  if (typeof define && define.amd)
    define(['external-dep'], factory);
  // etc UMD / module pattern
})*/

(['0', '1'], [], function($__System) {

(function(__global) {
  var loader = $__System;
  var hasOwnProperty = Object.prototype.hasOwnProperty;
  var indexOf = Array.prototype.indexOf || function(item) {
    for (var i = 0, l = this.length; i < l; i++)
      if (this[i] === item)
        return i;
    return -1;
  }

  function readMemberExpression(p, value) {
    var pParts = p.split('.');
    while (pParts.length)
      value = value[pParts.shift()];
    return value;
  }

  // bare minimum ignores for IE8
  var ignoredGlobalProps = ['_g', 'sessionStorage', 'localStorage', 'clipboardData', 'frames', 'external', 'mozAnimationStartTime', 'webkitStorageInfo', 'webkitIndexedDB'];

  var globalSnapshot;

  function forEachGlobal(callback) {
    if (Object.keys)
      Object.keys(__global).forEach(callback);
    else
      for (var g in __global) {
        if (!hasOwnProperty.call(__global, g))
          continue;
        callback(g);
      }
  }

  function forEachGlobalValue(callback) {
    forEachGlobal(function(globalName) {
      if (indexOf.call(ignoredGlobalProps, globalName) != -1)
        return;
      try {
        var value = __global[globalName];
      }
      catch (e) {
        ignoredGlobalProps.push(globalName);
      }
      callback(globalName, value);
    });
  }

  loader.set('@@global-helpers', loader.newModule({
    prepareGlobal: function(moduleName, exportName, globals) {
      // disable module detection
      var curDefine = __global.define;
       
      __global.define = undefined;
      __global.exports = undefined;
      if (__global.module && __global.module.exports)
        __global.module = undefined;

      // set globals
      var oldGlobals;
      if (globals) {
        oldGlobals = {};
        for (var g in globals) {
          oldGlobals[g] = globals[g];
          __global[g] = globals[g];
        }
      }

      // store a complete copy of the global object in order to detect changes
      if (!exportName) {
        globalSnapshot = {};

        forEachGlobalValue(function(name, value) {
          globalSnapshot[name] = value;
        });
      }

      // return function to retrieve global
      return function() {
        var globalValue;

        if (exportName) {
          globalValue = readMemberExpression(exportName, __global);
        }
        else {
          var singleGlobal;
          var multipleExports;
          var exports = {};

          forEachGlobalValue(function(name, value) {
            if (globalSnapshot[name] === value)
              return;
            if (typeof value == 'undefined')
              return;
            exports[name] = value;

            if (typeof singleGlobal != 'undefined') {
              if (!multipleExports && singleGlobal !== value)
                multipleExports = true;
            }
            else {
              singleGlobal = value;
            }
          });
          globalValue = multipleExports ? exports : singleGlobal;
        }

        // revert globals
        if (oldGlobals) {
          for (var g in oldGlobals)
            __global[g] = oldGlobals[g];
        }
        __global.define = curDefine;

        return globalValue;
      };
    }
  }));

})(typeof self != 'undefined' ? self : global);

$__System.registerDynamic("1", [], false, function(__require, __exports, __module) {
  var _retrieveGlobal = $__System.get("@@global-helpers").prepareGlobal(__module.id, null, null);
  (function() {
    (function() {
      if (scope && scope.Logger) {
        scope.Logger.enableAll();
      }
    })();
  })();
  return _retrieveGlobal();
});

$__System.registerDynamic("2", [], false, function(__require, __exports, __module) {
  var _retrieveGlobal = $__System.get("@@global-helpers").prepareGlobal(__module.id, null, null);
  (function() {
    (function() {
      var lastTime = 0;
      var vendors = ['webkit', 'moz'];
      for (var x = 0; x < vendors.length && !window.requestAnimationFrame; ++x) {
        window.requestAnimationFrame = window[vendors[x] + 'RequestAnimationFrame'];
        window.cancelAnimationFrame = window[vendors[x] + 'CancelAnimationFrame'] || window[vendors[x] + 'CancelRequestAnimationFrame'];
      }
      if (!window.requestAnimationFrame) {
        window.requestAnimationFrame = function(callback, element) {
          var currTime = new Date().getTime();
          var timeToCall = Math.max(0, 16 - (currTime - lastTime));
          var id = window.setTimeout(function() {
            callback(currTime + timeToCall);
          }, timeToCall);
          lastTime = currTime + timeToCall;
          return id;
        };
      }
      if (!window.cancelAnimationFrame) {
        window.cancelAnimationFrame = function(id) {
          clearTimeout(id);
        };
      }
    }());
  })();
  return _retrieveGlobal();
});

$__System.registerDynamic("4", [], false, function(__require, __exports, __module) {
  var _retrieveGlobal = $__System.get("@@global-helpers").prepareGlobal(__module.id, null, null);
  (function() {
    if (!("dataset" in document.createElement("_"))) {
      Object.defineProperty(HTMLElement.prototype, 'dataset', {
        get: function() {
          var dataset = {},
              attr = this.attributes;
          var copy = {};
          var count = 0;
          var camelcase = null;
          var attrValue = null;
          for (var i = 0; i < attr.length; i++) {
            if (attr[i].name.match(RegExp("^data-(.*)"))) {
              count++;
              var key = RegExp.$1;
              camelcase = utils.camelCase(key);
              attrValue = this.getAttribute(attr[i].name);
              dataset[camelcase] = attrValue;
              if (!this.$$__dataset) {
                copy[camelcase] = attrValue;
              }
            }
          }
          if (!this.$$__oldData) {
            this.$$__oldData = dataset;
          }
          if (!this.$$__dataset) {
            this.$$__dataset = copy;
            this.$$__datasetCallback = function(changes) {
              changes.forEach(function(change) {
                switch (change.type) {
                  case "add":
                  case "update":
                    var name = "";
                    for (var p in change.object) {
                      if (p != "$$__observers") {
                        name = "data-" + utils.hyphenate(p);
                        this.setAttribute(name, change.object[p]);
                      }
                    }
                    break;
                  case "delete":
                    this.removeAttribute("data-" + utils.hyphenate(change.name));
                    break;
                }
              }.bind(this));
            }.bind(this);
            Object.observe(this.$$__dataset, this.$$__datasetCallback);
          } else {
            if (!utils.equals(this.$$__oldData, dataset)) {
              Object.unobserve(this.$$__dataset, this.$$__datasetCallback);
              var changes = Object.changes(this.$$__dataset, dataset);
              for (var added in changes.added) {
                this.$$__dataset[utils.camelCase(added)] = dataset[utils.camelCase(added)];
              }
              for (var removed in changes.removed) {
                delete this.$$__dataset[utils.camelCase(removed)];
              }
              for (var update in changes.update) {
                this.$$__dataset[utils.camelCase(update)] = dataset[utils.camelCase(added)];
              }
              Object.observe(this.$$__dataset, this.$$__datasetCallback);
            }
            this.$$__oldData = dataset;
          }
          if (count === 0) {
            Object.unobserve(this.$$__dataset, this.$$__datasetCallback);
          }
          return this.$$__dataset;
        },
        set: function(value) {},
        enumerable: true,
        configurable: true
      });
    }
  })();
  return _retrieveGlobal();
});

$__System.registerDynamic("7", [], false, function(__require, __exports, __module) {
  var _retrieveGlobal = $__System.get("@@global-helpers").prepareGlobal(__module.id, null, null);
  (function() {
    !function(a, b) {
      b["true"] = a;
      var c = {},
          d = {},
          e = {},
          f = null;
      !function(a) {
        function b(a) {
          if ("number" == typeof a)
            return a;
          var b = {};
          for (var c in a)
            b[c] = a[c];
          return b;
        }
        function c() {
          this._delay = 0, this._endDelay = 0, this._fill = "none", this._iterationStart = 0, this._iterations = 1, this._duration = 0, this._playbackRate = 1, this._direction = "normal", this._easing = "linear";
        }
        function d(b, d) {
          var e = new c;
          return d && (e.fill = "both", e.duration = "auto"), "number" != typeof b || isNaN(b) ? void 0 !== b && Object.getOwnPropertyNames(b).forEach(function(c) {
            if ("auto" != b[c]) {
              if (("number" == typeof e[c] || "duration" == c) && ("number" != typeof b[c] || isNaN(b[c])))
                return;
              if ("fill" == c && -1 == s.indexOf(b[c]))
                return;
              if ("direction" == c && -1 == t.indexOf(b[c]))
                return;
              if ("playbackRate" == c && 1 !== b[c] && a.isDeprecated("AnimationEffectTiming.playbackRate", "2014-11-28", "Use Animation.playbackRate instead."))
                return;
              e[c] = b[c];
            }
          }) : e.duration = b, e;
        }
        function e(a) {
          return "number" == typeof a && (a = isNaN(a) ? {duration: 0} : {duration: a}), a;
        }
        function f(b, c) {
          b = a.numericTimingToObject(b);
          var e = d(b, c);
          return e._easing = i(e.easing), e;
        }
        function g(a, b, c, d) {
          return 0 > a || a > 1 || 0 > c || c > 1 ? B : function(e) {
            function f(a, b, c) {
              return 3 * a * (1 - c) * (1 - c) * c + 3 * b * (1 - c) * c * c + c * c * c;
            }
            if (0 == e || 1 == e)
              return e;
            for (var g = 0,
                h = 1; ; ) {
              var i = (g + h) / 2,
                  j = f(a, c, i);
              if (Math.abs(e - j) < .001)
                return f(b, d, i);
              e > j ? g = i : h = i;
            }
          };
        }
        function h(a, b) {
          return function(c) {
            if (c >= 1)
              return 1;
            var d = 1 / a;
            return c += b * d, c - c % d;
          };
        }
        function i(a) {
          var b = z.exec(a);
          if (b)
            return g.apply(this, b.slice(1).map(Number));
          var c = A.exec(a);
          if (c)
            return h(Number(c[1]), {
              start: u,
              middle: v,
              end: w
            }[c[2]]);
          var d = x[a];
          return d ? d : B;
        }
        function j(a) {
          return Math.abs(k(a) / a.playbackRate);
        }
        function k(a) {
          return a.duration * a.iterations;
        }
        function l(a, b, c) {
          return null == b ? C : b < c.delay ? D : b >= c.delay + a ? E : F;
        }
        function m(a, b, c, d, e) {
          switch (d) {
            case D:
              return "backwards" == b || "both" == b ? 0 : null;
            case F:
              return c - e;
            case E:
              return "forwards" == b || "both" == b ? a : null;
            case C:
              return null;
          }
        }
        function n(a, b, c, d) {
          return (d.playbackRate < 0 ? b - a : b) * d.playbackRate + c;
        }
        function o(a, b, c, d, e) {
          return 1 / 0 === c || c === -1 / 0 || c - d == b && e.iterations && (e.iterations + e.iterationStart) % 1 == 0 ? a : c % a;
        }
        function p(a, b, c, d) {
          return 0 === c ? 0 : b == a ? d.iterationStart + d.iterations - 1 : Math.floor(c / a);
        }
        function q(a, b, c, d) {
          var e = a % 2 >= 1,
              f = "normal" == d.direction || d.direction == (e ? "alternate-reverse" : "alternate"),
              g = f ? c : b - c,
              h = g / b;
          return b * d.easing(h);
        }
        function r(a, b, c) {
          var d = l(a, b, c),
              e = m(a, c.fill, b, d, c.delay);
          if (null === e)
            return null;
          if (0 === a)
            return d === D ? 0 : 1;
          var f = c.iterationStart * c.duration,
              g = n(a, e, f, c),
              h = o(c.duration, k(c), g, f, c),
              i = p(c.duration, h, g, c);
          return q(i, c.duration, h, c) / c.duration;
        }
        var s = "backwards|forwards|both|none".split("|"),
            t = "reverse|alternate|alternate-reverse".split("|");
        c.prototype = {
          _setMember: function(b, c) {
            this["_" + b] = c, this._effect && (this._effect._timingInput[b] = c, this._effect._timing = a.normalizeTimingInput(a.normalizeTimingInput(this._effect._timingInput)), this._effect.activeDuration = a.calculateActiveDuration(this._effect._timing), this._effect._animation && this._effect._animation._rebuildUnderlyingAnimation());
          },
          get playbackRate() {
            return this._playbackRate;
          },
          set delay(a) {
            this._setMember("delay", a);
          },
          get delay() {
            return this._delay;
          },
          set endDelay(a) {
            this._setMember("endDelay", a);
          },
          get endDelay() {
            return this._endDelay;
          },
          set fill(a) {
            this._setMember("fill", a);
          },
          get fill() {
            return this._fill;
          },
          set iterationStart(a) {
            this._setMember("iterationStart", a);
          },
          get iterationStart() {
            return this._iterationStart;
          },
          set duration(a) {
            this._setMember("duration", a);
          },
          get duration() {
            return this._duration;
          },
          set direction(a) {
            this._setMember("direction", a);
          },
          get direction() {
            return this._direction;
          },
          set easing(a) {
            this._setMember("easing", a);
          },
          get easing() {
            return this._easing;
          },
          set iterations(a) {
            this._setMember("iterations", a);
          },
          get iterations() {
            return this._iterations;
          }
        };
        var u = 1,
            v = .5,
            w = 0,
            x = {
              ease: g(.25, .1, .25, 1),
              "ease-in": g(.42, 0, 1, 1),
              "ease-out": g(0, 0, .58, 1),
              "ease-in-out": g(.42, 0, .58, 1),
              "step-start": h(1, u),
              "step-middle": h(1, v),
              "step-end": h(1, w)
            },
            y = "\\s*(-?\\d+\\.?\\d*|-?\\.\\d+)\\s*",
            z = new RegExp("cubic-bezier\\(" + y + "," + y + "," + y + "," + y + "\\)"),
            A = /steps\(\s*(\d+)\s*,\s*(start|middle|end)\s*\)/,
            B = function(a) {
              return a;
            },
            C = 0,
            D = 1,
            E = 2,
            F = 3;
        a.cloneTimingInput = b, a.makeTiming = d, a.numericTimingToObject = e, a.normalizeTimingInput = f, a.calculateActiveDuration = j, a.calculateTimeFraction = r, a.calculatePhase = l, a.toTimingFunction = i;
      }(c, f), function(a) {
        function b(a, b) {
          return a in h ? h[a][b] || b : b;
        }
        function c(a, c, d) {
          var g = e[a];
          if (g) {
            f.style[a] = c;
            for (var h in g) {
              var i = g[h],
                  j = f.style[i];
              d[i] = b(i, j);
            }
          } else
            d[a] = b(a, c);
        }
        function d(b) {
          function d() {
            var a = e.length;
            null == e[a - 1].offset && (e[a - 1].offset = 1), a > 1 && null == e[0].offset && (e[0].offset = 0);
            for (var b = 0,
                c = e[0].offset,
                d = 1; a > d; d++) {
              var f = e[d].offset;
              if (null != f) {
                for (var g = 1; d - b > g; g++)
                  e[b + g].offset = c + (f - c) * g / (d - b);
                b = d, c = f;
              }
            }
          }
          if (!Array.isArray(b) && null !== b)
            throw new TypeError("Keyframes must be null or an array of keyframes");
          if (null == b)
            return [];
          for (var e = b.map(function(b) {
            var d = {};
            for (var e in b) {
              var f = b[e];
              if ("offset" == e) {
                if (null != f && (f = Number(f), !isFinite(f)))
                  throw new TypeError("keyframe offsets must be numbers.");
              } else {
                if ("composite" == e)
                  throw {
                    type: DOMException.NOT_SUPPORTED_ERR,
                    name: "NotSupportedError",
                    message: "add compositing is not supported"
                  };
                f = "easing" == e ? a.toTimingFunction(f) : "" + f;
              }
              c(e, f, d);
            }
            return void 0 == d.offset && (d.offset = null), void 0 == d.easing && (d.easing = a.toTimingFunction("linear")), d;
          }),
              f = !0,
              g = -1 / 0,
              h = 0; h < e.length; h++) {
            var i = e[h].offset;
            if (null != i) {
              if (g > i)
                throw {
                  code: DOMException.INVALID_MODIFICATION_ERR,
                  name: "InvalidModificationError",
                  message: "Keyframes are not loosely sorted by offset. Sort or specify offsets."
                };
              g = i;
            } else
              f = !1;
          }
          return e = e.filter(function(a) {
            return a.offset >= 0 && a.offset <= 1;
          }), f || d(), e;
        }
        var e = {
          background: ["backgroundImage", "backgroundPosition", "backgroundSize", "backgroundRepeat", "backgroundAttachment", "backgroundOrigin", "backgroundClip", "backgroundColor"],
          border: ["borderTopColor", "borderTopStyle", "borderTopWidth", "borderRightColor", "borderRightStyle", "borderRightWidth", "borderBottomColor", "borderBottomStyle", "borderBottomWidth", "borderLeftColor", "borderLeftStyle", "borderLeftWidth"],
          borderBottom: ["borderBottomWidth", "borderBottomStyle", "borderBottomColor"],
          borderColor: ["borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor"],
          borderLeft: ["borderLeftWidth", "borderLeftStyle", "borderLeftColor"],
          borderRadius: ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"],
          borderRight: ["borderRightWidth", "borderRightStyle", "borderRightColor"],
          borderTop: ["borderTopWidth", "borderTopStyle", "borderTopColor"],
          borderWidth: ["borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"],
          flex: ["flexGrow", "flexShrink", "flexBasis"],
          font: ["fontFamily", "fontSize", "fontStyle", "fontVariant", "fontWeight", "lineHeight"],
          margin: ["marginTop", "marginRight", "marginBottom", "marginLeft"],
          outline: ["outlineColor", "outlineStyle", "outlineWidth"],
          padding: ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]
        },
            f = document.createElementNS("http://www.w3.org/1999/xhtml", "div"),
            g = {
              thin: "1px",
              medium: "3px",
              thick: "5px"
            },
            h = {
              borderBottomWidth: g,
              borderLeftWidth: g,
              borderRightWidth: g,
              borderTopWidth: g,
              fontSize: {
                "xx-small": "60%",
                "x-small": "75%",
                small: "89%",
                medium: "100%",
                large: "120%",
                "x-large": "150%",
                "xx-large": "200%"
              },
              fontWeight: {
                normal: "400",
                bold: "700"
              },
              outlineWidth: g,
              textShadow: {none: "0px 0px 0px transparent"},
              boxShadow: {none: "0px 0px 0px 0px transparent"}
            };
        a.normalizeKeyframes = d;
      }(c, f), function(a) {
        var b = {};
        a.isDeprecated = function(a, c, d, e) {
          var f = e ? "are" : "is",
              g = new Date,
              h = new Date(c);
          return h.setMonth(h.getMonth() + 3), h > g ? (a in b || console.warn("Web Animations: " + a + " " + f + " deprecated and will stop working on " + h.toDateString() + ". " + d), b[a] = !0, !1) : !0;
        }, a.deprecated = function(b, c, d, e) {
          var f = e ? "are" : "is";
          if (a.isDeprecated(b, c, d, e))
            throw new Error(b + " " + f + " no longer supported. " + d);
        };
      }(c), function() {
        if (document.documentElement.animate) {
          var a = document.documentElement.animate([], 0),
              b = !0;
          if (a && (b = !1, "play|currentTime|pause|reverse|playbackRate|cancel|finish|startTime|playState".split("|").forEach(function(c) {
            void 0 === a[c] && (b = !0);
          })), !b)
            return;
        }
        !function(a, b) {
          function c(a) {
            for (var b = {},
                c = 0; c < a.length; c++)
              for (var d in a[c])
                if ("offset" != d && "easing" != d && "composite" != d) {
                  var e = {
                    offset: a[c].offset,
                    easing: a[c].easing,
                    value: a[c][d]
                  };
                  b[d] = b[d] || [], b[d].push(e);
                }
            for (var f in b) {
              var g = b[f];
              if (0 != g[0].offset || 1 != g[g.length - 1].offset)
                throw {
                  type: DOMException.NOT_SUPPORTED_ERR,
                  name: "NotSupportedError",
                  message: "Partial keyframes are not supported"
                };
            }
            return b;
          }
          function d(a) {
            var c = [];
            for (var d in a)
              for (var e = a[d],
                  f = 0; f < e.length - 1; f++) {
                var g = e[f].offset,
                    h = e[f + 1].offset,
                    i = e[f].value,
                    j = e[f + 1].value;
                g == h && (1 == h ? i = j : j = i), c.push({
                  startTime: g,
                  endTime: h,
                  easing: e[f].easing,
                  property: d,
                  interpolation: b.propertyInterpolation(d, i, j)
                });
              }
            return c.sort(function(a, b) {
              return a.startTime - b.startTime;
            }), c;
          }
          b.convertEffectInput = function(e) {
            var f = a.normalizeKeyframes(e),
                g = c(f),
                h = d(g);
            return function(a, c) {
              if (null != c)
                h.filter(function(a) {
                  return 0 >= c && 0 == a.startTime || c >= 1 && 1 == a.endTime || c >= a.startTime && c <= a.endTime;
                }).forEach(function(d) {
                  var e = c - d.startTime,
                      f = d.endTime - d.startTime,
                      g = 0 == f ? 0 : d.easing(e / f);
                  b.apply(a, d.property, d.interpolation(g));
                });
              else
                for (var d in g)
                  "offset" != d && "easing" != d && "composite" != d && b.clear(a, d);
            };
          };
        }(c, d, f), function(a) {
          function b(a, b, c) {
            e[c] = e[c] || [], e[c].push([a, b]);
          }
          function c(a, c, d) {
            for (var e = 0; e < d.length; e++) {
              var f = d[e];
              b(a, c, f), /-/.test(f) && b(a, c, f.replace(/-(.)/g, function(a, b) {
                return b.toUpperCase();
              }));
            }
          }
          function d(b, c, d) {
            if ("initial" == c || "initial" == d) {
              var g = b.replace(/-(.)/g, function(a, b) {
                return b.toUpperCase();
              });
              "initial" == c && (c = f[g]), "initial" == d && (d = f[g]);
            }
            for (var h = c == d ? [] : e[b],
                i = 0; h && i < h.length; i++) {
              var j = h[i][0](c),
                  k = h[i][0](d);
              if (void 0 !== j && void 0 !== k) {
                var l = h[i][1](j, k);
                if (l) {
                  var m = a.Interpolation.apply(null, l);
                  return function(a) {
                    return 0 == a ? c : 1 == a ? d : m(a);
                  };
                }
              }
            }
            return a.Interpolation(!1, !0, function(a) {
              return a ? d : c;
            });
          }
          var e = {};
          a.addPropertiesHandler = c;
          var f = {
            backgroundColor: "transparent",
            backgroundPosition: "0% 0%",
            borderBottomColor: "currentColor",
            borderBottomLeftRadius: "0px",
            borderBottomRightRadius: "0px",
            borderBottomWidth: "3px",
            borderLeftColor: "currentColor",
            borderLeftWidth: "3px",
            borderRightColor: "currentColor",
            borderRightWidth: "3px",
            borderSpacing: "2px",
            borderTopColor: "currentColor",
            borderTopLeftRadius: "0px",
            borderTopRightRadius: "0px",
            borderTopWidth: "3px",
            bottom: "auto",
            clip: "rect(0px, 0px, 0px, 0px)",
            color: "black",
            fontSize: "100%",
            fontWeight: "400",
            height: "auto",
            left: "auto",
            letterSpacing: "normal",
            lineHeight: "120%",
            marginBottom: "0px",
            marginLeft: "0px",
            marginRight: "0px",
            marginTop: "0px",
            maxHeight: "none",
            maxWidth: "none",
            minHeight: "0px",
            minWidth: "0px",
            opacity: "1.0",
            outlineColor: "invert",
            outlineOffset: "0px",
            outlineWidth: "3px",
            paddingBottom: "0px",
            paddingLeft: "0px",
            paddingRight: "0px",
            paddingTop: "0px",
            right: "auto",
            textIndent: "0px",
            textShadow: "0px 0px 0px transparent",
            top: "auto",
            transform: "",
            verticalAlign: "0px",
            visibility: "visible",
            width: "auto",
            wordSpacing: "normal",
            zIndex: "auto"
          };
          a.propertyInterpolation = d;
        }(d, f), function(a, b) {
          function c(b) {
            var c = a.calculateActiveDuration(b),
                d = function(d) {
                  return a.calculateTimeFraction(c, d, b);
                };
            return d._totalDuration = b.delay + c + b.endDelay, d._isCurrent = function(d) {
              var e = a.calculatePhase(c, d, b);
              return e === PhaseActive || e === PhaseBefore;
            }, d;
          }
          b.KeyframeEffect = function(d, e, f) {
            var g,
                h = c(a.normalizeTimingInput(f)),
                i = b.convertEffectInput(e),
                j = function() {
                  i(d, g);
                };
            return j._update = function(a) {
              return g = h(a), null !== g;
            }, j._clear = function() {
              i(d, null);
            }, j._hasSameTarget = function(a) {
              return d === a;
            }, j._isCurrent = h._isCurrent, j._totalDuration = h._totalDuration, j;
          }, b.NullEffect = function(a) {
            var b = function() {
              a && (a(), a = null);
            };
            return b._update = function() {
              return null;
            }, b._totalDuration = 0, b._isCurrent = function() {
              return !1;
            }, b._hasSameTarget = function() {
              return !1;
            }, b;
          };
        }(c, d, f), function(a) {
          function b(a, b, c) {
            c.enumerable = !0, c.configurable = !0, Object.defineProperty(a, b, c);
          }
          function c(a) {
            this._surrogateStyle = document.createElementNS("http://www.w3.org/1999/xhtml", "div").style, this._style = a.style, this._length = 0, this._isAnimatedProperty = {};
            for (var b = 0; b < this._style.length; b++) {
              var c = this._style[b];
              this._surrogateStyle[c] = this._style[c];
            }
            this._updateIndices();
          }
          function d(a) {
            if (!a._webAnimationsPatchedStyle) {
              var d = new c(a);
              try {
                b(a, "style", {get: function() {
                    return d;
                  }});
              } catch (e) {
                a.style._set = function(b, c) {
                  a.style[b] = c;
                }, a.style._clear = function(b) {
                  a.style[b] = "";
                };
              }
              a._webAnimationsPatchedStyle = a.style;
            }
          }
          var e = {
            cssText: 1,
            length: 1,
            parentRule: 1
          },
              f = {
                getPropertyCSSValue: 1,
                getPropertyPriority: 1,
                getPropertyValue: 1,
                item: 1,
                removeProperty: 1,
                setProperty: 1
              },
              g = {
                removeProperty: 1,
                setProperty: 1
              };
          c.prototype = {
            get cssText() {
              return this._surrogateStyle.cssText;
            },
            set cssText(a) {
              for (var b = {},
                  c = 0; c < this._surrogateStyle.length; c++)
                b[this._surrogateStyle[c]] = !0;
              this._surrogateStyle.cssText = a, this._updateIndices();
              for (var c = 0; c < this._surrogateStyle.length; c++)
                b[this._surrogateStyle[c]] = !0;
              for (var d in b)
                this._isAnimatedProperty[d] || this._style.setProperty(d, this._surrogateStyle.getPropertyValue(d));
            },
            get length() {
              return this._surrogateStyle.length;
            },
            get parentRule() {
              return this._style.parentRule;
            },
            _updateIndices: function() {
              for (; this._length < this._surrogateStyle.length; )
                Object.defineProperty(this, this._length, {
                  configurable: !0,
                  enumerable: !1,
                  get: function(a) {
                    return function() {
                      return this._surrogateStyle[a];
                    };
                  }(this._length)
                }), this._length++;
              for (; this._length > this._surrogateStyle.length; )
                this._length--, Object.defineProperty(this, this._length, {
                  configurable: !0,
                  enumerable: !1,
                  value: void 0
                });
            },
            _set: function(a, b) {
              this._style[a] = b, this._isAnimatedProperty[a] = !0;
            },
            _clear: function(a) {
              this._style[a] = this._surrogateStyle[a], delete this._isAnimatedProperty[a];
            }
          };
          for (var h in f)
            c.prototype[h] = function(a, b) {
              return function() {
                var c = this._surrogateStyle[a].apply(this._surrogateStyle, arguments);
                return b && (this._isAnimatedProperty[arguments[0]] || this._style[a].apply(this._style, arguments), this._updateIndices()), c;
              };
            }(h, h in g);
          for (var i in document.documentElement.style)
            i in e || i in f || !function(a) {
              b(c.prototype, a, {
                get: function() {
                  return this._surrogateStyle[a];
                },
                set: function(b) {
                  this._surrogateStyle[a] = b, this._updateIndices(), this._isAnimatedProperty[a] || (this._style[a] = b);
                }
              });
            }(i);
          a.apply = function(b, c, e) {
            d(b), b.style._set(a.propertyName(c), e);
          }, a.clear = function(b, c) {
            b._webAnimationsPatchedStyle && b.style._clear(a.propertyName(c));
          };
        }(d, f), function(a) {
          window.Element.prototype.animate = function(b, c) {
            return a.timeline._play(a.KeyframeEffect(this, b, c));
          };
        }(d), function(a) {
          function b(a, c, d) {
            if ("number" == typeof a && "number" == typeof c)
              return a * (1 - d) + c * d;
            if ("boolean" == typeof a && "boolean" == typeof c)
              return .5 > d ? a : c;
            if (a.length == c.length) {
              for (var e = [],
                  f = 0; f < a.length; f++)
                e.push(b(a[f], c[f], d));
              return e;
            }
            throw "Mismatched interpolation arguments " + a + ":" + c;
          }
          a.Interpolation = function(a, c, d) {
            return function(e) {
              return d(b(a, c, e));
            };
          };
        }(d, f), function(a) {
          function b(a, b, c) {
            return Math.max(Math.min(a, c), b);
          }
          function c(c, d, e) {
            var f = a.dot(c, d);
            f = b(f, -1, 1);
            var g = [];
            if (1 === f)
              g = c;
            else
              for (var h = Math.acos(f),
                  i = 1 * Math.sin(e * h) / Math.sqrt(1 - f * f),
                  j = 0; 4 > j; j++)
                g.push(c[j] * (Math.cos(e * h) - f * i) + d[j] * i);
            return g;
          }
          var d = function() {
            function a(a, b) {
              for (var c = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
                  d = 0; 4 > d; d++)
                for (var e = 0; 4 > e; e++)
                  for (var f = 0; 4 > f; f++)
                    c[d][e] += b[d][f] * a[f][e];
              return c;
            }
            function b(a) {
              return 0 == a[0][2] && 0 == a[0][3] && 0 == a[1][2] && 0 == a[1][3] && 0 == a[2][0] && 0 == a[2][1] && 1 == a[2][2] && 0 == a[2][3] && 0 == a[3][2] && 1 == a[3][3];
            }
            function c(c, d, e, f, g) {
              for (var h = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
                  i = 0; 4 > i; i++)
                h[i][3] = g[i];
              for (var i = 0; 3 > i; i++)
                for (var j = 0; 3 > j; j++)
                  h[3][i] += c[j] * h[j][i];
              var k = f[0],
                  l = f[1],
                  m = f[2],
                  n = f[3],
                  o = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
              o[0][0] = 1 - 2 * (l * l + m * m), o[0][1] = 2 * (k * l - m * n), o[0][2] = 2 * (k * m + l * n), o[1][0] = 2 * (k * l + m * n), o[1][1] = 1 - 2 * (k * k + m * m), o[1][2] = 2 * (l * m - k * n), o[2][0] = 2 * (k * m - l * n), o[2][1] = 2 * (l * m + k * n), o[2][2] = 1 - 2 * (k * k + l * l), h = a(h, o);
              var p = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
              e[2] && (p[2][1] = e[2], h = a(h, p)), e[1] && (p[2][1] = 0, p[2][0] = e[0], h = a(h, p)), e[0] && (p[2][0] = 0, p[1][0] = e[0], h = a(h, p));
              for (var i = 0; 3 > i; i++)
                for (var j = 0; 3 > j; j++)
                  h[i][j] *= d[i];
              return b(h) ? [h[0][0], h[0][1], h[1][0], h[1][1], h[3][0], h[3][1]] : h[0].concat(h[1], h[2], h[3]);
            }
            return c;
          }();
          a.composeMatrix = d, a.quat = c;
        }(d, f), function(a, b) {
          a.sequenceNumber = 0;
          var c = function(a, b, c) {
            this.target = a, this.currentTime = b, this.timelineTime = c, this.type = "finish", this.bubbles = !1, this.cancelable = !1, this.currentTarget = a, this.defaultPrevented = !1, this.eventPhase = Event.AT_TARGET, this.timeStamp = Date.now();
          };
          b.Animation = function(b) {
            this._sequenceNumber = a.sequenceNumber++, this._currentTime = 0, this._startTime = null, this._paused = !1, this._playbackRate = 1, this._inTimeline = !0, this._finishedFlag = !1, this.onfinish = null, this._finishHandlers = [], this._effect = b, this._inEffect = this._effect._update(0), this._idle = !0, this._currentTimePending = !1;
          }, b.Animation.prototype = {
            _ensureAlive: function() {
              this._inEffect = this._effect._update(this.playbackRate < 0 && 0 === this.currentTime ? -1 : this.currentTime), this._inTimeline || !this._inEffect && this._finishedFlag || (this._inTimeline = !0, b.timeline._animations.push(this));
            },
            _tickCurrentTime: function(a, b) {
              a != this._currentTime && (this._currentTime = a, this._isFinished && !b && (this._currentTime = this._playbackRate > 0 ? this._totalDuration : 0), this._ensureAlive());
            },
            get currentTime() {
              return this._idle || this._currentTimePending ? null : this._currentTime;
            },
            set currentTime(a) {
              a = +a, isNaN(a) || (b.restart(), this._paused || null == this._startTime || (this._startTime = this._timeline.currentTime - a / this._playbackRate), this._currentTimePending = !1, this._currentTime != a && (this._tickCurrentTime(a, !0), b.invalidateEffects()));
            },
            get startTime() {
              return this._startTime;
            },
            set startTime(a) {
              a = +a, isNaN(a) || this._paused || this._idle || (this._startTime = a, this._tickCurrentTime((this._timeline.currentTime - this._startTime) * this.playbackRate), b.invalidateEffects());
            },
            get playbackRate() {
              return this._playbackRate;
            },
            set playbackRate(a) {
              if (a != this._playbackRate) {
                var b = this.currentTime;
                this._playbackRate = a, this._startTime = null, "paused" != this.playState && "idle" != this.playState && this.play(), null != b && (this.currentTime = b);
              }
            },
            get _isFinished() {
              return !this._idle && (this._playbackRate > 0 && this._currentTime >= this._totalDuration || this._playbackRate < 0 && this._currentTime <= 0);
            },
            get _totalDuration() {
              return this._effect._totalDuration;
            },
            get playState() {
              return this._idle ? "idle" : null == this._startTime && !this._paused && 0 != this.playbackRate || this._currentTimePending ? "pending" : this._paused ? "paused" : this._isFinished ? "finished" : "running";
            },
            play: function() {
              this._paused = !1, (this._isFinished || this._idle) && (this._currentTime = this._playbackRate > 0 ? 0 : this._totalDuration, this._startTime = null, b.invalidateEffects()), this._finishedFlag = !1, b.restart(), this._idle = !1, this._ensureAlive();
            },
            pause: function() {
              this._isFinished || this._paused || this._idle || (this._currentTimePending = !0), this._startTime = null, this._paused = !0;
            },
            finish: function() {
              this._idle || (this.currentTime = this._playbackRate > 0 ? this._totalDuration : 0, this._startTime = this._totalDuration - this.currentTime, this._currentTimePending = !1);
            },
            cancel: function() {
              this._inEffect && (this._inEffect = !1, this._idle = !0, this.currentTime = 0, this._startTime = null, this._effect._update(null), b.invalidateEffects(), b.restart());
            },
            reverse: function() {
              this.playbackRate *= -1, this.play();
            },
            addEventListener: function(a, b) {
              "function" == typeof b && "finish" == a && this._finishHandlers.push(b);
            },
            removeEventListener: function(a, b) {
              if ("finish" == a) {
                var c = this._finishHandlers.indexOf(b);
                c >= 0 && this._finishHandlers.splice(c, 1);
              }
            },
            _fireEvents: function(a) {
              var b = this._isFinished;
              if ((b || this._idle) && !this._finishedFlag) {
                var d = new c(this, this._currentTime, a),
                    e = this._finishHandlers.concat(this.onfinish ? [this.onfinish] : []);
                setTimeout(function() {
                  e.forEach(function(a) {
                    a.call(d.target, d);
                  });
                }, 0);
              }
              this._finishedFlag = b;
            },
            _tick: function(a) {
              return this._idle || this._paused || (null == this._startTime ? this.startTime = a - this._currentTime / this.playbackRate : this._isFinished || this._tickCurrentTime((a - this._startTime) * this.playbackRate)), this._currentTimePending = !1, this._fireEvents(a), !this._idle && (this._inEffect || !this._finishedFlag);
            }
          };
        }(c, d, f), function(a, b) {
          function c(a) {
            var b = i;
            i = [], a < s.currentTime && (a = s.currentTime), g(a), b.forEach(function(b) {
              b[1](a);
            }), o && g(a), f(), l = void 0;
          }
          function d(a, b) {
            return a._sequenceNumber - b._sequenceNumber;
          }
          function e() {
            this._animations = [], this.currentTime = window.performance && performance.now ? performance.now() : 0;
          }
          function f() {
            p.forEach(function(a) {
              a();
            }), p.length = 0;
          }
          function g(a) {
            n = !1;
            var c = b.timeline;
            c.currentTime = a, c._animations.sort(d), m = !1;
            var e = c._animations;
            c._animations = [];
            var f = [],
                g = [];
            e = e.filter(function(b) {
              return b._inTimeline = b._tick(a), b._inEffect ? g.push(b._effect) : f.push(b._effect), b._isFinished || b._paused || b._idle || (m = !0), b._inTimeline;
            }), p.push.apply(p, f), p.push.apply(p, g), c._animations.push.apply(c._animations, e), o = !1, m && requestAnimationFrame(function() {});
          }
          var h = window.requestAnimationFrame,
              i = [],
              j = 0;
          window.requestAnimationFrame = function(a) {
            var b = j++;
            return 0 == i.length && h(c), i.push([b, a]), b;
          }, window.cancelAnimationFrame = function(a) {
            i.forEach(function(b) {
              b[0] == a && (b[1] = function() {});
            });
          }, e.prototype = {_play: function(c) {
              c._timing = a.normalizeTimingInput(c.timing);
              var d = new b.Animation(c);
              return d._idle = !1, d._timeline = this, this._animations.push(d), b.restart(), b.invalidateEffects(), d;
            }};
          var k,
              l = void 0,
              k = function() {
                return void 0 == l && (l = performance.now()), l;
              },
              m = !1,
              n = !1;
          b.restart = function() {
            return m || (m = !0, requestAnimationFrame(function() {}), n = !0), n;
          };
          var o = !1;
          b.invalidateEffects = function() {
            o = !0;
          };
          var p = [],
              q = 1e3 / 60,
              r = window.getComputedStyle;
          Object.defineProperty(window, "getComputedStyle", {
            configurable: !0,
            enumerable: !0,
            value: function() {
              if (o) {
                var a = k();
                a - s.currentTime > 0 && (s.currentTime += q * (Math.floor((a - s.currentTime) / q) + 1)), g(s.currentTime);
              }
              return f(), r.apply(this, arguments);
            }
          });
          var s = new e;
          b.timeline = s;
        }(c, d, f), function(a) {
          function b(a, b) {
            for (var c = 0,
                d = 0; d < a.length; d++)
              c += a[d] * b[d];
            return c;
          }
          function c(a, b) {
            return [a[0] * b[0] + a[4] * b[1] + a[8] * b[2] + a[12] * b[3], a[1] * b[0] + a[5] * b[1] + a[9] * b[2] + a[13] * b[3], a[2] * b[0] + a[6] * b[1] + a[10] * b[2] + a[14] * b[3], a[3] * b[0] + a[7] * b[1] + a[11] * b[2] + a[15] * b[3], a[0] * b[4] + a[4] * b[5] + a[8] * b[6] + a[12] * b[7], a[1] * b[4] + a[5] * b[5] + a[9] * b[6] + a[13] * b[7], a[2] * b[4] + a[6] * b[5] + a[10] * b[6] + a[14] * b[7], a[3] * b[4] + a[7] * b[5] + a[11] * b[6] + a[15] * b[7], a[0] * b[8] + a[4] * b[9] + a[8] * b[10] + a[12] * b[11], a[1] * b[8] + a[5] * b[9] + a[9] * b[10] + a[13] * b[11], a[2] * b[8] + a[6] * b[9] + a[10] * b[10] + a[14] * b[11], a[3] * b[8] + a[7] * b[9] + a[11] * b[10] + a[15] * b[11], a[0] * b[12] + a[4] * b[13] + a[8] * b[14] + a[12] * b[15], a[1] * b[12] + a[5] * b[13] + a[9] * b[14] + a[13] * b[15], a[2] * b[12] + a[6] * b[13] + a[10] * b[14] + a[14] * b[15], a[3] * b[12] + a[7] * b[13] + a[11] * b[14] + a[15] * b[15]];
          }
          function d(a) {
            switch (a.t) {
              case "rotatex":
                var b = a.d[0].rad || 0,
                    c = a.d[0].deg || 0,
                    d = c * Math.PI / 180 + b;
                return [1, 0, 0, 0, 0, Math.cos(d), Math.sin(d), 0, 0, -Math.sin(d), Math.cos(d), 0, 0, 0, 0, 1];
              case "rotatey":
                var b = a.d[0].rad || 0,
                    c = a.d[0].deg || 0,
                    d = c * Math.PI / 180 + b;
                return [Math.cos(d), 0, -Math.sin(d), 0, 0, 1, 0, 0, Math.sin(d), 0, Math.cos(d), 0, 0, 0, 0, 1];
              case "rotate":
              case "rotatez":
                var b = a.d[0].rad || 0,
                    c = a.d[0].deg || 0,
                    d = c * Math.PI / 180 + b;
                return [Math.cos(d), Math.sin(d), 0, 0, -Math.sin(d), Math.cos(d), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
              case "rotate3d":
                var e = a.d[0],
                    f = a.d[1],
                    g = a.d[2],
                    b = a.d[3].rad || 0,
                    c = a.d[3].deg || 0,
                    d = c * Math.PI / 180 + b,
                    h = e * e + f * f + g * g;
                if (0 === h)
                  e = 1, f = 0, g = 0;
                else if (1 !== h) {
                  var i = Math.sqrt(h);
                  e /= i, f /= i, g /= i;
                }
                var j = Math.sin(d / 2),
                    k = j * Math.cos(d / 2),
                    l = j * j;
                return [1 - 2 * (f * f + g * g) * l, 2 * (e * f * l + g * k), 2 * (e * g * l - f * k), 0, 2 * (e * f * l - g * k), 1 - 2 * (e * e + g * g) * l, 2 * (f * g * l + e * k), 0, 2 * (e * g * l + f * k), 2 * (f * g * l - e * k), 1 - 2 * (e * e + f * f) * l, 0, 0, 0, 0, 1];
              case "scale":
                return [a.d[0], 0, 0, 0, 0, a.d[1], 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
              case "scalex":
                return [a.d[0], 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
              case "scaley":
                return [1, 0, 0, 0, 0, a.d[0], 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
              case "scalez":
                return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, a.d[0], 0, 0, 0, 0, 1];
              case "scale3d":
                return [a.d[0], 0, 0, 0, 0, a.d[1], 0, 0, 0, 0, a.d[2], 0, 0, 0, 0, 1];
              case "skew":
                var m = a.d[0].deg || 0,
                    n = a.d[0].rad || 0,
                    o = a.d[1].deg || 0,
                    p = a.d[1].rad || 0,
                    q = m * Math.PI / 180 + n,
                    r = o * Math.PI / 180 + p;
                return [1, Math.tan(r), 0, 0, Math.tan(q), 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
              case "skewx":
                var b = a.d[0].rad || 0,
                    c = a.d[0].deg || 0,
                    d = c * Math.PI / 180 + b;
                return [1, 0, 0, 0, Math.tan(d), 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
              case "skewy":
                var b = a.d[0].rad || 0,
                    c = a.d[0].deg || 0,
                    d = c * Math.PI / 180 + b;
                return [1, Math.tan(d), 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
              case "translate":
                var e = a.d[0].px || 0,
                    f = a.d[1].px || 0;
                return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, e, f, 0, 1];
              case "translatex":
                var e = a.d[0].px || 0;
                return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, e, 0, 0, 1];
              case "translatey":
                var f = a.d[0].px || 0;
                return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, f, 0, 1];
              case "translatez":
                var g = a.d[0].px || 0;
                return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, g, 1];
              case "translate3d":
                var e = a.d[0].px || 0,
                    f = a.d[1].px || 0,
                    g = a.d[2].px || 0;
                return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, e, f, g, 1];
              case "perspective":
                var s = a.d[0].px ? -1 / a.d[0].px : 0;
                return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, s, 0, 0, 0, 1];
              case "matrix":
                return [a.d[0], a.d[1], 0, 0, a.d[2], a.d[3], 0, 0, 0, 0, 1, 0, a.d[4], a.d[5], 0, 1];
              case "matrix3d":
                return a.d;
            }
          }
          function e(a) {
            return 0 === a.length ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] : a.map(d).reduce(c);
          }
          function f(a) {
            return [g(e(a))];
          }
          var g = function() {
            function a(a) {
              return a[0][0] * a[1][1] * a[2][2] + a[1][0] * a[2][1] * a[0][2] + a[2][0] * a[0][1] * a[1][2] - a[0][2] * a[1][1] * a[2][0] - a[1][2] * a[2][1] * a[0][0] - a[2][2] * a[0][1] * a[1][0];
            }
            function c(b) {
              for (var c = 1 / a(b),
                  d = b[0][0],
                  e = b[0][1],
                  f = b[0][2],
                  g = b[1][0],
                  h = b[1][1],
                  i = b[1][2],
                  j = b[2][0],
                  k = b[2][1],
                  l = b[2][2],
                  m = [[(h * l - i * k) * c, (f * k - e * l) * c, (e * i - f * h) * c, 0], [(i * j - g * l) * c, (d * l - f * j) * c, (f * g - d * i) * c, 0], [(g * k - h * j) * c, (j * e - d * k) * c, (d * h - e * g) * c, 0]],
                  n = [],
                  o = 0; 3 > o; o++) {
                for (var p = 0,
                    q = 0; 3 > q; q++)
                  p += b[3][q] * m[q][o];
                n.push(p);
              }
              return n.push(1), m.push(n), m;
            }
            function d(a) {
              return [[a[0][0], a[1][0], a[2][0], a[3][0]], [a[0][1], a[1][1], a[2][1], a[3][1]], [a[0][2], a[1][2], a[2][2], a[3][2]], [a[0][3], a[1][3], a[2][3], a[3][3]]];
            }
            function e(a, b) {
              for (var c = [],
                  d = 0; 4 > d; d++) {
                for (var e = 0,
                    f = 0; 4 > f; f++)
                  e += a[f] * b[f][d];
                c.push(e);
              }
              return c;
            }
            function f(a) {
              var b = g(a);
              return [a[0] / b, a[1] / b, a[2] / b];
            }
            function g(a) {
              return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
            }
            function h(a, b, c, d) {
              return [c * a[0] + d * b[0], c * a[1] + d * b[1], c * a[2] + d * b[2]];
            }
            function i(a, b) {
              return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
            }
            function j(j) {
              var k = [j.slice(0, 4), j.slice(4, 8), j.slice(8, 12), j.slice(12, 16)];
              if (1 !== k[3][3])
                return null;
              for (var l = [],
                  m = 0; 4 > m; m++)
                l.push(k[m].slice());
              for (var m = 0; 3 > m; m++)
                l[m][3] = 0;
              if (0 === a(l))
                return !1;
              var n,
                  o = [];
              if (k[0][3] || k[1][3] || k[2][3]) {
                o.push(k[0][3]), o.push(k[1][3]), o.push(k[2][3]), o.push(k[3][3]);
                var p = c(l),
                    q = d(p);
                n = e(o, q);
              } else
                n = [0, 0, 0, 1];
              var r = k[3].slice(0, 3),
                  s = [];
              s.push(k[0].slice(0, 3));
              var t = [];
              t.push(g(s[0])), s[0] = f(s[0]);
              var u = [];
              s.push(k[1].slice(0, 3)), u.push(b(s[0], s[1])), s[1] = h(s[1], s[0], 1, -u[0]), t.push(g(s[1])), s[1] = f(s[1]), u[0] /= t[1], s.push(k[2].slice(0, 3)), u.push(b(s[0], s[2])), s[2] = h(s[2], s[0], 1, -u[1]), u.push(b(s[1], s[2])), s[2] = h(s[2], s[1], 1, -u[2]), t.push(g(s[2])), s[2] = f(s[2]), u[1] /= t[2], u[2] /= t[2];
              var v = i(s[1], s[2]);
              if (b(s[0], v) < 0)
                for (var m = 0; 3 > m; m++)
                  t[m] *= -1, s[m][0] *= -1, s[m][1] *= -1, s[m][2] *= -1;
              var w,
                  x,
                  y = s[0][0] + s[1][1] + s[2][2] + 1;
              return y > 1e-4 ? (w = .5 / Math.sqrt(y), x = [(s[2][1] - s[1][2]) * w, (s[0][2] - s[2][0]) * w, (s[1][0] - s[0][1]) * w, .25 / w]) : s[0][0] > s[1][1] && s[0][0] > s[2][2] ? (w = 2 * Math.sqrt(1 + s[0][0] - s[1][1] - s[2][2]), x = [.25 * w, (s[0][1] + s[1][0]) / w, (s[0][2] + s[2][0]) / w, (s[2][1] - s[1][2]) / w]) : s[1][1] > s[2][2] ? (w = 2 * Math.sqrt(1 + s[1][1] - s[0][0] - s[2][2]), x = [(s[0][1] + s[1][0]) / w, .25 * w, (s[1][2] + s[2][1]) / w, (s[0][2] - s[2][0]) / w]) : (w = 2 * Math.sqrt(1 + s[2][2] - s[0][0] - s[1][1]), x = [(s[0][2] + s[2][0]) / w, (s[1][2] + s[2][1]) / w, .25 * w, (s[1][0] - s[0][1]) / w]), [r, t, u, x, n];
            }
            return j;
          }();
          a.dot = b, a.makeMatrixDecomposition = f;
        }(d, f), function(a) {
          function b(a, b) {
            var c = a.exec(b);
            return c ? (c = a.ignoreCase ? c[0].toLowerCase() : c[0], [c, b.substr(c.length)]) : void 0;
          }
          function c(a, b) {
            b = b.replace(/^\s*/, "");
            var c = a(b);
            return c ? [c[0], c[1].replace(/^\s*/, "")] : void 0;
          }
          function d(a, d, e) {
            a = c.bind(null, a);
            for (var f = []; ; ) {
              var g = a(e);
              if (!g)
                return [f, e];
              if (f.push(g[0]), e = g[1], g = b(d, e), !g || "" == g[1])
                return [f, e];
              e = g[1];
            }
          }
          function e(a, b) {
            for (var c = 0,
                d = 0; d < b.length && (!/\s|,/.test(b[d]) || 0 != c); d++)
              if ("(" == b[d])
                c++;
              else if (")" == b[d] && (c--, 0 == c && d++, 0 >= c))
                break;
            var e = a(b.substr(0, d));
            return void 0 == e ? void 0 : [e, b.substr(d)];
          }
          function f(a, b) {
            for (var c = a,
                d = b; c && d; )
              c > d ? c %= d : d %= c;
            return c = a * b / (c + d);
          }
          function g(a) {
            return function(b) {
              var c = a(b);
              return c && (c[0] = void 0), c;
            };
          }
          function h(a, b) {
            return function(c) {
              var d = a(c);
              return d ? d : [b, c];
            };
          }
          function i(b, c) {
            for (var d = [],
                e = 0; e < b.length; e++) {
              var f = a.consumeTrimmed(b[e], c);
              if (!f || "" == f[0])
                return;
              void 0 !== f[0] && d.push(f[0]), c = f[1];
            }
            return "" == c ? d : void 0;
          }
          function j(a, b, c, d, e) {
            for (var g = [],
                h = [],
                i = [],
                j = f(d.length, e.length),
                k = 0; j > k; k++) {
              var l = b(d[k % d.length], e[k % e.length]);
              if (!l)
                return;
              g.push(l[0]), h.push(l[1]), i.push(l[2]);
            }
            return [g, h, function(b) {
              var d = b.map(function(a, b) {
                return i[b](a);
              }).join(c);
              return a ? a(d) : d;
            }];
          }
          function k(a, b, c) {
            for (var d = [],
                e = [],
                f = [],
                g = 0,
                h = 0; h < c.length; h++)
              if ("function" == typeof c[h]) {
                var i = c[h](a[g], b[g++]);
                d.push(i[0]), e.push(i[1]), f.push(i[2]);
              } else
                !function(a) {
                  d.push(!1), e.push(!1), f.push(function() {
                    return c[a];
                  });
                }(h);
            return [d, e, function(a) {
              for (var b = "",
                  c = 0; c < a.length; c++)
                b += f[c](a[c]);
              return b;
            }];
          }
          a.consumeToken = b, a.consumeTrimmed = c, a.consumeRepeated = d, a.consumeParenthesised = e, a.ignore = g, a.optional = h, a.consumeList = i, a.mergeNestedRepeated = j.bind(null, null), a.mergeWrappedNestedRepeated = j, a.mergeList = k;
        }(d), function(a) {
          function b(b) {
            function c(b) {
              var c = a.consumeToken(/^inset/i, b);
              if (c)
                return d.inset = !0, c;
              var c = a.consumeLengthOrPercent(b);
              if (c)
                return d.lengths.push(c[0]), c;
              var c = a.consumeColor(b);
              return c ? (d.color = c[0], c) : void 0;
            }
            var d = {
              inset: !1,
              lengths: [],
              color: null
            },
                e = a.consumeRepeated(c, /^/, b);
            return e && e[0].length ? [d, e[1]] : void 0;
          }
          function c(c) {
            var d = a.consumeRepeated(b, /^,/, c);
            return d && "" == d[1] ? d[0] : void 0;
          }
          function d(b, c) {
            for (; b.lengths.length < Math.max(b.lengths.length, c.lengths.length); )
              b.lengths.push({px: 0});
            for (; c.lengths.length < Math.max(b.lengths.length, c.lengths.length); )
              c.lengths.push({px: 0});
            if (b.inset == c.inset && !!b.color == !!c.color) {
              for (var d,
                  e = [],
                  f = [[], 0],
                  g = [[], 0],
                  h = 0; h < b.lengths.length; h++) {
                var i = a.mergeDimensions(b.lengths[h], c.lengths[h], 2 == h);
                f[0].push(i[0]), g[0].push(i[1]), e.push(i[2]);
              }
              if (b.color && c.color) {
                var j = a.mergeColors(b.color, c.color);
                f[1] = j[0], g[1] = j[1], d = j[2];
              }
              return [f, g, function(a) {
                for (var c = b.inset ? "inset " : " ",
                    f = 0; f < e.length; f++)
                  c += e[f](a[0][f]) + " ";
                return d && (c += d(a[1])), c;
              }];
            }
          }
          function e(b, c, d, e) {
            function f(a) {
              return {
                inset: a,
                color: [0, 0, 0, 0],
                lengths: [{px: 0}, {px: 0}, {px: 0}, {px: 0}]
              };
            }
            for (var g = [],
                h = [],
                i = 0; i < d.length || i < e.length; i++) {
              var j = d[i] || f(e[i].inset),
                  k = e[i] || f(d[i].inset);
              g.push(j), h.push(k);
            }
            return a.mergeNestedRepeated(b, c, g, h);
          }
          var f = e.bind(null, d, ", ");
          a.addPropertiesHandler(c, f, ["box-shadow", "text-shadow"]);
        }(d), function(a) {
          function b(a) {
            return a.toFixed(3).replace(".000", "");
          }
          function c(a, b, c) {
            return Math.min(b, Math.max(a, c));
          }
          function d(a) {
            return /^\s*[-+]?(\d*\.)?\d+\s*$/.test(a) ? Number(a) : void 0;
          }
          function e(a, c) {
            return [a, c, b];
          }
          function f(a, b) {
            return 0 != a ? h(0, 1 / 0)(a, b) : void 0;
          }
          function g(a, b) {
            return [a, b, function(a) {
              return Math.round(c(1, 1 / 0, a));
            }];
          }
          function h(a, d) {
            return function(e, f) {
              return [e, f, function(e) {
                return b(c(a, d, e));
              }];
            };
          }
          function i(a, b) {
            return [a, b, Math.round];
          }
          a.clamp = c, a.addPropertiesHandler(d, h(0, 1 / 0), ["border-image-width", "line-height"]), a.addPropertiesHandler(d, h(0, 1), ["opacity", "shape-image-threshold"]), a.addPropertiesHandler(d, f, ["flex-grow", "flex-shrink"]), a.addPropertiesHandler(d, g, ["orphans", "widows"]), a.addPropertiesHandler(d, i, ["z-index"]), a.parseNumber = d, a.mergeNumbers = e, a.numberToString = b;
        }(d, f), function(a) {
          function b(a, b) {
            return "visible" == a || "visible" == b ? [0, 1, function(c) {
              return 0 >= c ? a : c >= 1 ? b : "visible";
            }] : void 0;
          }
          a.addPropertiesHandler(String, b, ["visibility"]);
        }(d), function(a) {
          function b(a) {
            a = a.trim(), e.fillStyle = "#000", e.fillStyle = a;
            var b = e.fillStyle;
            if (e.fillStyle = "#fff", e.fillStyle = a, b == e.fillStyle) {
              e.fillRect(0, 0, 1, 1);
              var c = e.getImageData(0, 0, 1, 1).data;
              e.clearRect(0, 0, 1, 1);
              var d = c[3] / 255;
              return [c[0] * d, c[1] * d, c[2] * d, d];
            }
          }
          function c(b, c) {
            return [b, c, function(b) {
              function c(a) {
                return Math.max(0, Math.min(255, a));
              }
              if (b[3])
                for (var d = 0; 3 > d; d++)
                  b[d] = Math.round(c(b[d] / b[3]));
              return b[3] = a.numberToString(a.clamp(0, 1, b[3])), "rgba(" + b.join(",") + ")";
            }];
          }
          var d = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
          d.width = d.height = 1;
          var e = d.getContext("2d");
          a.addPropertiesHandler(b, c, ["background-color", "border-bottom-color", "border-left-color", "border-right-color", "border-top-color", "color", "outline-color", "text-decoration-color"]), a.consumeColor = a.consumeParenthesised.bind(null, b), a.mergeColors = c;
        }(d, f), function(a, b) {
          function c(a, b) {
            if (b = b.trim().toLowerCase(), "0" == b && "px".search(a) >= 0)
              return {px: 0};
            if (/^[^(]*$|^calc/.test(b)) {
              b = b.replace(/calc\(/g, "(");
              var c = {};
              b = b.replace(a, function(a) {
                return c[a] = null, "U" + a;
              });
              for (var d = "U(" + a.source + ")",
                  e = b.replace(/[-+]?(\d*\.)?\d+/g, "N").replace(new RegExp("N" + d, "g"), "D").replace(/\s[+-]\s/g, "O").replace(/\s/g, ""),
                  f = [/N\*(D)/g, /(N|D)[*/]N/g, /(N|D)O\1/g, /\((N|D)\)/g],
                  g = 0; g < f.length; )
                f[g].test(e) ? (e = e.replace(f[g], "$1"), g = 0) : g++;
              if ("D" == e) {
                for (var h in c) {
                  var i = eval(b.replace(new RegExp("U" + h, "g"), "").replace(new RegExp(d, "g"), "*0"));
                  if (!isFinite(i))
                    return;
                  c[h] = i;
                }
                return c;
              }
            }
          }
          function d(a, b) {
            return e(a, b, !0);
          }
          function e(b, c, d) {
            var e,
                f = [];
            for (e in b)
              f.push(e);
            for (e in c)
              f.indexOf(e) < 0 && f.push(e);
            return b = f.map(function(a) {
              return b[a] || 0;
            }), c = f.map(function(a) {
              return c[a] || 0;
            }), [b, c, function(b) {
              var c = b.map(function(c, e) {
                return 1 == b.length && d && (c = Math.max(c, 0)), a.numberToString(c) + f[e];
              }).join(" + ");
              return b.length > 1 ? "calc(" + c + ")" : c;
            }];
          }
          var f = "px|em|ex|ch|rem|vw|vh|vmin|vmax|cm|mm|in|pt|pc",
              g = c.bind(null, new RegExp(f, "g")),
              h = c.bind(null, new RegExp(f + "|%", "g")),
              i = c.bind(null, /deg|rad|grad|turn/g);
          a.parseLength = g, a.parseLengthOrPercent = h, a.consumeLengthOrPercent = a.consumeParenthesised.bind(null, h), a.parseAngle = i, a.mergeDimensions = e;
          var j = a.consumeParenthesised.bind(null, g),
              k = a.consumeRepeated.bind(void 0, j, /^/),
              l = a.consumeRepeated.bind(void 0, k, /^,/);
          a.consumeSizePairList = l;
          var m = function(a) {
            var b = l(a);
            return b && "" == b[1] ? b[0] : void 0;
          },
              n = a.mergeNestedRepeated.bind(void 0, d, " "),
              o = a.mergeNestedRepeated.bind(void 0, n, ",");
          a.mergeNonNegativeSizePair = n, a.addPropertiesHandler(m, o, ["background-size"]), a.addPropertiesHandler(h, d, ["border-bottom-width", "border-image-width", "border-left-width", "border-right-width", "border-top-width", "flex-basis", "font-size", "height", "line-height", "max-height", "max-width", "outline-width", "width"]), a.addPropertiesHandler(h, e, ["border-bottom-left-radius", "border-bottom-right-radius", "border-top-left-radius", "border-top-right-radius", "bottom", "left", "letter-spacing", "margin-bottom", "margin-left", "margin-right", "margin-top", "min-height", "min-width", "outline-offset", "padding-bottom", "padding-left", "padding-right", "padding-top", "perspective", "right", "shape-margin", "text-indent", "top", "vertical-align", "word-spacing"]);
        }(d, f), function(a) {
          function b(b) {
            return a.consumeLengthOrPercent(b) || a.consumeToken(/^auto/, b);
          }
          function c(c) {
            var d = a.consumeList([a.ignore(a.consumeToken.bind(null, /^rect/)), a.ignore(a.consumeToken.bind(null, /^\(/)), a.consumeRepeated.bind(null, b, /^,/), a.ignore(a.consumeToken.bind(null, /^\)/))], c);
            return d && 4 == d[0].length ? d[0] : void 0;
          }
          function d(b, c) {
            return "auto" == b || "auto" == c ? [!0, !1, function(d) {
              var e = d ? b : c;
              if ("auto" == e)
                return "auto";
              var f = a.mergeDimensions(e, e);
              return f[2](f[0]);
            }] : a.mergeDimensions(b, c);
          }
          function e(a) {
            return "rect(" + a + ")";
          }
          var f = a.mergeWrappedNestedRepeated.bind(null, e, d, ", ");
          a.parseBox = c, a.mergeBoxes = f, a.addPropertiesHandler(c, f, ["clip"]);
        }(d, f), function(a) {
          function b(a) {
            return function(b) {
              var c = 0;
              return a.map(function(a) {
                return a === j ? b[c++] : a;
              });
            };
          }
          function c(a) {
            return a;
          }
          function d(b) {
            if (b = b.toLowerCase().trim(), "none" == b)
              return [];
            for (var c,
                d = /\s*(\w+)\(([^)]*)\)/g,
                e = [],
                f = 0; c = d.exec(b); ) {
              if (c.index != f)
                return;
              f = c.index + c[0].length;
              var g = c[1],
                  h = m[g];
              if (!h)
                return;
              var i = c[2].split(","),
                  j = h[0];
              if (j.length < i.length)
                return;
              for (var n = [],
                  o = 0; o < j.length; o++) {
                var p,
                    q = i[o],
                    r = j[o];
                if (p = q ? {
                  A: function(b) {
                    return "0" == b.trim() ? l : a.parseAngle(b);
                  },
                  N: a.parseNumber,
                  T: a.parseLengthOrPercent,
                  L: a.parseLength
                }[r.toUpperCase()](q) : {
                  a: l,
                  n: n[0],
                  t: k
                }[r], void 0 === p)
                  return;
                n.push(p);
              }
              if (e.push({
                t: g,
                d: n
              }), d.lastIndex == b.length)
                return e;
            }
          }
          function e(a) {
            return a.toFixed(6).replace(".000000", "");
          }
          function f(b, c) {
            if (b.decompositionPair !== c) {
              b.decompositionPair = c;
              var d = a.makeMatrixDecomposition(b);
            }
            if (c.decompositionPair !== b) {
              c.decompositionPair = b;
              var f = a.makeMatrixDecomposition(c);
            }
            return null == d[0] || null == f[0] ? [[!1], [!0], function(a) {
              return a ? c[0].d : b[0].d;
            }] : (d[0].push(0), f[0].push(1), [d, f, function(b) {
              var c = a.quat(d[0][3], f[0][3], b[5]),
                  g = a.composeMatrix(b[0], b[1], b[2], c, b[4]),
                  h = g.map(e).join(",");
              return h;
            }]);
          }
          function g(a) {
            return a.replace(/[xy]/, "");
          }
          function h(a) {
            return a.replace(/(x|y|z|3d)?$/, "3d");
          }
          function i(b, c) {
            var d = a.makeMatrixDecomposition && !0,
                e = !1;
            if (!b.length || !c.length) {
              b.length || (e = !0, b = c, c = []);
              for (var i = 0; i < b.length; i++) {
                var j = b[i].t,
                    k = b[i].d,
                    l = "scale" == j.substr(0, 5) ? 1 : 0;
                c.push({
                  t: j,
                  d: k.map(function(a) {
                    if ("number" == typeof a)
                      return l;
                    var b = {};
                    for (var c in a)
                      b[c] = l;
                    return b;
                  })
                });
              }
            }
            var n = function(a, b) {
              return "perspective" == a && "perspective" == b || ("matrix" == a || "matrix3d" == a) && ("matrix" == b || "matrix3d" == b);
            },
                o = [],
                p = [],
                q = [];
            if (b.length != c.length) {
              if (!d)
                return;
              var r = f(b, c);
              o = [r[0]], p = [r[1]], q = [["matrix", [r[2]]]];
            } else
              for (var i = 0; i < b.length; i++) {
                var j,
                    s = b[i].t,
                    t = c[i].t,
                    u = b[i].d,
                    v = c[i].d,
                    w = m[s],
                    x = m[t];
                if (n(s, t)) {
                  if (!d)
                    return;
                  var r = f([b[i]], [c[i]]);
                  o.push(r[0]), p.push(r[1]), q.push(["matrix", [r[2]]]);
                } else {
                  if (s == t)
                    j = s;
                  else if (w[2] && x[2] && g(s) == g(t))
                    j = g(s), u = w[2](u), v = x[2](v);
                  else {
                    if (!w[1] || !x[1] || h(s) != h(t)) {
                      if (!d)
                        return;
                      var r = f(b, c);
                      o = [r[0]], p = [r[1]], q = [["matrix", [r[2]]]];
                      break;
                    }
                    j = h(s), u = w[1](u), v = x[1](v);
                  }
                  for (var y = [],
                      z = [],
                      A = [],
                      B = 0; B < u.length; B++) {
                    var C = "number" == typeof u[B] ? a.mergeNumbers : a.mergeDimensions,
                        r = C(u[B], v[B]);
                    y[B] = r[0], z[B] = r[1], A.push(r[2]);
                  }
                  o.push(y), p.push(z), q.push([j, A]);
                }
              }
            if (e) {
              var D = o;
              o = p, p = D;
            }
            return [o, p, function(a) {
              return a.map(function(a, b) {
                var c = a.map(function(a, c) {
                  return q[b][1][c](a);
                }).join(",");
                return "matrix" == q[b][0] && 16 == c.split(",").length && (q[b][0] = "matrix3d"), q[b][0] + "(" + c + ")";
              }).join(" ");
            }];
          }
          var j = null,
              k = {px: 0},
              l = {deg: 0},
              m = {
                matrix: ["NNNNNN", [j, j, 0, 0, j, j, 0, 0, 0, 0, 1, 0, j, j, 0, 1], c],
                matrix3d: ["NNNNNNNNNNNNNNNN", c],
                rotate: ["A"],
                rotatex: ["A"],
                rotatey: ["A"],
                rotatez: ["A"],
                rotate3d: ["NNNA"],
                perspective: ["L"],
                scale: ["Nn", b([j, j, 1]), c],
                scalex: ["N", b([j, 1, 1]), b([j, 1])],
                scaley: ["N", b([1, j, 1]), b([1, j])],
                scalez: ["N", b([1, 1, j])],
                scale3d: ["NNN", c],
                skew: ["Aa", null, c],
                skewx: ["A", null, b([j, l])],
                skewy: ["A", null, b([l, j])],
                translate: ["Tt", b([j, j, k]), c],
                translatex: ["T", b([j, k, k]), b([j, k])],
                translatey: ["T", b([k, j, k]), b([k, j])],
                translatez: ["L", b([k, k, j])],
                translate3d: ["TTL", c]
              };
          a.addPropertiesHandler(d, i, ["transform"]);
        }(d, f), function(a) {
          function b(a) {
            var b = Number(a);
            return isNaN(b) || 100 > b || b > 900 || b % 100 !== 0 ? void 0 : b;
          }
          function c(b) {
            return b = 100 * Math.round(b / 100), b = a.clamp(100, 900, b), 400 === b ? "normal" : 700 === b ? "bold" : String(b);
          }
          function d(a, b) {
            return [a, b, c];
          }
          a.addPropertiesHandler(b, d, ["font-weight"]);
        }(d), function(a) {
          function b(a) {
            var b = {};
            for (var c in a)
              b[c] = -a[c];
            return b;
          }
          function c(b) {
            return a.consumeToken(/^(left|center|right|top|bottom)\b/i, b) || a.consumeLengthOrPercent(b);
          }
          function d(b, d) {
            var e = a.consumeRepeated(c, /^/, d);
            if (e && "" == e[1]) {
              var f = e[0];
              if (f[0] = f[0] || "center", f[1] = f[1] || "center", 3 == b && (f[2] = f[2] || {px: 0}), f.length == b) {
                if (/top|bottom/.test(f[0]) || /left|right/.test(f[1])) {
                  var h = f[0];
                  f[0] = f[1], f[1] = h;
                }
                if (/left|right|center|Object/.test(f[0]) && /top|bottom|center|Object/.test(f[1]))
                  return f.map(function(a) {
                    return "object" == typeof a ? a : g[a];
                  });
              }
            }
          }
          function e(d) {
            var e = a.consumeRepeated(c, /^/, d);
            if (e) {
              for (var f = e[0],
                  h = [{"%": 50}, {"%": 50}],
                  i = 0,
                  j = !1,
                  k = 0; k < f.length; k++) {
                var l = f[k];
                "string" == typeof l ? (j = /bottom|right/.test(l), i = {
                  left: 0,
                  right: 0,
                  center: i,
                  top: 1,
                  bottom: 1
                }[l], h[i] = g[l], "center" == l && i++) : (j && (l = b(l), l["%"] = (l["%"] || 0) + 100), h[i] = l, i++, j = !1);
              }
              return [h, e[1]];
            }
          }
          function f(b) {
            var c = a.consumeRepeated(e, /^,/, b);
            return c && "" == c[1] ? c[0] : void 0;
          }
          var g = {
            left: {"%": 0},
            center: {"%": 50},
            right: {"%": 100},
            top: {"%": 0},
            bottom: {"%": 100}
          },
              h = a.mergeNestedRepeated.bind(null, a.mergeDimensions, " ");
          a.addPropertiesHandler(d.bind(null, 3), h, ["transform-origin"]), a.addPropertiesHandler(d.bind(null, 2), h, ["perspective-origin"]), a.consumePosition = e, a.mergeOffsetList = h;
          var i = a.mergeNestedRepeated.bind(null, h, ", ");
          a.addPropertiesHandler(f, i, ["background-position", "object-position"]);
        }(d), function(a) {
          function b(b) {
            var c = a.consumeToken(/^circle/, b);
            if (c && c[0])
              return ["circle"].concat(a.consumeList([a.ignore(a.consumeToken.bind(void 0, /^\(/)), d, a.ignore(a.consumeToken.bind(void 0, /^at/)), a.consumePosition, a.ignore(a.consumeToken.bind(void 0, /^\)/))], c[1]));
            var f = a.consumeToken(/^ellipse/, b);
            if (f && f[0])
              return ["ellipse"].concat(a.consumeList([a.ignore(a.consumeToken.bind(void 0, /^\(/)), e, a.ignore(a.consumeToken.bind(void 0, /^at/)), a.consumePosition, a.ignore(a.consumeToken.bind(void 0, /^\)/))], f[1]));
            var g = a.consumeToken(/^polygon/, b);
            return g && g[0] ? ["polygon"].concat(a.consumeList([a.ignore(a.consumeToken.bind(void 0, /^\(/)), a.optional(a.consumeToken.bind(void 0, /^nonzero\s*,|^evenodd\s*,/), "nonzero,"), a.consumeSizePairList, a.ignore(a.consumeToken.bind(void 0, /^\)/))], g[1])) : void 0;
          }
          function c(b, c) {
            return b[0] === c[0] ? "circle" == b[0] ? a.mergeList(b.slice(1), c.slice(1), ["circle(", a.mergeDimensions, " at ", a.mergeOffsetList, ")"]) : "ellipse" == b[0] ? a.mergeList(b.slice(1), c.slice(1), ["ellipse(", a.mergeNonNegativeSizePair, " at ", a.mergeOffsetList, ")"]) : "polygon" == b[0] && b[1] == c[1] ? a.mergeList(b.slice(2), c.slice(2), ["polygon(", b[1], g, ")"]) : void 0 : void 0;
          }
          var d = a.consumeParenthesised.bind(null, a.parseLengthOrPercent),
              e = a.consumeRepeated.bind(void 0, d, /^/),
              f = a.mergeNestedRepeated.bind(void 0, a.mergeDimensions, " "),
              g = a.mergeNestedRepeated.bind(void 0, f, ",");
          a.addPropertiesHandler(b, c, ["shape-outside"]);
        }(d), function(a) {
          function b(a, b) {
            b.concat([a]).forEach(function(b) {
              b in document.documentElement.style && (c[a] = b);
            });
          }
          var c = {};
          b("transform", ["webkitTransform", "msTransform"]), b("transformOrigin", ["webkitTransformOrigin"]), b("perspective", ["webkitPerspective"]), b("perspectiveOrigin", ["webkitPerspectiveOrigin"]), a.propertyName = function(a) {
            return c[a] || a;
          };
        }(d, f);
      }(), !function(a, b) {
        function c(a) {
          var b = window.document.timeline;
          b.currentTime = a, b._discardAnimations(), 0 == b._animations.length ? e = !1 : requestAnimationFrame(c);
        }
        var d = window.requestAnimationFrame;
        window.requestAnimationFrame = function(a) {
          return d(function(b) {
            window.document.timeline._updateAnimationsPromises(), a(b), window.document.timeline._updateAnimationsPromises();
          });
        }, b.AnimationTimeline = function() {
          this._animations = [], this.currentTime = void 0;
        }, b.AnimationTimeline.prototype = {
          getAnimations: function() {
            return this._discardAnimations(), this._animations.slice();
          },
          _updateAnimationsPromises: function() {
            b.animationsWithPromises = b.animationsWithPromises.filter(function(a) {
              return a._updatePromises();
            });
          },
          _discardAnimations: function() {
            this._updateAnimationsPromises(), this._animations = this._animations.filter(function(a) {
              return "finished" != a.playState && "idle" != a.playState;
            });
          },
          _play: function(a) {
            var c = new b.Animation(a, this);
            return this._animations.push(c), b.restartWebAnimationsNextTick(), c._updatePromises(), c._animation.play(), c._updatePromises(), c;
          },
          play: function(a) {
            return a && a.remove(), this._play(a);
          }
        };
        var e = !1;
        b.restartWebAnimationsNextTick = function() {
          e || (e = !0, requestAnimationFrame(c));
        };
        var f = new b.AnimationTimeline;
        b.timeline = f;
        try {
          Object.defineProperty(window.document, "timeline", {
            configurable: !0,
            get: function() {
              return f;
            }
          });
        } catch (g) {}
        try {
          window.document.timeline = f;
        } catch (g) {}
      }(c, e, f), function(a, b) {
        b.animationsWithPromises = [], b.Animation = function(b, c) {
          if (this.effect = b, b && (b._animation = this), !c)
            throw new Error("Animation with null timeline is not supported");
          this._timeline = c, this._sequenceNumber = a.sequenceNumber++, this._holdTime = 0, this._paused = !1, this._isGroup = !1, this._animation = null, this._childAnimations = [], this._callback = null, this._oldPlayState = "idle", this._rebuildUnderlyingAnimation(), this._animation.cancel(), this._updatePromises();
        }, b.Animation.prototype = {
          _updatePromises: function() {
            var a = this._oldPlayState,
                b = this.playState;
            return this._readyPromise && b !== a && ("idle" == b ? (this._rejectReadyPromise(), this._readyPromise = void 0) : "pending" == a ? this._resolveReadyPromise() : "pending" == b && (this._readyPromise = void 0)), this._finishedPromise && b !== a && ("idle" == b ? (this._rejectFinishedPromise(), this._finishedPromise = void 0) : "finished" == b ? this._resolveFinishedPromise() : "finished" == a && (this._finishedPromise = void 0)), this._oldPlayState = this.playState, this._readyPromise || this._finishedPromise;
          },
          _rebuildUnderlyingAnimation: function() {
            this._updatePromises();
            var a,
                c,
                d,
                e,
                f = this._animation ? !0 : !1;
            f && (a = this.playbackRate, c = this._paused, d = this.startTime, e = this.currentTime, this._animation.cancel(), this._animation._wrapper = null, this._animation = null), (!this.effect || this.effect instanceof window.KeyframeEffect) && (this._animation = b.newUnderlyingAnimationForKeyframeEffect(this.effect), b.bindAnimationForKeyframeEffect(this)), (this.effect instanceof window.SequenceEffect || this.effect instanceof window.GroupEffect) && (this._animation = b.newUnderlyingAnimationForGroup(this.effect), b.bindAnimationForGroup(this)), this.effect && this.effect._onsample && b.bindAnimationForCustomEffect(this), f && (1 != a && (this.playbackRate = a), null !== d ? this.startTime = d : null !== e ? this.currentTime = e : null !== this._holdTime && (this.currentTime = this._holdTime), c && this.pause()), this._updatePromises();
          },
          _updateChildren: function() {
            if (this.effect && "idle" != this.playState) {
              var a = this.effect._timing.delay;
              this._childAnimations.forEach(function(c) {
                this._arrangeChildren(c, a), this.effect instanceof window.SequenceEffect && (a += b.groupChildDuration(c.effect));
              }.bind(this));
            }
          },
          _setExternalAnimation: function(a) {
            if (this.effect && this._isGroup)
              for (var b = 0; b < this.effect.children.length; b++)
                this.effect.children[b]._animation = a, this._childAnimations[b]._setExternalAnimation(a);
          },
          _constructChildAnimations: function() {
            if (this.effect && this._isGroup) {
              var a = this.effect._timing.delay;
              this._removeChildAnimations(), this.effect.children.forEach(function(c) {
                var d = window.document.timeline._play(c);
                this._childAnimations.push(d), d.playbackRate = this.playbackRate, this._paused && d.pause(), c._animation = this.effect._animation, this._arrangeChildren(d, a), this.effect instanceof window.SequenceEffect && (a += b.groupChildDuration(c));
              }.bind(this));
            }
          },
          _arrangeChildren: function(a, b) {
            null === this.startTime ? a.currentTime = this.currentTime - b / this.playbackRate : a.startTime !== this.startTime + b / this.playbackRate && (a.startTime = this.startTime + b / this.playbackRate);
          },
          get timeline() {
            return this._timeline;
          },
          get playState() {
            return this._animation ? this._animation.playState : "idle";
          },
          get finished() {
            return window.Promise ? (this._finishedPromise || (-1 == b.animationsWithPromises.indexOf(this) && b.animationsWithPromises.push(this), this._finishedPromise = new Promise(function(a, b) {
              this._resolveFinishedPromise = function() {
                a(this);
              }, this._rejectFinishedPromise = function() {
                b({
                  type: DOMException.ABORT_ERR,
                  name: "AbortError"
                });
              };
            }.bind(this)), "finished" == this.playState && this._resolveFinishedPromise()), this._finishedPromise) : (console.warn("Animation Promises require JavaScript Promise constructor"), null);
          },
          get ready() {
            return window.Promise ? (this._readyPromise || (-1 == b.animationsWithPromises.indexOf(this) && b.animationsWithPromises.push(this), this._readyPromise = new Promise(function(a, b) {
              this._resolveReadyPromise = function() {
                a(this);
              }, this._rejectReadyPromise = function() {
                b({
                  type: DOMException.ABORT_ERR,
                  name: "AbortError"
                });
              };
            }.bind(this)), "pending" !== this.playState && this._resolveReadyPromise()), this._readyPromise) : (console.warn("Animation Promises require JavaScript Promise constructor"), null);
          },
          get onfinish() {
            return this._onfinish;
          },
          set onfinish(a) {
            "function" == typeof a ? (this._onfinish = a, this._animation.onfinish = function(b) {
              b.target = this, a.call(this, b);
            }.bind(this)) : (this._animation.onfinish = a, this.onfinish = this._animation.onfinish);
          },
          get currentTime() {
            this._updatePromises();
            var a = this._animation.currentTime;
            return this._updatePromises(), a;
          },
          set currentTime(a) {
            this._updatePromises(), this._animation.currentTime = isFinite(a) ? a : Math.sign(a) * Number.MAX_VALUE, this._register(), this._forEachChild(function(b, c) {
              b.currentTime = a - c;
            }), this._updatePromises();
          },
          get startTime() {
            return this._animation.startTime;
          },
          set startTime(a) {
            this._updatePromises(), this._animation.startTime = isFinite(a) ? a : Math.sign(a) * Number.MAX_VALUE, this._register(), this._forEachChild(function(b, c) {
              b.startTime = a + c;
            }), this._updatePromises();
          },
          get playbackRate() {
            return this._animation.playbackRate;
          },
          set playbackRate(a) {
            this._updatePromises();
            var b = this.currentTime;
            this._animation.playbackRate = a, this._forEachChild(function(b) {
              b.playbackRate = a;
            }), "paused" != this.playState && "idle" != this.playState && this.play(), null !== b && (this.currentTime = b), this._updatePromises();
          },
          play: function() {
            this._updatePromises(), this._paused = !1, this._animation.play(), -1 == this._timeline._animations.indexOf(this) && this._timeline._animations.push(this), this._register(), b.awaitStartTime(this), this._forEachChild(function(a) {
              var b = a.currentTime;
              a.play(), a.currentTime = b;
            }), this._updatePromises();
          },
          pause: function() {
            this._updatePromises(), this.currentTime && (this._holdTime = this.currentTime), this._animation.pause(), this._register(), this._forEachChild(function(a) {
              a.pause();
            }), this._paused = !0, this._updatePromises();
          },
          finish: function() {
            this._updatePromises(), this._animation.finish(), this._register(), this._updatePromises();
          },
          cancel: function() {
            this._updatePromises(), this._animation.cancel(), this._register(), this._removeChildAnimations(), this._updatePromises();
          },
          reverse: function() {
            this._updatePromises();
            var a = this.currentTime;
            this._animation.reverse(), this._forEachChild(function(a) {
              a.reverse();
            }), null !== a && (this.currentTime = a), this._updatePromises();
          },
          addEventListener: function(a, b) {
            var c = b;
            "function" == typeof b && (c = function(a) {
              a.target = this, b.call(this, a);
            }.bind(this), b._wrapper = c), this._animation.addEventListener(a, c);
          },
          removeEventListener: function(a, b) {
            this._animation.removeEventListener(a, b && b._wrapper || b);
          },
          _removeChildAnimations: function() {
            for (; this._childAnimations.length; )
              this._childAnimations.pop().cancel();
          },
          _forEachChild: function(b) {
            var c = 0;
            if (this.effect.children && this._childAnimations.length < this.effect.children.length && this._constructChildAnimations(), this._childAnimations.forEach(function(a) {
              b.call(this, a, c), this.effect instanceof window.SequenceEffect && (c += a.effect.activeDuration);
            }.bind(this)), "pending" != this.playState) {
              var d = this.effect._timing,
                  e = this.currentTime;
              null !== e && (e = a.calculateTimeFraction(a.calculateActiveDuration(d), e, d)), (null == e || isNaN(e)) && this._removeChildAnimations();
            }
          }
        }, window.Animation = b.Animation;
      }(c, e, f), function(a, b) {
        function c(b) {
          this._frames = a.normalizeKeyframes(b);
        }
        function d() {
          for (var a = !1; h.length; ) {
            var b = h.shift();
            b._updateChildren(), a = !0;
          }
          return a;
        }
        var e = function(a) {
          if (a._animation = void 0, a instanceof window.SequenceEffect || a instanceof window.GroupEffect)
            for (var b = 0; b < a.children.length; b++)
              e(a.children[b]);
        };
        b.removeMulti = function(a) {
          for (var b = [],
              c = 0; c < a.length; c++) {
            var d = a[c];
            d._parent ? (-1 == b.indexOf(d._parent) && b.push(d._parent), d._parent.children.splice(d._parent.children.indexOf(d), 1), d._parent = null, e(d)) : d._animation && d._animation.effect == d && (d._animation.cancel(), d._animation.effect = new KeyframeEffect(null, []), d._animation._callback && (d._animation._callback._animation = null), d._animation._rebuildUnderlyingAnimation(), e(d));
          }
          for (c = 0; c < b.length; c++)
            b[c]._rebuild();
        }, b.KeyframeEffect = function(b, d, e) {
          return this.target = b, this._parent = null, e = a.numericTimingToObject(e), this._timingInput = a.cloneTimingInput(e), this._timing = a.normalizeTimingInput(e), this.timing = a.makeTiming(e, !1, this), this.timing._effect = this, "function" == typeof d ? (a.deprecated("Custom KeyframeEffect", "2015-06-22", "Use KeyframeEffect.onsample instead."), this._normalizedKeyframes = d) : this._normalizedKeyframes = new c(d), this._keyframes = d, this.activeDuration = a.calculateActiveDuration(this._timing), this;
        }, b.KeyframeEffect.prototype = {
          getFrames: function() {
            return "function" == typeof this._normalizedKeyframes ? this._normalizedKeyframes : this._normalizedKeyframes._frames;
          },
          set onsample(a) {
            if ("function" == typeof this.getFrames())
              throw new Error("Setting onsample on custom effect KeyframeEffect is not supported.");
            this._onsample = a, this._animation && this._animation._rebuildUnderlyingAnimation();
          },
          get parent() {
            return this._parent;
          },
          clone: function() {
            if ("function" == typeof this.getFrames())
              throw new Error("Cloning custom effects is not supported.");
            var b = new KeyframeEffect(this.target, [], a.cloneTimingInput(this._timingInput));
            return b._normalizedKeyframes = this._normalizedKeyframes, b._keyframes = this._keyframes, b;
          },
          remove: function() {
            b.removeMulti([this]);
          }
        };
        var f = Element.prototype.animate;
        Element.prototype.animate = function(a, c) {
          return b.timeline._play(new b.KeyframeEffect(this, a, c));
        };
        var g = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
        b.newUnderlyingAnimationForKeyframeEffect = function(a) {
          if (a) {
            var b = a.target || g,
                c = a._keyframes;
            "function" == typeof c && (c = []);
            var d = a._timingInput;
          } else
            var b = g,
                c = [],
                d = 0;
          return f.apply(b, [c, d]);
        }, b.bindAnimationForKeyframeEffect = function(a) {
          a.effect && "function" == typeof a.effect._normalizedKeyframes && b.bindAnimationForCustomEffect(a);
        };
        var h = [];
        b.awaitStartTime = function(a) {
          null === a.startTime && a._isGroup && (0 == h.length && requestAnimationFrame(d), h.push(a));
        };
        var i = window.getComputedStyle;
        Object.defineProperty(window, "getComputedStyle", {
          configurable: !0,
          enumerable: !0,
          value: function() {
            window.document.timeline._updateAnimationsPromises();
            var a = i.apply(this, arguments);
            return d() && (a = i.apply(this, arguments)), window.document.timeline._updateAnimationsPromises(), a;
          }
        }), window.KeyframeEffect = b.KeyframeEffect, window.Element.prototype.getAnimations = function() {
          return document.timeline.getAnimations().filter(function(a) {
            return null !== a.effect && a.effect.target == this;
          }.bind(this));
        };
      }(c, e, f), function(a, b) {
        function c(a) {
          a._registered || (a._registered = !0, f.push(a), g || (g = !0, requestAnimationFrame(d)));
        }
        function d() {
          var a = f;
          f = [], a.sort(function(a, b) {
            return a._sequenceNumber - b._sequenceNumber;
          }), a = a.filter(function(a) {
            a();
            var b = a._animation ? a._animation.playState : "idle";
            return "running" != b && "pending" != b && (a._registered = !1), a._registered;
          }), f.push.apply(f, a), f.length ? (g = !0, requestAnimationFrame(d)) : g = !1;
        }
        var e = (document.createElementNS("http://www.w3.org/1999/xhtml", "div"), 0);
        b.bindAnimationForCustomEffect = function(b) {
          var d,
              f = b.effect.target,
              g = "function" == typeof b.effect.getFrames();
          d = g ? b.effect.getFrames() : b.effect._onsample;
          var h = b.effect.timing,
              i = null;
          h = a.normalizeTimingInput(h);
          var j = function() {
            var c = j._animation ? j._animation.currentTime : null;
            null !== c && (c = a.calculateTimeFraction(a.calculateActiveDuration(h), c, h), isNaN(c) && (c = null)), c !== i && (g ? d(c, f, b.effect) : d(c, b.effect, b.effect._animation)), i = c;
          };
          j._animation = b, j._registered = !1, j._sequenceNumber = e++, b._callback = j, c(j);
        };
        var f = [],
            g = !1;
        b.Animation.prototype._register = function() {
          this._callback && c(this._callback);
        };
      }(c, e, f), function(a, b) {
        function c(a) {
          return a._timing.delay + a.activeDuration + a._timing.endDelay;
        }
        function d(b, c) {
          this._parent = null, this.children = b || [], this._reparent(this.children), c = a.numericTimingToObject(c), this._timingInput = a.cloneTimingInput(c), this._timing = a.normalizeTimingInput(c, !0), this.timing = a.makeTiming(c, !0, this), this.timing._effect = this, "auto" === this._timing.duration && (this._timing.duration = this.activeDuration);
        }
        window.SequenceEffect = function() {
          d.apply(this, arguments);
        }, window.GroupEffect = function() {
          d.apply(this, arguments);
        }, d.prototype = {
          _isAncestor: function(a) {
            for (var b = this; null !== b; ) {
              if (b == a)
                return !0;
              b = b._parent;
            }
            return !1;
          },
          _rebuild: function() {
            for (var a = this; a; )
              "auto" === a.timing.duration && (a._timing.duration = a.activeDuration), a = a._parent;
            this._animation && this._animation._rebuildUnderlyingAnimation();
          },
          _reparent: function(a) {
            b.removeMulti(a);
            for (var c = 0; c < a.length; c++)
              a[c]._parent = this;
          },
          _putChild: function(a, b) {
            for (var c = b ? "Cannot append an ancestor or self" : "Cannot prepend an ancestor or self",
                d = 0; d < a.length; d++)
              if (this._isAncestor(a[d]))
                throw {
                  type: DOMException.HIERARCHY_REQUEST_ERR,
                  name: "HierarchyRequestError",
                  message: c
                };
            for (var d = 0; d < a.length; d++)
              b ? this.children.push(a[d]) : this.children.unshift(a[d]);
            this._reparent(a), this._rebuild();
          },
          append: function() {
            this._putChild(arguments, !0);
          },
          prepend: function() {
            this._putChild(arguments, !1);
          },
          get parent() {
            return this._parent;
          },
          get firstChild() {
            return this.children.length ? this.children[0] : null;
          },
          get lastChild() {
            return this.children.length ? this.children[this.children.length - 1] : null;
          },
          clone: function() {
            for (var b = a.cloneTimingInput(this._timingInput),
                c = [],
                d = 0; d < this.children.length; d++)
              c.push(this.children[d].clone());
            return this instanceof GroupEffect ? new GroupEffect(c, b) : new SequenceEffect(c, b);
          },
          remove: function() {
            b.removeMulti([this]);
          }
        }, window.SequenceEffect.prototype = Object.create(d.prototype), Object.defineProperty(window.SequenceEffect.prototype, "activeDuration", {get: function() {
            var a = 0;
            return this.children.forEach(function(b) {
              a += c(b);
            }), Math.max(a, 0);
          }}), window.GroupEffect.prototype = Object.create(d.prototype), Object.defineProperty(window.GroupEffect.prototype, "activeDuration", {get: function() {
            var a = 0;
            return this.children.forEach(function(b) {
              a = Math.max(a, c(b));
            }), a;
          }}), b.newUnderlyingAnimationForGroup = function(c) {
          var d,
              e = null,
              f = function(b) {
                var c = d._wrapper;
                return c && "pending" != c.playState && c.effect ? null == b ? void c._removeChildAnimations() : 0 == b && c.playbackRate < 0 && (e || (e = a.normalizeTimingInput(c.effect.timing)), b = a.calculateTimeFraction(a.calculateActiveDuration(e), -1, e), isNaN(b) || null == b) ? (c._forEachChild(function(a) {
                  a.currentTime = -1;
                }), void c._removeChildAnimations()) : void 0 : void 0;
              },
              g = new KeyframeEffect(null, [], c._timing);
          return g.onsample = f, d = b.timeline._play(g);
        }, b.bindAnimationForGroup = function(a) {
          a._animation._wrapper = a, a._isGroup = !0, b.awaitStartTime(a), a._constructChildAnimations(), a._setExternalAnimation(a);
        }, b.groupChildDuration = c;
      }(c, e, f);
    }({}, function() {
      return this;
    }());
  })();
  return _retrieveGlobal();
});

$__System.registerDynamic("d", ["20"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("20"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("19", ["24"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("24"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1c", [], true, function(require, exports, module) {
  ;
  var global = this,
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

$__System.registerDynamic("1b", ["d"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  "use strict";
  var _Object$defineProperty = require("d")["default"];
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

$__System.registerDynamic("1e", ["28"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("28"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1f", ["29"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("29"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("20", ["2a"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = require("2a");
  module.exports = function defineProperty(it, key, desc) {
    return $.setDesc(it, key, desc);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("24", ["2a"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = require("2a");
  module.exports = function create(P, D) {
    return $.create(P, D);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("26", ["19"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  "use strict";
  var _Object$create = require("19")["default"];
  exports["default"] = function(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
      throw new TypeError("Super expression must either be null or a function, not " + typeof superClass);
    }
    subClass.prototype = _Object$create(superClass && superClass.prototype, {constructor: {
        value: subClass,
        enumerable: false,
        writable: true,
        configurable: true
      }});
    if (superClass)
      subClass.__proto__ = superClass;
  };
  exports.__esModule = true;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("27", ["2c"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  "use strict";
  var _Object$getOwnPropertyDescriptor = require("2c")["default"];
  exports["default"] = function get(_x, _x2, _x3) {
    var _again = true;
    _function: while (_again) {
      var object = _x,
          property = _x2,
          receiver = _x3;
      desc = parent = getter = undefined;
      _again = false;
      var desc = _Object$getOwnPropertyDescriptor(object, property);
      if (desc === undefined) {
        var parent = Object.getPrototypeOf(object);
        if (parent === null) {
          return undefined;
        } else {
          _x = parent;
          _x2 = property;
          _x3 = receiver;
          _again = true;
          continue _function;
        }
      } else if ("value" in desc) {
        return desc.value;
      } else {
        var getter = desc.get;
        if (getter === undefined) {
          return undefined;
        }
        return getter.call(receiver);
      }
    }
  };
  exports.__esModule = true;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("28", ["2d", "2a"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  require("2d");
  module.exports = require("2a").core.Object.assign;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("29", ["2e", "2f", "30", "31", "2a"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  require("2e");
  require("2f");
  require("30");
  require("31");
  module.exports = require("2a").core.Promise;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2a", ["32"], true, function(require, exports, module) {
  ;
  var global = this,
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
  var $ = module.exports = require("32")({
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

$__System.registerDynamic("2b", ["33"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("33"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2c", ["34"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("34"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2d", ["35", "36"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $def = require("35");
  $def($def.S, 'Object', {assign: require("36")});
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2e", ["37", "38", "2a", "39"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var cof = require("37"),
      tmp = {};
  tmp[require("38")('toStringTag')] = 'z';
  if (require("2a").FW && cof(tmp) != 'z') {
    require("39")(Object.prototype, 'toString', function toString() {
      return '[object ' + cof.classof(this) + ']';
    }, true);
  }
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2f", ["2a", "3a", "3b", "3c", "3d"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var set = require("2a").set,
      $at = require("3a")(true),
      ITER = require("3b").safe('iter'),
      $iter = require("3c"),
      step = $iter.step;
  require("3d")(String, 'String', function(iterated) {
    set(this, ITER, {
      o: String(iterated),
      i: 0
    });
  }, function() {
    var iter = this[ITER],
        O = iter.o,
        index = iter.i,
        point;
    if (index >= O.length)
      return step(1);
    point = $at(O, index);
    iter.i += point.length;
    return step(0, point);
  });
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("30", ["3e", "2a", "3c", "38"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  require("3e");
  var $ = require("2a"),
      Iterators = require("3c").Iterators,
      ITERATOR = require("38")('iterator'),
      ArrayValues = Iterators.Array,
      NL = $.g.NodeList,
      HTC = $.g.HTMLCollection,
      NLProto = NL && NL.prototype,
      HTCProto = HTC && HTC.prototype;
  if ($.FW) {
    if (NL && !(ITERATOR in NLProto))
      $.hide(NLProto, ITERATOR, ArrayValues);
    if (HTC && !(ITERATOR in HTCProto))
      $.hide(HTCProto, ITERATOR, ArrayValues);
  }
  Iterators.NodeList = Iterators.HTMLCollection = ArrayValues;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("31", ["2a", "40", "37", "35", "41", "42", "43", "44", "38", "3b", "45", "46", "47", "3f"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    'use strict';
    var $ = require("2a"),
        ctx = require("40"),
        cof = require("37"),
        $def = require("35"),
        assert = require("41"),
        forOf = require("42"),
        setProto = require("43").set,
        species = require("44"),
        SPECIES = require("38")('species'),
        RECORD = require("3b").safe('record'),
        PROMISE = 'Promise',
        global = $.g,
        process = global.process,
        asap = process && process.nextTick || require("45").set,
        P = global[PROMISE],
        isFunction = $.isFunction,
        isObject = $.isObject,
        assertFunction = assert.fn,
        assertObject = assert.obj;
    var useNative = function() {
      var test,
          works = false;
      function P2(x) {
        var self = new P(x);
        setProto(self, P2.prototype);
        return self;
      }
      try {
        works = isFunction(P) && isFunction(P.resolve) && P.resolve(test = new P(function() {})) == test;
        setProto(P2, P);
        P2.prototype = $.create(P.prototype, {constructor: {value: P2}});
        if (!(P2.resolve(5).then(function() {}) instanceof P2)) {
          works = false;
        }
      } catch (e) {
        works = false;
      }
      return works;
    }();
    function getConstructor(C) {
      var S = assertObject(C)[SPECIES];
      return S != undefined ? S : C;
    }
    function isThenable(it) {
      var then;
      if (isObject(it))
        then = it.then;
      return isFunction(then) ? then : false;
    }
    function notify(record) {
      var chain = record.c;
      if (chain.length)
        asap(function() {
          var value = record.v,
              ok = record.s == 1,
              i = 0;
          function run(react) {
            var cb = ok ? react.ok : react.fail,
                ret,
                then;
            try {
              if (cb) {
                if (!ok)
                  record.h = true;
                ret = cb === true ? value : cb(value);
                if (ret === react.P) {
                  react.rej(TypeError('Promise-chain cycle'));
                } else if (then = isThenable(ret)) {
                  then.call(ret, react.res, react.rej);
                } else
                  react.res(ret);
              } else
                react.rej(value);
            } catch (err) {
              react.rej(err);
            }
          }
          while (chain.length > i)
            run(chain[i++]);
          chain.length = 0;
        });
    }
    function isUnhandled(promise) {
      var record = promise[RECORD],
          chain = record.a || record.c,
          i = 0,
          react;
      if (record.h)
        return false;
      while (chain.length > i) {
        react = chain[i++];
        if (react.fail || !isUnhandled(react.P))
          return false;
      }
      return true;
    }
    function $reject(value) {
      var record = this,
          promise;
      if (record.d)
        return;
      record.d = true;
      record = record.r || record;
      record.v = value;
      record.s = 2;
      record.a = record.c.slice();
      setTimeout(function() {
        asap(function() {
          if (isUnhandled(promise = record.p)) {
            if (cof(process) == 'process') {
              process.emit('unhandledRejection', value, promise);
            } else if (global.console && isFunction(console.error)) {
              console.error('Unhandled promise rejection', value);
            }
          }
          record.a = undefined;
        });
      }, 1);
      notify(record);
    }
    function $resolve(value) {
      var record = this,
          then,
          wrapper;
      if (record.d)
        return;
      record.d = true;
      record = record.r || record;
      try {
        if (then = isThenable(value)) {
          wrapper = {
            r: record,
            d: false
          };
          then.call(value, ctx($resolve, wrapper, 1), ctx($reject, wrapper, 1));
        } else {
          record.v = value;
          record.s = 1;
          notify(record);
        }
      } catch (err) {
        $reject.call(wrapper || {
          r: record,
          d: false
        }, err);
      }
    }
    if (!useNative) {
      P = function Promise(executor) {
        assertFunction(executor);
        var record = {
          p: assert.inst(this, P, PROMISE),
          c: [],
          a: undefined,
          s: 0,
          d: false,
          v: undefined,
          h: false
        };
        $.hide(this, RECORD, record);
        try {
          executor(ctx($resolve, record, 1), ctx($reject, record, 1));
        } catch (err) {
          $reject.call(record, err);
        }
      };
      require("46")(P.prototype, {
        then: function then(onFulfilled, onRejected) {
          var S = assertObject(assertObject(this).constructor)[SPECIES];
          var react = {
            ok: isFunction(onFulfilled) ? onFulfilled : true,
            fail: isFunction(onRejected) ? onRejected : false
          };
          var promise = react.P = new (S != undefined ? S : P)(function(res, rej) {
            react.res = assertFunction(res);
            react.rej = assertFunction(rej);
          });
          var record = this[RECORD];
          record.c.push(react);
          if (record.a)
            record.a.push(react);
          record.s && notify(record);
          return promise;
        },
        'catch': function(onRejected) {
          return this.then(undefined, onRejected);
        }
      });
    }
    $def($def.G + $def.W + $def.F * !useNative, {Promise: P});
    cof.set(P, PROMISE);
    species(P);
    species($.core[PROMISE]);
    $def($def.S + $def.F * !useNative, PROMISE, {
      reject: function reject(r) {
        return new (getConstructor(this))(function(res, rej) {
          rej(r);
        });
      },
      resolve: function resolve(x) {
        return isObject(x) && RECORD in x && $.getProto(x) === this.prototype ? x : new (getConstructor(this))(function(res) {
          res(x);
        });
      }
    });
    $def($def.S + $def.F * !(useNative && require("47")(function(iter) {
      P.all(iter)['catch'](function() {});
    })), PROMISE, {
      all: function all(iterable) {
        var C = getConstructor(this),
            values = [];
        return new C(function(res, rej) {
          forOf(iterable, false, values.push, values);
          var remaining = values.length,
              results = Array(remaining);
          if (remaining)
            $.each.call(values, function(promise, index) {
              C.resolve(promise).then(function(value) {
                results[index] = value;
                --remaining || res(results);
              }, rej);
            });
          else
            res(results);
        });
      },
      race: function race(iterable) {
        var C = getConstructor(this);
        return new C(function(res, rej) {
          forOf(iterable, false, function(promise) {
            C.resolve(promise).then(res, rej);
          });
        });
      }
    });
  })(require("3f"));
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("32", [], true, function(require, exports, module) {
  ;
  var global = this,
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

$__System.registerDynamic("33", ["48", "2a"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  require("48");
  module.exports = require("2a").core.Object.values;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("34", ["2a", "49"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = require("2a");
  require("49");
  module.exports = function getOwnPropertyDescriptor(it, key) {
    return $.getDesc(it, key);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("35", ["2a"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = require("2a"),
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

$__System.registerDynamic("36", ["2a", "4a"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = require("2a"),
      enumKeys = require("4a");
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

$__System.registerDynamic("38", ["2a", "4b", "3b"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var global = require("2a").g,
      store = require("4b")('wks');
  module.exports = function(name) {
    return store[name] || (store[name] = global.Symbol && global.Symbol[name] || require("3b").safe('Symbol.' + name));
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("37", ["2a", "38"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = require("2a"),
      TAG = require("38")('toStringTag'),
      toString = {}.toString;
  function cof(it) {
    return toString.call(it).slice(8, -1);
  }
  cof.classof = function(it) {
    var O,
        T;
    return it == undefined ? it === undefined ? 'Undefined' : 'Null' : typeof(T = (O = Object(it))[TAG]) == 'string' ? T : cof(O);
  };
  cof.set = function(it, tag, stat) {
    if (it && !$.has(it = stat ? it : it.prototype, TAG))
      $.hide(it, TAG, tag);
  };
  module.exports = cof;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("39", ["2a"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = require("2a").hide;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3a", ["2a"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = require("2a");
  module.exports = function(TO_STRING) {
    return function(that, pos) {
      var s = String($.assertDefined(that)),
          i = $.toInteger(pos),
          l = s.length,
          a,
          b;
      if (i < 0 || i >= l)
        return TO_STRING ? '' : undefined;
      a = s.charCodeAt(i);
      return a < 0xd800 || a > 0xdbff || i + 1 === l || (b = s.charCodeAt(i + 1)) < 0xdc00 || b > 0xdfff ? TO_STRING ? s.charAt(i) : a : TO_STRING ? s.slice(i, i + 2) : (a - 0xd800 << 10) + (b - 0xdc00) + 0x10000;
    };
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3c", ["2a", "37", "41", "38", "4b"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var $ = require("2a"),
      cof = require("37"),
      assertObject = require("41").obj,
      SYMBOL_ITERATOR = require("38")('iterator'),
      FF_ITERATOR = '@@iterator',
      Iterators = require("4b")('iterators'),
      IteratorPrototype = {};
  setIterator(IteratorPrototype, $.that);
  function setIterator(O, value) {
    $.hide(O, SYMBOL_ITERATOR, value);
    if (FF_ITERATOR in [])
      $.hide(O, FF_ITERATOR, value);
  }
  module.exports = {
    BUGGY: 'keys' in [] && !('next' in [].keys()),
    Iterators: Iterators,
    step: function(done, value) {
      return {
        value: value,
        done: !!done
      };
    },
    is: function(it) {
      var O = Object(it),
          Symbol = $.g.Symbol,
          SYM = Symbol && Symbol.iterator || FF_ITERATOR;
      return SYM in O || SYMBOL_ITERATOR in O || $.has(Iterators, cof.classof(O));
    },
    get: function(it) {
      var Symbol = $.g.Symbol,
          ext = it[Symbol && Symbol.iterator || FF_ITERATOR],
          getIter = ext || it[SYMBOL_ITERATOR] || Iterators[cof.classof(it)];
      return assertObject(getIter.call(it));
    },
    set: setIterator,
    create: function(Constructor, NAME, next, proto) {
      Constructor.prototype = $.create(proto || IteratorPrototype, {next: $.desc(1, next)});
      cof.set(Constructor, NAME + ' Iterator');
    }
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3b", ["2a"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var sid = 0;
  function uid(key) {
    return 'Symbol('.concat(key === undefined ? '' : key, ')_', (++sid + Math.random()).toString(36));
  }
  uid.safe = require("2a").g.Symbol || uid;
  module.exports = uid;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3d", ["35", "39", "2a", "37", "3c", "38"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $def = require("35"),
      $redef = require("39"),
      $ = require("2a"),
      cof = require("37"),
      $iter = require("3c"),
      SYMBOL_ITERATOR = require("38")('iterator'),
      FF_ITERATOR = '@@iterator',
      KEYS = 'keys',
      VALUES = 'values',
      Iterators = $iter.Iterators;
  module.exports = function(Base, NAME, Constructor, next, DEFAULT, IS_SET, FORCE) {
    $iter.create(Constructor, NAME, next);
    function createMethod(kind) {
      function $$(that) {
        return new Constructor(that, kind);
      }
      switch (kind) {
        case KEYS:
          return function keys() {
            return $$(this);
          };
        case VALUES:
          return function values() {
            return $$(this);
          };
      }
      return function entries() {
        return $$(this);
      };
    }
    var TAG = NAME + ' Iterator',
        proto = Base.prototype,
        _native = proto[SYMBOL_ITERATOR] || proto[FF_ITERATOR] || DEFAULT && proto[DEFAULT],
        _default = _native || createMethod(DEFAULT),
        methods,
        key;
    if (_native) {
      var IteratorPrototype = $.getProto(_default.call(new Base));
      cof.set(IteratorPrototype, TAG, true);
      if ($.FW && $.has(proto, FF_ITERATOR))
        $iter.set(IteratorPrototype, $.that);
    }
    if ($.FW)
      $iter.set(proto, _default);
    Iterators[NAME] = _default;
    Iterators[TAG] = $.that;
    if (DEFAULT) {
      methods = {
        keys: IS_SET ? _default : createMethod(KEYS),
        values: DEFAULT == VALUES ? _default : createMethod(VALUES),
        entries: DEFAULT != VALUES ? _default : createMethod('entries')
      };
      if (FORCE)
        for (key in methods) {
          if (!(key in proto))
            $redef(proto, key, methods[key]);
        }
      else
        $def($def.P + $def.F * $iter.BUGGY, NAME, methods);
    }
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3e", ["2a", "4c", "3b", "3c", "3d"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = require("2a"),
      setUnscope = require("4c"),
      ITER = require("3b").safe('iter'),
      $iter = require("3c"),
      step = $iter.step,
      Iterators = $iter.Iterators;
  require("3d")(Array, 'Array', function(iterated, kind) {
    $.set(this, ITER, {
      o: $.toObject(iterated),
      i: 0,
      k: kind
    });
  }, function() {
    var iter = this[ITER],
        O = iter.o,
        kind = iter.k,
        index = iter.i++;
    if (!O || index >= O.length) {
      iter.o = undefined;
      return step(1);
    }
    if (kind == 'keys')
      return step(0, index);
    if (kind == 'values')
      return step(0, O[index]);
    return step(0, [index, O[index]]);
  }, 'values');
  Iterators.Arguments = Iterators.Array;
  setUnscope('keys');
  setUnscope('values');
  setUnscope('entries');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3f", ["4d"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = require("4d");
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("40", ["41"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var assertFunction = require("41").fn;
  module.exports = function(fn, that, length) {
    assertFunction(fn);
    if (~length && that === undefined)
      return fn;
    switch (length) {
      case 1:
        return function(a) {
          return fn.call(that, a);
        };
      case 2:
        return function(a, b) {
          return fn.call(that, a, b);
        };
      case 3:
        return function(a, b, c) {
          return fn.call(that, a, b, c);
        };
    }
    return function() {
      return fn.apply(that, arguments);
    };
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("41", ["2a"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = require("2a");
  function assert(condition, msg1, msg2) {
    if (!condition)
      throw TypeError(msg2 ? msg1 + msg2 : msg1);
  }
  assert.def = $.assertDefined;
  assert.fn = function(it) {
    if (!$.isFunction(it))
      throw TypeError(it + ' is not a function!');
    return it;
  };
  assert.obj = function(it) {
    if (!$.isObject(it))
      throw TypeError(it + ' is not an object!');
    return it;
  };
  assert.inst = function(it, Constructor, name) {
    if (!(it instanceof Constructor))
      throw TypeError(name + ": use the 'new' operator!");
    return it;
  };
  module.exports = assert;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("42", ["40", "3c", "4e"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var ctx = require("40"),
      get = require("3c").get,
      call = require("4e");
  module.exports = function(iterable, entries, fn, that) {
    var iterator = get(iterable),
        f = ctx(fn, that, entries ? 2 : 1),
        step;
    while (!(step = iterator.next()).done) {
      if (call(iterator, f, step.value, entries) === false) {
        return call.close(iterator);
      }
    }
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("43", ["2a", "41", "40"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = require("2a"),
      assert = require("41");
  function check(O, proto) {
    assert.obj(O);
    assert(proto === null || $.isObject(proto), proto, ": can't set as prototype!");
  }
  module.exports = {
    set: Object.setPrototypeOf || ('__proto__' in {} ? function(buggy, set) {
      try {
        set = require("40")(Function.call, $.getDesc(Object.prototype, '__proto__').set, 2);
        set({}, []);
      } catch (e) {
        buggy = true;
      }
      return function setPrototypeOf(O, proto) {
        check(O, proto);
        if (buggy)
          O.__proto__ = proto;
        else
          set(O, proto);
        return O;
      };
    }() : undefined),
    check: check
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("44", ["2a", "38"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = require("2a"),
      SPECIES = require("38")('species');
  module.exports = function(C) {
    if ($.DESC && !(SPECIES in C))
      $.setDesc(C, SPECIES, {
        configurable: true,
        get: $.that
      });
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("45", ["2a", "40", "37", "4f", "50", "3f"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    'use strict';
    var $ = require("2a"),
        ctx = require("40"),
        cof = require("37"),
        invoke = require("4f"),
        cel = require("50"),
        global = $.g,
        isFunction = $.isFunction,
        html = $.html,
        process = global.process,
        setTask = global.setImmediate,
        clearTask = global.clearImmediate,
        postMessage = global.postMessage,
        addEventListener = global.addEventListener,
        MessageChannel = global.MessageChannel,
        counter = 0,
        queue = {},
        ONREADYSTATECHANGE = 'onreadystatechange',
        defer,
        channel,
        port;
    function run() {
      var id = +this;
      if ($.has(queue, id)) {
        var fn = queue[id];
        delete queue[id];
        fn();
      }
    }
    function listner(event) {
      run.call(event.data);
    }
    if (!isFunction(setTask) || !isFunction(clearTask)) {
      setTask = function(fn) {
        var args = [],
            i = 1;
        while (arguments.length > i)
          args.push(arguments[i++]);
        queue[++counter] = function() {
          invoke(isFunction(fn) ? fn : Function(fn), args);
        };
        defer(counter);
        return counter;
      };
      clearTask = function(id) {
        delete queue[id];
      };
      if (cof(process) == 'process') {
        defer = function(id) {
          process.nextTick(ctx(run, id, 1));
        };
      } else if (addEventListener && isFunction(postMessage) && !global.importScripts) {
        defer = function(id) {
          postMessage(id, '*');
        };
        addEventListener('message', listner, false);
      } else if (isFunction(MessageChannel)) {
        channel = new MessageChannel;
        port = channel.port2;
        channel.port1.onmessage = listner;
        defer = ctx(port.postMessage, port, 1);
      } else if (ONREADYSTATECHANGE in cel('script')) {
        defer = function(id) {
          html.appendChild(cel('script'))[ONREADYSTATECHANGE] = function() {
            html.removeChild(this);
            run.call(id);
          };
        };
      } else {
        defer = function(id) {
          setTimeout(ctx(run, id, 1), 0);
        };
      }
    }
    module.exports = {
      set: setTask,
      clear: clearTask
    };
  })(require("3f"));
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("46", ["39"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $redef = require("39");
  module.exports = function(target, src) {
    for (var key in src)
      $redef(target, key, src[key]);
    return target;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("47", ["38"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var SYMBOL_ITERATOR = require("38")('iterator'),
      SAFE_CLOSING = false;
  try {
    var riter = [7][SYMBOL_ITERATOR]();
    riter['return'] = function() {
      SAFE_CLOSING = true;
    };
    Array.from(riter, function() {
      throw 2;
    });
  } catch (e) {}
  module.exports = function(exec) {
    if (!SAFE_CLOSING)
      return false;
    var safe = false;
    try {
      var arr = [7],
          iter = arr[SYMBOL_ITERATOR]();
      iter.next = function() {
        safe = true;
      };
      arr[SYMBOL_ITERATOR] = function() {
        return iter;
      };
      exec(arr);
    } catch (e) {}
    return safe;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4a", ["2a"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = require("2a");
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

$__System.registerDynamic("48", ["2a", "35"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = require("2a"),
      $def = require("35");
  function createObjectToArray(isEntries) {
    return function(object) {
      var O = $.toObject(object),
          keys = $.getKeys(O),
          length = keys.length,
          i = 0,
          result = Array(length),
          key;
      if (isEntries)
        while (length > i)
          result[i] = [key = keys[i++], O[key]];
      else
        while (length > i)
          result[i] = O[keys[i++]];
      return result;
    };
  }
  $def($def.S, 'Object', {
    values: createObjectToArray(false),
    entries: createObjectToArray(true)
  });
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("49", ["2a", "35"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = require("2a"),
      $def = require("35"),
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

$__System.registerDynamic("4b", ["2a"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = require("2a"),
      SHARED = '__core-js_shared__',
      store = $.g[SHARED] || $.hide($.g, SHARED, {})[SHARED];
  module.exports = function(key) {
    return store[key] || (store[key] = {});
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4c", ["2a", "38"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = require("2a"),
      UNSCOPABLES = require("38")('unscopables');
  if ($.FW && !(UNSCOPABLES in []))
    $.hide(Array.prototype, UNSCOPABLES, {});
  module.exports = function(key) {
    if ($.FW)
      [][UNSCOPABLES][key] = true;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4d", ["51"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = $__System._nodeRequire ? process : require("51");
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4e", ["41"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var assertObject = require("41").obj;
  function close(iterator) {
    var ret = iterator['return'];
    if (ret !== undefined)
      assertObject(ret.call(iterator));
  }
  function call(iterator, fn, value, entries) {
    try {
      return entries ? fn(assertObject(value)[0], value[1]) : fn(value);
    } catch (e) {
      close(iterator);
      throw e;
    }
  }
  call.close = close;
  module.exports = call;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4f", [], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = function(fn, args, that) {
    var un = that === undefined;
    switch (args.length) {
      case 0:
        return un ? fn() : fn.call(that);
      case 1:
        return un ? fn(args[0]) : fn.call(that, args[0]);
      case 2:
        return un ? fn(args[0], args[1]) : fn.call(that, args[0], args[1]);
      case 3:
        return un ? fn(args[0], args[1], args[2]) : fn.call(that, args[0], args[1], args[2]);
      case 4:
        return un ? fn(args[0], args[1], args[2], args[3]) : fn.call(that, args[0], args[1], args[2], args[3]);
      case 5:
        return un ? fn(args[0], args[1], args[2], args[3], args[4]) : fn.call(that, args[0], args[1], args[2], args[3], args[4]);
    }
    return fn.apply(that, args);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("50", ["2a"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = require("2a"),
      document = $.g.document,
      isObject = $.isObject,
      is = isObject(document) && isObject(document.createElement);
  module.exports = function(it) {
    return is ? document.createElement(it) : {};
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("51", ["52"], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = require("52");
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("52", [], true, function(require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var process = module.exports = {};
  var queue = [];
  var draining = false;
  function drainQueue() {
    if (draining) {
      return;
    }
    draining = true;
    var currentQueue;
    var len = queue.length;
    while (len) {
      currentQueue = queue;
      queue = [];
      var i = -1;
      while (++i < len) {
        currentQueue[i]();
      }
      len = queue.length;
    }
    draining = false;
  }
  process.nextTick = function(fun) {
    queue.push(fun);
    if (!draining) {
      setTimeout(drainQueue, 0);
    }
  };
  process.title = 'browser';
  process.browser = true;
  process.env = {};
  process.argv = [];
  process.version = '';
  process.versions = {};
  function noop() {}
  process.on = noop;
  process.addListener = noop;
  process.once = noop;
  process.off = noop;
  process.removeListener = noop;
  process.removeAllListeners = noop;
  process.emit = noop;
  process.binding = function(name) {
    throw new Error('process.binding is not supported');
  };
  process.cwd = function() {
    return '/';
  };
  process.chdir = function(dir) {
    throw new Error('process.chdir is not supported');
  };
  process.umask = function() {
    return 0;
  };
  global.define = __define;
  return module.exports;
});

$__System.register("0", ["2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c"], function (_export) {
  /**
   *  Browser support : IE9, Chrome , Firefox
   *  @version 0.0.1
   *  @author Romeo Kenfack Tsakem
   */

  // http://casperjs.org/
  // https://github.com/Fyrd/caniuse

  //TODO: Implements conditions as functions (data-show. data-hide, data-if)
  //TODO: Fix ciclic references

  "use strict";

  var windowPolyfills, polyfill, dataset, customEvent, promise, webanimation, Collection, Observable, Router, xhr, Logger;
  return {
    setters: [function (_) {
      windowPolyfills = _["default"];
    }, function (_2) {
      polyfill = _2["default"];
    }, function (_3) {
      dataset = _3["default"];
    }, function (_4) {
      customEvent = _4["default"];
    }, function (_5) {
      promise = _5["default"];
    }, function (_6) {
      webanimation = _6["default"];
    }, function (_7) {
      Collection = _7["default"];
    }, function (_8) {
      Observable = _8["default"];
    }, function (_a) {
      Router = _a["default"];
    }, function (_b) {
      xhr = _b["default"];
    }, function (_c) {
      Logger = _c["default"];
    }],
    execute: function () {
      _export("default", (function () {

        var scope = function scope(selector, ctx) {
          return Collection.query(selector, ctx);
        };

        for (var module in Collection) {
          if (Collection.hasOwnProperty(module)) {
            if (typeof Collection[module] == "function") {
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
      })());
    }
  };
});
$__System.register('3', ['d'], function (_export) {
  var _Object$defineProperty;

  return {
    setters: [function (_d) {
      _Object$defineProperty = _d['default'];
    }],
    execute: function () {
      'use strict';

      _export('default', (function () {

        if (!window.Object.assign) {

          _Object$defineProperty(window.Object, 'assign', {
            enumerable: false,
            configurable: true,
            writable: true,
            value: function value(target, firstSource) {
              'use strict';
              if (target === undefined || target === null) {
                throw new TypeError('Cannot convert first argument to object');
              }
              var to = window.Object(target);
              for (var i = 1; i < arguments.length; i++) {
                var nextSource = arguments[i];
                if (nextSource === undefined || nextSource === null) {
                  continue;
                }
                nextSource = window.Object(nextSource);

                var keysArray = window.Object.keys(window.Object(nextSource));
                for (var nextIndex = 0, len = keysArray.length; nextIndex < len; nextIndex++) {
                  var nextKey = keysArray[nextIndex];
                  var desc = window.Object.getOwnPropertyDescriptor(nextSource, nextKey);
                  if (desc !== undefined && desc.enumerable) {
                    to[nextKey] = nextSource[nextKey];
                  }
                }
              }
              return to;
            }
          });
        }

        if (!window.Object.keys) {
          window.Object.keys = (function () {
            'use strict';
            var hasOwnProperty = Object.prototype.hasOwnProperty,
                hasDontEnumBug = !({ toString: null }).propertyIsEnumerable('toString'),
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
        }

        if (!window.Object.values) {

          window.Object.values = (function (obj) {
            'use strict';
            return function (obj) {
              var values = [];
              window.Object.keys(obj).forEach(function (key, index) {
                values[index] = obj[key];
              });
              return values;
            };
          })();
        }
      })());
    }
  };
});
$__System.register('6', [], function (_export) {
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
$__System.register('5', [], function (_export) {
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
$__System.register("8", ["10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "e", "f", "c"], function (_export) {
  var pageready, clazz, style, dimension, traversing, attributes, events, manipulation, animation, _Object$create, template, cssHelpers, Logger, Collection;

  return {
    setters: [function (_2) {
      pageready = _2["default"];
    }, function (_3) {
      clazz = _3["default"];
    }, function (_4) {
      style = _4["default"];
    }, function (_5) {
      dimension = _5["default"];
    }, function (_6) {
      traversing = _6["default"];
    }, function (_7) {
      attributes = _7["default"];
    }, function (_8) {
      events = _8["default"];
    }, function (_9) {
      manipulation = _9["default"];
    }, function (_10) {
      animation = _10["default"];
    }, function (_) {
      _Object$create = _["default"];
    }, function (_e) {
      template = _e["default"];
    }, function (_f) {
      cssHelpers = _f["default"];
    }, function (_c) {
      Logger = _c["default"];
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
            Logger.warn("Method '" + name + "' already available.");
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
          if (this[name] !== undefined && override !== true) {
            Logger.warn("Method '" + name + "' already available as static method.");
          } else {
            this[name] = module[name];
          }
        }
      };

      Collection.addModule(clazz);
      Collection.addModule(style);
      Collection.addModule(traversing);
      Collection.addModule(attributes);
      Collection.addModule({
        find: traversing.find
      }, true);
      Collection.addModule(dimension);
      Collection.addModule(events);
      Collection.addModule(manipulation);
      Collection.addModule(animation);
      Collection.addModule({
        template: template.template
      });

      Collection.addStaticModule({
        template: {
          addSpecial: template.addSpecial,
          addSpecials: template.addSpecials,
          removeSpecial: template.removeSpecial
        }
      });
      Collection.addStaticModule(pageready);

      _export("default", Collection);
    }
  };
});
$__System.register('a', ['c'], function (_export) {
  'use strict';

  var Logger, scopeRouter, init;
  return {
    setters: [function (_c) {
      Logger = _c['default'];
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
$__System.register("9", ["1b", "1c", "1a"], function (_export) {
  var _createClass, _classCallCheck, Notifier, Observable;

  return {
    setters: [function (_b) {
      _createClass = _b["default"];
    }, function (_c) {
      _classCallCheck = _c["default"];
    }, function (_a) {
      Notifier = _a["default"];
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
$__System.register("b", ["1e", "1f", "1d"], function (_export) {
	var _Object$assign, _Promise, XHR;

	return {
		setters: [function (_e) {
			_Object$assign = _e["default"];
		}, function (_f) {
			_Promise = _f["default"];
		}, function (_d) {
			XHR = _d["default"];
		}],
		execute: function () {
			"use strict";

			_export("default", (function () {

				/**
    * *async*
    * *user*
    * *password*
    * *headers*
    * *timeout*
    *
    */

				var defaultOptions = {
					async: true,
					timeout: 3000,
					user: null,
					password: "",
					cache: false
				};

				var processRequest = function processRequest(xhr, options) {

					options = options || {};
					options.headers = options.headers || {};
					options = _Object$assign(defaultOptions, options);

					xhr.setAsync(options.async);
					xhr.setCaching(options.cache);
					xhr.setTimeout(options.timeout);

					if (options.user !== null) {
						xhr.setCredencials(options.user, options.password);
					}

					xhr.send();

					return new _Promise(function (resolve, reject) {
						xhr.on("success", function (e) {
							resolve(e);
						});
						xhr.on("fail", function (e) {
							reject(e);
						});
					});
				};

				var instance = null;

				var getInstance = function getInstance(method, url, data) {
					data = data || {};
					if (instance === null) {
						instance = new XHR(method, url, data);
						instance.$$oid = "scope_" + new Date().getTime();
					} else {
						instance.setMethod(method);
						instance.setUrl(url);
						instance.setRequestData(data);
					}
					return instance;
				};

				return {

					/**
     * Send an http get request
     * @param url {String} The request url
     * @param data {Map} Map containing key/value pairs data to be sent
     * @param options {Map} Map containing the request options.
     *   
     *
     */
					get: function get(url, data, options) {
						return processRequest(getInstance("get", url, data), options);
					},

					post: function post(url, data, options) {
						return processRequest(getInstance("post", url, data), options);
					},

					put: function put(url, data, options) {
						return processRequest(getInstance("put", url, data), options);
					},

					"delete": function _delete(url, data, options) {
						return processRequest(getInstance("delete", url, data), options);
					}

				};
			})());
		}
	};
});
$__System.register('c', [], function (_export) {
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
$__System.register("e", ["21", "c"], function (_export) {
  /**
  TODO : Partial rendering for Conditions
  conditions could also be function calls
  */

  "use strict";

  var utils, Logger;
  return {
    setters: [function (_) {
      utils = _["default"];
    }, function (_c) {
      Logger = _c["default"];
    }],
    execute: function () {
      _export("default", (function () {

        var Template = function Template(node, scope, ctx) {
          ctx = ctx || window;
          node.$$template = {
            node: node.cloneNode(true),
            instance: this,
            ctx: ctx
          };
          this._model = scope;
          this._ctx = ctx;
          this._node = node;
          this._currentPath = "";
          this._render(node, scope);
        };

        Template.NODE_TYPE = {
          ELEMENT: 1,
          ATTR: 2,
          TEXT: 3,
          DOCUMENT_FRAGMENT: 11
        };

        Template.verySpecials = ["checked", "multiple", "readonly", "disabled"];

        Template.conditions = ["if", "show", "hide"];

        Template.specials = {};

        Template.insertAfter = function (newNode, targetNode) {
          var itemToInsert = newNode;
          var parent = targetNode.parentNode;
          var children = Template.getChildren(parent);
          if (children[children.length - 1] == targetNode) {
            parent.appendChild(itemToInsert);
          } else {
            parent.insertBefore(itemToInsert, targetNode.nextSibling);
          }
        };

        Template.cloneAttrNode = function (attrNode) {
          var clone = document.createAttribute(attrNode.name);
          clone.value = attrNode.value;
          return clone;
        };

        Template.addSpecial = function (attrName, mapTo) {
          Template.specials[attrName] = mapTo;
        };

        Template.addSpecials = function (attrs) {
          for (var p in attrs) {
            Template.specials[p] = attrs[p];
          }
        };

        Template.removeSpecial = function (attrName, mapTo) {
          delete Template.specials[attrName];
        };

        Template.executeCode = function (code, scope) {

          return (function (codeToRun) {

            var vars = codeToRun.match(Template.regex.varName);

            var pathValue;

            vars.forEach(function (vr) {
              pathValue = Template._getPathValue.call(this, scope, vr);
              pathValue = typeof pathValue == "object" ? true : pathValue;
              if (pathValue !== undefined) {
                codeToRun = codeToRun.replace(vr, pathValue);
              }
            }, this);
            codeToRun = "'use strict'; return " + codeToRun;

            try {
              var tmpFunc = new Function(codeToRun); // jshint ignore:line
              return tmpFunc.apply({});
            } catch (err) {

              Logger.warn("The expression " + code + " could not be evaluated !");
            }
            return false;
          }).bind(this)(code);
        };

        Template.escapeHtml = function (str) {
          var div = document.createElement("div");
          div.appendChild(document.createTextNode(str));
          return div.innerHTML;
        };

        // UNSAFE with unsafe strings; only use on previously-escaped ones!
        Template.unescapeHtml = function (escapedStr) {
          var div = document.createElement("div");
          div.innerHTML = escapedStr;
          var child = div.childNodes[0];
          return child ? child.nodeValue : "";
        };

        Template.regex = {
          varName: /[a-zA-Z_$]+[0-9a-zA-Z_$]*(.[a-zA-Z_$]+[0-9a-zA-Z_$])*/g,
          sequence: null,
          token: /\{\{\s*\$?[\w]+\.?[\w]*\s*\}\}/g,
          tokenName: /\w+/,
          paramName: /\$?[\w]+\s*\.?[\w]*/,
          expression: null,
          escape: /[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g,
          trim: /^[\s+]+|[\s+]+$/g,
          repeat: /\{\{\s*([\w]+)\s*in\s*([\w]+\.?[\w]*)\s*\}\}/,
          func: /(.*)\((.*)\)/,
          params: /,\s+|,|\s+,\s+/,
          quote: /\"|\'/g,
          content: /[^.|^\s]/gm,
          depth: /..\//g,
          string: /^(\"|\')(.*)(\"|\')$/
        };

        Template._getPathValue = function (scope, path) {

          var getPathValue = function getPathValue(namespace, path) {
            var parts = path.split(".");
            var res;
            if (parts.length == 1) {
              if (typeof namespace[path] !== undefined) {
                res = namespace[path];
              }
            } else {
              res = namespace;
              for (var i = 0; i < parts.length; i++) {
                res = res[parts[i]];
                if (res === undefined) {
                  break;
                }
              }
            }
            res = typeof namespace[path] == "function" ? namespace[path]() : namespace[path];
            return res;
          };

          var value = getPathValue(scope, path);
          if (value === undefined) {
            value = getPathValue(this._model, path);
          }
          if (value === undefined) {
            value = getPathValue(window, path);
          }

          return value;
        };

        Template.getChildren = function (list) {
          var children = Array.prototype.slice.call(list.childNodes);
          return children.filter(function (node) {
            if (node.nodeType == Template.NODE_TYPE.TEXT && node.textContent.trim() === "") {
              return false;
            }
            return true;
          });
        };

        Template.create = function (node, model, ctx) {

          if (!node.$$template) {
            return new Template(node, model, ctx);
          } else {
            var parent = node.parentNode;
            var oldNode = node;
            var instance = node.$$template.instance;
            node = node.$$template.node;
            node.$$template = {
              node: node.cloneNode(true),
              instance: instance,
              ctx: ctx
            };
            node.$$template.instance._removeListeners.call(node.$$template.instance);
            node.$$template.instance._render.call(node.$$template.instance, node, model);
            parent.replaceChild(node, oldNode);
            return instance;
          }
        };

        Template.prototype = {

          _currentPath: null,

          _node: null,

          _listeners: [],

          _modelListeners: [],

          _findObjectListener: function _findObjectListener(obj) {
            var found = null;
            for (var i = 0; i < this._modelListeners.length; i++) {
              if (utils.equals(this._modelListeners[i].obj, obj)) {
                found = this._modelListeners[i];
                break;
              }
            }
            return found;
          },

          observeObject: function observeObject(obj, listener) {

            var modelListener = this._findObjectListener(obj);

            if (modelListener === null) {

              var globalListener = function globalListener(modelListener, changes) {
                modelListener.listeners.forEach(function (listener) {
                  listener(changes);
                });
              };

              modelListener = {
                obj: obj,
                globalListener: globalListener,
                listeners: [listener]
              };
              this._modelListeners.push(modelListener);

              Object.observe(obj, globalListener.bind(this, modelListener));
            } else {
              modelListener.listeners.push(listener);
            }
          },

          dispose: function dispose() {
            this._unobserve();
            this._removeListeners();
            var node = this._node;
            var parent = node.parentNode;
            parent.replaceChild(this._node.$$template.node, node);
            delete this._node.$$template;
          },

          update: function update(model) {
            this._model = model;
            var node = this._node;
            var parent = node.parentNode;
            var oldNode = node;
            var instance = node.$$template.instance;
            this._node = node = node.$$template.node;
            node.$$template = {
              node: node.cloneNode(true),
              instance: instance
            };
            node.$$template.instance._removeListeners.call(node.$$template.instance);
            node.$$template.instance._render.call(node.$$template.instance, node, model);
            parent.replaceChild(node, oldNode);
            return instance;
          },

          _unobserve: function _unobserve() {
            this._modelListeners.forEach(function (observed) {
              Object.unobserve(observed.obj, observed.globalListener);
            });
          },

          _removeListeners: function _removeListeners() {
            this._listeners.forEach(function (registered) {
              registered.node.removeEventListener(registered.eventName, registered.listener, false);
            });
            this._listeners = [];
          },

          _isEventSupported: function _isEventSupported(target, eventName) {
            eventName = "on" + eventName;
            var isSupported = (eventName in target);
            if (!isSupported) {
              target.setAttribute(eventName, "return;");
              isSupported = typeof target[eventName] == "function";
              target.removeAttribute(eventName);
            }
            return isSupported;
          },

          _getExpressions: function _getExpressions(value) {
            var expressions = [];
            var test = value.match(Template.regex.token) || [];
            test.forEach((function (match) {
              expressions.push({
                templExp: match.trim(),
                paramName: match.match(Template.regex.paramName)[0].trim()
              });
            }).bind(this));
            return expressions;
          },

          _parseRepeatExpression: function _parseRepeatExpression(value) {
            var expression = null;
            var test = value.match(Template.regex.repeat);
            if (test) {
              expression = {
                paramName: test[1].trim(),
                expr: test[2].trim()
              };
            }
            return expression;
          },

          _renderTextNode: function _renderTextNode(node, scope) {

            var originalNode = node.cloneNode(true);
            var expressions = this._getExpressions(originalNode.textContent);
            var toObserve = null;
            var pathToObserve = null;
            var val = null;

            if (expressions.length > 0) {
              expressions.forEach(function (expression) {
                val = scope[expression.paramName];
                if (val !== undefined) {
                  this.observeObject(scope, (function (changes) {
                    changes.forEach(function (change) {
                      node.textContent = this._renderText(originalNode.cloneNode(true).textContent, scope);
                    }, this);
                  }).bind(this));
                } else {
                  var parts = expression.paramName.split(".");
                  if (parts.length > 1) {
                    parts.splice(-1);
                    if (pathToObserve !== parts.join(".")) {
                      toObserve = Template._getPathValue.call(this, scope, parts.join("."));
                      this.observeObject(toObserve, (function (changes) {
                        changes.forEach(function (change) {
                          node.textContent = this._renderText(originalNode.cloneNode(true).textContent, scope);
                        }, this);
                      }).bind(this));
                    }
                    pathToObserve = parts.join(".");
                  }
                }
              }, this);
            }
            node.textContent = this._renderText(node.textContent, scope);
          },

          _renderText: function _renderText(text, scope) {
            if (text.length > 0) {
              var expressions = this._getExpressions(text);
              expressions.forEach((function (expression) {
                text = text.replace(expression.templExp, Template._getPathValue.call(this, scope, expression.paramName));
              }).bind(this));
              return text;
            }
            return "";
          },

          _getParamList: function _getParamList(scope, funcString) {
            var startPos = funcString.indexOf("(");
            var endPos = funcString.indexOf(")");
            var funcName = funcString.substr(0, startPos);
            var params = funcString.substr(startPos + 1, endPos - startPos - 1).trim();
            if (params.length > 0) {
              params = params.split(",").map((function (param) {
                return Template._getPathValue.call(this, scope, param.trim());
              }).bind(this)).filter(function (p) {
                return p !== undefined;
              });
            } else {
              params = [];
            }
            return {
              funcName: funcString.substr(0, startPos),
              params: params
            };
          },

          _callFunction: function _callFunction(funcString, args, scope, refNode) {

            return (function () {

              var parts = funcString.split(".");
              var isFunctionDefined = true;
              var context = scope[parts[0]] ? scope : this._model[parts[0]] ? this._model : window;
              context = context || this._model[parts[0]];
              context = context || window[parts[0]];
              var ref = context;

              for (var i = 0; i < parts.length; i++) {
                if (ref[parts[i]] !== undefined) {
                  ref = ref[parts[i]];
                } else {
                  isFunctionDefined = false;
                  Logger.warn("The function " + funcString + " is not defined");
                  break;
                }
              }

              context = context == window ? refNode : context;

              if (isFunctionDefined) {
                return function (e) {
                  args.push(e);
                  ref.apply(context, args);
                };
              } else {
                return function () {
                  Logger.warn("The function " + funcString + " is not defined");
                };
              }
            }).bind(this)();
          },

          _updateAttr: function _updateAttr(scope, expression, originalNode, refNode, changes) {
            var nodeName = this._renderText(originalNode.name, scope);
            changes.forEach(function (change) {
              var attrValue = originalNode.value.replace(expression.templExp, Template._getPathValue.call(this, scope, expression.paramName));
              refNode.setAttribute(nodeName, attrValue);
            }, this);
          },

          _toggleNodeRemove: function _toggleNodeRemove(refNode, originalRefNode, condition) {
            if (condition === false) {
              if (refNode.parentNode) {
                refNode.parentNode.removeChild(refNode);
              }
            }
          },

          processCondition: function processCondition(scope, refNode, condition, conditionValue, originalRefNode, previousSibling, nextSibling, parent) {

            if (["data-show", "data-hide"].indexOf(condition) != -1) {

              if (condition == "data-show") {
                if (conditionValue === true) {
                  refNode.classList.remove("scope-hide");
                } else {
                  refNode.classList.add("scope-hide");
                }
              } else {
                if (conditionValue === true) {
                  refNode.classList.add("scope-hide");
                } else {
                  refNode.classList.remove("scope-hide");
                }
              }
            } else if (condition == "data-if") {

              if (conditionValue === false) {
                if (refNode.parentNode) {
                  refNode.parentNode.removeChild(refNode);
                }
              } else {
                if (!refNode.parentNode) {
                  if (nextSibling) {
                    nextSibling.parentNode.insertBefore(originalRefNode, nextSibling);
                  } else if (previousSibling) {
                    Template.insertAfter(originalRefNode, previousSibling);
                  } else {
                    parent.appendChild(originalRefNode);
                  }
                  this._render(originalRefNode, scope);
                }
              }
            }
          },

          _applyCondition: function _applyCondition(refNode, node, scope) {

            var newstr = node.value.replace(/{/g, "").replace(/}/g, "");
            var conditionValue = Template.executeCode.call(this, newstr, scope);
            var expressions = this._getExpressions(node.value);

            var originalNode = Template.cloneAttrNode(node);
            var originalRefNode = refNode.cloneNode(true);

            var refParent = refNode.parentNode;
            var refNextSibling = refNode.nextSibling;
            var refPreviousSibling = refNode.previousSibling;

            this.processCondition(scope, refNode, node.name, conditionValue, originalRefNode, refPreviousSibling, refNextSibling, refParent);

            // Observe changes to any part of the condition
            (function (that, refNode, node, scope) {

              var vars = newstr.match(Template.regex.varName);

              vars.forEach(function (varr) {
                // Observe changes for partial rendering
                var val = scope[varr];
                if (val !== undefined) {
                  that.observeObject(scope, function (changes) {
                    conditionValue = Template.executeCode.call(that, Template.cloneAttrNode(originalNode).value.replace(/{/g, "").replace(/}/g, ""), scope);
                    that.processCondition(scope, refNode, originalNode.name, conditionValue, originalRefNode, refPreviousSibling, refNextSibling, refParent);
                  });
                } else {
                  var parts = varr.split(".");
                  if (parts.length > 1) {
                    if (scope[parts[0]] !== undefined) {
                      parts.splice(-1);
                      var toObserve = parts.join(".");
                      that.observeObject(Template._getPathValue.call(that, scope, toObserve), function (changes) {
                        conditionValue = Template.executeCode.call(that, Template.cloneAttrNode(originalNode).value.replace(/{/g, "").replace(/}/g, ""), scope);
                        that.processCondition(scope, refNode, originalNode.name, conditionValue, originalRefNode, refPreviousSibling, refNextSibling, refParent);
                      });
                    }
                  }
                }
              });
            })(this, refNode, node, scope);
          },

          _renderAttributeNode: function _renderAttributeNode(refNode, node, scope) {

            var attrValue = node.value;
            var nodeName = this._renderText(node.name, scope);
            var originalNode = node;

            var removedAttr = false;

            var parts = node.name.split("-");

            if (parts.length == 2) {

              if (this._isEventSupported(refNode, parts[1])) {

                var eventName = parts[1];
                var callback = attrValue;
                refNode.removeAttribute(node.name);
                var funcCall = this._getParamList(scope, callback);
                if (funcCall.funcName.trim().length > 0) {
                  callback = this._callFunction(funcCall.funcName, funcCall.params, scope, refNode);
                  this._listeners.push({
                    node: refNode,
                    eventName: eventName,
                    listener: callback
                  });
                  refNode.addEventListener(eventName, callback, false);
                }
              }

              if (Template.conditions.indexOf(parts[1]) != -1) {
                removedAttr = true;

                if (this._applyCondition(refNode, node, scope) === false) {
                  return false;
                }
              }
            } else {
              var expressions = this._getExpressions(attrValue);

              if (expressions.length) {
                expressions.forEach((function (expression) {

                  // Observe changes for partial rendering
                  var val = scope[expression.paramName];
                  if (val !== undefined) {
                    this.observeObject(scope, this._updateAttr.bind(this, scope, expression, originalNode, refNode));
                  } else {
                    parts = expression.paramName.split(".");
                    if (parts.length > 1) {
                      parts.splice(-1);
                      var toObserve = parts.join(".");
                      this.observeObject(Template._getPathValue.call(this, scope, toObserve), this._updateAttr.bind(this, scope, expression, originalNode, refNode));
                    }
                  }

                  attrValue = attrValue.replace(expression.templExp, Template._getPathValue.call(this, scope, expression.paramName));
                }).bind(this));
              }
            }
            node.value = attrValue;

            if (Template.specials[node.name]) {
              refNode.setAttribute(Template.specials[node.name], attrValue);
              removedAttr = true;
            }

            if (nodeName != node.name) {
              refNode.setAttribute(nodeName, attrValue);
              removedAttr = true;
            }

            if (Template.verySpecials.indexOf(nodeName) != -1) {
              if (attrValue != "true") {
                removedAttr = true;
              }
            }

            if (removedAttr) {
              refNode.removeAttribute(node.name);
            }

            return true;
          },

          _renderAttributes: function _renderAttributes(node, scope) {
            var attrs = node.attributes;
            var res = true;
            if (attrs && attrs.length > 0) {
              attrs = Array.prototype.slice.call(attrs);
              attrs.forEach((function (attr) {
                res = res && this._renderAttributeNode(node, attr, scope);
              }).bind(this));
            }
            return res;
          },

          _buildSubScope: function _buildSubScope(data, repeatExpression, index) {
            var subScope = {};
            subScope[repeatExpression.paramName] = data[index];
            subScope.$index = index;
            subScope.$key = repeatExpression.paramName;
            return subScope;
          },

          _updateList: function _updateList(listNode, changes) {

            var index;
            var children;
            var node;
            var repeatData = listNode.$$repeatData;

            changes.forEach(function (change) {

              switch (change.type) {

                case "add":
                  index = parseInt(change.name, 10);
                  if (index >= 0) {
                    node = repeatData.itemTemplate.cloneNode(true);
                    this._render(node, this._buildSubScope(repeatData.data, repeatData.expr, index));
                    if (index > 0) {
                      Template.insertAfter(node, Template.getChildren(listNode)[index - 1]);
                    } else {
                      listNode.appendChild(node);
                    }
                  }
                  break;

                case "delete":
                  index = parseInt(change.name, 10);
                  if (index >= 0) {
                    var toRemove = Template.getChildren(listNode)[index];
                    toRemove.parentNode.removeChild(toRemove);
                  }
                  break;

                case "update":
                  index = parseInt(change.name, 10);
                  if (index >= 0) {
                    node = repeatData.itemTemplate.cloneNode(true);
                    this._render(node, this._buildSubScope(repeatData.data, repeatData.expr, index));
                    var toReplace = Template.getChildren(listNode)[index];
                    toReplace.parentNode.replaceChild(node, toReplace);
                  }
                  break;

              }
            }, this);
          },

          _render: function _render(node, scope) {

            if (node.hasAttribute && node.hasAttribute("data-bind")) {
              scopeName = node.getAttribute("data-bind");
              node.removeAttribute("data-bind");
              scope = scope[scopeName];
              this._currentPath += "." + scopeName;
            }

            var repeatAttr = null;
            var children;

            if (node.hasAttribute && node.hasAttribute("data-repeat")) {
              repeatAttr = node.getAttribute("data-repeat");
              node.removeAttribute("data-repeat");
            }

            // If the data-if is false don't render the node
            if (this._renderAttributes(node, scope) === false) {
              return;
            }

            if (repeatAttr) {

              var repeatExpression = this._parseRepeatExpression(repeatAttr);

              var data = Template._getPathValue.call(this, scope, repeatExpression.expr);

              if (data === undefined) {
                Logger.debug(repeatExpression.expr + " does'nt exists on " + scope);
                return;
              }

              // Observe the list Model to update the dom when changes happen
              this.observeObject(data, this._updateList.bind(this, node));

              this._currentPath += "." + repeatExpression.expr;

              var l = data.length;
              var fragments = [];

              children = Array.prototype.slice.call(node.childNodes);

              var fragment = document.createDocumentFragment();
              children.forEach(function (child) {
                fragment.appendChild(child);
              });

              node.$$repeatData = {
                itemTemplate: fragment.cloneNode(true),
                data: data,
                expr: repeatExpression
              };

              for (var i = 0; i < l; i++) {
                var subScope = null;
                fragments.push(fragment.cloneNode(true));
              }

              var listFragment = document.createDocumentFragment();

              fragments.forEach((function (fragment, index) {
                this._render(fragment, this._buildSubScope(data, repeatExpression, index));
                listFragment.appendChild(fragment);
              }).bind(this));

              node.appendChild(listFragment);
            } else {

              children = Array.prototype.slice.call(node.childNodes);

              children.forEach((function (child) {
                if (child.nodeType == Template.NODE_TYPE.TEXT) {
                  this._renderTextNode(child, scope);
                } else if (child.nodeType == Template.NODE_TYPE.ELEMENT) {
                  this._renderAttributes(child, scope);
                  this._render(child, scope);
                }
              }).bind(this));
            }
          }
        };

        Template.addSpecials({
          "_src": "src",
          "_href": "href",
          "_style": "style",
          "_checked": "checked",
          "_disabled": "disabled",
          "_readonly": "readonly",
          "_multiple": "multiple"
        });

        return {

          addSpecial: Template.addSpecial,
          addSpecials: Template.addSpecials,
          removeSpecial: Template.removeSpecial,

          template: function template(model, ctx) {
            return Template.create(this[0], model, ctx);
          }

        };
      })());
    }
  };
});
$__System.register("f", ["21"], function (_export) {
  "use strict";

  var utils;
  return {
    setters: [function (_) {
      utils = _["default"];
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
$__System.register("10", [], function (_export) {
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
$__System.register("11", ["f"], function (_export) {
  "use strict";

  var cssHelpers;
  return {
    setters: [function (_f) {
      cssHelpers = _f["default"];
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
$__System.register("12", ["21", "f"], function (_export) {
  "use strict";

  var utils, cssHelpers;
  return {
    setters: [function (_) {
      utils = _["default"];
    }, function (_f) {
      cssHelpers = _f["default"];
    }],
    execute: function () {
      _export("default", {

        getStyle: function getStyle(name) {
          name = cssHelpers.getPropertyName(name);
          if (this[0]) {
            return this[0].style[utils.camelCase(name)];
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
$__System.register("13", [], function (_export) {
  "use strict";

  return {
    setters: [],
    execute: function () {
      _export("default", (function () {

        var swapStyles = function swapStyles(el, styleMap, func) {
          var originalStyles = {};
          for (var prop in styleMap) {
            originalStyles[prop] = el.style[prop];
            el.style[prop] = styleMap[prop];
          }

          var res = func.call(el);
          for (prop in originalStyles) {
            el.style[prop] = originalStyles[prop];
          }

          return res;
        };

        return {

          getWidth: function getWidth(force) {

            if (!this[0]) {
              return 0;
            }

            force = typeof force == "undefined" ? false : force;
            var rect = null;

            if (force === true) {
              rect = swapStyles(this[0], {
                display: "block",
                position: "absolute",
                visibility: "hidden"
              }, this[0].getBoundingClientRect);
            } else {
              rect = this[0].getBoundingClientRect();
            }

            return Math.round(rect.right - rect.left);
          },

          getHeight: function getHeight(force) {

            if (!this[0]) {
              return 0;
            }

            force = typeof force == "undefined" ? false : force;
            var rect = null;

            if (force === true) {
              rect = swapStyles(this[0], {
                display: "block",
                position: "absolute",
                visibility: "hidden"
              }, this[0].getBoundingClientRect);
            } else {
              rect = this[0].getBoundingClientRect();
            }

            return Math.round(rect.bottom - rect.top);
          },

          getOffset: function getOffset(force) {

            if (!this[0]) {
              return {};
            }

            force = typeof force == "undefined" ? false : force;
            if (force === true) {
              return swapStyles(this[0], {
                display: "block",
                position: "absolute",
                visibility: "hidden"
              }, this[0].getBoundingClientRect);
            } else {
              return this[0].getBoundingClientRect();
            }
          },

          getContentHeight: function getContentHeight(force) {
            if (!this[0]) {
              return 0;
            }
            force = typeof force == "undefined" ? false : force;
            var that = this;
            if (force === true) {
              return swapStyles(this[0], {
                display: "block",
                position: "absolute",
                visibility: "hidden",
                boxSizing: "content-box"
              }, function () {
                return parseInt(that.getStyle("height"), 10);
              });
            } else {
              return swapStyles(this[0], {
                boxSizing: "content-box"
              }, function () {
                return parseInt(that.getStyle("height"), 10);
              });
            }
          },

          getContentWidth: function getContentWidth(force) {
            if (!this[0]) {
              return 0;
            }
            force = typeof force == "undefined" ? false : force;
            var that = this;
            if (force === true) {
              return swapStyles(this[0], {
                display: "block",
                position: "absolute",
                visibility: "hidden",
                boxSizing: "content-box"
              }, function (col) {
                return parseInt(that.getStyle("width"), 10);
              });
            } else {
              return swapStyles(this[0], {
                boxSizing: "content-box"
              }, function () {
                return parseInt(that.getStyle("width"), 10);
              });
            }
          }
        };
      })());
    }
  };
});
$__System.register("14", ["8"], function (_export) {
  "use strict";

  var Collection;
  return {
    setters: [function (_) {
      Collection = _["default"];
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
            res = selector ? res.concat(sibling.find(selector)) : res.concat(sibling);
          });
          return res;
        },

        getChildren: function getChildren(selector) {
          var res = Collection();
          var children = null;
          this.forEach(function (item) {
            children = Collection.fromArray(Array.prototype.slice.call(item.childNodes));
            res = selector ? res.concat(children.find(selector)) : res.concat(children);
          });
          return res;
        },

        getParents: function getParents(selector) {
          var res = Collection();
          var parent = null;
          this.forEach(function (item) {
            parent = item.parentNode ? Collection.fromArray([item.parentNode]) : Collection();
            res = selector ? res.concat(parent.find(selector)) : res.concat(parent);
          });
          return res;
        }

      });
    }
  };
});
$__System.register("15", ["21"], function (_export) {
  "use strict";

  var utils;
  return {
    setters: [function (_) {
      utils = _["default"];
    }],
    execute: function () {
      _export("default", (function () {

        var _setAttribute = function _setAttribute(el, attrName, attrValue) {
          el.setAttribute(attrName, attrValue);
        };

        var _getAttribute = function _getAttribute(el, attrName) {
          return el.getAttribute(attrName);
        };

        var _getProperty = function _getProperty(el, propName) {
          return el[propName];
        };

        var _setProperty = function _setProperty(el, propName, propValue) {
          el[propName] = propValue;
        };

        var getDataSetAttribute = function getDataSetAttribute(el, dataAttrName) {
          if (el.dataset) {
            return el.dataset[utils.camelCase(dataAttrName)];
          } else {
            return _getAttribute(el, "data-" + utils.hyphenate(dataAttrName));
          }
        };

        var setDataSetAttibute = function setDataSetAttibute(el, dataAttrName, dataAttrValue) {
          if (el.dataset) {
            el.dataset[utils.camelCase(dataAttrName)] = dataAttrValue;
          } else {
            _setAttribute(el, "data-" + utils.hyphenate(dataAttrName), dataAttrValue);
          }
        };

        return {

          /**
           *
           */
          getAttribute: function getAttribute(attrName) {
            if (this[0]) {
              return _getAttribute(this[0], attrName);
            }
          },

          /**
           *
           */
          getAttributes: function getAttributes(attrNames) {
            var attrs = {};
            if (this[0]) {
              attrNames.forEach(function (attrName) {
                attrs[attrName] = _getAttribute(this[0], attrName);
              }, this);
            }
            return attrs;
          },

          setAttribute: function setAttribute(attrName, attrValue) {
            this.forEach(function (el) {
              _setAttribute(el, attrName, attrValue);
            });
            return this;
          },

          setAttributes: function setAttributes(attrsMap) {
            this.forEach(function (el) {
              for (var attrName in attrsMap) {
                _setAttribute(el, attrName, attrsMap[attrName]);
              }
            });
            return this;
          },

          getProperty: function getProperty(propName) {
            if (this[0]) {
              return _getProperty(this[0], propName);
            }
          },

          setProperty: function setProperty(propName, propValue) {
            this.forEach(function (el) {
              _setProperty(el, propName, propValue);
            });
            return this;
          },

          getProperties: function getProperties(props) {
            var properties = {};
            if (this[0]) {
              props.forEach(function (propName) {
                properties[propName] = _getProperty(this[0], propName);
              }, this);
            }
            return properties;
          },

          setProperties: function setProperties(propsMap) {
            this.forEach(function (el) {
              for (var propName in propsMap) {
                _setProperty(el, propName, propsMap[propName]);
              }
            });
            return this;
          },

          dataset: function dataset() {
            if (this[0]) {
              return this[0].dataset;
            }
          }

        };
      })());
    }
  };
});
$__System.register("16", ["21", "22", "23", "1a"], function (_export) {
  "use strict";

  var utils, helpers, emitter, Notifier;
  return {
    setters: [function (_) {
      utils = _["default"];
    }, function (_2) {
      helpers = _2["default"];
    }, function (_3) {
      emitter = _3["default"];
    }, function (_a) {
      Notifier = _a["default"];
    }],
    execute: function () {
      _export("default", (function () {

        var registerEvent = function registerEvent(eventType, listener, context, once) {
          var registeredListener;
          this.forEach(function (el) {
            el.$$__notifier = el.$$__notifier || new Notifier();
            if (once === true) {
              registeredListener = el.$$__notifier.once(eventType, listener, context);
            } else {
              registeredListener = el.$$__notifier.on(eventType, listener, context);
            }
            if (helpers.isEventSupported(el, eventType)) {
              el.addEventListener(eventType, registeredListener.fnCtx, false);
            }
          });
          return this;
        };

        return {

          on: function on(eventType, listener, context) {
            context = context || this;
            registerEvent.call(this, eventType, listener, context, false);
            return this;
          },

          once: function once(eventType, listener, context) {
            context = context || this;
            registerEvent.call(this, eventType, listener, context, true);
            return this;
          },

          off: function off(eventType, listener, context) {
            var notifier;
            var removed = [];
            this.forEach(function (el) {
              if (el.$$__notifier) {
                notifier = el.$$__notifier;
                removed = notifier.off(eventType, listener, context);
                if (helpers.isEventSupported(el, eventType)) {
                  removed.forEach(function (removedListener) {
                    el.removeEventListener(eventType, removedListener.fnCtx, false);
                  });
                }
              }
            });
            return this;
          },

          emit: function emit(eventType, data) {
            var removed = [];
            this.forEach(function (el) {
              if (el.$$__notifier) {
                removed = el.$$__notifier.emit(eventType, data);
                if (helpers.isEventSupported(el, eventType)) {
                  removed.forEach(function (removedListener) {
                    el.removeEventListener(eventType, removedListener.fnCtx, false);
                  });
                }
              }
            });
            return this;
          },

          emitNative: function emitNative(eventType, properties) {
            emitter.emitNative.call(this, eventType, properties);
            return this;
          },

          emitCustom: function emitCustom(eventType, detail) {
            emitter.emitCustom.call(this, eventType, detail);
            return this;
          }
        };
      })());
    }
  };
});
$__System.register("17", ["8"], function (_export) {
  "use strict";

  var Collection;
  return {
    setters: [function (_) {
      Collection = _["default"];
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
$__System.register("18", ["1f"], function (_export) {
	var _Promise;

	return {
		setters: [function (_f) {
			_Promise = _f["default"];
		}],
		execute: function () {
			"use strict";

			_export("default", (function () {

				/*
    idle
    The current time of the animation is unresolved and there are no pending tasks. In this state the animation has no effect.
    pending
    The animation is waiting on some pending task to complete.
    running
    The animation has a resolved current time that changes on each sample (provided the animation playback rate is not zero).
    paused
    The animation has been suspended and the current time is no longer changing.
    finished
    The animation has reached the natural boundary of its playback range and the current time is no longer updating.	
    */

				var animateElement = function animateElement(el, keyFrames, options) {

					if (el.$$animationHandler) {
						el.$$animationHandler.cancel();
					}

					var finishCallback = null;

					el.$$animationHandler = el.animate(keyFrames, options);

					return new _Promise(function (resolve, reject) {
						finishCallback = function (e) {
							resolve(el.$$animationHandler);
							el.$$animationHandler.removeEventListener("finish", finishCallback, false);
						};
						el.$$animationHandler.addEventListener("finish", finishCallback, false);
					});
				};

				return {

					finish: function finish() {
						this.forEach(function (el) {
							if (el.$$animationHandler) {
								el.$$animationHandler.finish();
							}
						});
						return this;
					},

					isPlaying: function isPlaying() {
						var isPlaying = false;
						for (var i = 0; i < this.length; i++) {
							if (this[0].$$animationHandler && this[0].$$animationHandler.playState == "running") {
								isPlaying = true;
								break;
							}
						}
						return isPlaying;
					},

					pause: function pause() {
						this.forEach(function (el) {
							if (el.$$animationHandler) {
								el.$$animationHandler.pause();
							}
						});
						return this;
					},

					cancel: function cancel() {
						this.forEach(function (el) {
							if (el.$$animationHandler) {
								el.$$animationHandler.cancel();
							}
						});
						return this;
					},

					stop: function stop() {
						this.forEach(function (el) {
							if (el.$$animationHandler && el.$$animationHandler.playState == "running") {
								el.$$animationHandler.stop();
							}
						});
						return this;
					},

					start: function start() {
						this.forEach(function (el) {
							if (el.$$animationHandler && el.$$animationHandler.playState == "paused") {
								el.$$animationHandler.stop();
							}
						});
						return this;
					},

					animate: function animate(keyFrames, options) {

						var allPromises = [];

						var delay = 0;

						if (options.delay !== undefined && options.delay > 0) {
							delay = options.delay;
							options.delay = 0;
						}

						var timerId = window.setTimeout((function () {

							this.emit("animationStart", { target: this, keyFrames: keyFrames, options: options });

							this.forEach(function (el) {
								allPromises.push(animateElement(el, keyFrames, options));
							});

							_Promise.all(allPromises).then((function (e) {
								this.setProperty("$$animationTimer", null);
								this.emit("animationEnd", { target: this, keyFrames: keyFrames, options: options });
							}).bind(this));
						}).bind(this), delay);

						this.setProperty("$$animationTimer", timerId);

						return this;
					}
				};
			})());
		}
	};
});
$__System.register("1a", ["23", "1b", "1c"], function (_export) {
  var emitter, _createClass, _classCallCheck, Notifier;

  return {
    setters: [function (_) {
      emitter = _["default"];
    }, function (_b) {
      _createClass = _b["default"];
    }, function (_c) {
      _classCallCheck = _c["default"];
    }],
    execute: function () {
      "use strict";

      Notifier = (function () {
        function Notifier() {
          _classCallCheck(this, Notifier);

          this.$$subscribers = {};
          this.$$counter = 1;
        }

        _createClass(Notifier, [{
          key: "registerEvent",
          value: function registerEvent(type, callback, ctx, once) {
            ctx = ctx || this;
            this.$$subscribers[type] = this.$$subscribers[type] || [];
            var listener = {
              fn: callback,
              fnCtx: function fnCtx() {
                callback.apply(ctx, [].slice.call(arguments));
              },
              scope: ctx,
              once: once
            };
            this.$$subscribers[type].push(listener);
            return listener;
          }
        }, {
          key: "on",
          value: function on(type, callback, ctx) {
            return this.registerEvent(type, callback, ctx, false);
          }
        }, {
          key: "off",
          value: function off(type, callback, ctx) {
            ctx = ctx || this;
            var removed = [];
            this.$$subscribers[type] = this.$$subscribers[type] || [];
            this.$$subscribers[type] = this.$$subscribers[type].filter(function (subscriber) {
              if (!(subscriber.fn == callback && subscriber.scope == ctx)) {
                removed.push(subscriber);
                return true;
              }
            });
            if (this.$$subscribers[type].length === 0) {
              delete this.$$subscribers[type];
            }
            return removed;
          }
        }, {
          key: "once",
          value: function once(type, callback, ctx) {
            return this.registerEvent(type, callback, ctx, true);
          }
        }, {
          key: "emit",
          value: function emit(type, message) {

            var removed = [];
            this.$$subscribers[type] = this.$$subscribers[type] || [];
            this.$$subscribers[type].forEach(function (subscriber, index) {
              subscriber.fn.call(subscriber.scope, message);
              if (subscriber.once === true) {
                removed.push(subscriber);
              }
            });

            var index = null;
            removed.forEach(function (toRemove) {
              index = this.$$subscribers[type].indexOf(toRemove);
              this.$$subscribers[type].splice(index, 1);
            }, this);

            if (this.$$subscribers[type].length === 0) {
              delete this.$$subscribers[type];
            }

            return removed;
          }
        }, {
          key: "emitNative",
          value: function emitNative(eventName, properties) {
            emitter.emitNative.call(this, eventName, properties);
          }
        }]);

        return Notifier;
      })();

      _export("default", Notifier);
    }
  };
});
$__System.register("1d", ["21", "25", "26", "27", "1b", "1c", "1a", "c"], function (_export) {
  var utils, uriUtils, _inherits, _get, _createClass, _classCallCheck, Notifier, Logger, XHR;

  return {
    setters: [function (_3) {
      utils = _3["default"];
    }, function (_4) {
      uriUtils = _4["default"];
    }, function (_) {
      _inherits = _["default"];
    }, function (_2) {
      _get = _2["default"];
    }, function (_b) {
      _createClass = _b["default"];
    }, function (_c) {
      _classCallCheck = _c["default"];
    }, function (_a) {
      Notifier = _a["default"];
    }, function (_c2) {
      Logger = _c2["default"];
    }],
    execute: function () {
      "use strict";

      XHR = (function (_Notifier) {
        function XHR(method, url, data) {
          _classCallCheck(this, XHR);

          _get(Object.getPrototypeOf(XHR.prototype), "constructor", this).call(this);
          this.init(method, url, data);
        }

        _inherits(XHR, _Notifier);

        _createClass(XHR, [{
          key: "init",
          value: function init(method, url, data) {

            method = method.toUpperCase();

            this.__xhr = window.XMLHttpRequest ? new XMLHttpRequest() : new ActiveXObject("Microsoft.XMLHTTP");
            this.__method = ["POST", "GET"].indexOf(method) != -1 ? method : "GET";
            this.__data = data || null;
            this.__requestHeaders = {};
            this.__response = null;
            this.__timeout = null;
            this.__async = true;
            this.__user = null;
            this.__password = null;
            this.__url = null;

            this.setUrl(url);

            this.__addListeners();
          }
        }, {
          key: "setCredencials",
          value: function setCredencials(user, password) {
            this.__user = user;
            this.__password = password;
          }
        }, {
          key: "setAsync",
          value: function setAsync(async) {
            this.__async = async;
          }
        }, {
          key: "getAsync",
          value: function getAsync() {
            return this.__async;
          }
        }, {
          key: "getMethod",
          value: function getMethod() {
            return this.__method;
          }
        }, {
          key: "setMethod",
          value: function setMethod(method) {
            this.__method = method;
          }
        }, {
          key: "getTimeout",
          value: function getTimeout() {
            return this.__timeout;
          }
        }, {
          key: "setTimeout",
          value: function setTimeout(timeout) {
            this.__timeout = timeout;
          }
        }, {
          key: "setRequestData",
          value: function setRequestData(data) {
            var dataType = utils.getType(data);
            if (dataType == "String" || dataType == "Object") {
              this.__data = data;
            }
            return this;
          }
        }, {
          key: "getRequestData",
          value: function getRequestData() {
            return this.__data;
          }
        }, {
          key: "setRequestHeader",
          value: function setRequestHeader(key, value) {
            this.__requestHeaders[key] = value;
            return this;
          }
        }, {
          key: "getRequestHeader",
          value: function getRequestHeader(key) {
            return this.__requestHeaders[key];
          }
        }, {
          key: "setUrl",
          value: function setUrl(url) {
            if (utils.getType(url) == "String") {
              this.__url = url;
            }
          }
        }, {
          key: "getUrl",
          value: function getUrl() {
            return this.__url;
          }
        }, {
          key: "isSupportedMethod",
          value: function isSupportedMethod(method) {
            return XHR.knownMethods.indexOf(method) != -1;
          }
        }, {
          key: "setCaching",
          value: function setCaching(caching) {
            this.__caching = caching;
          }
        }, {
          key: "isCaching",
          value: function isCaching() {
            return this.__caching === true;
          }
        }, {
          key: "isSuccessful",
          value: function isSuccessful(status) {
            return status >= 200 && status < 300 || status === 304;
          }
        }, {
          key: "getXhr",
          value: function getXhr() {
            return this.__xhr;
          }
        }, {
          key: "send",
          value: function send() {

            var xhr = this.getXhr();
            var curTimeout = this.getTimeout();
            var hasRequestData = this.getRequestData() !== null;
            var hasCacheControlHeader = this.__requestHeaders.hasOwnProperty("Cache-Control");
            var isBodyForMethodAllowed = this._methodAllowsBody(this.getMethod());
            var curContentType = this.getRequestHeader("Content-Type");
            var serializedData = this._serializeData(this.getRequestData(), curContentType);

            // add GET params if needed
            if (this.getMethod() === "GET" && hasRequestData) {
              this.setUrl(uriUtils.appendParamsToUrl(this.getUrl(), serializedData));
            }

            // cache prevention
            if (this.isCaching() === false && !hasCacheControlHeader) {
              // Make sure URL cannot be served from cache and new request is made
              this.setUrl(uriUtils.appendParamsToUrl(this.getUrl(), {
                nocache: new Date().valueOf()
              }));
            }

            // initialize request
            xhr.open(this.getMethod(), this.getUrl(), this.__async);

            // set timeout
            if (curTimeout) {
              xhr.timeout = curTimeout;
            }

            // set all previously stored headers on initialized request
            for (var key in this.__requestHeaders) {
              xhr.setRequestHeader(key, this.__requestHeaders[key]);
            }

            // send
            if (!isBodyForMethodAllowed) {
              // GET & HEAD
              xhr.send();
            } else {
              // POST & PUT ...
              if (typeof curContentType === "undefined") {
                // by default, set content-type urlencoded for requests with body
                xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
              }

              xhr.send(serializedData);
            }

            return this;
          }
        }, {
          key: "abort",
          value: function abort() {
            this.getXhr().abort();
            return this;
          }
        }, {
          key: "_serializeData",

          /**
           * Serializes data.
           *
           * @param data {String|Map} Data to serialize.
           * @param contentType {String?} Content-Type which influences the serialisation.
           * @return {String|null} Serialized data.
           */
          value: function _serializeData(data, contentType) {

            var isPost = this.getMethod() === "POST";
            var isJson = /application\/.*\+?json/.test(contentType);
            var dataType = utils.getType(data);

            if (!data) {
              return null;
            }

            if (dataType == "String") {
              return data;
            }

            if (isJson && (dataType == "Object" || dataType == "Array")) {
              return JSON.stringify(data);
            }

            if (dataType == "Object") {
              return uriUtils.toParameter(data, isPost);
            }

            return null;
          }
        }, {
          key: "_methodAllowsBody",
          value: function _methodAllowsBody(method) {
            return ["GET", "HEAD"].indexOf(method) == -1;
          }
        }, {
          key: "_setResponse",
          value: function _setResponse(response) {
            this.__response = response;
          }
        }, {
          key: "_onReadyStateChange",
          value: function _onReadyStateChange() {
            if (this.getXhr().readyState == 4) {
              this._done();
            }
          }
        }, {
          key: "_done",
          value: function _done() {

            var xhr = this.getXhr();
            var response = xhr.responseText;
            var contentType = xhr.getResponseHeader("Content-Type");

            if (this.isSuccessful(xhr.status)) {
              this._setResponse(this.__parse(response, contentType));
              this.emit("success", xhr);
            } else {
              try {
                this._setResponse(this.__parse(response, contentType));
              } catch (e) {}
              // A remote error failure
              if (xhr.status !== 0) {
                this.emit("fail", xhr);
              }
            }
          }
        }, {
          key: "__parse",
          value: function __parse(response, contentType) {

            var contentTypeOrig = contentType || "";

            // Ignore parameters (e.g. the character set)
            var contentTypeNormalized = contentTypeOrig.replace(/;.*$/, "");

            if (/^application\/(\w|\.)*\+?json$/.test(contentTypeNormalized)) {
              try {
                response = JSON.parse(response);
              } catch (e) {
                Logger.error("Error while parsing JSON body : " + e);
              }
            }

            if (/^application\/xml$/.test(contentTypeNormalized)) {
              try {
                if (window.DOMParser) {
                  response = new DOMParser().parseFromString(response, "text/xml");
                }
                // IE<9
                else {
                  response = new ActiveXObject("Microsoft.XMLDOM");
                  response.async = "false";
                  response.loadXML(response);
                }
              } catch (e) {
                response = undefined;
              }

              if (!response || !response.documentElement || response.getElementsByTagName("parsererror").length) {
                Logger.error("Invalid XML");
              }
            }
          }
        }, {
          key: "_onLoadEnd",
          value: function _onLoadEnd() {
            this.emit("loadEnd", this.getXhr());
          }
        }, {
          key: "_onTimeout",
          value: function _onTimeout() {
            this.emit("timeout", this.getXhr());
            this.emit("fail", this.getXhr());
          }
        }, {
          key: "_onError",
          value: function _onError() {
            this.emit("timeout", this.getXhr());
            this.emit("fail", this.getXhr());
          }
        }, {
          key: "_onAbort",
          value: function _onAbort() {
            this.emit("abort", this.getXhr());
          }
        }, {
          key: "__addListeners",
          value: function __addListeners() {
            var xhr = this.getXhr();
            if (xhr) {
              xhr.onreadystatechange = this._onReadyStateChange.bind(this);
              xhr.onloadend = this._onLoadEnd.bind(this);
              xhr.ontimeout = this._onTimeout.bind(this);
              xhr.onerror = this._onError.bind(this);
              xhr.onabort = this._onAbort.bind(this);
            }
            return this;
          }
        }]);

        return XHR;
      })(Notifier);

      XHR.knownMethods = ["GET", "POST", "PUT", "DELETE", "HEAD", "TRACE", "OPTIONS", "CONNECT", "PATCH"];

      _export("default", XHR);
    }
  };
});

// ignore if it does not work
$__System.register("23", ["21", "22", "2b", "f", "c"], function (_export) {
  var utils, eventHelpers, _Object$values, cssHelpers, Logger;

  return {
    setters: [function (_2) {
      utils = _2["default"];
    }, function (_) {
      eventHelpers = _["default"];
    }, function (_b) {
      _Object$values = _b["default"];
    }, function (_f) {
      cssHelpers = _f["default"];
    }, function (_c) {
      Logger = _c["default"];
    }],
    execute: function () {
      "use strict";

      _export("default", (function () {

        var keyEventSpec = "keyboard";

        (function () {
          var evt = document.createEvent("KeyboardEvent");
          keyEventSpec = evt.initKeyEvent ? "key" : "keyboard";
        })();

        var createTouch = function createTouch(target) {
          return {
            view: window,
            target: target,
            identifier: utils.getUID(),
            pageX: 0,
            pageY: 0,
            screenX: 0,
            screenY: 0
          };
        };

        var addDefaultTouches = function addDefaultTouches(target, eventName, properties) {
          var touch = createTouch(target);
          if (properties.touches.length === 0) {
            properties.touches.push(touch);
          }
          if (properties.targetTouches.length === 0) {
            properties.targetTouches.push(touch);
          }
          if (properties.changedTouches.length === 0) {
            properties.changedTouches.push(touch);
          }
        };

        var isMouseEvent = function isMouseEvent(eventName) {
          return eventName == "click" || eventName == "dbclick" || eventName.indexOf("mouse") === 0;
        };

        var isTouchEvent = function isTouchEvent(eventName) {
          return eventName.indexOf("touch") === 0;
        };

        var isPointerEvent = function isPointerEvent(eventName) {
          return eventName.indexOf("pointer") === 0;
        };

        var isKeyBoardEvent = function isKeyBoardEvent(eventName) {
          return eventName.indexOf("key") === 0;
        };

        var createUIEvent = function createUIEvent(eventName, properties) {
          var evt = null;
          properties = properties || {};
          if (typeof UIEvent != "undefined") {
            try {
              evt = new UIEvent(eventName, properties);
            } catch (err) {
              Logger.info("UIEvent construnctor not supported on, document.createEvent used instead.");
            }
          }
          if (evt === null) {
            evt = document.createEvent("UIEvent");
            evt.initUIEvent.apply(evt, [eventName].concat(_Object$values(properties)));
          }
          return evt;
        };

        var createKeyBoardEvent = function createKeyBoardEvent(eventName, properties) {
          var evt = null;
          properties = properties || {};
          if (typeof KeyboardEvent != "undefined") {
            try {
              evt = new KeyboardEvent(eventName, properties);
            } catch (err) {
              Logger.info("KeyboardEvent construnctor not supported on, document.createEvent used instead.");
            }
          }
          if (evt === null) {
            evt = document.createEvent("KeyboardEvent");
            var init = evt.initKeyEvent || evt.initKeyboardEvent;
            init.apply(evt, [eventName].concat(_Object$values(properties)));
          }
          return evt;
        };

        var createMouseEvent = function createMouseEvent(eventName, properties) {
          var evt = null;
          properties = properties || {};
          if (typeof MouseEvent != "undefined") {
            try {
              evt = new MouseEvent(eventName, properties);
            } catch (err) {
              Logger.info("MouseEvent construnctor not supported on, document.createEvent used instead.");
            }
          }
          if (evt === null) {
            evt = document.createEvent("MouseEvent");
            evt.initMouseEvent.apply(evt, [eventName].concat(_Object$values(properties)));
          }
          return evt;
        };

        var createTouchEvent = function createTouchEvent(target, eventName, properties) {
          var evt = null;
          properties = properties || {};
          properties = addDefaultTouches(target, eventName, properties);

          if (typeof TouchEvent != "undefined") {
            try {
              evt = new TouchEvent(eventName, properties);
            } catch (err) {
              Logger.info("TouchEvent construnctor not supported on, document.createEvent used instead.");
            }
          }

          if (evt === null) {
            evt = document.createEvent("TouchEvent");
            evt.initTouchEvent.apply(evt, [eventName].concat(_Object$values(properties)));
          }

          return evt;
        };

        var createPointerEvent = function createPointerEvent(eventName, properties) {

          var evt = null;
          properties = properties || {};

          if (typeof PointerEvent != "undefined") {
            try {
              evt = new PointerEvent(eventName, properties);
            } catch (err) {
              Logger.info("PointerEvent construnctor not supported on, document.createEvent used instead.");
            }
          }

          if (evt === null) {
            evt = document.createEvent("PointerEvent");
            evt.initPointerEvent.apply(evt, [eventName].concat(_Object$values(properties)));
          }

          return evt;
        };

        var createEvent = function createEvent(item, eventName, properties) {
          if (isMouseEvent(eventName)) {
            return createMouseEvent(eventName, properties);
          } else if (isTouchEvent(eventName)) {
            return createTouchEvent(item, eventName, properties);
          } else if (isPointerEvent(eventName)) {
            return createPointerEvent(eventName, properties);
          } else if (isKeyBoardEvent(eventName)) {
            return createKeyBoardEvent(eventName, properties);
          } else {
            return createUIEvent(eventName, properties);
          }
        };

        return {

          emitNative: function emitNative(eventName, properties) {
            properties = properties || {};
            this.forEach(function (item) {
              if (eventHelpers.isEventSupported(item, eventName)) {
                var evt = createEvent(item, eventName, properties);
                item.dispatchEvent(evt);
              } else {
                Logger.error(eventName + " not supported on " + item);
              }
            });
            return this;
          },

          emitCustom: function emitCustom(eventName, data) {
            data = data || {};
            this.forEach(function (item) {
              item.dispatchEvent(new CustomEvent(eventName, data));
            });
            return this;
          }

        };
      })());
    }
  };
});
$__System.register("21", [], function (_export) {
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

        getType: function getType(value) {
          return this.getClass(value);
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
$__System.register("22", [], function (_export) {
  "use strict";

  return {
    setters: [],
    execute: function () {
      _export("default", {

        isEventSupported: function isEventSupported(target, eventName) {
          eventName = "on" + eventName;
          var isSupported = (eventName in target);
          if (!isSupported) {
            target.setAttribute(eventName, "return;");
            isSupported = typeof target[eventName] == "function";
            target.removeAttribute(eventName);
          }
          return isSupported;
        }

      });
    }
  };
});
$__System.register("25", ["21", "c"], function (_export) {
  "use strict";

  var utils, Logger;
  return {
    setters: [function (_) {
      utils = _["default"];
    }, function (_c) {
      Logger = _c["default"];
    }],
    execute: function () {
      _export("default", {

        /**
         * Split URL
         *
         * Code taken from:
         *   parseUri 1.2.2
         *   (c) Steven Levithan <stevenlevithan.com>
         *   MIT License
         *
         *
         * @param str {String} String to parse as URI
         * @param strict {Boolean} Whether to parse strictly by the rules
         * @return {Object} Map with parts of URI as properties
         */
        parseUri: function parseUri(str, strict) {

          var options = {
            key: ["source", "protocol", "authority", "userInfo", "user", "password", "host", "port", "relative", "path", "directory", "file", "query", "anchor"],
            q: {
              name: "queryKey",
              parser: /(?:^|&)([^&=]*)=?([^&]*)/g
            },
            parser: {
              strict: /^(?:([^:\/?#]+):)?(?:\/\/((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?))?((((?:[^?#\/]*\/)*)([^?#]*))(?:\?([^#]*))?(?:#(.*))?)/,
              loose: /^(?:(?![^:@]+:[^:@\/]*@)([^:\/?#.]+):)?(?:\/\/)?((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/
            }
          };

          var o = options,
              m = options.parser[strict ? "strict" : "loose"].exec(str),
              uri = {},
              i = 14;

          while (i--) {
            uri[o.key[i]] = m[i] || "";
          }
          uri[o.q.name] = {};
          uri[o.key[12]].replace(o.q.parser, function ($0, $1, $2) {
            if ($1) {
              uri[o.q.name][$1] = $2;
            }
          });

          return uri;
        },

        /**
         * Append string to query part of URL. Respects existing query.
         *
         * @param url {String} URL to append string to.
         * @param params {String} Parameters to append to URL.
         * @return {String} URL with string appended in query part.
         */
        appendParamsToUrl: function appendParamsToUrl(url, params) {

          if (params === undefined) {
            return url;
          }

          var paramType = utils.getType(params);

          if (!(paramType == "String" || paramType == "Object")) {
            Logger.error("params must be either string or object");
          }

          if (paramType == "Object") {
            params = this.toParameter(params);
          }

          if (!params) {
            return url;
          }

          return url += /\?/.test(url) ? "&" + params : "?" + params;
        },

        /**
         * Serializes an object to URI parameters (also known as query string).
         *
         * Escapes characters that have a special meaning in URIs as well as
         * umlauts. Uses the global function encodeURIComponent, see
         * https://developer.mozilla.org/en-US/docs/JavaScript/Reference/Global_Objects/encodeURIComponent
         *
         * Note: For URI parameters that are to be sent as
         * application/x-www-form-urlencoded (POST), spaces should be encoded
         * with "+".
         *
         * @param obj {Object}   Object to serialize.
         * @param post {Boolean} Whether spaces should be encoded with "+".
         * @return {String}      Serialized object. Safe to append to URIs or send as
         *                       URL encoded string.
         */
        toParameter: function toParameter(obj, post) {
          var key,
              parts = [];

          for (key in obj) {
            if (obj.hasOwnProperty(key)) {
              var value = obj[key];
              if (value instanceof Array) {
                for (var i = 0; i < value.length; i++) {
                  this.__toParameterPair(key, value[i], parts, post);
                }
              } else {
                this.__toParameterPair(key, value, parts, post);
              }
            }
          }

          return parts.join("&");
        },

        /**
         * Encodes key/value to URI safe string and pushes to given array.
         *
         * @param key {String} Key.
         * @param value {String} Value.
         * @param parts {Array} Array to push to.
         * @param post {Boolean} Whether spaces should be encoded with "+".
         */
        __toParameterPair: function __toParameterPair(key, value, parts, post) {
          var encode = window.encodeURIComponent;
          if (post) {
            parts.push(encode(key).replace(/%20/g, "+") + "=" + encode(value).replace(/%20/g, "+"));
          } else {
            parts.push(encode(key) + "=" + encode(value));
          }
        },

        /**
         * Takes a relative URI and returns an absolute one.
         *
         * @param uri {String} relative URI
         * @return {String} absolute URI
         */
        getAbsolute: function getAbsolute(uri) {
          var div = document.createElement("div");
          div.innerHTML = "<a href=\"" + uri + "\">0</a>";
          return div.firstChild.href;
        }

      });
    }
  };
});
})
(function(factory) {
  factory();
});
//# sourceMappingURL=scope.js.map
!function(e){function t(e){for(var t=[],r=0,n=e.length;n>r;r++)-1==f.call(t,e[r])&&t.push(e[r]);return t}function r(e,r,n,o){if("string"!=typeof e)throw"System.register provided no module name";var i;i="boolean"==typeof n?{declarative:!1,deps:r,execute:o,executingRequire:n}:{declarative:!0,deps:r,declare:n},i.name=e,e in d||(d[e]=i),i.deps=t(i.deps),i.normalizedDeps=i.deps}function n(e,t){if(t[e.groupIndex]=t[e.groupIndex]||[],-1==f.call(t[e.groupIndex],e)){t[e.groupIndex].push(e);for(var r=0,o=e.normalizedDeps.length;o>r;r++){var i=e.normalizedDeps[r],s=d[i];if(s&&!s.evaluated){var a=e.groupIndex+(s.declarative!=e.declarative);if(void 0===s.groupIndex||s.groupIndex<a){if(void 0!==s.groupIndex&&(t[s.groupIndex].splice(f.call(t[s.groupIndex],s),1),0==t[s.groupIndex].length))throw new TypeError("Mixed dependency cycle detected");s.groupIndex=a}n(s,t)}}}}function o(e){var t=d[e];t.groupIndex=0;var r=[];n(t,r);for(var o=!!t.declarative==r.length%2,i=r.length-1;i>=0;i--){for(var a=r[i],u=0;u<a.length;u++){var l=a[u];o?s(l):c(l)}o=!o}}function i(e){return p[e]||(p[e]={name:e,dependencies:[],exports:{},importers:[]})}function s(t){if(!t.module){var r=t.module=i(t.name),n=t.module.exports,o=t.declare.call(e,function(e,t){r.locked=!0,n[e]=t;for(var o=0,i=r.importers.length;i>o;o++){var s=r.importers[o];if(!s.locked){var a=f.call(s.dependencies,r);s.setters[a](n)}}return r.locked=!1,t});if(r.setters=o.setters,r.execute=o.execute,!r.setters||!r.execute)throw new TypeError("Invalid System.register form for "+t.name);for(var a=0,c=t.normalizedDeps.length;c>a;a++){var u,h=t.normalizedDeps[a],v=d[h],b=p[h];b?u=b.exports:v&&!v.declarative?u=v.module.exports&&v.module.exports.__esModule?v.module.exports:{"default":v.module.exports,__useDefault:!0}:v?(s(v),b=v.module,u=b.exports):u=l(h),b&&b.importers?(b.importers.push(r),r.dependencies.push(b)):r.dependencies.push(null),r.setters[a]&&r.setters[a](u)}}}function a(e){var t,r=d[e];if(r)r.declarative?u(e,[]):r.evaluated||c(r),t=r.module.exports;else if(t=l(e),!t)throw new Error("Unable to load dependency "+e+".");return(!r||r.declarative)&&t&&t.__useDefault?t["default"]:t}function c(t){if(!t.module){var r={},n=t.module={exports:r,id:t.name};if(!t.executingRequire)for(var o=0,i=t.normalizedDeps.length;i>o;o++){var s=t.normalizedDeps[o],u=d[s];u&&c(u)}t.evaluated=!0;var l=t.execute.call(e,function(e){for(var r=0,n=t.deps.length;n>r;r++)if(t.deps[r]==e)return a(t.normalizedDeps[r]);throw new TypeError("Module "+e+" not declared as a dependency.")},r,n);l&&(n.exports=l)}}function u(t,r){var n=d[t];if(n&&!n.evaluated&&n.declarative){r.push(t);for(var o=0,i=n.normalizedDeps.length;i>o;o++){var s=n.normalizedDeps[o];-1==f.call(r,s)&&(d[s]?u(s,r):l(s))}n.evaluated||(n.evaluated=!0,n.module.execute.call(e))}}function l(e){if(h[e])return h[e];var t=d[e];if(!t)throw"Module "+e+" not present.";o(e),u(e,[]),d[e]=void 0;var r=t.module.exports;return(!r||!t.declarative&&r.__esModule!==!0)&&(r={"default":r,__useDefault:!0}),h[e]=r}var d={},f=Array.prototype.indexOf||function(e){for(var t=0,r=this.length;r>t;t++)if(this[t]===e)return t;return-1},p={},h={};return function(t,n){var o,o={register:r,get:l,set:function(e,t){h[e]=t},newModule:function(e){return e},global:e};o.set("@empty",{}),n(o);for(var i=0;i<t.length;i++)l(t[i])}}("undefined"!=typeof window?window:global)(["lib/objectobserve"],function(e){e.register("npm:core-js@0.9.18/library/modules/$.fw",[],!0,function(require,t,r){var n=e.global,o=n.define;return n.define=void 0,r.exports=function(e){return e.FW=!1,e.path=e.core,e},n.define=o,r.exports}),e.register("npm:core-js@0.9.18/library/modules/$.def",["npm:core-js@0.9.18/library/modules/$"],!0,function(require,t,r){function n(e,t){return function(){return e.apply(t,arguments)}}function o(e,t,r){var s,a,l,d,f=e&o.G,p=e&o.P,h=f?i:e&o.S?i[t]:(i[t]||{}).prototype,v=f?c:c[t]||(c[t]={});f&&(r=t);for(s in r)a=!(e&o.F)&&h&&s in h,a&&s in v||(l=a?h[s]:r[s],f&&!u(h[s])?d=r[s]:e&o.B&&a?d=n(l,i):e&o.W&&h[s]==l?!function(e){d=function(t){return this instanceof e?new e(t):e(t)},d.prototype=e.prototype}(l):d=p&&u(l)?n(Function.call,l):l,v[s]=d,p&&((v.prototype||(v.prototype={}))[s]=l))}var i=e.global,s=i.define;i.define=void 0;var a=require("npm:core-js@0.9.18/library/modules/$"),i=a.g,c=a.core,u=a.isFunction;return o.F=1,o.G=2,o.S=4,o.P=8,o.B=16,o.W=32,r.exports=o,i.define=s,r.exports}),e.register("npm:core-js@0.9.18/library/modules/$.get-names",["npm:core-js@0.9.18/library/modules/$"],!0,function(require,t,r){function n(e){try{return c(e)}catch(t){return u.slice()}}var o=e.global,i=o.define;o.define=void 0;var s=require("npm:core-js@0.9.18/library/modules/$"),a={}.toString,c=s.getNames,u="object"==typeof window&&Object.getOwnPropertyNames?Object.getOwnPropertyNames(window):[];return r.exports.get=function(e){return u&&"[object Window]"==a.call(e)?n(e):c(s.toObject(e))},o.define=i,r.exports}),e.register("npm:core-js@0.9.18/library/fn/object/create",["npm:core-js@0.9.18/library/modules/$"],!0,function(require,t,r){var n=e.global,o=n.define;n.define=void 0;var i=require("npm:core-js@0.9.18/library/modules/$");return r.exports=function(e,t){return i.create(e,t)},n.define=o,r.exports}),e.register("npm:core-js@0.9.18/library/fn/object/get-own-property-names",["npm:core-js@0.9.18/library/modules/$","npm:core-js@0.9.18/library/modules/es6.object.statics-accept-primitives"],!0,function(require,t,r){var n=e.global,o=n.define;n.define=void 0;var i=require("npm:core-js@0.9.18/library/modules/$");return require("npm:core-js@0.9.18/library/modules/es6.object.statics-accept-primitives"),r.exports=function(e){return i.getNames(e)},n.define=o,r.exports}),e.register("npm:core-js@0.9.18/library/fn/object/define-property",["npm:core-js@0.9.18/library/modules/$"],!0,function(require,t,r){var n=e.global,o=n.define;n.define=void 0;var i=require("npm:core-js@0.9.18/library/modules/$");return r.exports=function(e,t,r){return i.setDesc(e,t,r)},n.define=o,r.exports}),e.register("npm:core-js@0.9.18/library/fn/object/get-own-property-descriptor",["npm:core-js@0.9.18/library/modules/$","npm:core-js@0.9.18/library/modules/es6.object.statics-accept-primitives"],!0,function(require,t,r){var n=e.global,o=n.define;n.define=void 0;var i=require("npm:core-js@0.9.18/library/modules/$");return require("npm:core-js@0.9.18/library/modules/es6.object.statics-accept-primitives"),r.exports=function(e,t){return i.getDesc(e,t)},n.define=o,r.exports}),e.register("npm:core-js@0.9.18/library/fn/object/define-properties",["npm:core-js@0.9.18/library/modules/$"],!0,function(require,t,r){var n=e.global,o=n.define;n.define=void 0;var i=require("npm:core-js@0.9.18/library/modules/$");return r.exports=function(e,t){return i.setDescs(e,t)},n.define=o,r.exports}),e.register("npm:core-js@0.9.18/library/modules/$",["npm:core-js@0.9.18/library/modules/$.fw"],!0,function(require,t,r){function n(e){return isNaN(e=+e)?0:(e>0?b:v)(e)}function o(e,t){return{enumerable:!(1&e),configurable:!(2&e),writable:!(4&e),value:t}}function i(e,t,r){return e[t]=r,e}function s(e){return g?function(t,r,n){return j.setDesc(t,r,o(e,n))}:i}function a(e){return null!==e&&("object"==typeof e||"function"==typeof e)}function c(e){return"function"==typeof e}function u(e){if(void 0==e)throw TypeError("Can't call method on  "+e);return e}var l=e.global,d=l.define;l.define=void 0;var l="undefined"!=typeof self?self:Function("return this")(),f={},p=Object.defineProperty,h={}.hasOwnProperty,v=Math.ceil,b=Math.floor,m=Math.max,_=Math.min,g=!!function(){try{return 2==p({},"a",{get:function(){return 2}}).a}catch(e){}}(),y=s(1),j=r.exports=require("npm:core-js@0.9.18/library/modules/$.fw")({g:l,core:f,html:l.document&&document.documentElement,isObject:a,isFunction:c,that:function(){return this},toInteger:n,toLength:function(e){return e>0?_(n(e),9007199254740991):0},toIndex:function(e,t){return e=n(e),0>e?m(e+t,0):_(e,t)},has:function(e,t){return h.call(e,t)},create:Object.create,getProto:Object.getPrototypeOf,DESC:g,desc:o,getDesc:Object.getOwnPropertyDescriptor,setDesc:p,setDescs:Object.defineProperties,getKeys:Object.keys,getNames:Object.getOwnPropertyNames,getSymbols:Object.getOwnPropertySymbols,assertDefined:u,ES5Object:Object,toObject:function(e){return j.ES5Object(u(e))},hide:y,def:s(0),set:l.Symbol?i:y,each:[].forEach});return"undefined"!=typeof __e&&(__e=f),"undefined"!=typeof __g&&(__g=l),l.define=d,r.exports}),e.register("npm:babel-runtime@5.4.7/core-js/object/create",["npm:core-js@0.9.18/library/fn/object/create"],!0,function(require,t,r){var n=e.global,o=n.define;return n.define=void 0,r.exports={"default":require("npm:core-js@0.9.18/library/fn/object/create"),__esModule:!0},n.define=o,r.exports}),e.register("npm:babel-runtime@5.4.7/core-js/object/get-own-property-names",["npm:core-js@0.9.18/library/fn/object/get-own-property-names"],!0,function(require,t,r){var n=e.global,o=n.define;return n.define=void 0,r.exports={"default":require("npm:core-js@0.9.18/library/fn/object/get-own-property-names"),__esModule:!0},n.define=o,r.exports}),e.register("npm:babel-runtime@5.4.7/core-js/object/define-property",["npm:core-js@0.9.18/library/fn/object/define-property"],!0,function(require,t,r){var n=e.global,o=n.define;return n.define=void 0,r.exports={"default":require("npm:core-js@0.9.18/library/fn/object/define-property"),__esModule:!0},n.define=o,r.exports}),e.register("npm:babel-runtime@5.4.7/core-js/object/get-own-property-descriptor",["npm:core-js@0.9.18/library/fn/object/get-own-property-descriptor"],!0,function(require,t,r){var n=e.global,o=n.define;return n.define=void 0,r.exports={"default":require("npm:core-js@0.9.18/library/fn/object/get-own-property-descriptor"),__esModule:!0},n.define=o,r.exports}),e.register("npm:babel-runtime@5.4.7/core-js/object/define-properties",["npm:core-js@0.9.18/library/fn/object/define-properties"],!0,function(require,t,r){var n=e.global,o=n.define;return n.define=void 0,r.exports={"default":require("npm:core-js@0.9.18/library/fn/object/define-properties"),__esModule:!0},n.define=o,r.exports}),e.register("npm:core-js@0.9.18/library/modules/es6.object.statics-accept-primitives",["npm:core-js@0.9.18/library/modules/$","npm:core-js@0.9.18/library/modules/$.def","npm:core-js@0.9.18/library/modules/$.get-names"],!0,function(require,t,r){var n=e.global,o=n.define;n.define=void 0;var i=require("npm:core-js@0.9.18/library/modules/$"),s=require("npm:core-js@0.9.18/library/modules/$.def"),a=i.isObject,c=i.toObject;return i.each.call("freeze,seal,preventExtensions,isFrozen,isSealed,isExtensible,getOwnPropertyDescriptor,getPrototypeOf,keys,getOwnPropertyNames".split(","),function(e,t){var r=(i.core.Object||{})[e]||Object[e],n=0,o={};o[e]=0==t?function(e){return a(e)?r(e):e}:1==t?function(e){return a(e)?r(e):e}:2==t?function(e){return a(e)?r(e):e}:3==t?function(e){return a(e)?r(e):!0}:4==t?function(e){return a(e)?r(e):!0}:5==t?function(e){return a(e)?r(e):!1}:6==t?function(e,t){return r(c(e),t)}:7==t?function(e){return r(Object(i.assertDefined(e)))}:8==t?function(e){return r(c(e))}:require("npm:core-js@0.9.18/library/modules/$.get-names").get;try{r("z")}catch(u){n=1}s(s.S+s.F*n,"Object",o)}),n.define=o,r.exports}),e.register("npm:core-js@0.9.18/library/fn/object/keys",["npm:core-js@0.9.18/library/modules/es6.object.statics-accept-primitives","npm:core-js@0.9.18/library/modules/$"],!0,function(require,t,r){var n=e.global,o=n.define;return n.define=void 0,require("npm:core-js@0.9.18/library/modules/es6.object.statics-accept-primitives"),r.exports=require("npm:core-js@0.9.18/library/modules/$").core.Object.keys,n.define=o,r.exports}),e.register("npm:babel-runtime@5.4.7/core-js/object/keys",["npm:core-js@0.9.18/library/fn/object/keys"],!0,function(require,t,r){var n=e.global,o=n.define;return n.define=void 0,r.exports={"default":require("npm:core-js@0.9.18/library/fn/object/keys"),__esModule:!0},n.define=o,r.exports}),e.register("lib/utils",[],function(e){"use strict";return{setters:[],execute:function(){e("default",{classToTypeMap:{"[object String]":"String","[object Array]":"Array","[object Object]":"Object","[object RegExp]":"RegExp","[object Number]":"Number","[object Boolean]":"Boolean","[object Date]":"Date","[object Function]":"Function","[object Error]":"Error"},arrayChanges:function(e,t){var r=[],n=[],o=function(e,t,o){var i=e+"_"+t;if(-1==n.indexOf(i)){var s={name:t,type:e};"undefined"!=typeof o&&(s.oldValue=o),r.push(s)}};if(e.length!=t.length){if(r.push({name:"length",type:"update",oldValue:e.length}),e.length<t.length)for(var i=e.length,s=t.length;s>i;i++)void 0!==t[i]&&o("add",i+"");if(e.length>t.length)for(var a=t.length;a<e.length;a++)o("delete",a+"",e[a])}for(var c=0,u=e.length;u>c;c++)"undefined"!=typeof t[c]?this.equals(e[c],t[c])||o("update",c+"",e[c]):e.length==t.length&&o("delete",c+"",e[c]);return r},getClass:function(e){if(void 0===e)return"Undefined";if(null===e)return"Null";var t=Object.prototype.toString.call(e);return this.classToTypeMap[t]||t.slice(8,-1)},getUID:function(){return((new Date).getTime()+""+Math.floor(1e6*Math.random())).substr(0,18)},isFunction:function(e){return"function"==typeof e},equals:function(e,t){return this.__equals(e,t,[],[])},isObject:function(e){return"[object Object]"==Object.prototype.toString.call(e)},isDate:function(e){return"[object Date]"==Object.prototype.toString.call(e)},camelCase:function(e){return(e||"").toLowerCase().replace(/(-)\w/g,function(e){return e.toUpperCase().replace(/-/,"")})},hyphenate:function(e){return e.replace(/\s/g,"-").toLowerCase()},__equals:function(e,t,r,n){if(e===t)return 0!==e||1/e==1/t;if(null===e||null===t)return e===t;var o=Object.prototype.toString.call(e);if(o!=Object.prototype.toString.call(t))return!1;switch(o){case"[object String]":return e==String(t);case"[object Number]":return e!=+e?t!=+t:0===e?1/e==1/t:e==+t;case"[object Date]":case"[object Boolean]":return+e==+t;case"[object RegExp]":return e.source==t.source&&e.global==t.global&&e.multiline==t.multiline&&e.ignoreCase==t.ignoreCase}if("object"!=typeof e||"object"!=typeof t)return!1;for(var i=r.length;i--;)if(r[i]==e)return n[i]==t;var s=e.constructor,a=t.constructor;if(s!==a&&!(this.isFunction(s)&&s instanceof s&&this.isFunction(a)&&a instanceof a)&&"constructor"in e&&"constructor"in t)return!1;r.push(e),n.push(t);var c=0,u=!0;if("[object Array]"==o){if(c=e.length,u=c==t.length)for(;c--&&(u=this.__equals(e[c],t[c],r,n)););}else{for(var l in e)if(Object.prototype.hasOwnProperty.call(e,l)&&(c++,!(u=Object.prototype.hasOwnProperty.call(t,l)&&this.__equals(e[l],t[l],r,n))))break;if(u){for(l in t)if(Object.prototype.hasOwnProperty.call(t,l)&&!c--)break;u=!c}}return r.pop(),n.pop(),u}})}}}),e.register("lib/dirtycheck/animationFrame",["lib/dirtycheck/dirtycheck"],function(e){"use strict";var t;return{setters:[function(e){t=e["default"]}],execute:function(){e("default",function(){for(var e=!1,r=0,n=["webkit","moz"],o=0;o<n.length&&!window.requestAnimationFrame;++o)window.requestAnimationFrame=window[n[o]+"RequestAnimationFrame"],window.cancelAnimationFrame=window[n[o]+"CancelAnimationFrame"]||window[n[o]+"CancelRequestAnimationFrame"];if(e="undefined"!=typeof window.requestAnimationFrame,window.requestAnimationFrame||(window.requestAnimationFrame=function(e,t){var n=(new Date).getTime(),o=Math.max(0,16-(n-r)),i=window.setTimeout(function(){e(n+o)},o);return r=n+o,i}),window.cancelAnimationFrame||(window.cancelAnimationFrame=function(e){clearTimeout(e)}),!Observer.hasObjectObserve){var i=window.requestAnimationFrame;window.requestAnimationFrame=function(e,r){var n=function(){e(),t.executeHooks()};i.call(this,n,r)};var s=window.cancelAnimationFrame;window.cancelAnimationFrame=function(e){s.apply(this,arguments),t.executeHooks()}}}())}}}),e.register("lib/dirtycheck/eventListener",["lib/utils","lib/dirtycheck/dirtycheck"],function(e){"use strict";var t,r;return{setters:[function(e){t=e["default"]},function(e){r=e["default"]}],execute:function(){e("default",function(){Observer.hasObjectObserve||([window,document,Element.prototype].forEach(function(e){var t=e.addEventListener;e.addEventListener=function(e,n,o){if(o="undefined"==typeof o?!1:o,this&&"function"==typeof n){this.$$__observers=this.$$__observers||{},this.$$__observers[e]||(this.$$__observers[e]=[]);var i=function(){n.apply(this,[].slice.call(arguments)),r.executeHooks()};this.$$__observers[e].push({callback:i,type:e,listener:n,useCapture:o}),t.call(this,e,i,o)}else t.call(this,e,n,o)}}),[window,document,Element.prototype].forEach(function(e){var t=e.removeEventListener;e.removeEventListener=function(e,r,n){var o=[];n="undefined"==typeof n?!1:n,"function"==typeof r&&this.$$__observers&&this.$$__observers[e]&&(this.$$__observers[e].forEach(function(i){i.type==e&&i.listener==r&&i.useCapture==n&&(o.push(i),t.call(this,e,i.callback,n))},this),o.forEach(function(t){var r=this.$$__observers[e].indexOf(t);this.$$__observers[e].splice(r,1)},this),0===this.$$__observers[e].length&&delete this.$$__observers[e]),t.apply(this,arguments)}}))}())}}}),e.register("lib/dirtycheck/xhr",["lib/dirtycheck/dirtycheck"],function(e){"use strict";var t;return{setters:[function(e){t=e["default"]}],execute:function(){e("default",function(){Observer.hasObjectObserve||!function(e){XMLHttpRequest.prototype.send=function(){var r=this.onreadystatechange,n=function(){r(),t.executeHooks()};this.onreadystatechange=n,e.apply(this,arguments)}}(XMLHttpRequest.prototype.send)}())}}}),e.register("lib/dirtycheck/timers",["lib/dirtycheck/dirtycheck"],function(e){"use strict";var t;return{setters:[function(e){t=e["default"]}],execute:function(){e("default",function(){Observer.hasObjectObserve||(window.nativeSetTimeout=window.setTimeout,window.nativeSetInterval=window.setInterval,window.setTimeout=function(e,r){window.nativeSetTimeout(function(){e.apply(this,[].slice.call(arguments)),t.executeHooks()},r)},window.setInterval=function(e,r){window.nativeSetInterval(function(){e.apply(this,[].slice.call(arguments)),t.executeHooks()},r)})}())}}}),e.register("lib/polyfill/object",["npm:babel-runtime@5.4.7/core-js/object/keys"],function(e){var t;return{setters:[function(e){t=e["default"]}],execute:function(){"use strict";e("default",function(){t||(t=function(){var e=Object.prototype.hasOwnProperty,t=!{toString:null}.propertyIsEnumerable("toString"),r=["toString","toLocaleString","valueOf","hasOwnProperty","isPrototypeOf","propertyIsEnumerable","constructor"],n=r.length;return function(o){if("object"!=typeof o&&("function"!=typeof o||null===o))throw new TypeError("Object.keys called on non-object");var i,s,a=[];for(i in o)e.call(o,i)&&a.push(i);if(t)for(s=0;n>s;s++)e.call(o,r[s])&&a.push(r[s]);return a}}()),Object.changes||(Object.changes=function(e,t){var r,n={},o={},i={},s="$$__";for(r in e)if(0!==r.indexOf(s)){var a=t[r];(void 0===a||a!==e[r])&&(r in t?a!==e[r]&&(i[r]=a):o[r]=void 0)}for(r in t)0!==r.indexOf(s)&&(r in e||(n[r]=t[r]));return Array.isArray(t)&&t.length!==e.length&&(i.length=t.length),{added:n,removed:o,changed:i}})}())}}}),e.register("lib/dirtycheck/dirtycheck",["lib/utils"],function(e){"use strict";var t;return{setters:[function(e){t=e["default"]}],execute:function(){e("default",function(){var e=[Platform.performMicrotaskCheckpoint],t=function(){e.forEach(function(e){e()})},r=function(){Observer.hasObjectObserve||t()};return{executeHooks:r,wrapFunction:function(e){return function(){e(),r()}}}}())}}}),e.register("lib/observe-js",["npm:babel-runtime@5.4.7/core-js/object/create","npm:babel-runtime@5.4.7/core-js/object/get-own-property-names","npm:babel-runtime@5.4.7/core-js/object/define-property","npm:babel-runtime@5.4.7/core-js/object/get-own-property-descriptor","npm:babel-runtime@5.4.7/core-js/object/define-properties"],function(e){var t,r,n,o,i;return{setters:[function(e){t=e["default"]},function(e){r=e["default"]},function(e){n=e["default"]},function(e){o=e["default"]},function(e){i=e["default"]}],execute:function(){"use strict";e("default",function(e){function s(){function e(e){t=e}if("function"!=typeof Object.observe||"function"!=typeof Array.observe)return!1;var t=[],r={},n=[];return Object.observe(r,e),Array.observe(n,e),r.id=1,r.id=2,delete r.id,n.push(1,2),n.length=0,Object.deliverChangeRecords(e),5!==t.length?!1:"add"!=t[0].type||"update"!=t[1].type||"delete"!=t[2].type||"splice"!=t[3].type||"splice"!=t[4].type?!1:(Object.unobserve(r,e),Array.unobserve(n,e),!0)}function a(){if("undefined"!=typeof chrome&&chrome.app&&chrome.app.runtime)return!1;if("undefined"!=typeof navigator&&navigator.getDeviceStorage)return!1;try{var e=new Function("","return true;");return e()}catch(t){return!1}}function c(e){return+e===e>>>0&&""!==e}function u(e){return+e}function l(e){return e===Object(e)}function d(e,t){return e===t?0!==e||1/e===1/t:W(e)&&W(t)?!0:e!==e&&t!==t}function f(e){if(void 0===e)return"eof";var t=e.charCodeAt(0);switch(t){case 91:case 93:case 46:case 34:case 39:case 48:return e;case 95:case 36:return"ident";case 32:case 9:case 10:case 13:case 160:case 65279:case 8232:case 8233:return"ws"}return t>=97&&122>=t||t>=65&&90>=t?"ident":t>=49&&57>=t?"number":"else"}function p(){}function h(e){function t(){if(!(l>=e.length)){var t=e[l+1];return"inSingleQuote"==d&&"'"==t||"inDoubleQuote"==d&&'"'==t?(l++,n=t,h.append(),!0):void 0}}for(var r,n,o,i,s,a,c,u=[],l=-1,d="beforePath",h={push:function(){void 0!==o&&(u.push(o),o=void 0)},append:function(){void 0===o?o=n:o+=n}};d;)if(l++,r=e[l],"\\"!=r||!t(d)){if(i=f(r),c=Y[d],s=c[i]||c["else"]||"error","error"==s)return;if(d=s[0],a=h[s[1]]||p,n=void 0===s[2]?r:s[2],a(),"afterPath"===d)return u}}function v(e){return K.test(e)}function b(e,t){if(t!==ee)throw Error("Use Path.get to retrieve path objects");for(var r=0;r<e.length;r++)this.push(String(e[r]));G&&this.length&&(this.getValueFrom=this.compiledGetValueFromFn())}function m(e){if(e instanceof b)return e;if((null==e||0==e.length)&&(e=""),"string"!=typeof e){if(c(e.length))return new b(e,ee);e=String(e)}var t=te[e];if(t)return t;var r=h(e);if(!r)return re;var t=new b(r,ee);return te[e]=t,t}function _(e){return c(e)?"["+e+"]":'["'+e.replace(/"/g,'\\"')+'"]'}function g(t){for(var r=0;oe>r&&t.check_();)r++;return U&&(e.dirtyCheckCycleCount=r),r>0}function y(e){for(var t in e)return!1;return!0}function j(e){return y(e.added)&&y(e.removed)&&y(e.changed)}function O(e,t){var r={},n={},o={};for(var i in t){var s=e[i];(void 0===s||s!==t[i])&&(i in e?s!==t[i]&&(o[i]=s):n[i]=void 0)}for(var i in e)i in t||(r[i]=e[i]);return Array.isArray(e)&&e.length!==t.length&&(o.length=e.length),{added:r,removed:n,changed:o}}function w(){if(!ie.length)return!1;for(var e=0;e<ie.length;e++)ie[e]();return ie.length=0,!0}function x(){function e(e){t&&t.state_===le&&!n&&t.check_(e)}var t,r,n=!1,o=!0;return{open:function(r){if(t)throw Error("ObservedObject in use");o||Object.deliverChangeRecords(e),t=r,o=!1},observe:function(t,n){r=t,n?Array.observe(r,e):Object.observe(r,e)},deliver:function(t){n=t,Object.deliverChangeRecords(e),n=!1},close:function(){t=void 0,Object.unobserve(r,e),ae.push(this)}}}function $(e,t,r){var n=ae.pop()||x();return n.open(e),n.observe(t,r),n}function k(){function e(t,i){t&&(t===n&&(o[i]=!0),a.indexOf(t)<0&&(a.push(t),Object.observe(t,r)),e(Object.getPrototypeOf(t),i))}function t(e){for(var t=0;t<e.length;t++){var r=e[t];if(r.object!==n||o[r.name]||"setPrototype"===r.type)return!1}return!0}function r(r){if(!t(r)){for(var n,o=0;o<s.length;o++)n=s[o],n.state_==le&&n.iterateObjects_(e);for(var o=0;o<s.length;o++)n=s[o],n.state_==le&&n.check_()}}var n,o,i=0,s=[],a=[],c={object:void 0,objects:a,open:function(t,r){n||(n=r,o={}),s.push(t),i++,t.iterateObjects_(e)},close:function(e){if(i--,!(i>0)){for(var t=0;t<a.length;t++)Object.unobserve(a[t],r),C.unobservedCount++;s.length=0,a.length=0,n=void 0,o=void 0,ce.push(this)}}};return c}function E(e,t){return ne&&ne.object===t||(ne=ce.pop()||k(),ne.object=t),ne.open(e,t),ne}function C(){this.state_=ue,this.callback_=void 0,this.target_=void 0,this.directObserver_=void 0,this.value_=void 0,this.id_=pe++}function F(e){C._allObserversCount++,ve&&he.push(e)}function P(e){C._allObserversCount--}function S(e){C.call(this),this.value_=e,this.oldObject_=void 0}function A(e){if(!Array.isArray(e))throw Error("Provided object is not an Array");S.call(this,e)}function D(e,t){C.call(this),this.object_=e,this.path_=m(t),this.directObserver_=void 0}function I(e){C.call(this),this.reportChangesOnOpen_=e,this.value_=[],this.directObserver_=void 0,this.observed_=[]}function V(e){return e}function M(e,t,r,n){this.callback_=void 0,this.target_=void 0,this.value_=void 0,this.observable_=e,this.getValueFn_=t||V,this.setValueFn_=r||V,this.dontPassThroughSet_=n}function q(e,t,r){for(var n={},o={},i=0;i<t.length;i++){var s=t[i];_e[s.type]?(s.name in r||(r[s.name]=s.oldValue),"update"!=s.type&&("add"!=s.type?s.name in n?(delete n[s.name],delete r[s.name]):o[s.name]=!0:s.name in o?delete o[s.name]:n[s.name]=!0)):(console.error("Unknown changeRecord type: "+s.type),console.error(s))}for(var a in n)n[a]=e[a];for(var a in o)o[a]=void 0;var c={};for(var a in r)if(!(a in n||a in o)){var u=e[a];r[a]!==u&&(c[a]=u)}return{added:n,removed:o,changed:c}}function T(e,t,r){return{index:e,removed:t,addedCount:r}}function N(){}function R(e,t,r,n,o,i){return we.calcSplices(e,t,r,n,o,i)}function L(e,t,r,n){return r>t||e>n?-1:t==r||n==e?0:r>e?n>t?t-r:n-r:t>n?n-e:t-e}function z(e,t,r,n){for(var o=T(t,r,n),i=!1,s=0,a=0;a<e.length;a++){var c=e[a];if(c.index+=s,!i){var u=L(o.index,o.index+o.removed.length,c.index,c.index+c.addedCount);if(u>=0){e.splice(a,1),a--,s-=c.addedCount-c.removed.length,o.addedCount+=c.addedCount-u;var l=o.removed.length+c.removed.length-u;if(o.addedCount||l){var r=c.removed;if(o.index<c.index){var d=o.removed.slice(0,c.index-o.index);Array.prototype.push.apply(d,r),r=d}if(o.index+o.removed.length>c.index+c.addedCount){var f=o.removed.slice(c.index+c.addedCount-o.index);Array.prototype.push.apply(r,f)}o.removed=r,c.index<o.index&&(o.index=c.index)}else i=!0}else if(o.index<c.index){i=!0,e.splice(a,0,o),a++;var p=o.addedCount-o.removed.length;c.index+=p,s+=p}}}i||e.push(o)}function H(e,t){for(var r=[],n=0;n<t.length;n++){var o=t[n];switch(o.type){case"splice":z(r,o.index,o.removed.slice(),o.addedCount);break;case"add":case"update":case"delete":if(!c(o.name))continue;var i=u(o.name);if(0>i)continue;z(r,i,[o.oldValue],1);break;default:console.error("Unexpected record type: "+JSON.stringify(o))}}return r}function Q(e,t){var r=[];return H(e,t).forEach(function(t){return 1==t.addedCount&&1==t.removed.length?void(t.removed[0]!==e[t.index]&&r.push(t)):void(r=r.concat(R(e,t.index,t.index+t.addedCount,t.removed,0,t.removed.length)))}),r}var U=e.testingExposeCycleCount,B=s(),G=a(),W=e.Number.isNaN||function(t){return"number"==typeof t&&e.isNaN(t)},Z="__proto__"in{}?function(e){return e}:function(e){var i=e.__proto__;if(!i)return e;var s=t(i);return r(e).forEach(function(t){n(s,t,o(e,t))}),s},X="[$_a-zA-Z]",J="[$_a-zA-Z0-9]",K=new RegExp("^"+X+"+"+J+"*$"),Y={beforePath:{ws:["beforePath"],ident:["inIdent","append"],"[":["beforeElement"],eof:["afterPath"]},inPath:{ws:["inPath"],".":["beforeIdent"],"[":["beforeElement"],eof:["afterPath"]},beforeIdent:{ws:["beforeIdent"],ident:["inIdent","append"]},inIdent:{ident:["inIdent","append"],0:["inIdent","append"],number:["inIdent","append"],ws:["inPath","push"],".":["beforeIdent","push"],"[":["beforeElement","push"],eof:["afterPath","push"]},beforeElement:{ws:["beforeElement"],0:["afterZero","append"],number:["inIndex","append"],"'":["inSingleQuote","append",""],'"':["inDoubleQuote","append",""]},afterZero:{ws:["afterElement","push"],"]":["inPath","push"]},inIndex:{0:["inIndex","append"],number:["inIndex","append"],ws:["afterElement"],"]":["inPath","push"]},inSingleQuote:{"'":["afterElement"],eof:["error"],"else":["inSingleQuote","append"]},inDoubleQuote:{'"':["afterElement"],eof:["error"],"else":["inDoubleQuote","append"]},afterElement:{ws:["afterElement"],"]":["inPath","push"]}},ee={},te={};b.get=m,b.prototype=Z({__proto__:[],valid:!0,toString:function(){for(var e="",t=0;t<this.length;t++){var r=this[t];e+=v(r)?t?"."+r:r:_(r)}return e},getValueFrom:function(e,t){for(var r=0;r<this.length;r++){if(null==e)return;e=e[this[r]]}return e},iterateObjects:function(e,t){for(var r=0;r<this.length;r++){if(r&&(e=e[this[r-1]]),!l(e))return;t(e,this[0])}},compiledGetValueFromFn:function(){var e="",t="obj";e+="if (obj != null";for(var r,n=0;n<this.length-1;n++)r=this[n],t+=v(r)?"."+r:_(r),e+=" &&\n     "+t+" != null";e+=")\n";var r=this[n];return t+=v(r)?"."+r:_(r),e+="  return "+t+";\nelse\n  return undefined;",new Function("obj",e)},setValueFrom:function(e,t){if(!this.length)return!1;for(var r=0;r<this.length-1;r++){if(!l(e))return!1;e=e[this[r]]}return l(e)?(e[this[r]]=t,!0):!1}});var re=new b("",ee);re.valid=!1,re.getValueFrom=re.setValueFrom=function(){};var ne,oe=1e3,ie=[],se=B?function(){var e={pingPong:!0},t=!1;return Object.observe(e,function(){w(),t=!1}),function(r){ie.push(r),t||(t=!0,e.pingPong=!e.pingPong)}}():function(){return function(e){ie.push(e)}}(),ae=[],ce=[],ue=0,le=1,de=2,fe=3,pe=1;C.prototype={open:function(e,t){if(this.state_!=ue)throw Error("Observer has already been opened.");return F(this),this.callback_=e,this.target_=t,this.connect_(),this.state_=le,this.value_},close:function(){this.state_==le&&(P(this),this.disconnect_(),this.value_=void 0,this.callback_=void 0,this.target_=void 0,this.state_=de)},deliver:function(){this.state_==le&&g(this)},report_:function(e){try{this.callback_.apply(this.target_,e)}catch(t){C._errorThrownDuringCallback=!0,console.error("Exception caught during observer callback: "+(t.stack||t))}},discardChanges:function(){return this.check_(void 0,!0),this.value_}};var he,ve=!B;C._allObserversCount=0,ve&&(he=[]);var be=!1;e.Platform=e.Platform||{},e.Platform.performMicrotaskCheckpoint=function(){if(!be&&ve){be=!0;var t,r,n=0;do{n++,r=he,he=[],t=!1;for(var o=0;o<r.length;o++){var i=r[o];i.state_==le&&(i.check_()&&(t=!0),he.push(i))}w()&&(t=!0)}while(oe>n&&t);U&&(e.dirtyCheckCycleCount=n),be=!1}},ve&&(e.Platform.clearObservers=function(){he=[]}),S.prototype=Z({__proto__:C.prototype,arrayObserve:!1,connect_:function(e,t){B?this.directObserver_=$(this,this.value_,this.arrayObserve):this.oldObject_=this.copyObject(this.value_)},copyObject:function(e){var t=Array.isArray(e)?[]:{};for(var r in e)t[r]=e[r];return Array.isArray(e)&&(t.length=e.length),t},check_:function(e,t){var r,n;if(B){if(!e)return!1;n={},r=q(this.value_,e,n)}else n=this.oldObject_,r=O(this.value_,this.oldObject_);return j(r)?!1:(B||(this.oldObject_=this.copyObject(this.value_)),this.report_([r.added||{},r.removed||{},r.changed||{},function(e){return n[e]}]),!0)},disconnect_:function(){B?(this.directObserver_.close(),this.directObserver_=void 0):this.oldObject_=void 0},deliver:function(){this.state_==le&&(B?this.directObserver_.deliver(!1):g(this))},discardChanges:function(){return this.directObserver_?this.directObserver_.deliver(!0):this.oldObject_=this.copyObject(this.value_),this.value_}}),A.prototype=Z({__proto__:S.prototype,arrayObserve:!0,copyObject:function(e){return e.slice()},check_:function(e){var t;if(B){if(!e)return!1;t=Q(this.value_,e)}else t=R(this.value_,0,this.value_.length,this.oldObject_,0,this.oldObject_.length);return t&&t.length?(B||(this.oldObject_=this.copyObject(this.value_)),this.report_([t]),!0):!1}}),A.applySplices=function(e,t,r){r.forEach(function(r){for(var n=[r.index,r.removed.length],o=r.index;o<r.index+r.addedCount;)n.push(t[o]),o++;Array.prototype.splice.apply(e,n)})},D.prototype=Z(i({__proto__:C.prototype,connect_:function(){B&&(this.directObserver_=E(this,this.object_)),this.check_(void 0,!0)},disconnect_:function(){this.value_=void 0,this.directObserver_&&(this.directObserver_.close(this),this.directObserver_=void 0)},iterateObjects_:function(e){this.path_.iterateObjects(this.object_,e)},check_:function(e,t){var r=this.value_;return this.value_=this.path_.getValueFrom(this.object_),t||d(this.value_,r)?!1:(this.report_([this.value_,r,this]),
!0)},setValue:function(e){this.path_&&this.path_.setValueFrom(this.object_,e)}},{path:{get:function(){return this.path_},configurable:!0,enumerable:!0}}));var me={};I.prototype=Z({__proto__:C.prototype,connect_:function(){if(B){for(var e,t=!1,r=0;r<this.observed_.length;r+=2)if(e=this.observed_[r],e!==me){t=!0;break}t&&(this.directObserver_=E(this,e))}this.check_(void 0,!this.reportChangesOnOpen_)},disconnect_:function(){for(var e=0;e<this.observed_.length;e+=2)this.observed_[e]===me&&this.observed_[e+1].close();this.observed_.length=0,this.value_.length=0,this.directObserver_&&(this.directObserver_.close(this),this.directObserver_=void 0)},addPath:function(e,t){if(this.state_!=ue&&this.state_!=fe)throw Error("Cannot add paths once started.");var t=m(t);if(this.observed_.push(e,t),this.reportChangesOnOpen_){var r=this.observed_.length/2-1;this.value_[r]=t.getValueFrom(e)}},addObserver:function(e){if(this.state_!=ue&&this.state_!=fe)throw Error("Cannot add observers once started.");if(this.observed_.push(me,e),this.reportChangesOnOpen_){var t=this.observed_.length/2-1;this.value_[t]=e.open(this.deliver,this)}},startReset:function(){if(this.state_!=le)throw Error("Can only reset while open");this.state_=fe,this.disconnect_()},finishReset:function(){if(this.state_!=fe)throw Error("Can only finishReset after startReset");return this.state_=le,this.connect_(),this.value_},iterateObjects_:function(e){for(var t,r=0;r<this.observed_.length;r+=2)t=this.observed_[r],t!==me&&this.observed_[r+1].iterateObjects(t,e)},check_:function(e,t){for(var r,n=0;n<this.observed_.length;n+=2){var o,i=this.observed_[n],s=this.observed_[n+1];if(i===me){var a=s;o=this.state_===ue?a.open(this.deliver,this):a.discardChanges()}else o=s.getValueFrom(i);t?this.value_[n/2]=o:d(o,this.value_[n/2])||(r=r||[],r[n/2]=this.value_[n/2],this.value_[n/2]=o)}return r?(this.report_([this.value_,r,this.observed_]),!0):!1}}),M.prototype={open:function(e,t){return this.callback_=e,this.target_=t,this.value_=this.getValueFn_(this.observable_.open(this.observedCallback_,this)),this.value_},observedCallback_:function(e){if(e=this.getValueFn_(e),!d(e,this.value_)){var t=this.value_;this.value_=e,this.callback_.call(this.target_,this.value_,t)}},discardChanges:function(){return this.value_=this.getValueFn_(this.observable_.discardChanges()),this.value_},deliver:function(){return this.observable_.deliver()},setValue:function(e){return e=this.setValueFn_(e),!this.dontPassThroughSet_&&this.observable_.setValue?this.observable_.setValue(e):void 0},close:function(){this.observable_&&this.observable_.close(),this.callback_=void 0,this.target_=void 0,this.observable_=void 0,this.value_=void 0,this.getValueFn_=void 0,this.setValueFn_=void 0}};var _e={add:!0,update:!0,"delete":!0},ge=0,ye=1,je=2,Oe=3;N.prototype={calcEditDistances:function(e,t,r,n,o,i){for(var s=i-o+1,a=r-t+1,c=new Array(s),u=0;s>u;u++)c[u]=new Array(a),c[u][0]=u;for(var l=0;a>l;l++)c[0][l]=l;for(var u=1;s>u;u++)for(var l=1;a>l;l++)if(this.equals(e[t+l-1],n[o+u-1]))c[u][l]=c[u-1][l-1];else{var d=c[u-1][l]+1,f=c[u][l-1]+1;c[u][l]=f>d?d:f}return c},spliceOperationsFromEditDistances:function(e){for(var t=e.length-1,r=e[0].length-1,n=e[t][r],o=[];t>0||r>0;)if(0!=t)if(0!=r){var i,s=e[t-1][r-1],a=e[t-1][r],c=e[t][r-1];i=c>a?s>a?a:s:s>c?c:s,i==s?(s==n?o.push(ge):(o.push(ye),n=s),t--,r--):i==a?(o.push(Oe),t--,n=a):(o.push(je),r--,n=c)}else o.push(Oe),t--;else o.push(je),r--;return o.reverse(),o},calcSplices:function(e,t,r,n,o,i){var s=0,a=0,c=Math.min(r-t,i-o);if(0==t&&0==o&&(s=this.sharedPrefix(e,n,c)),r==e.length&&i==n.length&&(a=this.sharedSuffix(e,n,c-s)),t+=s,o+=s,r-=a,i-=a,r-t==0&&i-o==0)return[];if(t==r){for(var u=T(t,[],0);i>o;)u.removed.push(n[o++]);return[u]}if(o==i)return[T(t,[],r-t)];for(var l=this.spliceOperationsFromEditDistances(this.calcEditDistances(e,t,r,n,o,i)),u=void 0,d=[],f=t,p=o,h=0;h<l.length;h++)switch(l[h]){case ge:u&&(d.push(u),u=void 0),f++,p++;break;case ye:u||(u=T(f,[],0)),u.addedCount++,f++,u.removed.push(n[p]),p++;break;case je:u||(u=T(f,[],0)),u.addedCount++,f++;break;case Oe:u||(u=T(f,[],0)),u.removed.push(n[p]),p++}return u&&d.push(u),d},sharedPrefix:function(e,t,r){for(var n=0;r>n;n++)if(!this.equals(e[n],t[n]))return n;return r},sharedSuffix:function(e,t,r){for(var n=e.length,o=t.length,i=0;r>i&&this.equals(e[--n],t[--o]);)i++;return i},calculateSplices:function(e,t){return this.calcSplices(e,0,e.length,t,0,t.length)},equals:function(e,t){return e===t}};var we=new N;e.Observer=C,e.Observer.runEOM_=se,e.Observer.observerSentinel_=me,e.Observer.hasObjectObserve=B,e.ArrayObserver=A,e.ArrayObserver.calculateSplices=function(e,t){return we.calculateSplices(e,t)},e.ArraySplice=N,e.ObjectObserver=S,e.PathObserver=D,e.CompoundObserver=I,e.Path=b,e.ObserverTransform=M}("undefined"!=typeof global&&global&&"undefined"!=typeof module&&module?global:void 0||window))}}}),e.register("lib/objectobserve",["npm:babel-runtime@5.4.7/core-js/object/keys","lib/observe-js","lib/dirtycheck/dirtycheck","lib/dirtycheck/animationFrame","lib/dirtycheck/eventListener","lib/dirtycheck/xhr","lib/dirtycheck/timers","lib/polyfill/object","lib/utils"],function(e){var t,r,n,o,i,s,a,c,u;return{setters:[function(e){t=e["default"]},function(e){r=e["default"]},function(e){n=e["default"]},function(e){o=e["default"]},function(e){i=e["default"]},function(e){s=e["default"]},function(e){a=e["default"]},function(e){c=e["default"]},function(e){u=e["default"]}],execute:function(){"use strict";e("default",function(){if(!Observer.hasObjectObserve&&!Object.observe){Object.getNotifier=function(e){return{notify:function(t){var r=e.$$__observers||{};for(var n in r)r[n].callback.call(r[n].scope,t)},performChange:function(e,t){var r=t.call(this);"undefined"!=typeof r&&(r.type=e,this.notify(r))}}};var e=function(e,t){return 0===t.length||-1!=t.indexOf(e)};Object.observe=function(r,o,i){if(i=i||[],!r.$$__observers){var s=null;if(Array.isArray(r)){r.$$__observers={observer:new ArrayObserver(r),listeners:[],arrayCopy:r.slice(0),arrayLength:r.length};s=function(e){r.$$__observers.listeners.forEach(function(e){var t=u.arrayChanges(r.$$__observers.arrayCopy,r),n=e.acceptList;n.length>0&&(t=t.filter(function(e){return-1!==n.indexOf(e.type)})),e.listener.call(this,t)}),n.executeHooks(),r.$$__observers&&(r.$$__observers.arrayLength=r.length,r.$$__observers.arrayCopy=r.slice(0))}}else if(u.isObject(r))r.$$__observers={observer:new ObjectObserver(r),listeners:[]},s=function(o,i,s,a){var c,u=[];r.$$__observers.listeners.forEach(function(l){c=l.acceptList,u=[],e("add",c)&&t(o).forEach(function(e){u[u.length]={name:e,object:r,type:"add"}}),e("update",c)&&t(s).forEach(function(e){u[u.length]={name:e,object:r,oldValue:a(e),type:"update"}}),e("delete",c)&&t(i).forEach(function(e){u[u.length]={name:e,object:r,oldValue:a(e),type:"delete"}}),l.listener.call(this,u),n.executeHooks()})};else if(!u.isDate(r))throw new Error("TypeError: Object.observe cannot observe non-object");s&&r.$$__observers.observer.open(s)}return r.$$__observers.listeners.push({listener:o,acceptList:i}),r},Object.unobserve=function(e,t){var r=[];return e.$$__observers&&e.$$__observers.listeners&&e.$$__observers.listeners.length>0&&(e.$$__observers.listeners.forEach(function(e){e.listener==t&&r.push(e)}),r.forEach(function(t){var r=e.$$__observers.listeners.indexOf(t);e.$$__observers.listeners.splice(r,1)}),0===e.$$__observers.listeners.length&&(e.$$__observers.observer.close(),delete e.$$__observers)),e}}}())}}})});
//# sourceMappingURL=objectobserve.min.js.map