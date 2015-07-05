/**
* Here the place where to specific settings for production
*
*/
(function() {

  // Only enables errors
  if(scope && scope.Logger) {
    scope.Logger.setLevel("error");
  }

})();