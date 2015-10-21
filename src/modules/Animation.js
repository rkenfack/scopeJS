export default (function() {

/*
idle
The current time of the animation is unresolved and there are no pending tasks. In this state the animation has no effect.
pending
The animation is waiting on some pending task to complete.
running
The animation has a resolved current time that changes on each sample (provided the animation playback rate is not zero).
paused
The animation has been suspended and the current time is no longer changing.
finished
The animation has reached the natural boundary of its playback range and the current time is no longer updating.	
*/
	
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
		
		finish : function() {
			this.forEach(function(el) {
				if(el.$$animationHandler) {
					el.$$animationHandler.finish();
				}
			});
			return this;
		},
		
		isPlaying : function() {
			var isPlaying = false;
			for(var i = 0; i<this.length; i++) {
				if(this[0].$$animationHandler && (this[0].$$animationHandler.playState == "running")) {
					isPlaying = true;
					break;
				}
			}
			return isPlaying;
			
		},

		pause : function() {
			this.forEach(function(el) {
				if(el.$$animationHandler) {
					el.$$animationHandler.pause();
				}
			});
			return this;
		},
		
		cancel : function() {
			this.forEach(function(el) {
				if(el.$$animationHandler) {
					el.$$animationHandler.cancel();
				}
			});
			return this;
		},
		
		stop : function() {
			this.forEach(function(el) {
				if(el.$$animationHandler && (el.$$animationHandler.playState == "running")) {
					el.$$animationHandler.stop();
				}
			});
			return this;
		},
		
		start : function() {
			this.forEach(function(el) {
				if(el.$$animationHandler && (el.$$animationHandler.playState == "paused")) {
					el.$$animationHandler.stop();
				}
			});
			return this;
		},

		animate : function animate(keyFrames, options) {

			var allPromises = [];
						
			var delay = 0;
			
			if(options.delay !== undefined && options.delay > 0) {
				delay = options.delay;
				options.delay = 0;
			}

			var timerId = window.setTimeout(function() {
							
				this.emit("animationStart", {target : this, keyFrames : keyFrames, options : options});
							
				this.forEach(function (el) {
					allPromises.push(animateElement(el, keyFrames, options));
				});						

				Promise.all(allPromises).then((function (e) {
					this.setProperty("$$animationTimer", null);
					this.emit("animationEnd", {target : this, keyFrames : keyFrames, options : options});
				}).bind(this));
							
			}.bind(this), delay);

			this.setProperty("$$animationTimer", timerId);

			return this;
		}
	};
	
})();