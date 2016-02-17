export default class Deferred {
  get promise() {
    return this._promise;
  }

  get status() {
    return this._status;
  }

  get isResolved() {
    return this.status === 'resolved';
  }

  get isRejected() {
    return this.status === 'rejected';
  }

  get isPending() {
    return this.status === 'pending';
  }

  constructor() {
    this._status = 'pending';
    this._promise = new Promise(
      (resolve, reject) => {
        this._resolve = resolve;
        this._reject = reject;
      });

    this.toJSON = function toJSON() {
      return {
        status: this.status,
        isPending: this.isPending
      };
    };
  }

  resolve(result) {
    if (this.isPending) {
      this._status = 'resolved';
      this._resolve(result);
    }
    return this;
  }

  reject(reason) {
    if (this.isPending) {
      this._status = 'rejected';
      this._reject(reason);
    }
    return this;
  }

  /**
   * Yields execution using process#nextTick()
   * and resolves into Deferred#status
   * @returns {Promise}
   */
  checkAsync() {
    return new Promise((resolve) => {
      process.nextTick(() => {
        resolve(this.status);
      });
    });
  }
}
