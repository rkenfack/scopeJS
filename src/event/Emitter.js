import eventHelpers from "src/event/Helpers";
import cssHelpers from "src/css/Helpers";
import Logger from "src/modules/Logger";
import utils from "src/utils/Utils";



export default (function () {

  var keyEventSpec = "keyboard";

  (function(){
    var evt = document.createEvent('KeyboardEvent');
    keyEventSpec = evt.initKeyEvent ? "key" : "keyboard";
  })();


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

  var isKeyBoardEvent = function(eventName) {
    return eventName.indexOf("key") === 0;
  };


  var createUIEvent = function (eventName, properties) {
    var evt = null;
    properties = properties || {};
    if (typeof UIEvent != "undefined") {
      try {
        evt = new UIEvent(eventName, properties);
      } catch(err) {
         Logger.info("UIEvent construnctor not supported on, document.createEvent used instead.");
      }
    }
    if(evt === null) {
      evt = document.createEvent('UIEvent');
      evt.initUIEvent.apply(evt, [eventName].concat(Object.values(properties)));
    }
    return evt;
  };


  var createKeyBoardEvent = function (eventName, properties) {
    var evt = null;
    properties = properties || {};
    if (typeof KeyboardEvent != "undefined") {
      try {
        evt = new KeyboardEvent(eventName, properties);
      } catch(err) {
        Logger.info("KeyboardEvent construnctor not supported on, document.createEvent used instead.");
      }
    }
    if(evt === null) {
      evt = document.createEvent('KeyboardEvent');
      var init = evt.initKeyEvent || evt.initKeyboardEvent;
      init.apply(evt, [eventName].concat(Object.values(properties)));
    }
    return evt;
  };


  var createMouseEvent = function (eventName, properties) {
    var evt = null;
    properties = properties || {};
    if (typeof MouseEvent != "undefined") {
      try {
        evt = new MouseEvent(eventName, properties);
      } catch(err) {
        Logger.info("MouseEvent construnctor not supported on, document.createEvent used instead.");
      }
    }
    if(evt === null) {
      evt = document.createEvent('MouseEvent');
      evt.initMouseEvent.apply(evt, [eventName].concat(Object.values(properties)));
    }
    return evt;
  };


  var createTouchEvent = function (target, eventName, properties) {
    var evt = null;
    properties = properties || {};
    properties = addDefaultTouches(target, eventName, properties);

    if (typeof TouchEvent != "undefined") {
      try {
        evt = new TouchEvent(eventName, properties);
      } catch(err) {
        Logger.info("TouchEvent construnctor not supported on, document.createEvent used instead.");
      }
    }

    if(evt === null) {
      evt = document.createEvent('TouchEvent');
      evt.initTouchEvent.apply(evt, [eventName].concat(Object.values(properties)));
    }

    return evt;
  };


  var createPointerEvent = function (eventName, properties) {

    var evt = null;
    properties = properties || {};

    if (typeof PointerEvent != "undefined") {
      try {
        evt = new PointerEvent(eventName, properties);
      } catch(err) {
        Logger.info("PointerEvent construnctor not supported on, document.createEvent used instead.");
      }
    }

    if(evt === null) {
      evt = document.createEvent('PointerEvent');
      evt.initPointerEvent.apply(evt, [eventName].concat(Object.values(properties)));
    }

    return evt;
  };


  var createEvent = function (item, eventName, properties) {
    if (isMouseEvent(eventName)) {
      return createMouseEvent(eventName, properties);
    } else if (isTouchEvent(eventName)) {
      return createTouchEvent(item, eventName, properties);
    } else if (isPointerEvent(eventName)) {
      return createPointerEvent(eventName, properties);
    } else if(isKeyBoardEvent(eventName)) {
      return createKeyBoardEvent(eventName, properties);
    } else {
      return createUIEvent(eventName, properties);
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


    emitCustom : function(eventName, data) {
      data = data || {};
      this.forEach(function (item) {
        item.dispatchEvent(new CustomEvent(eventName, data));
      });
      return this;
    }


  };

})();
