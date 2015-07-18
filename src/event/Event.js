import utils from "src/utils/Utils";
import helpers from "src/event/Helpers";

export default {

  on : function (eventType, listener, context, useCapture) {

    context = context || this;

    this.forEach(function (el) {
      listener.$$__listenerId = listener.$$__listenerId || String(utils.getUID());
      el.$$__listeners = el.$$__listeners || {};
      if (!el.$$__listeners[eventType]) {
        el.$$__listeners[eventType] = [];
      }
      context.$$__boundListeners = context.$$__boundListeners || {};
      if (!context.$$__boundListeners[eventType]) {
        context.$$__boundListeners[eventType] = [];
      }
      context.$$__boundListeners[eventType].push(listener.$$__listenerId);
      var callback = null;
      if (helpers.isEventSupported(el, eventType)) {
        callback = function () {
          listener.apply(context, [].slice.call(arguments));
        };
        el.addEventListener(eventType, callback, useCapture);
      } else {
        callback = listener;
      }
      el.$$__listeners[eventType][listener.$$__listenerId] = {
        type : eventType,
        originalListener : listener,
        listener: callback,
        context: context,
        useCapture: useCapture
      };
    });
    return this;
  },



  off : function (eventType, listener, context, useCapture) {
    context = context || this;
    var boundListeners = context.$$__boundListeners;
    this.forEach(function (el) {
      var listenerId = listener.$$__listenerId;
      if (listenerId) {
        var observerStore = el.$$__listeners[eventType][listenerId];
        if (observerStore && (observerStore.useCapture === useCapture)) {
          if (boundListeners && boundListeners[eventType] && (boundListeners[eventType].indexOf(listenerId) != -1)) {
            el.removeEventListener(eventType, observerStore.listener, useCapture);
            var index = el.$$__listeners[eventType].indexOf(listenerId);
            el.$$__listeners[eventType][listenerId] = undefined;
            el.$$__listeners[eventType] = el.$$__listeners[eventType].splice(index, 1);
          }

        }
      }
    });
    return this;
  },



  once : function (eventType, listener, context, useCapture) {
    context = context || this;
    this.forEach(function (el) {
      var callback = null;
      if (isEventSupported(el, eventType)) {
        callback = function () {
          listener.apply(context, [].slice.call(arguments));
          el.removeEventListener(eventType, callback, useCapture);
        };
        el.addEventListener(eventType, callback, useCapture);
      } else {
        callback = listener;
      }
    });
    return this;
  },



  emit : function(eventType, data) {
    var listeners = null;
    var storedInfo = null;
    this.forEach(function(el) {
      if(el.$$__listeners[eventType]) {
        listeners = el.$$__listeners[eventType];
        for(var listenerId in listeners) {
          storedInfo = listeners[listenerId];
          storedInfo.originalListener.call(storedInfo.context, data);
        }
      }
    });
  },

  emitNative : function(eventType, properties) {

  }

};