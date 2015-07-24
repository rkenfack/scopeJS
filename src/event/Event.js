import utils from "src/utils/Utils";
import helpers from "src/event/Helpers";
import Notifier from "src/event/Notifier";

export default (function() {

  var registerEvent =  function(eventType, listener, context, once) {
    var registeredListener;
    this.forEach(function(el) {
      el.$$__notifier = el.$$__notifier || new Notifier();
      if(once === true) {
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

    on : function(eventType, listener, context) {
      context = context || this;
      registerEvent.call(this, eventType, listener, context, false);
      return this;
    },

    once : function(eventType, listener, context) {
      context = context || this;
      registerEvent.call(this, eventType, listener, context, true);
      return this;
    },


    off : function(eventType, listener, context) {
      var notifier;
      var removed = [];
      this.forEach(function(el) {
        if (el.$$__notifier) {
          notifier = el.$$__notifier;
          removed = notifier.off(eventType, listener, context);
          if (helpers.isEventSupported(el, eventType)) {
            removed.forEach(function(removedListener) {
              el.removeEventListener(eventType, removedListener.fnCtx, false);
            });
          }
        }
      });
      return this;
    },

    emit : function(eventType, data) {
      var removed = [];
      this.forEach(function(el) {
        if (el.$$__notifier) {
          removed = el.$$__notifier.emit(eventType, data);
          if (helpers.isEventSupported(el, eventType)) {
            removed.forEach(function(removedListener) {
              el.removeEventListener(eventType, removedListener.fnCtx, false);
            });
          }
        }
      });
      return this;
    },

    emitNative : function(eventType, properties) {
      var notifier = new Notifier();
      notifier.emitNative.call(this, eventType, properties);
      return this;
    }
  };

})();
