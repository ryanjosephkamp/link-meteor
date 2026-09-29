// Import links (0.5.0): decodes and parses delimited text and link lists off the page's main thread,
// and says how many rows it has read so far. Bytes or text come in and rows go out; nothing else.
import { decodeText, readText } from '../../core/imports.js';

// {id, kind, bytes? | text?, delimiter?} => {id, progress} while reading, then readText's result
// with the id, or {id, error}.
self.addEventListener('message', ({ data }) => {
  const { id, kind, bytes, delimiter } = data;
  try {
    const text = bytes ? decodeText(bytes) : String(data.text ?? '');
    self.postMessage({ id, ...readText(text, { kind, delimiter, onProgress: (rows) => self.postMessage({ id, progress: rows }) }) });
  } catch (error) { self.postMessage({ id, error: String(error?.message || error) }); }
});
