/*
 * Hollow Knight web port — persistent speedrun split timer panel.
 *
 * Classic (non-module) script: exposes window.HKSpeedrunTimer so it can be
 * loaded both by the game pages and by the standalone test page
 * (speedrun-timer.test.html) via a plain <script> tag, including over file://.
 *
 * The clock and the storage backend are injectable so tests can drive the
 * timer with a fake clock and an in-memory localStorage replacement:
 *
 *   var panel = HKSpeedrunTimer.createPanel({
 *     now: function () { return fakeTimeMs; },   // defaults to performance.now
 *     storage: fakeStorage,                       // defaults to localStorage
 *     hotkeys: false                              // T/R/E hotkeys on by default
 *   });
 *   document.body.appendChild(panel.element);
 */
(function (global) {
  "use strict";

  var STORAGE_KEY = "hk_speedrun_splits_v1";

  // Default route: common HK any% checkpoints (same list the old timer used).
  var DEFAULT_SPLIT_NAMES = [
    "Vengeful Spirit",
    "Enter Greenpath",
    "Mothwing Cloak",
    "Mantis Claw",
    "Gruz Mother",
    "Dream Nail",
    "Gorgeous Husk",
    "Lumafly Lantern",
    "Crystal Heart",
    "Watcher Knights",
    "Lurien",
    "Uumuu",
    "Monomon",
    "Queen's Gardens Acid Skip",
    "Beast's Den Bench",
    "Herrah",
    "The Hollow Knight"
  ];

  var PLACEHOLDER = "—"; // shown whenever there is no historical best yet

  function defaultSplits() {
    return DEFAULT_SPLIT_NAMES.map(function (name) {
      return { name: name, bestSeg: null, bestCum: null };
    });
  }

  function isValidTime(v) {
    return typeof v === "number" && isFinite(v) && v >= 0;
  }

  // Stored shape: JSON array of { name: string, bestSeg: number|null, bestCum: number|null }
  // bestSeg = best (fastest) segment duration for this split, ms.
  // bestCum = best (fastest) cumulative time at which this split was hit, ms.
  // Returns null when the stored value is not an array at all.
  function sanitizeSplits(raw) {
    if (!Array.isArray(raw)) return null;
    return raw.map(function (entry, i) {
      var e = entry && typeof entry === "object" ? entry : {};
      return {
        name:
          typeof e.name === "string" && e.name.trim()
            ? e.name
            : "Split " + (i + 1),
        bestSeg: isValidTime(e.bestSeg) ? e.bestSeg : null,
        bestCum: isValidTime(e.bestCum) ? e.bestCum : null
      };
    });
  }

  function pad(n, len) {
    return String(n).padStart(len, "0");
  }

  function formatMs(ms) {
    ms = Math.max(0, Math.floor(ms));
    var h = Math.floor(ms / 3600000);
    var m = Math.floor((ms % 3600000) / 60000);
    var s = Math.floor((ms % 60000) / 1000);
    var rest = ms % 1000;
    return pad(h, 2) + ":" + pad(m, 2) + ":" + pad(s, 2) + "." + pad(rest, 3);
  }

  // Delta vs best: negative = faster (green), positive = slower (red).
  function formatDelta(ms) {
    var sign = ms < 0 ? "-" : "+";
    return sign + formatMs(Math.abs(ms));
  }

  var CSS = [
    ".hkst-panel{position:fixed;top:10px;left:50%;transform:translateX(-50%);",
    "background:rgba(0,0,0,.78);border:1px solid rgba(255,255,255,.12);",
    "border-radius:12px;padding:10px 14px;color:#fff;font-family:monospace;",
    "z-index:99999;user-select:none;text-align:center;min-width:280px;}",
    ".hkst-label{font-size:10px;opacity:.7;letter-spacing:2px;margin-bottom:4px;}",
    ".hkst-time{font-size:26px;font-weight:bold;}",
    ".hkst-controls{display:flex;gap:6px;justify-content:center;margin-top:6px;}",
    ".hkst-controls button,.hkst-add{font:inherit;font-size:11px;color:#fff;",
    "background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);",
    "border-radius:8px;padding:3px 10px;cursor:pointer;}",
    ".hkst-controls button:hover,.hkst-add:hover{background:rgba(255,255,255,.16);}",
    ".hkst-controls button:disabled{opacity:.35;cursor:default;}",
    ".hkst-splits{list-style:none;margin:8px 0 0;padding:6px 0 0;",
    "border-top:1px solid rgba(255,255,255,.1);max-height:220px;overflow-y:auto;",
    "font-size:12px;text-align:left;}",
    ".hkst-row{display:flex;align-items:center;gap:8px;padding:2px 4px;",
    "border-bottom:1px solid rgba(255,255,255,.06);border-radius:4px;}",
    ".hkst-row.hkst-current{background:rgba(79,195,247,.18);",
    "outline:1px solid rgba(79,195,247,.45);}",
    ".hkst-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".hkst-row.hkst-current .hkst-name{color:#4fc3f7;font-weight:bold;}",
    ".hkst-cum{opacity:.55;font-size:10px;}",
    ".hkst-seg{min-width:82px;text-align:right;}",
    ".hkst-delta{min-width:82px;text-align:right;}",
    ".hkst-delta.hkst-faster{color:#3ddc84;}",
    ".hkst-delta.hkst-slower{color:#ef5350;}",
    ".hkst-delta.hkst-none,.hkst-seg.hkst-none{opacity:.45;}",
    ".hkst-del{border:none;background:none;color:#fff;opacity:.35;cursor:pointer;",
    "font:inherit;padding:0 2px;}",
    ".hkst-del:hover{opacity:1;color:#ef5350;}",
    ".hkst-add{margin-top:6px;width:100%;}",
    ".hkst-total{margin-top:6px;font-size:12px;border-top:1px solid rgba(255,255,255,.1);",
    "padding-top:6px;}",
    ".hkst-total .hkst-none{opacity:.45;}",
    ".hkst-hint{font-size:10px;opacity:.5;margin-top:6px;}"
  ].join("\n");

  var cssInjected = false;
  function injectCss(doc) {
    if (cssInjected) return;
    cssInjected = true;
    var style = doc.createElement("style");
    style.textContent = CSS;
    doc.head.appendChild(style);
  }

  function createPanel(opts) {
    opts = opts || {};
    var doc = opts.document || global.document;
    var now =
      typeof opts.now === "function"
        ? opts.now
        : function () {
            return performance.now();
          };
    var storage;
    if (opts.storage !== undefined) {
      storage = opts.storage;
    } else {
      try {
        storage = global.localStorage;
      } catch (e) {
        storage = null;
      }
    }
    var storageKey = opts.storageKey || STORAGE_KEY;
    var useHotkeys = opts.hotkeys !== false;

    injectCss(doc);

    // ── Persistent state ──────────────────────────────────────────────
    var splits = loadSplits();

    // ── Current-run (transient) state ─────────────────────────────────
    var runSegments = []; // { seg, cum, delta|null } per completed split
    var currentSplit = 0;
    var elapsed = 0; // accumulated ms, excluding any ongoing running stretch
    var startedAt = 0; // now() timestamp of the last resume
    var running = false;
    var enabled = true;

    function loadSplits() {
      if (!storage) return defaultSplits();
      try {
        var raw = storage.getItem(storageKey);
        if (raw == null) return defaultSplits();
        var clean = sanitizeSplits(JSON.parse(raw));
        // Corrupted JSON or a non-array payload: fall back to defaults.
        return clean === null ? defaultSplits() : clean;
      } catch (e) {
        return defaultSplits();
      }
    }

    function saveSplits() {
      if (!storage) return;
      try {
        storage.setItem(storageKey, JSON.stringify(splits));
      } catch (e) {
        /* quota / privacy mode — keep running without persistence */
      }
    }

    // ── Timer core (all time from the injected clock) ─────────────────
    function getElapsed() {
      return running ? elapsed + (now() - startedAt) : elapsed;
    }

    function isFinished() {
      return splits.length > 0 && currentSplit >= splits.length;
    }

    function start() {
      if (running) return;
      if (isFinished()) resetRun(); // previous run complete → start a fresh one
      running = true;
      startedAt = now();
      render();
    }

    function pause() {
      if (!running) return;
      elapsed += now() - startedAt;
      running = false;
      render();
    }

    function toggle() {
      if (running) pause();
      else start();
    }

    function resetRun() {
      running = false;
      elapsed = 0;
      runSegments = [];
      currentSplit = 0;
    }

    // Reset clears ONLY the current run; historical bests are untouched.
    function reset() {
      resetRun();
      render();
    }

    function split() {
      if (!running) return; // split is a no-op until the timer is started
      if (currentSplit >= splits.length) return;

      var cum = getElapsed();
      var prevCum = currentSplit === 0 ? 0 : runSegments[currentSplit - 1].cum;
      var seg = cum - prevCum;
      var sp = splits[currentSplit];

      // Delta against the best known BEFORE this split updates it.
      var delta = sp.bestSeg == null ? null : seg - sp.bestSeg;

      runSegments.push({ seg: seg, cum: cum, delta: delta });

      if (sp.bestSeg == null || seg < sp.bestSeg) sp.bestSeg = seg;
      if (sp.bestCum == null || cum < sp.bestCum) sp.bestCum = cum;

      currentSplit++;

      // All splits done → stop the clock automatically.
      if (currentSplit >= splits.length) {
        running = false;
        elapsed = cum;
      }

      saveSplits();
      render();
    }

    // ── Split list editing (structural edits reset the current run) ───
    function addSplit(name) {
      name =
        typeof name === "string" && name.trim()
          ? name.trim()
          : "Split " + (splits.length + 1);
      splits.push({ name: name, bestSeg: null, bestCum: null });
      resetRun();
      saveSplits();
      render();
    }

    function removeSplit(index) {
      if (index < 0 || index >= splits.length) return;
      splits.splice(index, 1);
      resetRun();
      saveSplits();
      render();
    }

    function renameSplit(index, name) {
      if (index < 0 || index >= splits.length) return;
      if (typeof name !== "string" || !name.trim()) return;
      splits[index].name = name.trim();
      saveSplits();
      render();
    }

    function getBestTotal() {
      if (!splits.length) return null;
      return splits[splits.length - 1].bestCum;
    }

    // ── UI ────────────────────────────────────────────────────────────
    var root = doc.createElement("div");
    root.className = "hkst-panel";

    var label = doc.createElement("div");
    label.className = "hkst-label";
    label.textContent = "SPEEDRUN";
    root.appendChild(label);

    var timeEl = doc.createElement("div");
    timeEl.className = "hkst-time";
    timeEl.textContent = formatMs(0);
    root.appendChild(timeEl);

    var controls = doc.createElement("div");
    controls.className = "hkst-controls";
    var btnStart = doc.createElement("button");
    btnStart.textContent = "Start";
    btnStart.title = "Start/Pause (T)";
    var btnReset = doc.createElement("button");
    btnReset.textContent = "Reset";
    btnReset.title = "Reset (R)";
    var btnSplit = doc.createElement("button");
    btnSplit.textContent = "Split";
    btnSplit.title = "Split (E)";
    controls.appendChild(btnStart);
    controls.appendChild(btnReset);
    controls.appendChild(btnSplit);
    root.appendChild(controls);

    var listEl = doc.createElement("ul");
    listEl.className = "hkst-splits";
    root.appendChild(listEl);

    var btnAdd = doc.createElement("button");
    btnAdd.className = "hkst-add";
    btnAdd.textContent = "+ Add split";
    root.appendChild(btnAdd);

    var totalEl = doc.createElement("div");
    totalEl.className = "hkst-total";
    root.appendChild(totalEl);

    var hint = doc.createElement("div");
    hint.className = "hkst-hint";
    hint.textContent =
      "T = Start/Pause • R = Reset • E = Split • double-click a split to rename";
    root.appendChild(hint);

    function render() {
      timeEl.textContent = formatMs(getElapsed());
      btnStart.textContent = running ? "Pause" : "Start";
      btnSplit.disabled = !running || currentSplit >= splits.length;

      listEl.textContent = "";
      splits.forEach(function (sp, i) {
        var li = doc.createElement("li");
        li.className = "hkst-row";
        var done = i < runSegments.length;
        var isCurrent = !done && i === currentSplit;
        if (done) li.classList.add("hkst-done");
        if (isCurrent) li.classList.add("hkst-current");

        var nameEl = doc.createElement("span");
        nameEl.className = "hkst-name";
        nameEl.textContent = sp.name;
        nameEl.title = "Double-click to rename";
        li.appendChild(nameEl);

        var cumEl = doc.createElement("span");
        cumEl.className = "hkst-cum";
        cumEl.textContent = done ? formatMs(runSegments[i].cum) : "";
        li.appendChild(cumEl);

        var segEl = doc.createElement("span");
        segEl.className = "hkst-seg";
        if (done) {
          segEl.textContent = formatMs(runSegments[i].seg);
        } else if (sp.bestSeg != null) {
          segEl.textContent = formatMs(sp.bestSeg);
          segEl.classList.add("hkst-none");
          segEl.title = "Best segment";
        } else {
          segEl.textContent = PLACEHOLDER;
          segEl.classList.add("hkst-none");
        }
        li.appendChild(segEl);

        var deltaEl = doc.createElement("span");
        deltaEl.className = "hkst-delta";
        if (done && runSegments[i].delta != null) {
          var d = runSegments[i].delta;
          deltaEl.textContent = formatDelta(d);
          deltaEl.classList.add(d < 0 ? "hkst-faster" : "hkst-slower");
        } else {
          deltaEl.textContent = done ? PLACEHOLDER : "";
          if (done) deltaEl.classList.add("hkst-none");
        }
        li.appendChild(deltaEl);

        var del = doc.createElement("button");
        del.className = "hkst-del";
        del.textContent = "×";
        del.title = "Delete split";
        del.addEventListener("click", function (ev) {
          ev.stopPropagation();
          removeSplit(i);
        });
        li.appendChild(del);

        nameEl.addEventListener("dblclick", function () {
          var renamed = global.prompt
            ? global.prompt("Split name:", sp.name)
            : null;
          if (renamed != null) renameSplit(i, renamed);
        });

        listEl.appendChild(li);
      });

      var best = getBestTotal();
      totalEl.textContent = "";
      var totalLabel = doc.createElement("span");
      totalLabel.textContent = "Total best: ";
      var totalValue = doc.createElement("span");
      if (best != null) {
        totalValue.textContent = formatMs(best);
      } else {
        totalValue.textContent = PLACEHOLDER;
        totalValue.className = "hkst-none";
      }
      totalEl.appendChild(totalLabel);
      totalEl.appendChild(totalValue);
    }

    // Keep the clock display ticking while running.
    var tickInterval =
      opts.tickIntervalMs != null ? opts.tickIntervalMs : 33;
    var ticker = setInterval(function () {
      if (running) timeEl.textContent = formatMs(getElapsed());
    }, tickInterval);

    btnStart.addEventListener("click", toggle);
    btnReset.addEventListener("click", reset);
    btnSplit.addEventListener("click", split);
    btnAdd.addEventListener("click", function () {
      var name = global.prompt ? global.prompt("New split name:") : null;
      if (name != null) addSplit(name);
    });

    function onKeydown(e) {
      if (!enabled || e.repeat) return;
      var t = e.target;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      var key = (e.key || "").toLowerCase();
      if (key === "t") toggle();
      else if (key === "r") reset();
      else if (key === "e") split();
    }
    if (useHotkeys) doc.addEventListener("keydown", onKeydown);

    function setEnabled(v) {
      enabled = !!v;
      if (!enabled && running) pause();
      root.style.display = enabled ? "" : "none";
    }

    render();

    return {
      element: root,
      // timer controls
      start: start,
      pause: pause,
      toggle: toggle,
      reset: reset,
      split: split,
      // split list editing
      addSplit: addSplit,
      removeSplit: removeSplit,
      renameSplit: renameSplit,
      // inspection (used by the test page)
      getElapsed: getElapsed,
      isRunning: function () {
        return running;
      },
      isFinished: isFinished,
      getSplits: function () {
        return splits.map(function (s) {
          return { name: s.name, bestSeg: s.bestSeg, bestCum: s.bestCum };
        });
      },
      getRunSegments: function () {
        return runSegments.map(function (r) {
          return { seg: r.seg, cum: r.cum, delta: r.delta };
        });
      },
      getBestTotal: getBestTotal,
      setEnabled: setEnabled,
      dispose: function () {
        clearInterval(ticker);
        if (useHotkeys) doc.removeEventListener("keydown", onKeydown);
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  global.HKSpeedrunTimer = {
    STORAGE_KEY: STORAGE_KEY,
    DEFAULT_SPLIT_NAMES: DEFAULT_SPLIT_NAMES.slice(),
    PLACEHOLDER: PLACEHOLDER,
    formatMs: formatMs,
    formatDelta: formatDelta,
    createPanel: createPanel
  };
})(typeof window !== "undefined" ? window : this);
