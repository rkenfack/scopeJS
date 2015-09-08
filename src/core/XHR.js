import Notifier from "src/event/Notifier";
import utils from "src/utils/Utils";
import uriUtils from "src/utils/Uri";
import Logger from "src/modules/Logger";


class XHR extends Notifier {

  constructor(method, url, data) {
    super();
    this.init(method, url, data);
  }


  init(method, url, data) {

    method = method.toUpperCase();

    this.__xhr = window.XMLHttpRequest ? new XMLHttpRequest() : new ActiveXObject('Microsoft.XMLHTTP');
    this.__method = ["POST", "GET"].indexOf(method) != -1 ? method : "GET";
    this.__data = data || null;
    this.__requestHeaders = {};
    this.__response = null;
    this.__timeout = null;
    this.__async = true;
    this.__user = null;
    this.__password = null;
    this.__url = null;

    this.setUrl(url);

    this.__addListeners();
  }

  setCredencials(user, password) {
    this.__user = user;
    this.__password = password;
  }


  setAsync(async) {
    this.__async = async;
  }


  getAsync() {
    return this.__async;
  }


  getMethod() {
    return this.__method;
  }


  setMethod(method) {
    this.__method = method;
  }


  getTimeout() {
    return this.__timeout;
  }


  setTimeout(timeout) {
    this.__timeout = timeout;
  }


  setRequestData(data) {
    var dataType = utils.getType(data);
    if ((dataType == "String") || (dataType == "Object")) {
      this.__data = data;
    }
    return this;
  }


  getRequestData() {
    return this.__data;
  }


  setRequestHeader(key, value) {
    this.__requestHeaders[key] = value;
    return this;
  }


  getRequestHeader(key) {
    return this.__requestHeaders[key];
  }


  setUrl(url) {
    if (utils.getType(url) == "String") {
      this.__url = url;
    }
  }

  getUrl() {
    return this.__url;
  }


  isSupportedMethod(method) {
    return XHR.knownMethods.indexOf(method) != -1;
  }

  setCaching(caching) {
    this.__caching = caching;
  }


  isCaching() {
    return this.__caching === true;
  }


  isSuccessful(status) {
    return (status >= 200 && status < 300 || status === 304);
  }


  getXhr() {
    return this.__xhr;
  }


  send() {

    var xhr = this.getXhr();
    var curTimeout = this.getTimeout();
    var hasRequestData = (this.getRequestData() !== null);
    var hasCacheControlHeader = this.__requestHeaders.hasOwnProperty("Cache-Control");
    var isBodyForMethodAllowed = this._methodAllowsBody(this.getMethod());
    var curContentType = this.getRequestHeader("Content-Type");
    var serializedData = this._serializeData(this.getRequestData(), curContentType);

    // add GET params if needed
    if (this.getMethod() === "GET" && hasRequestData) {
      this.setUrl(uriUtils.appendParamsToUrl(this.getUrl(), serializedData));
    }

    // cache prevention
    if (this.isCaching() === false && !hasCacheControlHeader) {
      // Make sure URL cannot be served from cache and new request is made
      this.setUrl(uriUtils.appendParamsToUrl(this.getUrl(), {
        nocache: new Date().valueOf()
      }));
    }    

    // initialize request
    xhr.open(this.getMethod(), this.getUrl(), this.__async);
	
	// set timeout
    if (curTimeout) {	
      xhr.timeout = curTimeout;
    }

    // set all previously stored headers on initialized request
    for (var key in this.__requestHeaders) {
      xhr.setRequestHeader(key, this.__requestHeaders[key]);
    }

    // send
    if (!isBodyForMethodAllowed) {
      // GET & HEAD
      xhr.send();
    } else {
      // POST & PUT ...
      if (typeof curContentType === "undefined") {
        // by default, set content-type urlencoded for requests with body
        xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
      }

      xhr.send(serializedData);
    }

    return this;

  }


  abort() {
    this.getXhr().abort();
    return this;
  }


  /**
   * Serializes data.
   *
   * @param data {String|Map} Data to serialize.
   * @param contentType {String?} Content-Type which influences the serialisation.
   * @return {String|null} Serialized data.
   */
  _serializeData(data, contentType) {

    var isPost = this.getMethod() === "POST";
    var isJson = (/application\/.*\+?json/).test(contentType);
    var dataType = utils.getType(data);

    if (!data) {
      return null;
    }

    if (dataType == "String") {
      return data;
    }

    if (isJson && (dataType == "Object" || dataType == "Array")) {
      return JSON.stringify(data);
    }

    if (dataType == "Object") {
      return uriUtils.toParameter(data, isPost);
    }

    return null;
  }


  _methodAllowsBody(method) {
    return ["GET", "HEAD"].indexOf(method) == -1;
  }


  _setResponse(response) {
    this.__response = response;
  }


  _onReadyStateChange() {
    if (this.getXhr().readyState == 4) {
      this._done();
    }
  }


  _done() {

    var xhr = this.getXhr();
    var response = xhr.responseText;
    var contentType = xhr.getResponseHeader("Content-Type");

    if (this.isSuccessful(xhr.status)) {
      this._setResponse(this.__parse(response, contentType));
      this.emit("success", xhr);
    } else {
      try {
        this._setResponse(this.__parse(response, contentType));
      } catch (e) {
        // ignore if it does not work
      }
      // A remote error failure
      if (xhr.status !== 0) {
        this.emit("fail", xhr);
      }
    }
  }


  __parse(response, contentType) {

    var contentTypeOrig = contentType || "";

    // Ignore parameters (e.g. the character set)
    var contentTypeNormalized = contentTypeOrig.replace(/;.*$/, "");

    if ((/^application\/(\w|\.)*\+?json$/).test(contentTypeNormalized)) {
      try {
        response = JSON.parse(response);
      } catch (e) {
        Logger.error("Error while parsing JSON body : " + e);
      }
    }

    if ((/^application\/xml$/).test(contentTypeNormalized)) {
      try {
        if (window.DOMParser) {
          response = (new DOMParser()).parseFromString(response, 'text/xml');
        }
        // IE<9
        else {
          response = new ActiveXObject('Microsoft.XMLDOM');
          response.async = 'false';
          response.loadXML(response);
        }
      } catch (e) {
        response = undefined;
      }

      if (!response || !response.documentElement || response.getElementsByTagName('parsererror').length) {
        Logger.error('Invalid XML');
      }

    }

  }


  _onLoadEnd() {
    this.emit("loadEnd", this.getXhr());
  }


  _onTimeout() {
    this.emit("timeout", this.getXhr());
    this.emit("fail", this.getXhr());
  }


  _onError() {
    this.emit("timeout", this.getXhr());
    this.emit("fail", this.getXhr());
  }


  _onAbort() {
    this.emit("abort", this.getXhr());
  }


  __addListeners() {
    var xhr = this.getXhr();
    if (xhr) {
      xhr.onreadystatechange = this._onReadyStateChange.bind(this);
      xhr.onloadend = this._onLoadEnd.bind(this);
      xhr.ontimeout = this._onTimeout.bind(this);
      xhr.onerror = this._onError.bind(this);
      xhr.onabort = this._onAbort.bind(this);
    }
    return this;
  }

}

XHR.knownMethods = ["GET", "POST", "PUT", "DELETE", "HEAD", "TRACE", "OPTIONS", "CONNECT", "PATCH"];


export default XHR;
