import utils from "src/utils/Utils";

export default (function () {

  var browserPrefix = ["Webkit", "Moz", "O", "ms", "Khtml"];
  var classCache = [];


  return {

    getPropertyName : function (propertyName) {
      var style = document.documentElement.style;
      if (style[propertyName] !== undefined) {
        return propertyName;
      }
      for (var i=0, l=browserPrefix; i<l; i++) {
        var prefixedProp =browserPrefix + utils.firstUp(propertyName);
        if (style[prefixedProp] !== undefined) {
          return prefixedProp;
        }
      }
      return null;
    },

    classRegEx: function (name) {
      return name in classCache ?
        classCache[name] : (classCache[name] = new RegExp('(^|\\s)' + name + '(\\s|$)'));
    },

    nodeListToArray: function (nodeList) {
      return Array.prototype.slice.call(nodeList);
    },

    isWindow : function (element) {
      return (typeof (element && element.document && element.location && element.alert && element.setInterval)) !== "undefined";
    },

    isDocument: function (element) {
      return typeof element.createElement != "undefined";
    },

    isSuportedElement: function (element) {
      return ((element instanceof HTMLElement) || this.isWindow(element) || this.isDocument(element));
    },


    hasClass: function (el, classToCheck) {
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

    addClass: function (el, classToAdd) {
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

    addClasses: function (el, classesToAdd) {
      classesToAdd.forEach(function (classToAdd) {
        this.addClass(el, classToAdd.trim());
      });
    },

    removeClass: function (el, classToRemove) {
      if (el instanceof HTMLElement) {
        if (el.classList) {
          el.classList.remove(classToRemove);
        } else {
          var classes = el.className.split(/\s+/g).join(" ");
          el.className = classes.replace(classRegEx(classToRemove), "");
        }
      }
    },

    removeClasses: function (el, classesToRemove) {
      classesToRemove.forEach(function (classToRemove) {
        this.removeClass(el, classToRemove);
      });
    },

    toggleClass: function (el, classToToggle) {
      if (el instanceof HTMLElement) {
        if (this.hasClass(el, classToToggle)) {
          this.removeClass(el, classToToggle);
        } else {
          this.addClass(el, classToToggle);
        }
      }
    },

    toggleClasses: function (el, classesToToggle) {
      classesToToggle.forEach(function (classToToggle) {
        this.toggleClass(el, classToToggle);
      });
    }

  };

})();
