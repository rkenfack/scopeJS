import eventHelpers from "src/event/Helpers";
import cssHelpers from "src/css/Helpers";
import Logger from "src/modules/Logger";

export default (function() {
  //item.dispatchEvent(new CustomEvent(eventName ,{ detail : data }));
  //http://www.w3.org/TR/pointerevents/#pointerevent-interface
  /*var event = new PointerEvent("pointerover",
   {bubbles: true,
    cancelable: true,
    pointerId: 42,
    pointerType: "pen",
    clientX: 300,
    clientY: 500
    });
eventTarget.dispatchEvent(event); */

  var setDefaults = function(properties) {
    var defaults = {
      bubbles : true,
      cancelable: true
    };
    for(var prop in defaults) {
      if(typeof properties[prop] == "undefined") {
        roperties[prop] = defaults[prop];
      }
    }
    return properties;
  };

  var isMouseEvent = function(eventName) {
    return (eventName == "click") || (eventName == "dbclick") || (eventName.indexOf("mouse") == 0);
  };

  var isTouchEvent = function(eventName) {
    return eventName.indexOf("touch") == 0;
  };

  var isPointerEvent = function(eventName) {
    return eventName.indexOf("pointer") == 0;
  };


  var createBaseEvent = function(eventName, properties) {
    var evt = null;
    properties = setDefaults(properties);
    if(typeof Event != "undefined") {
      evt = Event(eventName, properties);
    } else {
      evt = document.createEvent('Event');
      evt.initEvent(eventName, true, true);
    }
    return evt;
  };


  var createMouseEvent = function(eventName, properties) {
    var evt = null;
    if(typeof MouseEvent != "undefined") {
      var evt = new MouseEvent(eventName, {
        bubbles : true,
        cancelable: true,
        view: window,
      });
    } else {
      evt = document.createEvent('MouseEvent');
      evt.initMouseEvent(eventName, true, true);
    }
    return evt;
  };


  var createTouchEvent = function(eventName, properties) {

  };

  var createPointerEvent = function(eventName, properties) {

  };



  var createEvent(eventName) {
    if(isMouseEvent(eventName)) {
      return createMouseEvent(eventName);
    } else if(isTouchEvent(eventName)) {
      return createTouchEvent(eventName);
    } else if(isPointerEvent(eventName)) {
      return createPointerEvent(eventName);
    } else {
      return createBaseEvent(eventName);
    }
  };


  return {


    emitNative : function(eventName, properties) {

      properties = properties || {};

      this.forEach(function(item) {
        if(eventHelpers.isEventSupported(item, eventName)) {
          var evt = createEvent(eventName, properties);
          item.dispatchEvent(evt);
        } else {
          Logger.error("dispatchEvent not supported on "+el);
        }
      });
      return this;
    },


    emitCustom : function(eventName, data) {
      data = data || {};
      this.forEach(function(item) {
        item.dispatchEvent(new CustomEvent(eventName ,{ detail : data }));
      });
      return this;
    }

  }

})();