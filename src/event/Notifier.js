import emitter from "src/event/Emitter";

export default class Notifier {

  constructor() {
    this.$$subscribers = {};
    this.$$counter = 1;
  }


  registerEvent(type, callback, ctx, once) {
    ctx = ctx || window;
    var currentId = ++this.$$counter;
    this.$$subscribers[type] = this.$$subscribers[type] || [];
    this.$$subscribers[type].push({
      id : this.$$counter,
      fn: callback,
      scope: ctx,
      once : once
    });
    return currentId;
  }


  on(type, callback, ctx) {
    this.registerEvent(type, callback, ctx, false);
  }


  off(type, callback, ctx) {
    ctx = ctx || window;
    this.$$subscribers[type] = this.$$subscribers[type].filter(function (subscriber) {
      if (!((subscriber.fn == callback) && (subscriber.scope == ctx))) {
        return subscriber;
      }
    });
    if(this.$$subscribers[type].length === 0) {
      delete this.$$subscribers[type];
    }
  }


  once(type, callback, ctx) {
    this.registerEvent(type, callback, ctx, true);
  }


  emit(type, message) {
    this.$$subscribers[type] = this.$$subscribers[type] || [];
    this.$$subscribers[type].forEach(function (subscriber, index) {
      subscriber.fn.call(subscriber.scope, message);
      if(subscriber.once === true) {
        this.$$subscribers[type].splice(index, 1);
        if(this.$$subscribers[type].length === 0) {
          delete this.$$subscribers[type];
        }
      }
    });
  }

  emitNative(eventName, properties) {
    emitter.emitNative.call(this, eventName, properties);
  }


}