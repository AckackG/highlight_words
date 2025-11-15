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

function showToast(message) {
  const toastContainer = document.createElement("div");
  toastContainer.id = "myToastContainer";
  toastContainer.innerHTML = `<div id="myToast">${message}</div>`;
  document.body.appendChild(toastContainer);

  // 添加 CSS 样式 (也可以通过 link 引入外部 CSS)
  const style = document.createElement("style");
  style.textContent = `
    #myToastContainer {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1000; /* 确保在最上层 */
    }

    #myToast {
    background-color: green;
    color: white;
    text-align: center;
    border-radius: 5px;
    padding: 16px;
    font-size: 16px;
    }
`;
  document.head.appendChild(style);

  // 延时消失
  setTimeout(function () {
    toastContainer.remove();
  }, 3000); // 3秒后消失
}

document.addEventListener("DOMContentLoaded", () => {
  const textarea = document.getElementById("vocabularyText");
  const saveBtn = document.getElementById("saveBtn");
  const borderModeCheckbox = document.getElementById("borderMode");
  const saladictPath = document.getElementById("saladictInput");
  const updateinfodiv = document.getElementById("updateinfo");

  // 加载已保存的词表和边框模式
  chrome.storage.local.get(["vocabulary", "borderMode", "UpdateInfo"], function (result) {
    if (result.vocabulary) {
      textarea.value = result.vocabulary.join("\n");
    }
    borderModeCheckbox.checked = result.borderMode || false; // 默认关闭

    if (result.UpdateInfo) {
      updateinfodiv.innerHTML = result.UpdateInfo;
    }
  });

  // 保存 btn
  saveBtn.addEventListener("click", () => {
    // border mode
    const borderMode = borderModeCheckbox.checked;
    chrome.storage.local.set({ borderMode });

    // load volcabulary
    const file = saladictPath.files[0];

    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const vocabulary = parse_wordbook(e.target.result);
        const UpdateInfo = `${vocabulary.length}单词, 更新于 ${new Date().toLocaleString()}`;
        chrome.storage.local.set({ vocabulary, UpdateInfo }, () => {
          textarea.value = vocabulary.join("\n");
          updateinfodiv.innerHTML = UpdateInfo;

          showToast(`已导入 ${vocabulary.length} 个单词 `);
        });
      };
      reader.readAsText(file);
    } else {
      showToast("saladict 词库文件未设置！");
    }
  });
});
