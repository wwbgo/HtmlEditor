(function () {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const nodeMarkerAttribute = "data-html-editor-node-id";
  const editableAttribute = "data-html-editor-editable";
  const selectedAttribute = "data-html-editor-selected";
  const assetAttribute = "data-html-editor-asset";
  const historyLimit = 80;

  let lastFullHtml = "";
  let lastBaseHref = "";
  let lastSiteRootHref = "";
  let lastLocalBaseHref = "";
  let lastLocalSiteRootHref = "";
  let lastTitle = "HTML Document";
  let lastHeadExtras = "";
  let lastBodyAttrs = "";
  let lastHtmlAttrs = 'lang="zh-CN"';
  let history = [];
  let historyIndex = -1;
  let historyTimer = 0;
  let suppressHistory = false;

  const nonEditableTags = new Set([
    "audio",
    "br",
    "canvas",
    "embed",
    "form",
    "iframe",
    "img",
    "input",
    "map",
    "object",
    "option",
    "picture",
    "script",
    "select",
    "source",
    "style",
    "svg",
    "template",
    "textarea",
    "video"
  ]);

  const editableTextTags = new Set([
    "a",
    "abbr",
    "b",
    "bdi",
    "bdo",
    "blockquote",
    "button",
    "caption",
    "cite",
    "code",
    "data",
    "dd",
    "dfn",
    "dt",
    "em",
    "figcaption",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "i",
    "kbd",
    "label",
    "legend",
    "li",
    "mark",
    "p",
    "pre",
    "q",
    "s",
    "small",
    "span",
    "strong",
    "sub",
    "summary",
    "sup",
    "td",
    "th",
    "time",
    "u",
    "var"
  ]);

  const protectedContentSelector = [
    "audio",
    "canvas",
    "embed",
    "form",
    "iframe",
    "img",
    "input",
    "object",
    "option",
    "picture",
    "script",
    "select",
    "source",
    "style",
    "svg",
    "template",
    "textarea",
    "video"
  ].join(",");

  const mergeableNewAttributes = new Set([
    "alt",
    "class",
    "data-bg",
    "data-background",
    "data-href",
    "data-lazy-src",
    "data-original",
    "data-poster",
    "data-src",
    "data-srcset",
    "decoding",
    "height",
    "href",
    "loading",
    "poster",
    "rel",
    "sizes",
    "src",
    "srcset",
    "style",
    "target",
    "title",
    "width"
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

    preserveBodyHtmlNodes(doc.body);
    markEditableSourceNodes(doc.body);

    const headExtras = Array.from(doc.head.children)
      .filter((element) => !isGeneratedHeadElement(element))
      .map((element) => element.outerHTML)
      .join("\n");

    return {
      body: doc.body ? doc.body.innerHTML : source,
      css: "",
      title: doc.title || "HTML Document",
      headExtras,
      bodyAttrs: doc.body ? attrsToString(doc.body) : "",
      htmlAttrs: doc.documentElement ? attrsToString(doc.documentElement) : 'lang="zh-CN"'
    };
  }

  function loadHtml(fullHtml, baseHref, siteRootHref, localBaseHref, localSiteRootHref) {
    lastFullHtml = fullHtml || "";
    lastBaseHref = baseHref || "";
    lastSiteRootHref = siteRootHref || lastBaseHref;
    lastLocalBaseHref = localBaseHref || lastBaseHref;
    lastLocalSiteRootHref = localSiteRootHref || lastSiteRootHref || lastLocalBaseHref;

    const parts = splitHtml(lastFullHtml);
    lastTitle = parts.title;
    lastHeadExtras = parts.headExtras;
    lastBodyAttrs = parts.bodyAttrs;
    lastHtmlAttrs = parts.htmlAttrs;

    applyDocumentHead(parts, false);

    const editable = document.getElementById("document-body");
    editable.innerHTML = parts.body || "";
    prepareEditableDom(editable);
    applyDocumentHead(parts, true);
    resetHistory();
  }

  function buildHtml() {
    const editable = document.getElementById("document-body");
    const merged = mergeEditedContentIntoOriginalDocument(editable);
    if (merged) {
      return merged;
    }

    const clone = editable.cloneNode(true);
    cleanEditorDom(clone);
    removeNodeMarkers(clone);
    return buildCompleteHtml(restorePreservedHtmlPlaceholders(clone.innerHTML));
  }

  function mergeEditedContentIntoOriginalDocument(editable) {
    if (!editable || !lastFullHtml) {
      return "";
    }

    const parser = new DOMParser();
    const originalDoc = parser.parseFromString(lastFullHtml, "text/html");
    if (!originalDoc.body) {
      return "";
    }

    preserveBodyHtmlNodes(originalDoc.body);
    markEditableSourceNodes(originalDoc.body);

    const editedBody = editable.cloneNode(true);
    cleanEditorDom(editedBody);
    mergeEditedBodyIntoOriginalBody(originalDoc.body, editedBody);
    rewriteDocumentUrls(originalDoc.body, relativizeAssetUrl);
    removeNodeMarkers(originalDoc.body);

    return mergeBodyIntoOriginalDocument(
      restorePreservedHtmlPlaceholders(originalDoc.body.innerHTML)
    );
  }

  function mergeEditedBodyIntoOriginalBody(originalBody, editedBody) {
    const editedElements = collectMarkedElements(editedBody);

    Array.from(originalBody.querySelectorAll(`[${nodeMarkerAttribute}]`))
      .sort((left, right) => getNodeDepth(right) - getNodeDepth(left))
      .forEach((originalElement) => {
        const marker = originalElement.getAttribute(nodeMarkerAttribute);
        const editedElement = marker ? editedElements.get(marker) : null;
        if (!editedElement || !isSameTag(originalElement, editedElement)) {
          return;
        }

        mergeElementAttributes(originalElement, editedElement);
        mergeElementContent(originalElement, editedElement);
      });
  }

  function collectMarkedElements(root) {
    const elements = new Map();
    if (!root) {
      return elements;
    }

    root.querySelectorAll(`[${nodeMarkerAttribute}]`).forEach((element) => {
      const marker = element.getAttribute(nodeMarkerAttribute);
      if (marker && !elements.has(marker)) {
        elements.set(marker, element);
      }
    });

    return elements;
  }

  function mergeElementAttributes(originalElement, editedElement) {
    Array.from(editedElement.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (!mergeableNewAttributes.has(name) || isEditorOwnedAttribute(name)) {
        return;
      }

      originalElement.setAttribute(attribute.name, attribute.value);
    });
  }

  function mergeElementContent(originalElement, editedElement) {
    if (isProtectedContent(originalElement) || isProtectedContent(editedElement)) {
      if (canMergeDirectTextContent(originalElement)) {
        mergeDirectTextNodes(originalElement, editedElement);
      }
      return;
    }

    if (canReplacePlainTextContent(originalElement)) {
      const editedText = editedElement.textContent || "";
      if (editedText !== (originalElement.textContent || "")) {
        originalElement.textContent = editedText;
      }
      return;
    }

    mergeDirectTextNodes(originalElement, editedElement);
  }

  function canReplacePlainTextContent(element) {
    const tag = element.tagName.toLowerCase();
    if (!editableTextTags.has(tag)) {
      return false;
    }

    return element.children.length === 0;
  }

  function mergeDirectTextNodes(originalElement, editedElement) {
    const originalKeys = getDirectElementKeys(originalElement);
    const editedKeys = getDirectElementKeys(editedElement);
    if (originalKeys.join("|") !== editedKeys.join("|")) {
      return;
    }

    const originalSegments = getDirectTextSegments(originalElement);
    const editedSegments = getDirectTextSegments(editedElement);
    if (originalSegments.length !== editedSegments.length) {
      return;
    }

    originalSegments.forEach((segment, index) => {
      const editedText = editedSegments[index].nodes.map((node) => node.textContent || "").join("");
      const originalText = segment.nodes.map((node) => node.textContent || "").join("");
      if (editedText === originalText) {
        return;
      }

      replaceTextSegment(originalElement, segment, editedText);
    });
  }

  function getDirectElementKeys(element) {
    return Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.ELEMENT_NODE)
      .map((node) => node.getAttribute(nodeMarkerAttribute) || node.tagName.toLowerCase());
  }

  function getDirectTextSegments(element) {
    const segments = [{ nodes: [], before: null }];
    Array.from(element.childNodes).forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        segments[segments.length - 1].before = node;
        segments.push({ nodes: [], before: null });
        return;
      }

      if (node.nodeType === Node.TEXT_NODE) {
        segments[segments.length - 1].nodes.push(node);
      }
    });

    return segments;
  }

  function replaceTextSegment(parent, segment, text) {
    segment.nodes.forEach((node) => node.remove());
    if (!text) {
      return;
    }

    parent.insertBefore(parent.ownerDocument.createTextNode(text), segment.before || null);
  }

  function prepareEditableDom(root) {
    if (!root) {
      return;
    }

    root.querySelectorAll(`[${selectedAttribute}]`).forEach((element) => {
      element.removeAttribute(selectedAttribute);
    });

    root.querySelectorAll(`[${nodeMarkerAttribute}]`).forEach((element) => {
      element.removeAttribute(editableAttribute);
      element.removeAttribute(assetAttribute);
      element.removeAttribute("contenteditable");
      element.removeAttribute("spellcheck");

      if (shouldMakeContentEditable(element)) {
        element.setAttribute(editableAttribute, "true");
        element.setAttribute("contenteditable", "plaintext-only");
        element.setAttribute("spellcheck", "true");
      } else if (isEditableAsset(element)) {
        element.setAttribute(assetAttribute, "true");
      }
    });
  }

  function shouldMakeContentEditable(element) {
    const tag = element.tagName.toLowerCase();
    if (nonEditableTags.has(tag) || !editableTextTags.has(tag)) {
      return false;
    }

    if (!hasMeaningfulEditableText(element)) {
      return false;
    }

    return element.children.length === 0 || shouldMakeDirectTextContainerEditable(element);
  }

  function shouldMakeDirectTextContainerEditable(element) {
    return element.tagName.toLowerCase() === "li";
  }

  function hasMeaningfulEditableText(element) {
    return Array.from(element.childNodes).some((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return Boolean(node.textContent && node.textContent.trim());
      }

      return node.nodeType === Node.ELEMENT_NODE && node.tagName.toLowerCase() === "br";
    });
  }

  function canMergeDirectTextContent(element) {
    const tag = element.tagName.toLowerCase();
    return editableTextTags.has(tag);
  }

  function isEditableAsset(element) {
    const tag = element.tagName.toLowerCase();
    return tag === "img" || tag === "video" || tag === "source" || tag === "iframe";
  }

  function preserveBodyHtmlNodes(body) {
    if (!body) {
      return;
    }

    Array.from(body.querySelectorAll("script")).forEach((script) => {
      replaceWithPreservedHtmlPlaceholder(script, script.outerHTML);
    });

    const comments = [];
    const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_COMMENT);
    while (walker.nextNode()) {
      comments.push(walker.currentNode);
    }

    comments.forEach((comment) => {
      replaceWithPreservedHtmlPlaceholder(comment, `<!--${comment.nodeValue || ""}-->`);
    });
  }

  function replaceWithPreservedHtmlPlaceholder(node, html) {
    const placeholder = node.ownerDocument.createElement("template");
    placeholder.setAttribute("data-html-editor-preserved-html", toBase64(html));
    placeholder.innerHTML = "html-editor-preserved";
    node.parentNode.replaceChild(placeholder, node);
  }

  function restorePreservedHtmlPlaceholders(html) {
    const template = document.createElement("template");
    template.innerHTML = html || "";

    template.content.querySelectorAll("[data-html-editor-preserved-html]").forEach((placeholder) => {
      const preservedHtml = fromBase64(placeholder.getAttribute("data-html-editor-preserved-html") || "");
      if (!preservedHtml) {
        placeholder.remove();
        return;
      }

      const replacement = document.createElement("template");
      replacement.innerHTML = normalizeHtmlFragmentForSave(preservedHtml);
      placeholder.replaceWith(...Array.from(replacement.content.childNodes));
    });

    return template.innerHTML;
  }

  function markEditableSourceNodes(root) {
    if (!root) {
      return;
    }

    let nextId = 1;
    root.querySelectorAll("*").forEach((element) => {
      element.setAttribute(nodeMarkerAttribute, String(nextId++));
    });
  }

  function applyDocumentHead(parts, executeScripts) {
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
    Array.from(template.content.children).forEach((sourceElement) => {
      const element = createPreviewHeadElement(document, sourceElement, executeScripts);
      if (!element) {
        return;
      }

      if (isTailwindCdnScript(sourceElement)) {
        normalizeTailwindPreviewConfig(document);
      }

      document.head.appendChild(element);
    });
  }

  function createPreviewHeadElement(targetDocument, sourceElement, executeScripts) {
    const tag = sourceElement.tagName.toLowerCase();
    if (tag !== "link" && tag !== "style" && tag !== "script") {
      return null;
    }

    if (tag === "script" && !executeScripts) {
      return null;
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

  function isTailwindCdnScript(element) {
    if (element.tagName.toLowerCase() !== "script") {
      return false;
    }

    const src = element.getAttribute("src") || "";
    if (!src) {
      return false;
    }

    try {
      return new URL(src, document.baseURI).hostname.toLowerCase() === "cdn.tailwindcss.com";
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

  function buildCompleteHtml(html) {
    const headExtras = normalizeHtmlFragmentForSave(lastHeadExtras);
    return [
      "<!doctype html>",
      `<html ${lastHtmlAttrs || 'lang="zh-CN"'}>`,
      "<head>",
      '  <meta charset="utf-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1">',
      `  <title>${escapeHtml(lastTitle)}</title>`,
      headExtras.trim(),
      "</head>",
      `<body${lastBodyAttrs ? ` ${lastBodyAttrs}` : ""}>`,
      html,
      "</body>",
      "</html>"
    ].filter(Boolean).join("\n");
  }

  function cleanEditorDom(root) {
    if (!root) {
      return;
    }

    root.querySelectorAll("*").forEach((element) => {
      element.removeAttribute("contenteditable");
      element.removeAttribute("spellcheck");
      element.removeAttribute(editableAttribute);
      element.removeAttribute(selectedAttribute);
      element.removeAttribute(assetAttribute);
    });
  }

  function removeNodeMarkers(root) {
    if (!root) {
      return;
    }

    if (root.nodeType === Node.ELEMENT_NODE) {
      root.removeAttribute(nodeMarkerAttribute);
    }

    root.querySelectorAll(`[${nodeMarkerAttribute}]`).forEach((element) => {
      element.removeAttribute(nodeMarkerAttribute);
    });
  }

  function mergeBodyIntoOriginalDocument(bodyHtml) {
    const source = lastFullHtml || "";
    const bodyOpen = findBodyOpenTag(source);
    if (!bodyOpen) {
      return "";
    }

    const bodyClose = findLastBodyCloseTag(source, bodyOpen.end);
    if (!bodyClose) {
      return "";
    }

    return `${source.slice(0, bodyOpen.end)}${bodyHtml}${source.slice(bodyClose.start)}`;
  }

  function findBodyOpenTag(source) {
    const lower = source.toLowerCase();
    const headCloseIndex = lower.indexOf("</head");
    let searchStart = 0;

    if (headCloseIndex >= 0) {
      const headCloseEnd = findTagEnd(source, headCloseIndex);
      searchStart = headCloseEnd >= 0 ? headCloseEnd + 1 : headCloseIndex + 7;
    }

    let index = lower.indexOf("<body", searchStart);
    while (index >= 0) {
      if (isTagNameBoundary(source.charAt(index + 5))) {
        const end = findTagEnd(source, index);
        return end >= 0 ? { start: index, end: end + 1 } : null;
      }

      index = lower.indexOf("<body", index + 5);
    }

    return null;
  }

  function findLastBodyCloseTag(source, minIndex) {
    const lower = source.toLowerCase();
    let index = lower.lastIndexOf("</body");

    while (index >= minIndex) {
      if (isTagNameBoundary(source.charAt(index + 6))) {
        const end = findTagEnd(source, index);
        return end >= 0 ? { start: index, end: end + 1 } : null;
      }

      index = index > 0 ? lower.lastIndexOf("</body", index - 1) : -1;
    }

    return null;
  }

  function findTagEnd(source, startIndex) {
    let quote = "";

    for (let index = startIndex; index < source.length; index++) {
      const char = source.charAt(index);
      if (quote) {
        if (char === quote) {
          quote = "";
        }
        continue;
      }

      if (char === '"' || char === "'") {
        quote = char;
      } else if (char === ">") {
        return index;
      }
    }

    return -1;
  }

  function isTagNameBoundary(char) {
    return !char || /[\s>/]/.test(char);
  }

  function rewriteDocumentUrls(root, mapper) {
    rewriteUrlAttributes(root, mapper);
    rewriteInlineStyles(root, mapper);
  }

  function rewriteUrlAttributes(root, mapper) {
    const attributes = [
      "src",
      "href",
      "poster",
      "data-src",
      "data-href",
      "data-poster",
      "data-original",
      "data-lazy-src",
      "data-bg",
      "data-background"
    ];
    const selector = attributes.map((attribute) => `[${attribute}]`).join(",");
    const elements = [];

    if (root.nodeType === Node.ELEMENT_NODE && root.matches(selector)) {
      elements.push(root);
    }

    root.querySelectorAll(selector).forEach((element) => elements.push(element));
    elements.forEach((element) => {
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

    ["srcset", "data-srcset"].forEach((attribute) => {
      const srcsetElements = [];
      if (root.nodeType === Node.ELEMENT_NODE && root.hasAttribute(attribute)) {
        srcsetElements.push(root);
      }

      root.querySelectorAll(`[${attribute}]`).forEach((element) => srcsetElements.push(element));
      srcsetElements.forEach((element) => {
        const value = element.getAttribute(attribute);
        element.setAttribute(attribute, mapSrcset(value, mapper));
      });
    });
  }

  function rewriteInlineStyles(root, mapper) {
    const styleElements = [];
    if (root.nodeType === Node.ELEMENT_NODE && root.hasAttribute("style")) {
      styleElements.push(root);
    }

    root.querySelectorAll("[style]").forEach((element) => styleElements.push(element));
    styleElements.forEach((element) => {
      const value = element.getAttribute("style");
      element.setAttribute("style", mapCssUrls(value, mapper));
    });

    if (root.nodeType === Node.ELEMENT_NODE && root.tagName.toLowerCase() === "style") {
      root.textContent = mapCssUrls(root.textContent || "", mapper);
    }

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
    if (!url || shouldKeepUrl(value)) {
      return value;
    }

    if (!isAbsoluteUrl(url)) {
      return value;
    }

    const siteRootRelativeUrl = relativizeSiteRootUrl(url);
    if (siteRootRelativeUrl !== null) {
      return siteRootRelativeUrl;
    }

    if (!lastBaseHref || !isRuntimeLocalAbsoluteUrl(url)) {
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

  function normalizeHtmlFragmentForSave(html) {
    const template = document.createElement("template");
    template.innerHTML = html || "";
    rewriteUrlAttributes(template.content, relativizeAssetUrl);
    rewriteInlineStyles(template.content, relativizeAssetUrl);
    return template.innerHTML;
  }

  function isRootRelativeUrl(url) {
    return url.startsWith("/") && !url.startsWith("//");
  }

  function isAbsoluteUrl(url) {
    return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//");
  }

  function splitUrlParts(url) {
    const hashIndex = url.indexOf("#");
    const searchIndex = url.indexOf("?");
    const hasSearch = searchIndex >= 0 && (hashIndex < 0 || searchIndex < hashIndex);
    const pathEnd = hasSearch ? searchIndex : hashIndex >= 0 ? hashIndex : url.length;
    const searchEnd = hashIndex >= 0 ? hashIndex : url.length;

    return {
      path: url.slice(0, pathEnd),
      search: hasSearch ? url.slice(searchIndex, searchEnd) : "",
      hash: hashIndex >= 0 ? url.slice(hashIndex) : ""
    };
  }

  function appendIndexDocument(path) {
    if (!path) {
      return "index.html";
    }

    return `${path.replace(/\/+$/, "")}/index.html`;
  }

  function shouldKeepUrl(value) {
    const url = String(value || "").trim().toLowerCase();
    if (url.startsWith("http:") || url.startsWith("https:")) {
      return !isRuntimeLocalAbsoluteUrl(value);
    }

    return url.startsWith("#")
      || url.startsWith("//")
      || url.startsWith("data:")
      || url.startsWith("blob:")
      || url.startsWith("mailto:")
      || url.startsWith("tel:")
      || url.startsWith("javascript:");
  }

  function isRuntimeLocalAbsoluteUrl(url) {
    try {
      const parsed = new URL(url, lastBaseHref);
      return parsed.protocol === "file:"
        || isSameOrigin(parsed, lastBaseHref)
        || isSameOrigin(parsed, lastSiteRootHref);
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

  function isSameTag(left, right) {
    return Boolean(
      left
      && right
      && left.nodeType === Node.ELEMENT_NODE
      && right.nodeType === Node.ELEMENT_NODE
      && left.tagName.toLowerCase() === right.tagName.toLowerCase()
    );
  }

  function isProtectedContent(element) {
    return Boolean(
      element.matches(protectedContentSelector)
      || element.querySelector(protectedContentSelector)
    );
  }

  function isEditorOwnedAttribute(name) {
    return name === nodeMarkerAttribute
      || name === "contenteditable"
      || name === "spellcheck"
      || name.startsWith("data-html-editor-");
  }

  function getNodeDepth(node) {
    let depth = 0;
    let current = node;
    while (current && current.parentNode) {
      depth++;
      current = current.parentNode;
    }
    return depth;
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

  function resetHistory() {
    const body = document.getElementById("document-body");
    history = [body.innerHTML];
    historyIndex = 0;
  }

  function scheduleHistory() {
    if (suppressHistory) {
      return;
    }

    window.clearTimeout(historyTimer);
    historyTimer = window.setTimeout(pushHistory, 250);
  }

  function pushHistory() {
    if (suppressHistory) {
      return;
    }

    const body = document.getElementById("document-body");
    const html = body.innerHTML;
    if (history[historyIndex] === html) {
      return;
    }

    history = history.slice(0, historyIndex + 1);
    history.push(html);
    if (history.length > historyLimit) {
      history.shift();
    }
    historyIndex = history.length - 1;
  }

  function restoreHistory(nextIndex) {
    if (nextIndex < 0 || nextIndex >= history.length || nextIndex === historyIndex) {
      return false;
    }

    const body = document.getElementById("document-body");
    suppressHistory = true;
    body.innerHTML = history[nextIndex];
    historyIndex = nextIndex;
    prepareEditableDom(body);
    suppressHistory = false;
    return true;
  }

  function undo() {
    window.clearTimeout(historyTimer);
    pushHistory();
    return restoreHistory(historyIndex - 1);
  }

  function redo() {
    window.clearTimeout(historyTimer);
    return restoreHistory(historyIndex + 1);
  }

  function handleKeydown(event) {
    if (event.ctrlKey || event.metaKey) {
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
      } else if (key === "z") {
        event.preventDefault();
        undo();
      } else if (key === "y") {
        event.preventDefault();
        redo();
      }
      return;
    }

    const editable = getEditableTarget(event.target);
    if (!editable) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      insertPlainText("\n");
      scheduleHistory();
    } else if (event.key === "Escape") {
      editable.blur();
    }
  }

  function handlePaste(event) {
    if (!getEditableTarget(event.target)) {
      return;
    }

    event.preventDefault();
    const text = event.clipboardData ? event.clipboardData.getData("text/plain") : "";
    insertPlainText(text);
    scheduleHistory();
  }

  function handleClick(event) {
    const body = document.getElementById("document-body");
    if (!body.contains(event.target)) {
      return;
    }

    const interactive = event.target.closest("a,button");
    if (interactive) {
      event.preventDefault();
    }

    const selectable = event.target.closest(`[${assetAttribute}],a`);
    if (!selectable || !body.contains(selectable)) {
      clearSelection();
      return;
    }

    selectElement(selectable);
  }

  function handleDoubleClick(event) {
    const body = document.getElementById("document-body");
    const target = event.target.closest(`[${assetAttribute}],a`);
    if (!target || !body.contains(target)) {
      return;
    }

    event.preventDefault();
    editElementAttributes(target);
  }

  function editElementAttributes(element) {
    pushHistory();
    const tag = element.tagName.toLowerCase();

    if (tag === "a") {
      promptAttribute(element, "href", "链接地址");
      promptAttribute(element, "title", "链接标题");
    } else if (tag === "img") {
      promptAttribute(element, "src", "图片地址");
      promptAttribute(element, "alt", "替代文本");
    } else if (tag === "video") {
      promptAttribute(element, "src", "视频地址");
      promptAttribute(element, "poster", "封面地址");
    } else if (tag === "source") {
      promptAttribute(element, "src", "资源地址");
      promptAttribute(element, "srcset", "资源集合");
    } else if (tag === "iframe") {
      promptAttribute(element, "src", "框架地址");
      promptAttribute(element, "title", "框架标题");
    }

    pushHistory();
  }

  function promptAttribute(element, attribute, label) {
    const currentValue = element.getAttribute(attribute) || "";
    const nextValue = window.prompt(label, currentValue);
    if (nextValue === null) {
      return;
    }

    if (nextValue === "") {
      element.removeAttribute(attribute);
    } else {
      element.setAttribute(attribute, nextValue);
    }
  }

  function clearSelection() {
    document.querySelectorAll(`[${selectedAttribute}]`).forEach((element) => {
      element.removeAttribute(selectedAttribute);
    });
  }

  function selectElement(element) {
    clearSelection();
    element.setAttribute(selectedAttribute, "true");
  }

  function getEditableTarget(target) {
    const body = document.getElementById("document-body");
    const element = target && target.nodeType === Node.ELEMENT_NODE
      ? target
      : target?.parentElement;
    const editable = element ? element.closest(`[${editableAttribute}="true"]`) : null;
    return editable && body.contains(editable) ? editable : null;
  }

  function insertPlainText(text) {
    if (!text) {
      return;
    }

    if (document.queryCommandSupported && document.queryCommandSupported("insertText")) {
      document.execCommand("insertText", false, text);
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function postHost(command) {
    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage(command);
    }
  }

  function init() {
    document.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("paste", handlePaste, true);
    document.addEventListener("input", scheduleHistory, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("dblclick", handleDoubleClick, true);
  }

  window.editorHost = {
    loadHtmlBase64(base64, baseHrefBase64, siteRootHrefBase64, localBaseHrefBase64, localSiteRootHrefBase64) {
      loadHtml(
        fromBase64(base64),
        fromBase64(baseHrefBase64),
        fromBase64(siteRootHrefBase64),
        fromBase64(localBaseHrefBase64),
        fromBase64(localSiteRootHrefBase64)
      );
      return true;
    },
    getHtmlBase64() {
      window.clearTimeout(historyTimer);
      pushHistory();
      return toBase64(buildHtml());
    },
    undo() {
      return undo();
    },
    redo() {
      return redo();
    },
    applyTool() {
      return false;
    },
    reload() {
      loadHtml(lastFullHtml, lastBaseHref, lastSiteRootHref, lastLocalBaseHref, lastLocalSiteRootHref);
      return true;
    },
    isReady() {
      return true;
    },
    debugState() {
      return {
        mode: "contenteditable",
        editableCount: document.querySelectorAll(`[${editableAttribute}="true"]`).length,
        assetCount: document.querySelectorAll(`[${assetAttribute}="true"]`).length,
        historyIndex,
        historyLength: history.length
      };
    }
  };

  init();
}());
