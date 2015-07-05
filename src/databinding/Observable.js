import Notifier from "src/event/Notifier";

export default class Observable {

  constructor() {
    this.$$__notifier = new Notifier();
    Object.observe(this, this.onChange.bind(this));
  }


  onChange(changes) {

    var eventName = null;
    changes = this.extractPublicMembers(changes);

    changes.forEach(function (change) {
      eventName = change.name + "Change";
      this.fireEvent(eventName, change);
    }.bind(this));

    if(changes.length > 0) {
      this.fireEvent("change", changes);
    }

  }


  extractPublicMembers(changes) {
    var firstCharCode = null;
    changes = changes.filter(function(change) {
      firstCharCode = change.name.toLowerCase().charCodeAt(0);
      return (firstCharCode >= 97 && firstCharCode <= 122);
    });
    return changes;
  }


  addListener(eventType, listener, context) {
    this.$$__notifier.subscribe(eventType, listener, context);
  }


  fireEvent(eventType, eventData) {
    window.setTimeout(this.$$__notifier.notify.bind(this.$$__notifier, eventType, eventData), 0);
  }


  on(eventType, listener, context) {
    this.addListener(eventType, listener, context);
  }


  off(eventType, listener, context) {
    this.$$__notifier.unsubscribe(eventType, listener, context);
  }


  once(eventType, listener, context) {
    var that = this;
    var callback = function () {
      listener.apply(context, [].slice.call(arguments));
      this.off(eventType, callback);
    }.bind(this);
    this.addListener(eventType, callback, context);
  }


}