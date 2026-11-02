// Two things the bundled PDF reader uses that Chrome 116 to 123 lack, supplied only where
// missing: Promise.withResolvers (Chrome 119) and async iteration of ReadableStream (Chrome 124).
// Loaded before the reader, in the page and in its worker (pdfjs.js, pdfjs-worker.js).
Promise.withResolvers ??= function withResolvers() {
  let resolve, reject;
  const promise = new this((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
};
if (typeof ReadableStream !== 'undefined' && !ReadableStream.prototype[Symbol.asyncIterator]) {
  ReadableStream.prototype.values = function values({ preventCancel = false } = {}) {
    const reader = this.getReader();
    return {
      next: () => reader.read().then((result) => { if (result.done) reader.releaseLock(); return result; }),
      return: async (value) => { if (!preventCancel) await reader.cancel(value); reader.releaseLock(); return { done: true, value }; },
      [Symbol.asyncIterator]() { return this; },
    };
  };
  ReadableStream.prototype[Symbol.asyncIterator] = ReadableStream.prototype.values;
}
