/* Kaj System – site behaviour: theme, language, nav, estimator, contact form. */
(function () {
  'use strict';
  var CFG = window.KAJ_CONFIG || {};
  var I18N = window.KAJ_I18N || { langs: { en: 'English' }, en: {} };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  /* Theme ---------------------------------------------------------------- */
  var root = document.documentElement;
  function applyTheme(t) {
    root.setAttribute('data-theme', t);
    var sun = $('#themeBtn .ic-sun'), moon = $('#themeBtn .ic-moon');
    if (sun && moon) { sun.hidden = t === 'dark'; moon.hidden = t !== 'dark'; }
  }
  applyTheme(root.getAttribute('data-theme') || 'light');
  var themeBtn = $('#themeBtn');
  if (themeBtn) themeBtn.addEventListener('click', function () {
    var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    store.set('kaj-theme', next); applyTheme(next);
  });

  /* Language ------------------------------------------------------------- */
  var langs = Object.keys(I18N.langs || { en: 1 });
  function pickLang() {
    var q = new URLSearchParams(location.search).get('lang');
    if (q && I18N[q]) return q;
    var saved = store.get('kaj-lang');
    if (saved && I18N[saved]) return saved;
    var nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
    return I18N[nav] ? nav : 'en';
  }
  var lang = pickLang();
  function t(key) {
    var d = I18N[lang] || {}, e = I18N.en || {};
    return d[key] != null ? d[key] : (e[key] != null ? e[key] : key);
  }
  function applyLang(l) {
    lang = l; store.set('kaj-lang', l); root.lang = l;
    $$('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    $$('[data-i18n-ph]').forEach(function (el) { el.placeholder = t(el.getAttribute('data-i18n-ph')); });
    $$('[data-i18n-aria]').forEach(function (el) { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
    document.title = t('meta.title');
    var md = $('meta[name="description"]'); if (md) md.content = t('meta.description');
    $$('.lang-switch button').forEach(function (b) { b.classList.toggle('active', b.dataset.lang === l); });
    renderEstimate();
    renderTestimonials();
  }
  $$('.lang-switch').forEach(function (sw) {
    langs.forEach(function (l) {
      var b = document.createElement('button');
      b.type = 'button'; b.dataset.lang = l; b.textContent = l.toUpperCase();
      b.setAttribute('aria-label', I18N.langs[l]);
      b.addEventListener('click', function () { applyLang(l); });
      sw.appendChild(b);
    });
  });

  /* Nav ------------------------------------------------------------------ */
  var nav = $('#nav'), toggle = $('#navToggle'), mobile = $('#navMobile');
  function onScroll() { if (nav) nav.classList.toggle('scrolled', window.scrollY > 8); }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  function setMenu(open) {
    if (!toggle || !mobile) return;
    mobile.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    $('.ic-open', toggle).hidden = open; $('.ic-close', toggle).hidden = !open;
  }
  if (toggle) toggle.addEventListener('click', function () { setMenu(!mobile.classList.contains('open')); });
  if (mobile) $$('a', mobile).forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });

  // Highlight the section in view.
  var sections = $$('main section[id]');
  var navAnchors = $$('.nav-links a');
  if ('IntersectionObserver' in window && sections.length) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        navAnchors.forEach(function (a) { a.classList.toggle('active', a.getAttribute('href') === '#' + en.target.id); });
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    sections.forEach(function (s) { spy.observe(s); });
  }

  /* Reveal on scroll ----------------------------------------------------- */
  var reveals = $$('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { threshold: 0.12 });
    reveals.forEach(function (el) { io.observe(el); });
  } else { reveals.forEach(function (el) { el.classList.add('in'); }); }

  /* Config-driven bits --------------------------------------------------- */
  var cur = CFG.currency || { symbol: '$' };
  function money(n) {
    n = Math.round(n / 10) * 10;
    return cur.symbol + n.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US');
  }
  var P = CFG.pricing || {};
  $$('[data-price]').forEach(function (el) { var k = el.getAttribute('data-price'); if (P[k] != null) el.textContent = money(P[k]); });

  var C = CFG.contact || {};
  var yr = $('#year'); if (yr) yr.textContent = String(new Date().getFullYear());
  if (C.email) {
    var le = $('#linkEmail'); if (le) { le.href = 'mailto:' + C.email; $('#emailText').textContent = C.email; }
    var fe = $('#footerEmail'); if (fe) { fe.innerHTML = '<a href="mailto:' + C.email + '">' + C.email + '</a>'; }
  }
  var waUrl = C.whatsapp ? 'https://wa.me/' + String(C.whatsapp).replace(/\D/g, '') : '';
  if (waUrl) {
    var lw = $('#linkWa'); if (lw) { lw.href = waUrl; lw.hidden = false; $('#waText').textContent = '+' + String(C.whatsapp).replace(/\D/g, ''); }
    var fab = $('#waFab'); if (fab) { fab.href = waUrl; fab.hidden = false; }
  }
  if (C.bookingUrl) {
    var lb = $('#linkBook'); if (lb) { lb.href = C.bookingUrl; lb.hidden = false; $('#bookText').textContent = C.bookingUrl.replace(/^https?:\/\//, ''); }
  }
  var loc = $('#locText'); if (loc) loc.textContent = C.location || '';

  var S = CFG.social || {};
  var socials = $('#socials');
  if (socials) {
    [['linkedin', 'i-in', 'LinkedIn'], ['twitter', 'i-tw', 'X / Twitter'], ['instagram', 'i-ig', 'Instagram'], ['github', 'i-gh', 'GitHub']].forEach(function (s) {
      if (!S[s[0]]) return;
      var a = document.createElement('a');
      a.href = S[s[0]]; a.target = '_blank'; a.rel = 'noopener'; a.setAttribute('aria-label', s[2]);
      a.innerHTML = '<svg><use href="#' + s[1] + '"/></svg>';
      socials.appendChild(a);
    });
  }

  function renderTestimonials() {
    var list = CFG.testimonials || [], sec = $('#testimonials'), grid = $('#testiGrid');
    if (!sec || !grid) return;
    if (!list.length) { sec.hidden = true; return; }
    sec.hidden = false; grid.innerHTML = '';
    list.forEach(function (q) {
      var el = document.createElement('article'); el.className = 'card quote reveal in';
      var initials = q.avatar || (q.name || '?').split(' ').map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
      el.innerHTML = '<div class="stars" aria-hidden="true">★★★★★</div><p></p><div class="who"><i></i><div><b></b><span></span></div></div>';
      $('p', el).textContent = '“' + (q.quote || '') + '”';
      $('.who i', el).textContent = initials; $('.who b', el).textContent = q.name || ''; $('.who span', el).textContent = q.role || '';
      grid.appendChild(el);
    });
  }

  /* Estimator ------------------------------------------------------------ */
  var E = CFG.estimator || {};
  var estForm = $('#estimator');
  var estimate = null;
  function computeEstimate() {
    if (!estForm || !E.base) return null;
    var platform = (estForm.querySelector('input[name="platform"]:checked') || {}).value || 'webapp';
    var base = E.base[platform] || { price: 0, weeks: 0 };
    var price = base.price, weeks = base.weeks, addons = [];
    $$('input[name="addon"]:checked', estForm).forEach(function (cb) {
      var a = (E.addons || {})[cb.value]; if (!a) return;
      price += a.price; weeks += a.weeks; addons.push(cb.value);
    });
    var rush = (estForm.querySelector('input[name="speed"]:checked') || {}).value === 'rush';
    if (rush && E.rush) { price *= E.rush.price; weeks *= E.rush.weeks; }
    var spread = E.spread || 0.15;
    return {
      platform: platform, addons: addons, rush: rush,
      low: price * (1 - spread), high: price * (1 + spread),
      weeksLow: Math.max(1, Math.round(weeks)), weeksHigh: Math.max(1, Math.round(weeks * 1.25)),
    };
  }
  function renderEstimate() {
    estimate = computeEstimate();
    if (!estimate) return;
    $('#estPrice').textContent = money(estimate.low) + ' – ' + money(estimate.high);
    var w = estimate.weeksLow === estimate.weeksHigh ? String(estimate.weeksLow) : estimate.weeksLow + ' – ' + estimate.weeksHigh;
    $('#estWeeks').textContent = w + ' ' + t('est.weeksUnit');
    var tally = $('#estTally'); tally.innerHTML = '';
    var rows = [[t('est.p.' + estimate.platform), money(E.base[estimate.platform].price)]];
    estimate.addons.forEach(function (a) { rows.push(['+ ' + t('est.a.' + a), money(E.addons[a].price)]); });
    if (estimate.rush) rows.push([t('est.t.rush'), '×' + E.rush.price]);
    rows.forEach(function (r) {
      var d = document.createElement('div'); d.innerHTML = '<span></span><span></span>';
      d.children[0].textContent = r[0]; d.children[1].textContent = r[1]; tally.appendChild(d);
    });
  }
  if (estForm) { estForm.addEventListener('change', renderEstimate); }

  function summarizeEstimate() {
    if (!estimate) return '';
    var lines = [t('est.p.' + estimate.platform)];
    estimate.addons.forEach(function (a) { lines.push('+ ' + t('est.a.' + a)); });
    if (estimate.rush) lines.push(t('est.t.rush'));
    lines.push(t('est.result') + ': ' + money(estimate.low) + ' – ' + money(estimate.high));
    lines.push(t('est.weeks') + ': ' + $('#estWeeks').textContent);
    return lines.join('\n');
  }
  var estSend = $('#estSend');
  if (estSend) estSend.addEventListener('click', function () {
    var type = $('#f-type'), msg = $('#f-msg');
    if (type && estimate) type.value = estimate.platform;
    if (msg && estimate) {
      var summary = summarizeEstimate();
      msg.value = (msg.value && msg.value.indexOf(summary) === -1 ? msg.value + '\n\n' : '') + summary + '\n\n';
      var budget = $('#f-budget');
      if (budget) {
        var mid = (estimate.low + estimate.high) / 2;
        budget.value = mid < 1000 ? '<1000' : mid < 3000 ? '1000-3000' : mid < 8000 ? '3000-8000' : '>8000';
      }
      setTimeout(function () { msg.focus(); }, 600);
    }
  });

  // "Choose this package" buttons preselect the project type.
  $$('[data-plan]').forEach(function (a) {
    a.addEventListener('click', function () { var type = $('#f-type'); if (type) type.value = a.getAttribute('data-plan'); });
  });

  /* Contact form --------------------------------------------------------- */
  var form = $('#contactForm'), status = $('#formStatus'), submitBtn = $('#submitBtn');
  function showStatus(kind, text) { status.hidden = false; status.className = 'form-status ' + kind; status.textContent = text; }
  if (form) form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }
    var data = new FormData(form);
    if (data.get('_gotcha')) return; // bot
    var payload = {
      name: data.get('name'), email: data.get('email'), phone: data.get('phone'),
      project: data.get('project'), budget: data.get('budget'), message: data.get('message'),
      language: lang, page: location.href,
    };
    var endpoint = C.formEndpoint;
    if (!endpoint) {
      // No backend configured: open the visitor's email client with everything filled in.
      var body = Object.keys(payload).map(function (k) { return k + ': ' + payload[k]; }).join('\n');
      location.href = 'mailto:' + (C.email || '') + '?subject=' + encodeURIComponent('Project request – ' + payload.name) + '&body=' + encodeURIComponent(body);
      showStatus('ok', t('contact.success'));
      return;
    }
    submitBtn.disabled = true; var label = $('span', submitBtn); var old = label.textContent; label.textContent = t('contact.sending');
    fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); showStatus('ok', t('contact.success')); form.reset(); })
      .catch(function () { showStatus('err', t('contact.error') + ' ' + (C.email || '')); })
      .then(function () { submitBtn.disabled = false; label.textContent = old; });
  });

  applyLang(lang);
})();
