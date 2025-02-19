// 添加解析沙拉查词JSON的函数
function parse_wordbook(jsonData) {
  try {
    // 将 JSON 字符串解析为 JavaScript 对象
    const jsonObject = JSON.parse(jsonData);

    // 检查是否成功解析并且存在 'words' 属性
    if (jsonObject && jsonObject.words && Array.isArray(jsonObject.words)) {
      const wordsArray = jsonObject.words;
      const extractedWords = [];

      // 遍历 'words' 数组
      for (const wordItem of wordsArray) {
        // 检查每个元素是否是对象并且包含 'text' 属性
        if (wordItem && typeof wordItem === "object" && wordItem.hasOwnProperty("text")) {
          extractedWords.push(wordItem.text);
        }
      }

      if (extractedWords.length === 0) {
        console.error("提取的词库为空。");
      } else {
        console.log("提取的词库:", extractedWords);
      }

      return extractedWords;
    } else {
      console.error("JSON 数据格式不正确，缺少 'words' 数组或格式错误。");
      return []; // 返回空数组表示提取失败
    }
  } catch (error) {
    console.error("解析 JSON 字符串时发生错误:", error);
    return []; // 返回空数组表示提取失败
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const textarea = document.getElementById("vocabularyText");
  const saveBtn = document.getElementById("saveBtn");
  const fileInput = document.getElementById("fileInput");
  const borderModeCheckbox = document.getElementById("borderMode");
  const saladictInput = document.getElementById("saladictInput");

  // 加载已保存的词表和边框模式
  chrome.storage.local.get(["vocabulary", "borderMode"], function (result) {
    if (result.vocabulary) {
      textarea.value = result.vocabulary.join("\n");
    }
    borderModeCheckbox.checked = result.borderMode || false; // 默认关闭
  });

  // 处理沙拉查词JSON导入
  let saladictWords = []; // 存储沙拉查词词库

  saladictInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        saladictWords = parse_wordbook(e.target.result);
        chrome.storage.local.set({ saladictWords }, () => {
          alert("沙拉查词词库导入成功！");
        });
      };
      reader.readAsText(file);
    }
  });

  // 保存词表和边框模式
  saveBtn.addEventListener("click", () => {
    const additionalWords = textarea.value
      .split("\n")
      .map((word) => word.trim().toLowerCase())
      .filter((word) => word.length > 0);

    const borderMode = borderModeCheckbox.checked;

    // 合并词库
    chrome.storage.local.get(["saladictWords"], (result) => {
      const vocabulary = [...(result.saladictWords || []), ...additionalWords];
      chrome.storage.local.set({ vocabulary, borderMode, additionalWords }, () => {
        alert("保存成功！");
      });
    });
  });

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        textarea.value = e.target.result;
      };
      reader.readAsText(file);
    }
  });
});
