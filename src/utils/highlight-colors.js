// 生成指定数量的不同颜色
function generateDistinctColors(count) {
  const colors = [];
  for (let i = 0; i < count; i++) {
    const hue = Math.floor(i * (360 / count));
    const lightness = Math.floor(40 + (30 * i) / count) + "%";
    const saturation = "70%";
    const backgroundLightness = parseInt(lightness, 10);
    const borderLightness = Math.max(10, backgroundLightness - 20) + "%";

    colors.push({
      backgroundColor: `hsl(${hue}, ${saturation}, ${lightness})`,
      borderColor: `hsl(${hue}, ${saturation}, ${borderLightness})`,
    });
  }
  return colors;
}

const COLOR_SCHEMES = {
  basic: generateDistinctColors(30),
};

function getWordHash(word) {
  let hash = 0;
  for (let i = 0; i < word.length; i++) {
    hash = (hash << 5) - hash + word.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function getHighlightColor(word) {
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

// 挂载到 window 以供 Content Script 调用
window.applyHighlightStyle = function (element, word, borderMode) {
  const style = getHighlightColor(word);
  if (borderMode) {
    Object.assign(element.style, {
      borderBottom: `2px solid ${style.borderColor}`,
      borderRadius: "0",
      padding: "0",
      margin: "0",
      backgroundColor: "transparent",
      color: "inherit",
    });
  } else {
    Object.assign(element.style, style);
    element.style.color = "#000"; // 确保高亮背景下文字可见
  }
};
