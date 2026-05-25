/* NetGameForge game-page widget (FE-13/14): like/dislike action-bar + reviews
   accordion. Reads slug from #ngf-ratings[data-slug]. Optimistic vote updates,
   lazy-loaded reviews, no modals. Depends on js/ratings.js (window.NGFRatings). */
(function (w, d) {
  "use strict";

  var R = w.NGFRatings;
  if (!R) return;

  var root = d.getElementById("ngf-ratings");
  if (!root) return;
  var slug = root.getAttribute("data-slug");
  if (!slug) return;

  function el(tag, cls, text) {
    var n = d.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function fmtDate(ts) {
    if (!ts) return "";
    var dt = new Date(ts * 1000);
    if (isNaN(dt.getTime())) return "";
    return dt.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  }

  function track(name, params) {
    if (typeof w.track === "function") w.track(name, params);
  }

  /* ---------- Like / dislike ---------- */

  var state = { myVote: 0, likes: 0, dislikes: 0, totalVotes: 0, percentPositive: null, enoughVotes: false };

  var bar = el("section", "ngf-actionbar");
  bar.setAttribute("aria-label", "Оценка игры");

  var likeBtn = el("button", "ngf-vote", "👍");
  likeBtn.type = "button";
  likeBtn.setAttribute("aria-label", "Нравится");
  likeBtn.setAttribute("aria-pressed", "false");

  var dislikeBtn = el("button", "ngf-vote", "👎");
  dislikeBtn.type = "button";
  dislikeBtn.setAttribute("aria-label", "Не нравится");
  dislikeBtn.setAttribute("aria-pressed", "false");

  var summary = el("span", "ngf-vote-summary", "");
  summary.setAttribute("role", "status");

  bar.appendChild(likeBtn);
  bar.appendChild(dislikeBtn);
  bar.appendChild(summary);

  function renderVotes() {
    likeBtn.setAttribute("aria-pressed", state.myVote === 1 ? "true" : "false");
    dislikeBtn.setAttribute("aria-pressed", state.myVote === -1 ? "true" : "false");
    likeBtn.classList.toggle("is-active", state.myVote === 1);
    dislikeBtn.classList.toggle("is-active", state.myVote === -1);
    if (state.enoughVotes && state.percentPositive != null) {
      summary.textContent = state.percentPositive + "% понравилось · " + state.totalVotes + " оценок";
    } else {
      summary.textContent = "Оцени первым";
    }
  }

  function onVote(target) {
    var prev = { myVote: state.myVote, likes: state.likes, dislikes: state.dislikes, totalVotes: state.totalVotes, percentPositive: state.percentPositive, enoughVotes: state.enoughVotes };
    var next = state.myVote === target ? 0 : target; // repeat click clears
    // Optimistic local recompute.
    if (state.myVote === 1) state.likes -= 1;
    if (state.myVote === -1) state.dislikes -= 1;
    if (next === 1) state.likes += 1;
    if (next === -1) state.dislikes += 1;
    state.myVote = next;
    state.totalVotes = state.likes + state.dislikes;
    state.percentPositive = state.totalVotes > 0 ? Math.round((state.likes / state.totalVotes) * 100) : null;
    state.enoughVotes = state.totalVotes >= 10;
    renderVotes();

    R.vote(slug, next).then(function (res) {
      state.myVote = res.myVote;
      state.likes = res.likes;
      state.dislikes = res.dislikes;
      state.totalVotes = res.totalVotes;
      state.percentPositive = res.percentPositive;
      state.enoughVotes = res.totalVotes >= 10;
      renderVotes();
      track("vote", { game_id: slug, value: next });
    }).catch(function () {
      // Roll back on failure.
      state.myVote = prev.myVote;
      state.likes = prev.likes;
      state.dislikes = prev.dislikes;
      state.totalVotes = prev.totalVotes;
      state.percentPositive = prev.percentPositive;
      state.enoughVotes = prev.enoughVotes;
      renderVotes();
    });
  }

  likeBtn.addEventListener("click", function () { onVote(1); });
  dislikeBtn.addEventListener("click", function () { onVote(-1); });

  /* ---------- Reviews accordion ---------- */

  var reviewsLoaded = false;
  var myPending = null;
  var reviews = [];

  var details = el("details", "ngf-reviews");
  var summ = el("summary", "ngf-reviews-summary");
  var summTitle = el("span", null, "Отзывы");
  var summCount = el("span", "ngf-reviews-count", "");
  summ.appendChild(summTitle);
  summ.appendChild(summCount);
  details.appendChild(summ);

  var panel = el("div", "ngf-reviews-panel");
  details.appendChild(panel);

  // Form
  var form = el("form", "ngf-review-form");
  var nameField = el("label", "ngf-field");
  nameField.appendChild(el("span", null, "Имя (необязательно)"));
  var nameInput = el("input");
  nameInput.type = "text";
  nameInput.maxLength = 40;
  nameInput.placeholder = "Игрок";
  nameField.appendChild(nameInput);

  var textField = el("label", "ngf-field");
  textField.appendChild(el("span", null, "Отзыв"));
  var textArea = el("textarea");
  textArea.rows = 3;
  textArea.minLength = 3;
  textArea.maxLength = 500;
  textArea.placeholder = "Что понравилось или не зашло?";
  textField.appendChild(textArea);

  var counter = el("span", "ngf-counter", "");
  textField.appendChild(counter);

  var submitBtn = el("button", "ngf-btn ngf-btn--primary", "Отправить");
  submitBtn.type = "submit";

  var formMsg = el("p", "ngf-form-msg", "");
  formMsg.setAttribute("role", "status");
  formMsg.hidden = true;

  form.appendChild(nameField);
  form.appendChild(textField);
  form.appendChild(submitBtn);
  form.appendChild(formMsg);

  var myReviewBox = el("div", "ngf-my-review");
  myReviewBox.hidden = true;

  var list = el("div", "ngf-review-list");
  var emptyMsg = el("p", "ngf-reviews-empty", "Пока нет отзывов. Поделись впечатлением");

  panel.appendChild(form);
  panel.appendChild(myReviewBox);
  panel.appendChild(emptyMsg);
  panel.appendChild(list);

  function updateCounter() {
    var len = textArea.value.length;
    if (len >= 450) {
      counter.hidden = false;
      counter.textContent = len + " / 500";
    } else {
      counter.hidden = true;
    }
  }
  textArea.addEventListener("input", updateCounter);
  updateCounter();

  function chip(text, cls) {
    return el("span", "ngf-chip " + cls, text);
  }

  function reviewItem(r) {
    var item = el("article", "ngf-review");
    var head = el("div", "ngf-review-head");
    head.appendChild(el("strong", null, r.name || "Игрок"));
    var date = fmtDate(r.created_at);
    if (date) head.appendChild(el("time", "ngf-review-date", date));
    item.appendChild(head);
    item.appendChild(el("p", "ngf-review-text", r.text));
    return item;
  }

  function renderMyPending() {
    myReviewBox.hidden = true;
    myReviewBox.innerHTML = "";
    if (!myPending) return;
    if (myPending.status === "pending") {
      myReviewBox.hidden = false;
      var p = el("div", "ngf-review");
      var h = el("div", "ngf-review-head");
      h.appendChild(el("strong", null, "Ваш отзыв"));
      h.appendChild(chip("На проверке", "ngf-chip--pending"));
      p.appendChild(h);
      p.appendChild(el("p", "ngf-review-text", myPending.text || ""));
      myReviewBox.appendChild(p);
    } else if (myPending.status === "rejected") {
      myReviewBox.hidden = false;
      var note = el("p", "ngf-reject-note", "Не прошёл публикацию — возможно, есть оскорбления/ссылки. Отредактируй и отправь снова");
      myReviewBox.appendChild(note);
      if (myPending.text && !textArea.value) textArea.value = myPending.text;
      updateCounter();
    }
  }

  function renderList() {
    list.innerHTML = "";
    if (reviews.length === 0) {
      emptyMsg.hidden = false;
    } else {
      emptyMsg.hidden = true;
      reviews.forEach(function (r) { list.appendChild(reviewItem(r)); });
    }
  }

  function applyData(data) {
    state.myVote = data.myVote || 0;
    state.likes = data.likes || 0;
    state.dislikes = data.dislikes || 0;
    state.totalVotes = data.totalVotes || 0;
    state.percentPositive = data.percentPositive;
    state.enoughVotes = !!data.enoughVotes;
    renderVotes();

    reviews = data.reviews || [];
    myPending = data.myPending || null;
    summCount.textContent = "(" + reviews.length + ")";
    renderList();
    renderMyPending();
  }

  function loadReviews() {
    if (reviewsLoaded) return;
    reviewsLoaded = true;
    R.fetchGame(slug).then(applyData).catch(function () {
      reviewsLoaded = false; // allow retry on next open
    });
  }

  details.addEventListener("toggle", function () {
    if (details.open) loadReviews();
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = textArea.value.trim();
    if (text.length < 3 || text.length > 500) {
      formMsg.hidden = false;
      formMsg.textContent = "Отзыв должен быть от 3 до 500 символов.";
      return;
    }
    submitBtn.disabled = true;
    formMsg.hidden = true;
    R.submitReview(slug, text, nameInput.value.trim()).then(function (res) {
      track("review_submit", { game_id: slug, status: res.status });
      if (res.status === "approved") {
        reviews.unshift({ name: nameInput.value.trim() || null, text: text, created_at: Math.floor(Date.now() / 1000) });
        summCount.textContent = "(" + reviews.length + ")";
        renderList();
        myPending = null;
        renderMyPending();
        textArea.value = "";
        updateCounter();
      } else {
        myPending = { status: res.status, reject_reason: res.reject_reason, text: text };
        renderMyPending();
        if (res.status === "approved") textArea.value = "";
        else if (res.status === "pending") { textArea.value = ""; updateCounter(); }
      }
    }).catch(function () {
      formMsg.hidden = false;
      formMsg.textContent = "Не удалось отправить. Попробуй ещё раз.";
    }).finally(function () {
      submitBtn.disabled = false;
    });
  });

  /* ---------- Mount + initial load ---------- */

  root.appendChild(bar);
  root.appendChild(details);
  renderVotes();

  // Eagerly fetch vote state (so summary shows on load); reviews list is reused.
  R.fetchGame(slug).then(function (data) {
    applyData(data);
    reviewsLoaded = true;
  }).catch(function () {});
})(window, document);
