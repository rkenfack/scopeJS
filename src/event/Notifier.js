import emitter from "src/event/Emitter";

export default class Notifier {

  constructor() {
    this.$$subscribers = {};
    this.$$counter = 1;
  }

  registerEvent(type, callback, ctx, once) {
    ctx = ctx || window;
    this.$$subscribers[type] = this.$$subscribers[type] || [];
    var listener = {
      fn: callback,
      fnCtx : function() { callback.apply(ctx, [].slice.call(arguments)); },
      scope: ctx,
      once : once
    };
    this.$$subscribers[type].push(listener);
    return listener;
  }


  on(type, callback, ctx) {
    return this.registerEvent(type, callback, ctx, false);
  }


  off(type, callback, ctx) {
    ctx = ctx || window;
    var removed = [];
    this.$$subscribers[type] = this.$$subscribers[type] || [];
    this.$$subscribers[type] = this.$$subscribers[type].filter(function (subscriber) {
      if (!((subscriber.fn == callback) && (subscriber.scope == ctx))) {
        removed.push(subscriber);
        return true;
      }
    });
    if(this.$$subscribers[type].length === 0) {
      delete this.$$subscribers[type];
    }
    return removed;
  }


  once(type, callback, ctx) {
    return this.registerEvent(type, callback, ctx, true);
  }


  emit(type, message) {

    var removed = [];
    this.$$subscribers[type] = this.$$subscribers[type] || [];
    this.$$subscribers[type].forEach(function (subscriber, index) {
      subscriber.fn.call(subscriber.scope, message);
      if(subscriber.once === true) {
        removed.push(subscriber);
      }
    });

    var index = null;
    removed.forEach(function(toRemove) {
      index = this.$$subscribers[type].indexOf(toRemove);
      this.$$subscribers[type].splice(index, 1);
    }, this);

    if(this.$$subscribers[type].length === 0) {
      delete this.$$subscribers[type];
    }

    return removed;
  }

  emitNative(eventName, properties) {
    emitter.emitNative.call(this, eventName, properties);
  }


}