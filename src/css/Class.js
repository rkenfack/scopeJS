import cssHelpers from "src/css/Helpers";


export default {

  addClass : function (classToAdd) {
    this.forEach(function (el) {
      cssHelpers.addClass(el, classToAdd);
    });
    return this;
  },


  addClasses : function (classesToAdd) {
    this.forEach(function (el) {
      cssHelpers.addClasses(el, classesToAdd);
    });
    return this;
  },


  getClass : function () {
    if (this[0] && (this[0] instanceof HTMLElement)) {
      return this[0].className;
    }
    return "";
  },


  hasClass : function (classToCheck) {
    var res = false;
    if (this[0]) {
      return cssHelpers.hasClass(this[0], classToCheck);
    }
    return res;
  },


  removeClass : function (classToRemove) {
    this.forEach(function (el) {
      cssHelpers.removeClass(el, classToRemove);
    });
    return this;
  },


  removeClasses : function (classesToRemove) {
    this.forEach(function (el) {
      cssHelpers.removeClasses(el, classesToRemove);
    });
    return this;
  },


  replaceClass : function (oldClass, newClass) {
    this.forEach(function (el) {
      if (cssHelpers.hasClass(el, oldClass)) {
        cssHelpers.removeClass(el, oldClass);
        cssHelpers.addClass(el, newClass);
      }
    });
    return this;
  },


  toggleClass : function (classToToggle) {
    this.forEach(function (el) {
      cssHelpers.toggleClass(el, classToToggle);
    });
    return this;
  },


  toggleClasses : function (classesToToggle) {
    this.forEach(function (el) {
      cssHelpers.toggleClasses(el, classesToToggle);
    });
    return this;
  }
};