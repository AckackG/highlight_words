(function () {
  const Validator = {
    /**
     * 判断选区是否有效（是否应该触发翻译）
     * @param {string} text - 选中的文本
     * @param {HTMLElement} target - 触发事件的 DOM 元素
     * @returns {boolean} - true 表示有效，应该触发翻译
     */
    isValid(text, target) {
      if (!text) return false;
      const cleanText = text.trim();

      // 1. 基础长度校验 (太短或太长都不行)
      if (cleanText.length < 2 || cleanText.length > 50) return false;

      // 2. 输入框/编辑区忽略
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return false;
      }

      // 3. 排除中文干扰 (目标是翻译成中文，选中中文通常是复制)
      if (/[\u4e00-\u9fa5]/.test(cleanText)) return false;

      // 4. 排除纯数字、纯符号 (如 "2024", ">>>")
      if (/^[\d\s\p{P}+=<>^`~|]+$/u.test(cleanText)) return false;

      // 5. 排除代码特征 (含 {} [] _ \ 等非自然语言符号)
      if (/[{}[\]\\_]/.test(cleanText)) return false;

      // 6. 排除无空格的长字符串 (如 URL, Token, SessionID)
      if (cleanText.length > 20 && !/\s/.test(cleanText)) return false;

      return true;
    },
  };

  // 暴露给全局 (Content Script 环境)
  window.VocabularyValidator = Validator;
})();
