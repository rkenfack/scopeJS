import somatemplate from "src/resources/soma-template";

export default (function() {

  var applyChanges = function(template, model) {

    var firstCharCode = null;
    var keysArray = Object.keys(Object(model));
    var changeCount = 0;

    for (var nextIndex = 0, len = keysArray.length; nextIndex < len; nextIndex++) {
      var nextKey = keysArray[nextIndex];
      if((nextKey.toLowerCase().charAt(0) != "_") && (nextKey.toLowerCase().charAt(0) != "$")) {
        changeCount ++;
        var desc = Object.getOwnPropertyDescriptor(model, nextKey);
        if (desc !== undefined && desc.enumerable) {
          template.scope[nextKey] = model[nextKey];
        }
      }
    }

    if(changeCount > 0) {
      template.render();
    }

  };

  return {
    template : function (model) {
      var template = somatemplate.create(this[0]);
      applyChanges(template, model);
      Object.observe(model, applyChanges.bind(this, template, model));
      return this;
    }
  };

})();


