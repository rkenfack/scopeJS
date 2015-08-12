export default {

   isEventSupported : function (target, eventName) {
    eventName = "on" + eventName;
    var isSupported = (eventName in target);
    if (!isSupported) {
      target.setAttribute(eventName, "return;");
      isSupported = typeof target[eventName] == "function";
      target.removeAttribute(eventName);
    }
    return isSupported;
  }

};