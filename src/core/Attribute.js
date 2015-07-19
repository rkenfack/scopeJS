import utils from "src/utils/Utils";

export default (function() {


  var setAttribute = function(el, attrName, attrValue) {
    el.setAttribute(attrName, attrValue);
  };


  var getAttribute = function(el, attrName) {
    return el.getAttribute(attrName);
  };


  var getProperty = function(el, propName) {
    return el[propName];
  };


  var setProperty = function(el, propName, propValue) {
    el[propName] = propValue;
  };


  var getDataSetAttribute = function(el, dataAttrName) {
    if (el.dataset) {
      return el.dataset[utils.camelCase(dataAttrName)];
    } else {
      return getAttribute(el, "data-" + utils.hyphenate(dataAttrName));
    }
  };


  var setDataSetAttibute = function(el, dataAttrName, dataAttrValue) {
    if (el.dataset) {
      el.dataset[utils.camelCase(dataAttrName)] = dataAttrValue;
    } else {
      setAttribute(el, "data-" + utils.hyphenate(dataAttrName), dataAttrValue);
    }
  };


  return {

    /**
     *
     */
    getAttribute: function(attrName) {
      if (this[0]) {
        return getAttribute(this[0], attrName);
      }
    },


    /**
     *
     */
    getAttributes: function(attrNames) {
      var attrs = {};
      if (this[0]) {
        attrNames.forEach(function(attrName) {
          attrs[attrName] = getAttribute(this[0], attrName);
        }, this);
      }
      return attrs;
    },


    setAttribute: function(attrName, attrValue) {
      if (this[0]) {
        setAttribute(this[0], attrName, attrValue);
      }
      return this;
    },


    setAttributes: function(attrsMap) {
      if (this[0]) {
        for (var attrName in attrsMap) {
          setAttribute(this[0], attrName, attrsMap[attrName]);
        }
      }
      return this;
    },


    getProperty: function(propName) {
      if (this[0]) {
        return getProperty(this[0], propName);
      }
    },



    setProperty: function(propName, propValue) {
      if (this[0]) {
        return setProperty(this[0], propName, propValue);
      }
      return this;
    },


    getProperties: function(props) {
      var properties = {};
      if (this[0]) {
        props.forEach(function(propName) {
          properties[propName] = getProperty(this[0], propName);
        }, this);
      }
      return properties;
    },


    setProperties: function(propsMap) {
      if (this[0]) {
        for (var propName in propsMap) {
          setProperty(this[0], propName, propsMap[propName]);
        }
      }
      return this;
    },

    dataset : function() {
      if(this[0]) {
        return this[0].dataset;
      }
    }


  };

})();
