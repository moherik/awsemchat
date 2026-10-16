globalThis.fetch = () => Promise.reject(new Error('Network access is unavailable in UI tests'));
