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

function load_saladict() {
  // 开启浏览器时，读取单词列表到 storage
  chrome.storage.local.get(["WordsFilePath"], function (result) {
    const filepath = result.WordsFilePath;

    if (filepath) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const vocabulary = parse_wordbook(e.target.result);
        chrome.storage.local.set({ vocabulary }, () => {
          console.info(`已导入 ${vocabulary.length} 个单词 `);
        });
      };
      reader.readAsText(filepath);
      return true;
    } else {
      console.warn("saladict 词库文件未设置！");
      return false;
    }
  });
}

// 监听来自其他扩展组件的消息
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === "call_load_saladict") {
    const result = load_saladict();
    sendResponse({ response: result });
    return true;
  }
  return false;
});

load_saladict();
