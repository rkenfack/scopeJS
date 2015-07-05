import cssHelpers from "src/css/Helpers";
import utils from "src/utils/Utils";

export default {

  getStyle : function (name) {
    name = cssHelpers.getPropertyName(name);
    if (this[0]) {
      return this[0].style[utils.camelcase(name)];
    }
  },

  setStyle : function (name, value) {
    name = cssHelpers.getPropertyName(name);
    this.forEach(function (el) {
      el.style[name] = value;
    });
    return this;
  },


  setStyles : function (styleMap) {
    for (var name in styleMap) {
      this.setStyle(name, styleMap[name]);
    }
    return this;
  }

};
