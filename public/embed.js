(function () {
  // Captured synchronously at top-level execution, before any awaits --
  // document.currentScript is null once execution leaves the initial
  // synchronous run, even for a script tagged async.
  var thisScript = document.currentScript;
  var businessId = thisScript.getAttribute("data-business-id");
  if (!businessId) {
    console.error("chatx embed: missing data-business-id attribute.");
    return;
  }

  // The script's own src tells us which app instance to talk to, so the
  // same snippet works unchanged across local/staging/production.
  var origin = new URL(thisScript.src).origin;

  var iframe = document.createElement("iframe");
  iframe.src = origin + "/widget/" + encodeURIComponent(businessId);
  iframe.title = "Chat widget";
  iframe.style.position = "fixed";
  iframe.style.bottom = "16px";
  iframe.style.right = "16px";
  iframe.style.border = "none";
  iframe.style.background = "transparent";
  iframe.style.zIndex = "2147483647";
  iframe.style.colorScheme = "light";
  // Small bubble-sized default so there's no flash of an oversized box
  // before the widget's first real size report arrives.
  iframe.style.width = "88px";
  iframe.style.height = "88px";

  window.addEventListener("message", function (event) {
    if (event.source !== iframe.contentWindow) return;
    var data = event.data;
    if (!data || data.source !== "chatx-widget" || data.type !== "resize") return;
    iframe.style.width = data.width + "px";
    iframe.style.height = data.height + "px";
  });

  // This snippet may be pasted in <head> (before <body> exists yet) or in a
  // footer (after it). With the `async` attribute, an in-head placement can
  // execute before document.body is available at all, so appendChild can't
  // just assume it's there -- wait for the document to finish parsing first
  // if it hasn't already.
  function mount() {
    document.body.appendChild(iframe);
  }
  if (document.body) {
    mount();
  } else {
    document.addEventListener("DOMContentLoaded", mount);
  }
})();
