export default (function() {

  var swapStyles = function(el, styleMap, func) {
    var originalStyles = {};
    for (var prop in styleMap) {
      originalStyles[prop] = el.style[prop];
      el.style[prop] = styleMap[prop];
    }

    var res = el.call(el, func);
    for (prop in originalStyles) {
      el.style[prop] = originalStyles[prop];
    }

    return res;
  };

  return {

    getWidth : function(force) {

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
        }, "getBoundingClientRect");
      } else {
        rect = this[0].getBoundingClientRect();
      }

      return Math.round(rect.right - rect.left);
    },


    getHeight : function(force) {

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
        }, "getBoundingClientRect");
      } else {
        rect = this[0].getBoundingClientRect();
      }

      return Math.round(rect.bottom - rect.top);
    },


    getOffset : function(force) {

      if (!this[0]) {
        return {};
      }

      force = typeof force == "undefined" ? false : force;
      if (force === true) {
        return swapStyles(this[0], {
          display: "block",
          position: "absolute",
          visibility: "hidden"
        }, "getBoundingClientRect");
      } else {
        return this[0].getBoundingClientRect();
      }
    },


    getContentHeight : function(force) {
      force = typeof force == "undefined" ? false : force;
    },


    getContentWidth : function(force) {
      force = typeof force == "undefined" ? false : force;
    }
  };

})();
