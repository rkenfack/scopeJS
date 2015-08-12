export default {

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

  getType : function(value) {
    return this.getClass(value);
  },

  getClass: function (value) {
    // The typeof null and undefined is "object" under IE8
    if (value === undefined) {
      return "Undefined";
    } else if (value === null) {
      return "Null";
    }
    var classString = Object.prototype.toString.call(value);
    return (this.classToTypeMap[classString] || classString.slice(8, -1));
  },

  getUID: function () {
    return ((new Date()).getTime() + "" + Math.floor(Math.random() * 1000000)).substr(0, 18);
  },

  isFunction: function (obj) {
    return typeof obj === 'function';
  },

  equals: function (object1, object2) {
    return this.__equals(object1, object2, [], []);
  },

  isObject: function (obj) {
    return Object.prototype.toString.call(obj) == "[object Object]";
  },

  isDate: function (obj) {
    return Object.prototype.toString.call(obj) == "[object Date]";
  },

  camelCase : function(s) {
    if(s.indexOf("-") != -1 ){
      return (s||'').toLowerCase().replace(/(-)\w/g, function(m) {
        return m.toUpperCase().replace(/-/,'');
      });
    }
    return s;
  },

  firstUp : function(str) {
    return str.charAt(0).toUpperCase() + str.substr(1);
  },

  hyphenate : function(str) {
    return str.replace(/\s/g, "-").toLowerCase();
  },

  __equals: function (object1, object2, aStack, bStack) {
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
    case '[object String]':
      // Primitives and their corresponding object wrappers are equivalent; thus, `"5"` is
      // equivalent to `new String("5")`.
      return object1 == String(object2);
    case '[object Number]':
      // `NaN`s are equivalent, but non-reflexive. An `egal` comparison is performed for
      // other numeric values.
      return object1 != +object1 ? object2 != +object2 : (object1 === 0 ? 1 / object1 == 1 / object2 : object1 == +object2);
    case '[object Date]':
    case '[object Boolean]':
      // Coerce dates and booleans to numeric primitive values. Dates are compared by their
      // millisecond representations. Note that invalid dates with millisecond representations
      // of `NaN` are not equivalent.
      return +object1 == +object2;
      // RegExps are compared by their source patterns and flags.
    case '[object RegExp]':
      return object1.source == object2.source &&
        object1.global == object2.global &&
        object1.multiline == object2.multiline &&
        object1.ignoreCase == object2.ignoreCase;
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
    if (aCtor !== bCtor && !(this.isFunction(aCtor) && (aCtor instanceof aCtor) &&
      this.isFunction(bCtor) && (bCtor instanceof bCtor)) && ('constructor' in object1 && 'constructor' in object2)) {
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
          if (Object.prototype.hasOwnProperty.call(object2, key) && !(size--)) {
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
