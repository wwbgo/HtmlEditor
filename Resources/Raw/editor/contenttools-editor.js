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
  let lastFocusedElement = null;
  let lastSelection = null;
  const editableContainerTags = [
    "div",
    "section",
    "article",
    "main",
    "header",
    "footer",
    "nav",
    "aside",
    "figure",
    "figcaption",
    "details",
    "summary",
    "form",
    "fieldset",
    "legend",
    "center"
  ];
  const inlineFlowTags = new Set([
    "a",
    "abbr",
    "b",
    "bdi",
    "bdo",
    "br",
    "button",
    "cite",
    "code",
    "data",
    "dfn",
    "em",
    "i",
    "kbd",
    "label",
    "mark",
    "q",
    "s",
    "small",
    "span",
    "strong",
    "sub",
    "sup",
    "time",
    "u",
    "var",
    "wbr"
  ]);

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
    const headExtras = Array.from(doc.head.children)
      .filter((element) => !isGeneratedHeadElement(element))
      .map((element) => element.outerHTML)
      .join("\n");

    return {
      body: doc.body ? doc.body.innerHTML : source,
      css: "",
      title: doc.title || "HTML Document",
      headExtras,
      bodyScripts,
      bodyAttrs: doc.body ? attrsToString(doc.body) : "",
      htmlAttrs: doc.documentElement ? attrsToString(doc.documentElement) : 'lang="zh-CN"'
    };
  }

  function buildHtml() {
    const html = normalizeHtmlForSave(document.getElementById("document-body").innerHTML);
    const css = mapCssUrls(getEditorStyle(), relativizeAssetUrl);
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

  function loadHtml(fullHtml, baseHref) {
    if (editor && editor.isEditing && editor.isEditing()) {
      editor.stop(true);
    }

    lastFullHtml = fullHtml || "";
    lastBaseHref = baseHref || "";
    const parts = splitHtml(lastFullHtml);
    lastTitle = parts.title;
    lastHeadExtras = parts.headExtras;
    lastBodyScripts = parts.bodyScripts;
    lastBodyAttrs = parts.bodyAttrs;
    lastHtmlAttrs = parts.htmlAttrs;

    applyDocumentHead(parts);
    const editable = document.getElementById("document-body");
    editable.innerHTML = parts.body || "";
    normalizeEditableDom(editable);
    setEditorStyle(parts.css || "");

    restartEditing();
  }

  function restartEditing() {
    lastFocusedElement = null;
    lastSelection = null;
    editor.start();
    markEditableSurface();
  }

  function markEditableSurface() {
    const editable = document.getElementById("document-body");
    editable.setAttribute("data-editor-active", "true");
  }

  function applyDocumentHead(parts) {
    document.head.querySelectorAll("[data-html-editor-host]").forEach((element) => element.remove());

    if (lastBaseHref) {
      const base = document.createElement("base");
      base.href = lastBaseHref;
      base.setAttribute("data-html-editor-host", "true");
      document.head.prepend(base);
    }

    if (!parts.headExtras) {
      return;
    }

    const template = document.createElement("template");
    template.innerHTML = parts.headExtras;
    Array.from(template.content.children)
      .filter((element) => {
        const tag = element.tagName.toLowerCase();
        return tag === "link" || tag === "style";
      })
      .forEach((element) => {
        const clone = element.cloneNode(true);
        clone.setAttribute("data-html-editor-host", "true");
        document.head.appendChild(clone);
      });
  }

  function setEditorStyle(css) {
    let style = document.getElementById("loaded-document-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "loaded-document-style";
      style.setAttribute("data-html-editor-host", "true");
      document.head.appendChild(style);
    }

    style.textContent = css || "";
  }

  function getEditorStyle() {
    return document.getElementById("loaded-document-style")?.textContent || "";
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
    if (tag === "title") {
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

  function isRuntimeLocalAbsoluteUrl(url) {
    try {
      const parsed = new URL(url, lastBaseHref);
      return parsed.protocol === "file:";
    } catch {
      return false;
    }
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

  function registerEditableContainers() {
    if (ContentEdit.HtmlEditorContainer) {
      return;
    }

    class HtmlEditorContainer extends ContentEdit.ElementCollection {
      cssTypeName() {
        return "html-container";
      }

      type() {
        return "HtmlEditorContainer";
      }

      typeName() {
        return "HTML container";
      }

      static fromDOMElement(domElement) {
        if (isEditableTextContainer(domElement)) {
          return new ContentEdit.Text(
            domElement.tagName,
            this.getDOMElementAttributes(domElement),
            domElement.innerHTML.replace(/^\s+|\s+$/g, "")
          );
        }

        const container = new this(domElement.tagName, this.getDOMElementAttributes(domElement));
        attachEditableChildren(container, domElement);
        return container;
      }
    }

    HtmlEditorContainer.droppers = {
      HtmlEditorContainer: ContentEdit.Element._dropVert,
      Image: ContentEdit.Element._dropBoth,
      List: ContentEdit.Element._dropVert,
      PreText: ContentEdit.Element._dropVert,
      Static: ContentEdit.Element._dropVert,
      Table: ContentEdit.Element._dropVert,
      Text: ContentEdit.Element._dropVert,
      Video: ContentEdit.Element._dropBoth
    };

    ContentEdit.HtmlEditorContainer = HtmlEditorContainer;
    ContentEdit.TagNames.get().register(HtmlEditorContainer, ...editableContainerTags);
  }

  function normalizeEditableDom(root) {
    if (!root) {
      return;
    }

    wrapInlineFlowChildren(root);
  }

  function wrapInlineFlowChildren(parent) {
    const childNodes = Array.from(parent.childNodes);
    let inlineNodes = [];

    const flushInlineNodes = (beforeNode) => {
      if (!inlineNodes.length) {
        return;
      }

      const paragraph = document.createElement("p");
      inlineNodes.forEach((node) => paragraph.appendChild(node.cloneNode(true)));
      inlineNodes = [];

      if (!hasEditableInlineContent(paragraph)) {
        return;
      }

      parent.insertBefore(paragraph, beforeNode || null);
    };

    childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent.trim() || inlineNodes.length) {
          inlineNodes.push(node);
        }
        node.remove();
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        node.remove();
        return;
      }

      if (isInlineFlowElement(node)) {
        inlineNodes.push(node);
        node.remove();
        return;
      }

      flushInlineNodes(node);
    });

    flushInlineNodes(null);
  }

  function attachEditableChildren(parent, domElement) {
    let inlineNodes = [];

    const flushInlineNodes = () => {
      if (!inlineNodes.length) {
        return;
      }

      const paragraph = document.createElement("p");
      inlineNodes.forEach((node) => paragraph.appendChild(node.cloneNode(true)));
      inlineNodes = [];

      if (hasEditableInlineContent(paragraph)) {
        parent.attach(ContentEdit.Text.fromDOMElement(paragraph));
      }
    };

    Array.from(domElement.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent.trim() || inlineNodes.length) {
          inlineNodes.push(node);
        }
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return;
      }

      if (isInlineFlowElement(node)) {
        inlineNodes.push(node);
        return;
      }

      flushInlineNodes();
      const element = createContentElement(node);
      if (element) {
        parent.attach(element);
      }
    });

    flushInlineNodes();
  }

  function createContentElement(domElement) {
    const tagName = domElement.getAttribute("data-ce-tag") || domElement.tagName;
    const elementClass = ContentEdit.TagNames.get().match(tagName);
    return elementClass.fromDOMElement(domElement);
  }

  function isInlineFlowElement(element) {
    return inlineFlowTags.has(element.tagName.toLowerCase());
  }

  function isEditableTextContainer(element) {
    return Array.from(element.childNodes).every((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return true;
      }

      return node.nodeType === Node.ELEMENT_NODE && isInlineFlowElement(node);
    }) && hasEditableInlineContent(element);
  }

  function hasEditableInlineContent(element) {
    return Boolean(
      element.textContent.trim()
      || element.querySelector("br,img,svg,canvas,input,textarea,select,button")
    );
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

  function init() {
    registerEditableContainers();

    ContentTools.StylePalette.add([
      new ContentTools.Style("标题强调", "heading-accent", ["h1", "h2", "h3"]),
      new ContentTools.Style("图片说明", "image-caption", ["p"]),
      new ContentTools.Style("按钮", "button-like", ["a", "button"])
    ]);

    editor = ContentTools.EditorApp.get();
    editor.init("[data-editable]", "data-name");
    editor.addEventListener("saved", function (ev) {
      ev.preventDefault();
      editor.busy(false);
    });
    trackSelectionState();
    document.addEventListener("keydown", handleShortcut, true);
    editor.start();
    markEditableSurface();
  }

  function trackSelectionState() {
    const updateSelectionState = () => {
      const focused = ContentEdit.Root.get().focused();
      if (!focused) {
        return;
      }

      lastFocusedElement = focused;
      lastSelection = focused.selection ? focused.selection() : null;
    };

    ContentEdit.Root.get().bind("focus", updateSelectionState);
    ContentEdit.Root.get().bind("blur", updateSelectionState);
    document.addEventListener("selectionchange", updateSelectionState);
  }

  function applyTool(toolName) {
    const tool = ContentTools.ToolShelf.fetch(toolName);
    if (!tool.requiresElement) {
      if (!tool.canApply(null, null)) {
        return false;
      }

      tool.apply(null, null, function () {});
      return true;
    }

    const focused = ContentEdit.Root.get().focused() || lastFocusedElement;
    let selection = null;

    if (focused && focused.selection) {
      selection = focused.selection() || lastSelection;
      if (lastSelection) {
        try {
          focused.focus();
          focused.selection(lastSelection);
          selection = focused.selection();
        } catch {
          selection = lastSelection;
        }
      }
    }

    if (!focused || !focused.isMounted()) {
      return false;
    }

    if (!tool.canApply(focused, selection)) {
      return false;
    }

    tool.apply(focused, selection, function () {
      const nextFocused = ContentEdit.Root.get().focused();
      if (nextFocused) {
        lastFocusedElement = nextFocused;
        lastSelection = nextFocused.selection ? nextFocused.selection() : null;
      }
    });
    return true;
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
      return applyTool("undo");
    },
    redo() {
      return applyTool("redo");
    },
    applyTool(toolName) {
      return applyTool(toolName);
    },
    debugState() {
      const editable = document.getElementById("document-body");
      const regions = editor && editor.regions ? editor.regions() : {};
      return {
        editorState: editor && editor.getState ? editor.getState() : null,
        isEditing: Boolean(editor && editor.isEditing && editor.isEditing()),
        regionNames: Object.keys(regions),
        regionChildren: Object.fromEntries(Object.entries(regions).map(([name, region]) => [
          name,
          region.children.map((child) => child.type())
        ])),
        contentEditableCount: document.querySelectorAll("[contenteditable]").length,
        textElementCount: document.querySelectorAll(".ce-element--type-text,.ce-element--type-pre-text,.ce-element--type-list-item-text,.ce-element--type-table-cell-text").length,
        documentBodyChildren: editable ? editable.children.length : 0
      };
    },
    reload() {
      loadHtml(lastFullHtml, lastBaseHref);
      return true;
    },
    isReady() {
      return Boolean(editor);
    }
  };

  init();
}());
