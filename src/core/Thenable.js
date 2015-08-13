
export default class Thenable {

  constructor(promise, abort) {
    this.__promise = promise;
    this.__abort = abort || null;
    this.__rejectionCallback = null;
  }

  /**
   * Returns the internal created promise object
   * @return {Promise} The created promise object
   */
  _getPromise() {
    return this.__promise;
  }

  /**
   * Sets a new promise object
   *
   * @param promise {Promise} A promise object
   */
  _setPromise(promise) {
    this.__promise = promise;
  }


  /**
   * Appends fulfillment and rejection handlers to the promise of the timer
   *
   * @param onFulfilled {Function} fulfillment handler.
   * @param onRejected {Function} rejection handler
   * @return {baselib.module.promise.Thenable} The thenable instance.
   */
  then(onFulfilled, onRejected) {
    this.__rejectionCallback = onRejected;
    if (this.__promise) {
      this.__promise = this.__promise.then(onFulfilled, onRejected);
    }
    return this;
  }


  /**
   * Appends a rejection handler callback to the promise of the timer
   *
   * @param onRejected {Function} rejection handler
   * @return {baselib.module.promise.Thenable} The thenable instance.
   */
  catch (onRejected) {
    if (this.__promise) {
      this.__promise = this.__promise["catch"](onRejected);
    }
    return this;
  }


  /**
   * Appends a rejection handler callback to the promise of the timer
   *
   * @param onRejected {Function} rejection handler
   * @return {baselib.module.promise.Thenable} The thenable instance.
   */
  fail(onRejected) {
    return this["catch"](onRejected);
  }


  /**
   * Abort request - i.e. cancels any network activity.
   * @param reason {Object?} The reason of the abortion.
   * @return {baselib.module.promise.Thenable} The thenable instance.
   */
  abort(reason) {
    if (this.__abort) {
      this.__abort();
    }
    return this;
  }

  /**
   * Returns the rejection callback
   */
  _getRejectionCallback() {
    return this.__rejectionCallback;
  }

}
