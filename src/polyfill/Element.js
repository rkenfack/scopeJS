export default (function () {

  if (!Element.prototype.matches) {
    var p = Element.prototype;
    var f = p.webkitMatchesSelector || p.mozMatchesSelector || p.msMatchesSelector || function (s) {
      return [].indexOf.call(document.querySelectorAll(s), this) !== -1;
    };
    return f.call(this, selector);
  }

})();
