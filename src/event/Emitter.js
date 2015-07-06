import eventHelpers from "src/event/Helpers";
import cssHelpers from "src/css/Helpers";
import Logger from "src/modules/Logger";
import utils from "src/utils/Utils";

export
default (function () {
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


//https://gist.github.com/basecss/8666646


  var eventProperties = {

    base: {
      bubbles: true,
      cancelable: true
    },

    mouse : {
      canBubble: true,
      cancelable: true,
      view: window,
      detail: 0,
      screenX: 0,
      screenY: 0,
      clientX: 0,
      clientY: 0,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
      button: 0,
      relatedTarget: null
    },

    touch : {
      touches : [],
      targetTouches : [],
      changedTouches : [],
      altKey : false,
      metaKey : false,
      ctrlKey : false,
      shiftKey : false
    },

    pointer : {
      canBubble: true,
      cancelable: true,
      view: window,
      detail: 0,
      screenX: 0,
      screenY: 0,
      clientX: 0,
      clientY: 0,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
      button: 0,
      relatedTarget: null,
      offsetX : 0,
      offsetY : 0,
      width : 0,
      height : 0,
      pressure : 0,
      rotation : 0,
      tiltX : 0,
      tiltY : 0,
      pointerId : 0,
      pointerType : null,
      hwTimestamp : 0,
      isPrimary : false
    },


    initTouch : {
      canBubble: true,
      cancelable: true,
      view: window,
      detail: 0,
      screenX: 0,
      screenY: 0,
      clientX: 0,
      clientY: 0,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
      touches: [],
      targetTouches: [],
      changedTouches: [],
      scale: 1,
      rotation: 0,
      touchItem: 0
    }

  };


  var setDefaults = function (type, properties) {
    var res = {};
    for (var prop in eventProperties[type]) {
      if(eventProperties[type].hasOwnProperty(prop)) {
        if (typeof properties[prop] == "undefined") {
          res[prop] = eventProperties[type][prop];
        } else {
          res[prop] = properties[prop];
        }
      }
    }
    return res;
  };


  var createTouch = function(target) {
    return {
      view : window,
      target : target,
      identifier : utils.getUID(),
      pageX : 0,
      pageY : 0,
      screenX : 0,
      screenY : 0
    };
  };


  var addDefaultTouches = function(target, eventName, properties) {
    var touch = createTouch(target);
    if(properties.touches.length === 0) {
      properties.touches.push(touch);
    }
    if(properties.targetTouches.length === 0) {
      properties.targetTouches.push(touch);
    }
    if(properties.changedTouches.length === 0) {
      properties.changedTouches.push(touch);
    }
  };


  var isMouseEvent = function (eventName) {
    return (eventName == "click") || (eventName == "dbclick") || (eventName.indexOf("mouse") === 0);
  };


  var isTouchEvent = function (eventName) {
    return eventName.indexOf("touch") === 0;
  };


  var isPointerEvent = function (eventName) {
    return eventName.indexOf("pointer") === 0;
  };


  var createBaseEvent = function (eventName, properties) {
    var evt = null;
    properties = properties || {};
    properties = setDefaults("base", properties);
    if (typeof Event != "undefined") {
      evt = Event(eventName, properties);
    } else {
      evt = document.createEvent('Event');
      evt.initEvent([eventName].concat(Object.values(properties)));
    }
    return evt;
  };


  var createMouseEvent = function (eventName, properties) {
    var evt = null;
    properties = properties || {};
    properties = setDefaults("mouse", properties);
    if (typeof MouseEvent != "undefined") {
      evt = new MouseEvent(eventName, properties);
    } else {
      evt = document.createEvent('MouseEvent');
      evt.initMouseEvent.apply([eventName].concat(Object.values(properties)));
    }
    return evt;
  };


  var createTouchEvent = function (target, eventName, properties) {
    var evt = null;
    properties = properties || {};
    properties = setDefaults("touch", properties);
    properties = addDefaultTouches(target, eventName, properties);
    if (typeof TouchEvent != "undefined") {
      evt = new TouchEvent(eventName, properties);
    } else {
      evt = document.createEvent('TouchEvent');
      evt.initTouchEvent.apply(evt, [eventName].concat(Object.values(properties)));
    }
    return evt;
  };


  var createPointerEvent = function (eventName, properties) {
    var evt = null;
    properties = properties || {};
    properties = setDefaults("pointer", properties);
    if (typeof PointerEvent != "undefined") {
      evt = new PointerEvent(eventName, properties);
    } else {
      evt = document.createEvent('PointerEvent');
      evt.initPointerEvent.apply(evt, [eventName].concat(Object.values(properties)));
    }
    return evt;
  };


  var createEvent = function (item, eventName, properties) {
    if (isMouseEvent(eventName)) {
      return createMouseEvent(eventName);
    } else if (isTouchEvent(eventName)) {
      return createTouchEvent(item, eventName, properties);
    } else if (isPointerEvent(eventName)) {
      return createPointerEvent(eventName);
    } else {
      return createBaseEvent(eventName);
    }
  };


  return {

    emitNative : function (eventName, properties) {
      this.forEach(function (item) {
        if (eventHelpers.isEventSupported(item, eventName)) {
          var evt = createEvent(item, eventName, properties);
          item.dispatchEvent(evt);
        } else {
          Logger.error(eventName+" not supported on " + item);
        }
      });
      return this;
    },


    emitCustom : function (eventName, data) {
      data = data || {};
      this.forEach(function (item) {
        item.dispatchEvent(new CustomEvent(eventName, {
          detail: data
        }));
      });
      return this;
    }


  };

})();
