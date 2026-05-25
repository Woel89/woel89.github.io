/* NetGameForge tracking abstraction (design §7).
   track(eventName, params) fans out to GA4 (gtag) and Yandex.Metrika (reachGoal).
   Guarded so missing/blocked libs never throw. Phase 2: swap body for own /e endpoint. */
(function (w) {
  "use strict";
  var YM_ID = 109411317;
  w.track = function track(eventName, params) {
    params = params || {};
    try {
      if (typeof w.gtag === "function") w.gtag("event", eventName, params);
    } catch (e) {}
    try {
      if (typeof w.ym === "function") w.ym(YM_ID, "reachGoal", eventName, params);
    } catch (e) {}
  };
})(window);
