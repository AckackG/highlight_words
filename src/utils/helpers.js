// ==========================================
// Utils: Helpers
// ==========================================
(function (global) {
  function generateUUID() {
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
    );
  }

  function debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  // 挂载到全局
  global.VH_Helpers = {
    generateUUID,
    debounce,
  };
})(globalThis);
