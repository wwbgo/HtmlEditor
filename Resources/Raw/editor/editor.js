(function () {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let editor;
  let lastFullHtml = "";
  let lastBaseHref = "";
  let lastTitle = "HTML Document";
  let lastHeadExtras = "";
  let lastBodyScripts = "";
  let lastBodyAttrs = "";
  let lastHtmlAttrs = 'lang="zh-CN"';

  function toBase64(value) {
    const bytes = encoder.encode(value || "");
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  function fromBase64(value) {
    if (!value) {
      return "";
    }

    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return decoder.decode(bytes);
  }

  function splitHtml(fullHtml) {
    const source = fullHtml || "";
    const parser = new DOMParser();
    const doc = parser.parseFromString(source, "text/html");
    const bodyScripts = Array.from(doc.body.querySelectorAll("script"))
      .map((script) => script.outerHTML)
      .join("\n");

    doc.body.querySelectorAll("script").forEach((script) => script.remove());

    const styles = Array.from(doc.head.querySelectorAll("style"))
      .map((style) => style.textContent || "")
      .join("\n\n");

    const headExtras = Array.from(doc.head.children)
      .filter((element) => !isGeneratedHeadElement(element))
      .map((element) => element.outerHTML)
      .join("\n");

    return {
      body: doc.body ? doc.body.innerHTML : source,
      css: styles,
      title: doc.title || "HTML Document",
      headExtras,
      bodyScripts,
      bodyAttrs: doc.body ? attrsToString(doc.body) : "",
      htmlAttrs: doc.documentElement ? attrsToString(doc.documentElement) : 'lang="zh-CN"'
    };
  }

  function buildHtml() {
    const html = normalizeHtmlForSave(editor ? editor.getHtml() : "");
    const css = mapCssUrls(editor ? editor.getCss() : "", relativizeAssetUrl);
    const headExtras = normalizeHtmlFragmentForSave(lastHeadExtras);
    const bodyScripts = normalizeHtmlFragmentForSave(lastBodyScripts);
    return [
      "<!doctype html>",
      `<html ${lastHtmlAttrs || 'lang="zh-CN"'}>`,
      "<head>",
      '  <meta charset="utf-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1">',
      `  <title>${escapeHtml(lastTitle)}</title>`,
      headExtras.trim(),
      css.trim() ? `  <style>\n${css}\n  </style>` : "",
      "</head>",
      `<body${lastBodyAttrs ? ` ${lastBodyAttrs}` : ""}>`,
      html,
      bodyScripts.trim(),
      "</body>",
      "</html>"
    ].filter(Boolean).join("\n");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isGeneratedHeadElement(element) {
    const tag = element.tagName.toLowerCase();
    if (tag === "title" || tag === "style") {
      return true;
    }

    if (tag === "meta") {
      const charset = element.getAttribute("charset");
      const name = element.getAttribute("name");
      return Boolean(charset) || String(name || "").toLowerCase() === "viewport";
    }

    return false;
  }

  function attrsToString(element) {
    return Array.from(element.attributes)
      .map((attribute) => `${attribute.name}="${escapeHtml(attribute.value)}"`)
      .join(" ");
  }

  function rewriteDocumentUrls(doc, mapper) {
    rewriteUrlAttributes(doc, mapper);
    rewriteInlineStyles(doc, mapper);
  }

  function rewriteUrlAttributes(root, mapper) {
    const attributes = ["src", "href", "poster"];
    root.querySelectorAll("[src],[href],[poster]").forEach((element) => {
      attributes.forEach((attribute) => {
        if (!element.hasAttribute(attribute)) {
          return;
        }

        const tag = element.tagName.toLowerCase();
        if (attribute === "href" && tag !== "link" && tag !== "a") {
          return;
        }

        const value = element.getAttribute(attribute);
        const mapped = mapper(value);
        if (mapped !== value) {
          element.setAttribute(attribute, mapped);
        }
      });
    });

    root.querySelectorAll("[srcset]").forEach((element) => {
      const value = element.getAttribute("srcset");
      element.setAttribute("srcset", mapSrcset(value, mapper));
    });
  }

  function rewriteInlineStyles(root, mapper) {
    root.querySelectorAll("[style]").forEach((element) => {
      const value = element.getAttribute("style");
      element.setAttribute("style", mapCssUrls(value, mapper));
    });

    root.querySelectorAll("style").forEach((element) => {
      element.textContent = mapCssUrls(element.textContent || "", mapper);
    });
  }

  function mapCssUrls(css, mapper) {
    return String(css || "").replace(/url\((['"]?)(.*?)\1\)/gi, (_match, quote, rawUrl) => {
      const mapped = mapper(rawUrl.trim());
      return `url(${quote || ""}${mapped}${quote || ""})`;
    });
  }

  function mapSrcset(value, mapper) {
    return String(value || "")
      .split(",")
      .map((part) => {
        const trimmed = part.trim();
        if (!trimmed) {
          return "";
        }

        const pieces = trimmed.split(/\s+/);
        pieces[0] = mapper(pieces[0]);
        return pieces.join(" ");
      })
      .filter(Boolean)
      .join(", ");
  }

  function relativizeAssetUrl(value) {
    const url = String(value || "").trim();
    if (!url || !lastBaseHref || shouldKeepUrl(value)) {
      return value;
    }

    if (!isRuntimeLocalAbsoluteUrl(url)) {
      return value;
    }

    try {
      const base = new URL(lastBaseHref);
      const target = new URL(url, lastBaseHref);
      const sameLocalOrigin = base.protocol === "file:"
        ? target.protocol === "file:"
        : target.origin === base.origin;

      if (!sameLocalOrigin) {
        return value;
      }

      const relative = pathRelative(decodeURIComponent(base.pathname), decodeURIComponent(target.pathname));
      return relative
        ? `${relative}${target.search || ""}${target.hash || ""}`
        : value;
    } catch {
      return value;
    }
  }

  function shouldKeepUrl(value) {
    const url = String(value || "").trim().toLowerCase();
    return url.startsWith("#")
      || url.startsWith("data:")
      || url.startsWith("http:")
      || url.startsWith("https:")
      || url.startsWith("mailto:")
      || url.startsWith("tel:")
      || url.startsWith("javascript:");
  }

  function pathRelative(basePath, targetPath) {
    const baseParts = normalizeBasePath(basePath).split("/").filter(Boolean);
    const targetParts = normalizeTargetPath(targetPath).split("/").filter(Boolean);

    while (baseParts.length && targetParts.length && baseParts[0].toLowerCase() === targetParts[0].toLowerCase()) {
      baseParts.shift();
      targetParts.shift();
    }

    return "../".repeat(baseParts.length) + targetParts.map(encodeURIComponent).join("/");
  }

  function normalizeBasePath(path) {
    let normalized = String(path || "").replace(/\\/g, "/");
    normalized = stripWindowsUrlPrefix(normalized);
    if (!normalized.endsWith("/")) {
      normalized = normalized.substring(0, normalized.lastIndexOf("/") + 1);
    }
    return normalized;
  }

  function normalizeTargetPath(path) {
    return stripWindowsUrlPrefix(String(path || "").replace(/\\/g, "/"));
  }

  function stripWindowsUrlPrefix(path) {
    return String(path || "").replace(/^\/([A-Za-z]:\/)/, "$1");
  }

  function isRuntimeLocalAbsoluteUrl(url) {
    try {
      const parsed = new URL(url, lastBaseHref);
      return parsed.protocol === "file:";
    } catch {
      return false;
    }
  }

  function normalizeHtmlForSave(html) {
    const template = document.createElement("template");
    template.innerHTML = html || "";
    rewriteUrlAttributes(template.content, relativizeAssetUrl);
    rewriteInlineStyles(template.content, relativizeAssetUrl);
    return template.innerHTML;
  }

  function normalizeHtmlFragmentForSave(html) {
    const template = document.createElement("template");
    template.innerHTML = html || "";
    rewriteUrlAttributes(template.content, relativizeAssetUrl);
    rewriteInlineStyles(template.content, relativizeAssetUrl);
    return template.innerHTML;
  }

  function loadHtml(fullHtml, baseHref) {
    lastFullHtml = fullHtml || "";
    lastBaseHref = baseHref || "";
    const parts = splitHtml(lastFullHtml);
    lastTitle = parts.title;
    lastHeadExtras = parts.headExtras;
    lastBodyScripts = parts.bodyScripts;
    lastBodyAttrs = parts.bodyAttrs;
    lastHtmlAttrs = parts.htmlAttrs;
    applyCanvasHead(parts);
    editor.setComponents(parts.body || "");
    editor.setStyle(parts.css || "");
    setTimeout(() => applyCanvasHead(parts), 0);
    editor.UndoManager.clear();
  }

  function applyCanvasHead(parts) {
    const canvasDocument = editor.Canvas.getDocument();
    if (!canvasDocument || !canvasDocument.head) {
      return;
    }

    canvasDocument.head.querySelectorAll("[data-html-editor-host]").forEach((element) => element.remove());

    if (lastBaseHref) {
      const base = canvasDocument.createElement("base");
      base.href = lastBaseHref;
      base.setAttribute("data-html-editor-host", "true");
      canvasDocument.head.prepend(base);
    }

    if (!parts.headExtras) {
      return;
    }

    const template = document.createElement("template");
    template.innerHTML = parts.headExtras;
    Array.from(template.content.children)
      .filter((element) => {
        const tag = element.tagName.toLowerCase();
        const rel = String(element.getAttribute("rel") || "").toLowerCase();
        return tag === "link" && rel === "stylesheet";
      })
      .forEach((element) => {
        const clone = element.cloneNode(true);
        clone.setAttribute("data-html-editor-host", "true");
        canvasDocument.head.appendChild(clone);
      });
  }

  function init() {
    editor = grapesjs.init({
      container: "#editor",
      height: "100vh",
      width: "auto",
      storageManager: false,
      fromElement: false,
      canvas: {
        styles: [],
        scripts: []
      },
      blockManager: {
        appendTo: null,
        blocks: [
          {
            id: "section",
            label: "区块",
            category: "基础",
            content: "<section><h2>标题</h2><p>正文内容</p></section>"
          },
          {
            id: "text",
            label: "文本",
            category: "基础",
            content: "<p>输入文本</p>"
          },
          {
            id: "image",
            label: "图片",
            category: "基础",
            content: { type: "image" }
          },
          {
            id: "link",
            label: "链接",
            category: "基础",
            content: '<a href="#">链接文本</a>'
          },
          {
            id: "button",
            label: "按钮",
            category: "基础",
            content: '<button type="button">按钮</button>'
          }
        ]
      },
      panels: {
        defaults: [
          {
            id: "commands",
            buttons: [
              { id: "preview", command: "preview", label: "预览" },
              { id: "fullscreen", command: "fullscreen", label: "全屏" }
            ]
          },
          {
            id: "views",
            buttons: [
              { id: "open-blocks", command: "open-blocks", label: "区块", active: true },
              { id: "open-sm", command: "open-sm", label: "样式" },
              { id: "open-tm", command: "open-tm", label: "属性" },
              { id: "open-layers", command: "open-layers", label: "图层" }
            ]
          }
        ]
      },
      styleManager: {
        sectors: [
          {
            name: "布局",
            open: true,
            properties: ["display", "position", "top", "right", "left", "bottom"]
          },
          {
            name: "尺寸",
            open: true,
            properties: ["width", "height", "max-width", "min-height", "margin", "padding"]
          },
          {
            name: "文字",
            open: true,
            properties: ["font-family", "font-size", "font-weight", "letter-spacing", "color", "line-height", "text-align"]
          },
          {
            name: "装饰",
            open: true,
            properties: ["background-color", "border", "border-radius", "box-shadow"]
          }
        ]
      }
    });

    document.addEventListener("keydown", handleShortcut, true);
  }

  function handleShortcut(event) {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    const key = String(event.key || "").toLowerCase();
    if (key === "s") {
      event.preventDefault();
      postHost(event.shiftKey ? "saveAs" : "save");
    } else if (key === "o") {
      event.preventDefault();
      postHost("openFolder");
    } else if (key === "r") {
      event.preventDefault();
      postHost("reload");
    }
  }

  function postHost(command) {
    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage(command);
    }
  }

  window.editorHost = {
    loadHtmlBase64(base64, baseHrefBase64) {
      loadHtml(fromBase64(base64), fromBase64(baseHrefBase64));
      return true;
    },
    getHtmlBase64() {
      return toBase64(buildHtml());
    },
    undo() {
      editor.UndoManager.undo();
      return true;
    },
    redo() {
      editor.UndoManager.redo();
      return true;
    },
    reload() {
      loadHtml(lastFullHtml);
      return true;
    },
    isReady() {
      return Boolean(editor);
    }
  };

  init();
}());
