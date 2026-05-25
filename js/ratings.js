/* NetGameForge ratings client (FE-12): visitor_id + API wrappers for the
   live likes/dislikes + moderated reviews Worker. Vanilla, no deps.
   Backend: https://ngf-api.kovalevde.workers.dev (see worker/src/index.js). */
(function (w) {
  "use strict";

  var API_BASE = "https://ngf-api.kovalevde.workers.dev";
  var VID_KEY = "ngf_visitor_id";

  function uuid() {
    if (w.crypto && typeof w.crypto.randomUUID === "function") {
      return w.crypto.randomUUID();
    }
    // Fallback uuid v4 (no crypto.randomUUID).
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getVisitorId() {
    var id;
    try {
      id = w.localStorage.getItem(VID_KEY);
      if (!id) {
        id = uuid();
        w.localStorage.setItem(VID_KEY, id);
      }
    } catch (e) {
      // localStorage blocked (private mode) — ephemeral id, still works per page.
      id = id || uuid();
    }
    return id;
  }

  async function api(path, opts) {
    var res = await fetch(API_BASE + path, opts);
    var data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    if (!res.ok) {
      var err = new Error((data && data.error) || ("http_" + res.status));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function fetchGame(slug) {
    var vid = encodeURIComponent(getVisitorId());
    return api("/api/game/" + encodeURIComponent(slug) + "?visitor_id=" + vid, {
      method: "GET",
    });
  }

  function vote(slug, value) {
    return api("/api/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        game_id: slug,
        visitor_id: getVisitorId(),
        value: value,
      }),
    });
  }

  function submitReview(slug, text, name) {
    return api("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        game_id: slug,
        visitor_id: getVisitorId(),
        text: text,
        name: name || undefined,
      }),
    });
  }

  w.NGFRatings = {
    API_BASE: API_BASE,
    getVisitorId: getVisitorId,
    fetchGame: fetchGame,
    vote: vote,
    submitReview: submitReview,
  };
})(window);
