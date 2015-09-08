import XHR from "src/core/XHR";

export default (function(){

	/**
	* *async*
	* *user*
	* *password*
	* *headers*
	* *timeout*
	*
	*/
	
	var defaultOptions = {
		async : true,
		timeout : 3000,
		user : null,
		password : "",
		cache : false
	};
	
	
	var processRequest = function(xhr, options) {
		
		options = options || {};
		options.headers = options.headers || {};		
		options = Object.assign(defaultOptions, options);
			
		xhr.setAsync(options.async);
		xhr.setCaching(options.cache);
		xhr.setTimeout(options.timeout);
			
		if(options.user !== null) {
			xhr.setCredencials(options.user, options.password);
		}		
		
		xhr.send();
		
		return new Promise(function(resolve, reject) {	
			xhr.on("success", function(e) {
				resolve(e);
			});
			xhr.on("fail", function(e) {
				reject(e);
			});
		});
	};
	
	var instance = null;
	
	var getInstance = function(method, url, data) {
		data = data || {};
		if(instance === null) {
			instance = new XHR(method, url, data);
			instance.$$oid = "scope_"+(new Date()).getTime();
		} else {
			instance.setMethod(method);
			instance.setUrl(url);
			instance.setRequestData(data);
		}		
		return instance;
	};
	
	
	return {
		
		/**
		* Send an http get request
		* @param url {String} The request url
		* @param data {Map} Map containing key/value pairs data to be sent
		* @param options {Map} Map containing the request options.
		*   
		*
		*/
		get : function(url, data, options) {			
			return processRequest(getInstance("get", url, data), options);			
		},
		
		
		post : function(url, data, options) {
			return processRequest(getInstance("post", url, data), options);		
		},
		
		
		put : function(url, data, options) {
			return processRequest(getInstance("put", url, data), options);		
		},
		
		
		delete : function(url, data, options) {
			return processRequest(getInstance("delete", url, data), options);			
		}
		
	};
	
})();