// 生成 UUID
export function generateUUID() {
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
  );
}

// 简单的防抖函数
export function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// 导出到全局 (供 content scripts 使用)
// if (typeof window !== "undefined") {
//   window.generateUUID = generateUUID;
//   window.debounce = debounce;
// }

// import { generateUUID, debounce } from "../utils/helpers.js";
