export default class Notifier {

  constructor() {
    this.subscribers = {};
  }

  subscribe(type, callback, ctx) {
    ctx = ctx || window;
    this.subscribers[type] = this.subscribers[type] || [];
    this.subscribers[type].push({
      fn: callback,
      scope: ctx
    });
  }


  unsubscribe(type, callback, ctx) {
    ctx = ctx || window;
    this.subscribers[type] = this.subscribers[type].filter(function (subscriber) {
      if (!((subscriber.fn == callback) && (subscriber.scope == ctx))) {
        return subscriber;
      }
    });
  }


  notify(type, message) {
    this.subscribers[type] = this.subscribers[type] || [];
    this.subscribers[type].forEach(function (subscriber) {
      subscriber.fn.call(subscriber.scope, message);
    });
  }

}