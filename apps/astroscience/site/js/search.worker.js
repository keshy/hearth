import { search } from "./search.js";

self.onmessage = (e) => {
  try {
    const results = search({ ...e.data, onProgress: (p) => self.postMessage({ progress: p }) });
    self.postMessage({ results });
  } catch (err) {
    self.postMessage({ error: err.message });
  }
};
