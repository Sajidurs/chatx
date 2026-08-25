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

  // The widget itself can't move its own iframe element from inside (it's
  // on the host page, entirely out of the iframe's reach), so it posts
  // small per-tick movement deltas here instead and this is what actually
  // repositions the real element. Each "drag" message carries an
  // *incremental* delta (mousemove's own movementX/movementY, not a
  // running total from where the drag started) added onto the iframe's
  // current position -- an absolute delta measured from a fixed start
  // point breaks here, because the iframe itself moves out from under the
  // cursor mid-drag, which shifts what any position *inside* the iframe's
  // own coordinate space means for the same real on-screen cursor spot.
  // Confirmed directly: using a running total from drag start made the
  // element visibly lag to about half the real cursor movement.
  window.addEventListener("message", function (event) {
    if (event.source !== iframe.contentWindow) return;
    var data = event.data;
    if (!data || data.source !== "chatx-widget") return;

    if (data.type === "resize") {
      iframe.style.width = data.width + "px";
      iframe.style.height = data.height + "px";
      return;
    }

    if (data.type === "dragStart") {
      var rect = iframe.getBoundingClientRect();
      // Switch from bottom/right anchoring (the default, so the widget
      // stays pinned to a corner as the page resizes) to absolute top/left
      // once the visitor picks a specific spot -- bottom/right anchoring
      // would otherwise fight a drag by re-anchoring to the same corner on
      // the next resize (e.g. minimizing back to the bubble).
      iframe.style.bottom = "";
      iframe.style.right = "";
      iframe.style.top = rect.top + "px";
      iframe.style.left = rect.left + "px";
      return;
    }

    if (data.type === "drag") {
      var currentTop = parseFloat(iframe.style.top) || 0;
      var currentLeft = parseFloat(iframe.style.left) || 0;
      var iframeRect = iframe.getBoundingClientRect();
      var maxLeft = Math.max(window.innerWidth - iframeRect.width, 0);
      var maxTop = Math.max(window.innerHeight - iframeRect.height, 0);
      var newLeft = Math.min(Math.max(currentLeft + data.dx, 0), maxLeft);
      var newTop = Math.min(Math.max(currentTop + data.dy, 0), maxTop);
      iframe.style.left = newLeft + "px";
      iframe.style.top = newTop + "px";
      return;
    }
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
