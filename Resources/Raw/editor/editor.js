(function () {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let editor;
  let lastFullHtml = "";
  let lastBaseHref = "";
  let lastSiteRootHref = "";
  let lastLocalBaseHref = "";
  let lastLocalSiteRootHref = "";
  let lastPreviewMode = false;
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

    if (!isAbsoluteUrl(url)) {
      return value;
    }

    const siteRootRelativeUrl = relativizeSiteRootUrl(url);
    if (siteRootRelativeUrl !== null) {
      return siteRootRelativeUrl;
    }

    if (!isRuntimeLocalAbsoluteUrl(url)) {
      return value;
    }

    try {
      const base = new URL(lastBaseHref);
      const localBase = new URL(lastLocalBaseHref || lastBaseHref);
      const target = new URL(url, lastBaseHref);
      const sameLocalOrigin = base.protocol === "file:"
        ? target.protocol === "file:"
        : target.origin === base.origin;

      if (!sameLocalOrigin) {
        return value;
      }

      const relative = pathRelative(decodeURIComponent(localBase.pathname), decodeURIComponent(target.pathname));
      const relativePath = target.pathname.endsWith("/")
        ? appendIndexDocument(relative)
        : relative;
      return `${relativePath || "index.html"}${target.search || ""}${target.hash || ""}`;
    } catch {
      return value;
    }
  }

  function relativizeSiteRootUrl(url) {
    if (!lastSiteRootHref || !lastBaseHref || !lastLocalBaseHref) {
      return null;
    }

    try {
      const base = new URL(lastBaseHref);
      const siteRoot = new URL(lastSiteRootHref);
      const localBase = new URL(lastLocalBaseHref);
      const localSiteRoot = new URL(lastLocalSiteRootHref || lastLocalBaseHref);
      const parts = splitUrlParts(url);
      const target = isRootRelativeUrl(url)
        ? new URL(`${parts.path.slice(1)}${parts.search}${parts.hash}`, siteRoot)
        : new URL(url, base);

      if (target.protocol === "file:") {
        if (localBase.protocol !== "file:") {
          return null;
        }

        const relative = pathRelative(decodeURIComponent(localBase.pathname), decodeURIComponent(target.pathname));
        const relativePath = target.pathname.endsWith("/") ? appendIndexDocument(relative) : relative;

        return `${relativePath || "index.html"}${target.search || ""}${target.hash || ""}`;
      }

      if (target.origin !== siteRoot.origin || base.origin !== siteRoot.origin) {
        return null;
      }

      const siteRelativePath = decodeURIComponent(target.pathname).replace(/^\/+/, "");
      const localTargetPath = normalizeBasePath(decodeURIComponent(localSiteRoot.pathname)) + siteRelativePath;
      const relative = pathRelative(decodeURIComponent(localBase.pathname), localTargetPath);
      const relativePath = parts.path.endsWith("/")
        ? appendIndexDocument(relative)
        : relative;

      return `${relativePath || "index.html"}${target.search || ""}${target.hash || ""}`;
    } catch {
      return null;
    }
  }

  function isRootRelativeUrl(url) {
    return url.startsWith("/") && !url.startsWith("//");
  }

  function isAbsoluteUrl(url) {
    return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//");
  }

  function splitUrlParts(url) {
    try {
      const parsed = new URL(url, lastBaseHref || window.location.href);
      return {
        path: parsed.pathname || "",
        search: parsed.search || "",
        hash: parsed.hash || ""
      };
    } catch {
      const match = String(url || "").match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
      return {
        path: match ? match[1] : url,
        search: match && match[2] ? match[2] : "",
        hash: match && match[3] ? match[3] : ""
      };
    }
  }

  function shouldKeepUrl(value) {
    const url = String(value || "").trim().toLowerCase();
    if (url.startsWith("http:") || url.startsWith("https:")) {
      return !isRuntimeLocalAbsoluteUrl(value);
    }

    return url.startsWith("#")
      || url.startsWith("data:")
      || url.startsWith("mailto:")
      || url.startsWith("tel:")
      || url.startsWith("javascript:");
  }

  function appendIndexDocument(path) {
    if (!path) {
      return "index.html";
    }

    return `${path.replace(/\/+$/, "")}/index.html`;
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
      return parsed.protocol === "file:" || isSameOrigin(parsed, lastBaseHref) || isSameOrigin(parsed, lastSiteRootHref);
    } catch {
      return false;
    }
  }

  function isSameOrigin(parsedUrl, baseHref) {
    if (!baseHref) {
      return false;
    }

    try {
      const base = new URL(baseHref);
      return parsedUrl.origin === base.origin;
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

  function loadHtml(fullHtml, baseHref, siteRootHref, localBaseHref, localSiteRootHref, previewMode) {
    lastFullHtml = fullHtml || "";
    lastBaseHref = baseHref || "";
    lastSiteRootHref = siteRootHref || lastBaseHref;
    lastLocalBaseHref = localBaseHref || lastBaseHref;
    lastLocalSiteRootHref = localSiteRootHref || lastSiteRootHref || lastLocalBaseHref;
    lastPreviewMode = Boolean(previewMode);
    const parts = splitHtml(lastFullHtml);
    lastTitle = parts.title;
    lastHeadExtras = parts.headExtras;
    lastBodyScripts = parts.bodyScripts;
    lastBodyAttrs = parts.bodyAttrs;
    lastHtmlAttrs = parts.htmlAttrs;

    if (lastPreviewMode) {
      renderPreview(lastFullHtml);
      return;
    }

    hidePreview();
    applyCanvasHead(parts, false);
    editor.setComponents(parts.body || "");
    editor.setStyle(parts.css || "");
    setTimeout(() => applyCanvasHead(parts, true, false), 0);
    editor.UndoManager.clear();
  }

  function renderPreview(fullHtml) {
    const editorElement = document.getElementById("editor");
    if (editorElement) {
      editorElement.style.display = "none";
      editorElement.setAttribute("aria-hidden", "true");
    }

    const frame = ensurePreviewFrame();
    frame.srcdoc = "";
    frame.srcdoc = buildPreviewHtml(fullHtml);
  }

  function hidePreview() {
    const frame = document.getElementById("html-editor-preview-frame");
    if (frame) {
      frame.remove();
    }

    const editorElement = document.getElementById("editor");
    if (editorElement) {
      editorElement.style.display = "";
      editorElement.removeAttribute("aria-hidden");
    }
  }

  function ensurePreviewFrame() {
    let frame = document.getElementById("html-editor-preview-frame");
    if (frame) {
      return frame;
    }

    frame = document.createElement("iframe");
    frame.id = "html-editor-preview-frame";
    frame.title = "HTML preview";
    frame.setAttribute("data-html-editor-host", "true");
    frame.style.border = "0";
    frame.style.display = "block";
    frame.style.width = "100%";
    frame.style.height = "100vh";
    frame.style.background = "#fff";
    document.body.appendChild(frame);
    return frame;
  }

  function buildPreviewHtml(fullHtml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(fullHtml || "", "text/html");
    if (lastBaseHref && doc.head) {
      const base = doc.createElement("base");
      base.href = lastBaseHref;
      base.setAttribute("data-html-editor-host", "true");
      doc.head.prepend(base);
    }

    return `<!doctype html>\n${doc.documentElement.outerHTML}`;
  }

  function applyCanvasHead(parts, executeScripts, allowAllScripts) {
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
    Array.from(template.content.children).forEach((sourceElement) => {
      const element = createPreviewHeadElement(canvasDocument, sourceElement, executeScripts, allowAllScripts);
      if (!element) {
        return;
      }

      if (isTailwindCdnScript(sourceElement, canvasDocument)) {
        normalizeTailwindPreviewConfig(canvasDocument);
      }

      canvasDocument.head.appendChild(element);
    });
  }

  function createPreviewHeadElement(targetDocument, sourceElement, executeScripts, allowAllScripts) {
    const tag = sourceElement.tagName.toLowerCase();
    if (tag !== "link" && tag !== "style" && tag !== "script") {
      return null;
    }

    if (tag === "script") {
      if (!executeScripts || (!allowAllScripts && !isAllowedStyleScript(sourceElement, targetDocument))) {
        return null;
      }
    }

    const element = targetDocument.createElement(tag);
    Array.from(sourceElement.attributes).forEach((attribute) => {
      element.setAttribute(attribute.name, attribute.value);
    });
    element.setAttribute("data-html-editor-host", "true");

    if (tag === "script") {
      if (!sourceElement.hasAttribute("async") && !sourceElement.hasAttribute("defer")) {
        element.async = false;
      }
      element.textContent = sourceElement.textContent || "";
    } else {
      element.innerHTML = sourceElement.innerHTML;
    }

    return element;
  }

  function isAllowedStyleScript(element, targetDocument) {
    return isTailwindConfigScript(element) || isTailwindCdnScript(element, targetDocument);
  }

  function isTailwindConfigScript(element) {
    if (element.tagName.toLowerCase() !== "script" || element.hasAttribute("src")) {
      return false;
    }

    return /(?:window\.)?tailwind(?:\.config)?\s*=/.test(element.textContent || "");
  }

  function isTailwindCdnScript(element, targetDocument) {
    if (element.tagName.toLowerCase() !== "script") {
      return false;
    }

    const src = element.getAttribute("src") || "";
    if (!src) {
      return false;
    }

    try {
      return new URL(src, targetDocument.baseURI).hostname.toLowerCase() === "cdn.tailwindcss.com";
    } catch {
      return src.toLowerCase().includes("cdn.tailwindcss.com");
    }
  }

  function normalizeTailwindPreviewConfig(targetDocument) {
    const view = targetDocument.defaultView;
    if (!view || !view.tailwind || typeof view.tailwind !== "object") {
      return;
    }

    const tailwind = view.tailwind;
    if (!tailwind.config || typeof tailwind.config !== "object") {
      const legacyConfig = {};
      Object.keys(tailwind).forEach((key) => {
        if (key !== "config") {
          legacyConfig[key] = tailwind[key];
        }
      });
      tailwind.config = legacyConfig;
    }

    if (!Array.isArray(tailwind.config.plugins)) {
      tailwind.config.plugins = [];
    }
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
    loadHtmlBase64(base64, baseHrefBase64, siteRootHrefBase64, localBaseHrefBase64, localSiteRootHrefBase64, previewMode) {
      loadHtml(
        fromBase64(base64),
        fromBase64(baseHrefBase64),
        fromBase64(siteRootHrefBase64),
        fromBase64(localBaseHrefBase64),
        fromBase64(localSiteRootHrefBase64),
        Boolean(previewMode)
      );
      return true;
    },
    getHtmlBase64() {
      if (lastPreviewMode) {
        return toBase64(lastFullHtml);
      }

      return toBase64(buildHtml());
    },
    undo() {
      if (lastPreviewMode) {
        return false;
      }

      editor.UndoManager.undo();
      return true;
    },
    redo() {
      if (lastPreviewMode) {
        return false;
      }

      editor.UndoManager.redo();
      return true;
    },
    reload() {
      loadHtml(lastFullHtml, lastBaseHref, lastSiteRootHref, lastLocalBaseHref, lastLocalSiteRootHref, lastPreviewMode);
      return true;
    },
    isReady() {
      return Boolean(editor);
    }
  };

  init();
}());
