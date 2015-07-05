export default (function() {

  var __readyCallbacks = [];

  var __executeReadyCallbacks = function () {
    window.removeEventListener("load", __executeReadyCallbacks, false);
    __readyCallbacks.forEach(function (callback) {
      callback();
    });
    __readyCallbacks = [];
  };


  if (document.addEventListener) {
    window.addEventListener("load", __executeReadyCallbacks, false);
    document.addEventListener("DOMContentLoaded", __executeReadyCallbacks);
  }

  return {
    ready : function(callback) {
      if (document.readyState === "complete") {
        window.setTimeout(callback, 1);
        return;
      }
      __readyCallbacks.push(callback);
    }
  };

})();