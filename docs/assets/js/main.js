/* =============================================================================
   SWE_BUILDER docs — site interactions
   - Theme toggle (persisted in localStorage)
   - Mobile nav toggle
   - Copy-to-clipboard for <pre> blocks
   - Active nav-link highlighting based on current pathname
   - Mermaid theme sync
   ============================================================================= */

(function () {
  "use strict";

  /* ----- Theme ----- */
  var THEME_KEY = "swe-builder-theme";

  function getStoredTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch (e) {
      return null;
    }
  }

  function setStoredTheme(value) {
    try {
      localStorage.setItem(THEME_KEY, value);
    } catch (e) {
      /* noop */
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    if (window.mermaid && typeof window.mermaid.initialize === "function") {
      try {
        window.mermaid.initialize({
          startOnLoad: false,
          theme: theme === "light" ? "default" : "dark",
          themeVariables: theme === "light"
            ? {}
            : {
                primaryColor: "#1f262e",
                primaryTextColor: "#e6edf3",
                primaryBorderColor: "#4f7cff",
                lineColor: "#8b949e",
                secondaryColor: "#161b22",
                tertiaryColor: "#0d1117",
              },
        });
        window.mermaid.run({ querySelector: ".mermaid" });
      } catch (e) {
        /* mermaid may not be loaded yet */
      }
    }
  }

  function detectInitialTheme() {
    var stored = getStoredTheme();
    if (stored === "light" || stored === "dark") return stored;
    var prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
    return prefersLight ? "light" : "dark";
  }

  function initThemeToggle() {
    var btn = document.querySelector("[data-theme-toggle]");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var current = document.documentElement.getAttribute("data-theme") || "dark";
      var next = current === "dark" ? "light" : "dark";
      setStoredTheme(next);
      applyTheme(next);
    });
  }

  /* ----- Mobile nav ----- */
  function initMobileNav() {
    var btn = document.querySelector("[data-menu-toggle]");
    var nav = document.querySelector("[data-mobile-nav]");
    if (!btn || !nav) return;
    btn.addEventListener("click", function () {
      nav.classList.toggle("open");
      var open = nav.classList.contains("open");
      btn.setAttribute("aria-expanded", String(open));
    });
    nav.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        nav.classList.remove("open");
        btn.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* ----- Active nav link ----- */
  function initActiveNav() {
    var path = window.location.pathname.replace(/\/+$/, "");
    var fileMatch = path.match(/([^/]+)$/);
    var current = fileMatch ? fileMatch[1] : "index.html";
    if (current === "" || current === "swe_builder") current = "index.html";

    document.querySelectorAll("[data-nav] a").forEach(function (a) {
      var href = a.getAttribute("href");
      if (!href) return;
      var bare = href.split("/").pop();
      var matches =
        bare === current ||
        (current === "index.html" && (bare === "" || bare === "index.html")) ||
        (bare === "index.html" && current === "");
      if (matches) {
        a.classList.add("active");
        a.setAttribute("aria-current", "page");
      }
    });
  }

  /* ----- Copy-to-clipboard ----- */
  function initCopyButtons() {
    document.querySelectorAll("pre").forEach(function (pre) {
      if (pre.querySelector(".copy-btn")) return;
      var btn = document.createElement("button");
      btn.className = "copy-btn";
      btn.type = "button";
      btn.setAttribute("aria-label", "Copy code");
      btn.textContent = "Copy";
      btn.addEventListener("click", function () {
        var code = pre.querySelector("code");
        var text = code ? code.innerText : pre.innerText;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(showCopied, fallbackCopy);
        } else {
          fallbackCopy();
        }

        function fallbackCopy() {
          var ta = document.createElement("textarea");
          ta.value = text;
          ta.setAttribute("readonly", "");
          ta.style.position = "absolute";
          ta.style.left = "-9999px";
          document.body.appendChild(ta);
          ta.select();
          try {
            document.execCommand("copy");
            showCopied();
          } catch (e) {
            /* noop */
          }
          document.body.removeChild(ta);
        }

        function showCopied() {
          btn.textContent = "Copied";
          btn.classList.add("copied");
          setTimeout(function () {
            btn.textContent = "Copy";
            btn.classList.remove("copied");
          }, 1500);
        }
      });
      pre.appendChild(btn);
    });
  }

  /* ----- Heading anchors ----- */
  function initHeadingAnchors() {
    document.querySelectorAll("main.content h2[id], main.content h3[id]").forEach(function (h) {
      if (h.querySelector(".anchor")) return;
      var a = document.createElement("a");
      a.className = "anchor";
      a.href = "#" + h.id;
      a.setAttribute("aria-label", "Permalink to " + h.textContent);
      a.textContent = "#";
      h.appendChild(a);
    });
  }

  /* ----- Boot ----- */
  applyTheme(detectInitialTheme());

  document.addEventListener("DOMContentLoaded", function () {
    initThemeToggle();
    initMobileNav();
    initActiveNav();
    initCopyButtons();
    initHeadingAnchors();

    if (window.mermaid && typeof window.mermaid.run === "function") {
      try {
        window.mermaid.run({ querySelector: ".mermaid" });
      } catch (e) {
        /* noop */
      }
    }
    if (window.hljs && typeof window.hljs.highlightAll === "function") {
      try {
        window.hljs.highlightAll();
      } catch (e) {
        /* noop */
      }
    }
  });
})();
