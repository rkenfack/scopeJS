export default (function() {	
	
	var animateElement = function animateElement(el, keyFrames, options) {					
	
		if (el.$$animationHandler) {
			el.$$animationHandler.cancel();
		}
			
		var finishCallback = null; 
					
		el.$$animationHandler = el.animate(keyFrames, options);										

		return new Promise(function (resolve, reject) {
			finishCallback = function(e) {
				resolve(el.$$animationHandler);
				el.$$animationHandler.removeEventListener("finish", finishCallback, false);
			};
			el.$$animationHandler.addEventListener("finish", finishCallback, false);						
		});
	};

	return {					

		animate : function animate(keyFrames, options) {

			var allPromises = [];
						
			var delay = 0;					
			if(options.delay !== undefined && options.delay > 0) {
				delay = options.delay;
				options.delay = 0;
			}

			window.setTimeout(function() {
							
				this.emit("animationStart", {target : this, keyFrames : keyFrames, options : options});
							
				this.forEach(function (el) {
					allPromises.push(animateElement(el, keyFrames, options));
				});						

				Promise.all(allPromises).then((function (e) {
					this.emit("animationEnd", {target : this, keyFrames : keyFrames, options : options});
				}).bind(this));
							
			}.bind(this), delay);					

			return this;
		}
	};
	
})();