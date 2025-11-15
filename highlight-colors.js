// 生成指定数量的不同颜色
function generateDistinctColors(count) {
  const colors = [];
  for (let i = 0; i < count; i++) {
    // 在色轮上均匀分布色调 (0 - 360)
    const hue = Math.floor(i * (360 / count));
    // 限制亮度范围，避免过亮或过暗的颜色
    const lightness = Math.floor(40 + (30 * i) / count) + "%"; // 亮度从 40% 到 70%
    const saturation = "70%"; // 保持饱和度

    // 确保边框颜色比背景颜色深
    const backgroundLightness = parseInt(lightness, 10);
    const borderLightness = Math.max(10, backgroundLightness - 20) + "%"; // 边框亮度至少为 10%，且比背景暗 20%

    colors.push({
      backgroundColor: `hsl(${hue}, ${saturation}, ${lightness})`,
      borderColor: `hsl(${hue}, ${saturation}, ${borderLightness})`,
    });
  }
  return colors;
}

// 预定义的颜色方案
const COLOR_SCHEMES = {
  basic: generateDistinctColors(30), // 生成 30 种颜色
};

// 根据单词生成唯一的数字
function getWordHash(word) {
  let hash = 0;
  for (let i = 0; i < word.length; i++) {
    hash = (hash << 5) - hash + word.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

// 获取单词的高亮颜色
function getHighlightColor(word) {
  // 使用单词的hash值来选择颜色
  const hash = getWordHash(word.toLowerCase());
  const colorIndex = hash % COLOR_SCHEMES.basic.length;
  const colorScheme = COLOR_SCHEMES.basic[colorIndex];

  return {
    backgroundColor: colorScheme.backgroundColor,
    borderColor: colorScheme.borderColor,
    borderRadius: "2px",
    padding: "0 2px",
    margin: "0 1px",
    transition: "all 0.2s ease-in-out",
  };
}

// 应用高亮样式到元素
window.applyHighlightStyle = function (element, word) {
  const style = getHighlightColor(word);
  // 从 content.js 获取 borderMode 变量
  chrome.storage.local.get("borderMode", function (result) {
    const borderMode = result.borderMode;
    if (borderMode) {
      // 如果是边框模式，则只应用边框样式，移除背景色
      Object.assign(element.style, {
        border: `1.5px solid ${style.borderColor}`,
        borderRadius: style.borderRadius,
        padding: style.padding,
        margin: style.margin,
        transition: style.transition,
        backgroundColor: "transparent", // 设置背景为透明
      });
    } else {
      // 否则应用完整的样式
      Object.assign(element.style, style);
    }
  });
};
