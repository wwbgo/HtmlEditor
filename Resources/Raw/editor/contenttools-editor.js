(function () {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let editor;
  let lastFullHtml = "";
  let lastBaseHref = "";
  let lastSiteRootHref = "";
  let lastTitle = "HTML Document";
  let lastHeadExtras = "";
  let lastBodyAttrs = "";
  let lastHtmlAttrs = 'lang="zh-CN"';
  let lastFocusedElement = null;
  let lastSelection = null;
  const nodeMarkerAttribute = "data-html-editor-node-id";
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
  const replaceableContentTags = new Set([
    "a",
    "abbr",
    "b",
    "bdi",
    "bdo",
    "blockquote",
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
    "button",
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

  function buildHtml() {
    const editable = document.getElementById("document-body");
    syncFocusedElementContent();

    const merged = mergeEditedContentIntoOriginalDocument(editable);
    if (merged) {
      return merged;
    }

    const bodyHtml = getEditableBodyHtml(editable);
    const html = restorePreservedHtmlPlaceholders(
      normalizeHtmlForSave(bodyHtml)
    );

    return buildCompleteHtml(html);
  }

  function getEditableBodyHtml(editable) {
    syncFocusedElementContent();

    const regions = editor && editor.regions ? editor.regions() : null;
    if (regions && regions.body && typeof regions.body.html === "function") {
      return regions.body.html();
    }

    if (!editable) {
      return "";
    }

    const clone = editable.cloneNode(true);
    cleanEditorDom(clone);
    return clone.innerHTML;
  }

  function syncFocusedElementContent() {
    const focused = ContentEdit.Root.get().focused();
    if (focused && focused.isMounted && focused.isMounted() && typeof focused._syncContent === "function") {
      focused._syncContent();
    }
  }

  function buildCompleteHtml(html) {
    const css = mapCssUrls(getEditorStyle(), relativizeAssetUrl);
    const headExtras = normalizeHtmlFragmentForSave(lastHeadExtras);
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
      "</body>",
      "</html>"
    ].filter(Boolean).join("\n");
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
    const editedModelBody = getEditedModelBodyFragment(editable);
    mergeEditedBodyIntoOriginalBody(originalDoc.body, editedBody, editedModelBody);
    rewriteDocumentUrls(originalDoc.body, relativizeAssetUrl);
    removeNodeMarkers(originalDoc.body);

    return mergeBodyIntoOriginalDocument(
      restorePreservedHtmlPlaceholders(originalDoc.body.innerHTML)
    );
  }

  function getEditedModelBodyFragment(editable) {
    const template = document.createElement("template");
    template.innerHTML = getEditableBodyHtml(editable);
    return template.content;
  }

  function mergeEditedBodyIntoOriginalBody(originalBody, editedBody, fallbackEditedBody) {
    const editedElements = collectMarkedElements(editedBody);
    const fallbackEditedElements = collectMarkedElements(fallbackEditedBody);

    Array.from(originalBody.querySelectorAll(`[${nodeMarkerAttribute}]`))
      .sort((left, right) => getNodeDepth(right) - getNodeDepth(left))
      .forEach((originalElement) => {
        const marker = originalElement.getAttribute(nodeMarkerAttribute);
        const editedElement = getBestEditedElement(
          originalElement,
          marker,
          editedElements,
          fallbackEditedElements
        );
        if (!editedElement) {
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

  function getBestEditedElement(originalElement, marker, editedElements, fallbackEditedElements) {
    if (!marker) {
      return null;
    }

    const candidates = [
      editedElements.get(marker),
      fallbackEditedElements.get(marker)
    ].filter(Boolean);

    return candidates.find((element) => isSameTag(originalElement, element)) || candidates[0] || null;
  }

  function mergeElementAttributes(originalElement, editedElement) {
    if (!isSameTag(originalElement, editedElement)) {
      return;
    }

    Array.from(editedElement.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (!mergeableNewAttributes.has(name) || isEditorOwnedAttribute(name)) {
        return;
      }

      originalElement.setAttribute(attribute.name, attribute.value);
    });
  }

  function mergeElementContent(originalElement, editedElement) {
    if (!isSameTag(originalElement, editedElement)) {
      return;
    }

    if (canReplaceElementContent(originalElement, editedElement)) {
      if (!hasMeaningfulContentChange(originalElement, editedElement)) {
        return;
      }

      originalElement.innerHTML = editedElement.innerHTML;
      return;
    }

    mergeDirectTextNodes(originalElement, editedElement);
  }

  function canReplaceElementContent(originalElement, editedElement) {
    const tag = originalElement.tagName.toLowerCase();
    if (!replaceableContentTags.has(tag)) {
      return false;
    }

    if (originalElement.querySelector(`[${nodeMarkerAttribute}]`)) {
      return false;
    }

    if (isProtectedContent(originalElement) || isProtectedContent(editedElement)) {
      return false;
    }

    if (isInlineFlowElement(originalElement) && hasNonInlineElementChild(editedElement)) {
      return false;
    }

    return true;
  }

  function mergeDirectTextNodes(originalElement, editedElement) {
    if (isProtectedContent(originalElement) || isProtectedContent(editedElement)) {
      return;
    }

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
      if (
        editedText === originalText
        || normalizeTextForCompare(editedText) === normalizeTextForCompare(originalText)
      ) {
        return;
      }

      replaceTextSegment(originalElement, segment, editedText);
    });
  }

  function hasMeaningfulContentChange(originalElement, editedElement) {
    if (getComparableInnerHtml(originalElement) === getComparableInnerHtml(editedElement)) {
      return false;
    }

    return normalizeTextForCompare(originalElement.textContent || "")
      !== normalizeTextForCompare(editedElement.textContent || "")
      || getComparableElementSignature(originalElement) !== getComparableElementSignature(editedElement);
  }

  function getComparableInnerHtml(element) {
    const clone = element.cloneNode(true);
    removeNodeMarkers(clone);
    cleanEditorDom(clone);
    return String(clone.innerHTML || "")
      .replace(/>\s+</g, "><")
      .trim();
  }

  function getComparableElementSignature(element) {
    return Array.from(element.querySelectorAll("*"))
      .map((child) => child.tagName.toLowerCase())
      .join("|");
  }

  function normalizeTextForCompare(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
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

  function hasNonInlineElementChild(element) {
    return Array.from(element.children).some((child) => !isInlineFlowElement(child));
  }

  function isEditorOwnedAttribute(name) {
    return name === nodeMarkerAttribute
      || name === "contenteditable"
      || name === "draggable"
      || name === "spellcheck"
      || name.startsWith("data-ce-")
      || name.startsWith("data-ct-");
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

  function cleanEditorDom(root) {
    root.querySelectorAll("*").forEach((element) => {
      element.removeAttribute("contenteditable");
      element.removeAttribute("data-ce-size");
      removeEditorClasses(element);
    });
  }

  function removeEditorClasses(element) {
    if (!element.hasAttribute("class")) {
      return;
    }

    const classes = Array.from(element.classList)
      .filter((className) => !className.startsWith("ce-element") && !className.startsWith("ct--"));

    if (classes.length) {
      element.setAttribute("class", classes.join(" "));
    } else {
      element.removeAttribute("class");
    }
  }

  function loadHtml(fullHtml, baseHref, siteRootHref) {
    if (editor && editor.isEditing && editor.isEditing()) {
      editor.stop(true);
    }

    lastFullHtml = fullHtml || "";
    lastBaseHref = baseHref || "";
    lastSiteRootHref = siteRootHref || lastBaseHref;
    const parts = splitHtml(lastFullHtml);
    lastTitle = parts.title;
    lastHeadExtras = parts.headExtras;
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
    root.querySelectorAll(attributes.map((attribute) => `[${attribute}]`).join(",")).forEach((element) => {
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
      root.querySelectorAll(`[${attribute}]`).forEach((element) => {
        const value = element.getAttribute(attribute);
        element.setAttribute(attribute, mapSrcset(value, mapper));
      });
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
    if (!url || shouldKeepUrl(value)) {
      return value;
    }

    const siteRootRelativeUrl = relativizeSiteRootUrl(url);
    if (siteRootRelativeUrl !== null) {
      return siteRootRelativeUrl;
    }

    if (!lastBaseHref) {
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

  function relativizeSiteRootUrl(url) {
    if (!isRootRelativeUrl(url) || !lastSiteRootHref || !lastBaseHref) {
      return null;
    }

    try {
      const base = new URL(lastBaseHref);
      const siteRoot = new URL(lastSiteRootHref);
      if (base.protocol !== "file:" || siteRoot.protocol !== "file:") {
        return null;
      }

      const parts = splitUrlParts(url);
      const siteRootPath = normalizeBasePath(decodeURIComponent(siteRoot.pathname));
      const targetPath = siteRootPath + decodePathPart(parts.path.slice(1));
      const relative = pathRelative(decodeURIComponent(base.pathname), targetPath);
      const relativePath = parts.path.endsWith("/")
        ? appendIndexDocument(relative)
        : relative;

      return `${relativePath || "index.html"}${parts.search}${parts.hash}`;
    } catch {
      return null;
    }
  }

  function isRootRelativeUrl(url) {
    return url.startsWith("/") && !url.startsWith("//");
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

  function decodePathPart(path) {
    try {
      return decodeURIComponent(path);
    } catch {
      return path;
    }
  }

  function appendIndexDocument(path) {
    if (!path) {
      return "index.html";
    }

    return `${path.replace(/\/+$/, "")}/index.html`;
  }

  function shouldKeepUrl(value) {
    const url = String(value || "").trim().toLowerCase();
    return url.startsWith("#")
      || url.startsWith("//")
      || url.startsWith("data:")
      || url.startsWith("blob:")
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
    ContentEdit.TagNames.get().register(ContentEdit.Static, "template");
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
    loadHtmlBase64(base64, baseHrefBase64, siteRootHrefBase64) {
      loadHtml(fromBase64(base64), fromBase64(baseHrefBase64), fromBase64(siteRootHrefBase64));
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
      loadHtml(lastFullHtml, lastBaseHref, lastSiteRootHref);
      return true;
    },
    isReady() {
      return Boolean(editor);
    }
  };

  init();
}());
