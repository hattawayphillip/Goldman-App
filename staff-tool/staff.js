/*
 * Goldman Equipment — internal quick-quote & finance tool.
 *
 * Reads the FULL equipment catalog live from Airtable (not just the
 * customer-site-visible subset — staff need to quote on everything, not
 * just what's advertised publicly). Edit a row in Airtable and it shows
 * up here on next page load, same as the customer site.
 *
 * Requires config.js (see ../config.js.template) loaded before this file.
 */
(function () {
  'use strict';

  var AC = window.AirtableClient;
  var TABLES = window.AIRTABLE_CONFIG.tables;

  var DATA = null;
  var state = { filterCat: 'All', search: '', selectedId: null, selectedImpl: [], priceOverride: null, down: 0, apr: 6.9, term: 60 };

  function fmt(n) { return '$' + Math.round(n).toLocaleString(); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function loadData() {
    return Promise.all([
      AC.fetchAllRecords(TABLES.categories),
      AC.fetchAllRecords(TABLES.equipment),
      AC.fetchAllRecords(TABLES.attachments),
      AC.fetchAllRecords(TABLES.promotions),
      AC.fetchAllRecords(TABLES.siteSettings)
    ]).then(function (results) {
      var categories = results[0], equipment = results[1], attachments = results[2],
        promotions = results[3], settings = results[4];

      categories.sort(function (a, b) { return AC.num(a.SortOrder) - AC.num(b.SortOrder); });

      var models = equipment.map(function (m) {
        return {
          id: m._id,
          cat: m.CategoryKey,
          label: m.Name,
          blurb: m.Description || '',
          msrp: AC.num(m.MSRP),
          salePrice: AC.num(m.SalePrice),
          monthlyPayment: AC.num(m.MonthlyPayment),
          financeTeaser: m.FinanceTeaser || '',
          featured: AC.truthy(m.Featured),
          priceIsPlaceholder: AC.truthy(m.PriceIsPlaceholder)
        };
      });

      var atts = attachments.map(function (a) {
        return {
          id: a._id, cat: a.ImplementCategory, brand: a.Brand, model: a.Model,
          desc: a.Description, price: AC.num(a.Price), equipmentCategoryKey: a.EquipmentCategoryKey
        };
      });

      var activePromo = promotions.filter(function (p) { return AC.truthy(p.Active); })[0] || promotions[0] || {};
      var siteSettings = settings[0] || {};

      return {
        categories: categories.map(function (c) { return { key: c.Key, name: c.Name, icon: c.Icon }; }),
        models: models,
        attachments: atts,
        promo: {
          headline: activePromo.Headline || '', dateRange: activePromo.DateRangeText || '',
          bulletin: activePromo.Bulletin || '', badge: activePromo.BadgeText || ''
        },
        settings: { siteTitle: siteSettings.SiteTitle || 'Goldman Equipment' }
      };
    });
  }

  function renderPromoBanner() {
    var p = DATA.promo;
    var el = document.getElementById('promo-banner');
    if (!p || !p.headline) { el.style.display = 'none'; return; }
    el.innerHTML = '<span>' + esc(p.headline) + (p.dateRange ? ' — ' + esc(p.dateRange) : '') + ': ' + esc(p.bulletin) + '</span>' +
      (p.badge ? '<span class="badge">' + esc(p.badge) + '</span>' : '');
  }

  function renderCatTabs() {
    var tabs = [{ key: 'All', name: 'All' }].concat(DATA.categories.map(function (c) { return { key: c.key, name: c.name }; }));
    document.getElementById('cat-tabs').innerHTML = tabs.map(function (t) {
      return '<div class="cat-tab' + (state.filterCat === t.key ? ' active' : '') + '" data-key="' + esc(t.key) + '">' + esc(t.name) + '</div>';
    }).join('');
    document.querySelectorAll('.cat-tab').forEach(function (el) {
      el.addEventListener('click', function () { state.filterCat = el.dataset.key; renderCatTabs(); renderModelList(); });
    });
  }

  function catName(key) {
    var c = DATA.categories.filter(function (c) { return c.key === key; })[0];
    return c ? c.name : key;
  }

  function renderModelList() {
    var q = state.search.trim().toLowerCase();
    var models = DATA.models.filter(function (m) {
      return (state.filterCat === 'All' || m.cat === state.filterCat) && (!q || m.label.toLowerCase().indexOf(q) >= 0);
    });
    document.getElementById('result-count').textContent = models.length + ' model' + (models.length === 1 ? '' : 's');
    document.getElementById('model-list').innerHTML = models.map(function (m) {
      var hasPrice = m.salePrice > 0 || m.msrp > 0;
      var price = hasPrice ? fmt(m.salePrice > 0 ? m.salePrice : m.msrp) : 'No price on file';
      var priceClass = !hasPrice ? 'price none' : (m.priceIsPlaceholder ? 'price placeholder' : 'price');
      return '<div class="model-row' + (state.selectedId === m.id ? ' selected' : '') + '" data-id="' + esc(m.id) + '">' +
        '<div><div class="name">' + esc(m.label) + '</div><div class="blurb">' + esc(catName(m.cat)) + '</div></div>' +
        '<div class="' + priceClass + '">' + price + (hasPrice && m.priceIsPlaceholder ? ' *' : '') + '</div></div>';
    }).join('');
    document.querySelectorAll('.model-row').forEach(function (el) {
      el.addEventListener('click', function () { selectModel(el.dataset.id); });
    });
  }

  function selectModel(id) {
    state.selectedId = id;
    state.selectedImpl = [];
    var m = DATA.models.filter(function (x) { return x.id === id; })[0];
    state.priceOverride = m.salePrice > 0 ? m.salePrice : (m.msrp > 0 ? m.msrp : 0);
    renderModelList();
    renderQuote();
  }

  function selectedModel() {
    return DATA.models.filter(function (m) { return m.id === state.selectedId; })[0];
  }

  function implementsFor(model) {
    if (!model) return [];
    return DATA.attachments.filter(function (a) { return a.equipmentCategoryKey === model.cat; });
  }

  function equipmentSubtotal() {
    var m = selectedModel();
    if (!m) return 0;
    var base = state.priceOverride || 0;
    var implTotal = DATA.attachments
      .filter(function (a) { return state.selectedImpl.indexOf(a.id) >= 0; })
      .reduce(function (s, a) { return s + a.price; }, 0);
    return base + implTotal;
  }

  function monthlyPayment(principal, apr, months) {
    if (principal <= 0 || months <= 0) return 0;
    var r = (apr / 100) / 12;
    if (r === 0) return principal / months;
    return principal * r * Math.pow(1 + r, months) / (Math.pow(1 + r, months) - 1);
  }

  function renderQuote() {
    var m = selectedModel();
    var body = document.getElementById('quote-body');
    if (!m) { body.innerHTML = '<div id="no-selection">Select a piece of equipment on the left to start a quote.</div>'; return; }

    var implList = implementsFor(m);
    var groups = {};
    implList.forEach(function (a) { (groups[a.cat] = groups[a.cat] || []).push(a); });
    var implHtml = implList.length ? Object.keys(groups).map(function (cat) {
      var rows = groups[cat].map(function (a) {
        var checked = state.selectedImpl.indexOf(a.id) >= 0;
        return '<div class="impl-row' + (checked ? ' checked' : '') + '" data-id="' + esc(a.id) + '">' +
          '<div class="impl-name">' + esc(a.brand + ' ' + a.model) + ' <span style="color:#8a938d;font-weight:600;">' + esc(a.desc) + '</span></div>' +
          '<div class="impl-price">' + fmt(a.price) + '</div></div>';
      }).join('');
      return '<div class="impl-group-label">' + esc(cat) + '</div>' + rows;
    }).join('') : '';

    var subtotal = equipmentSubtotal();
    var principal = Math.max(subtotal - (state.down || 0), 0);
    var payment = monthlyPayment(principal, state.apr, state.term);

    body.innerHTML =
      '<div class="qp-section">' +
      '<div id="selected-name">' + esc(m.label) + '</div>' +
      '<div id="selected-blurb">' + esc(m.blurb) + '</div>' +
      '<div class="price-field"><label>Quoted Price</label><input id="price-input" type="number" value="' + (state.priceOverride || 0) + '"></div>' +
      (m.priceIsPlaceholder ? '<div class="placeholder-note">Catalog price on this model is a placeholder — confirm real pricing before quoting a customer.</div>' : '') +
      (m.financeTeaser ? '<div style="font-size:12px;color:#23511D;font-weight:700;margin-top:8px;">' + esc(m.financeTeaser) + '</div>' : '') +
      '</div>' +

      (implList.length ? '<div class="qp-section"><div class="qp-label">Add Implements</div>' + implHtml + '</div>' : '') +

      '<div class="qp-section">' +
      '<div id="subtotal-row"><span>Quote Subtotal</span><span class="amt">' + fmt(subtotal) + '</span></div>' +
      '</div>' +

      '<div class="qp-section">' +
      '<div class="qp-label">Financing Estimate</div>' +
      '<div class="finance-row"><label>Down Payment</label><input id="down-input" type="number" value="' + (state.down || 0) + '"></div>' +
      '<div class="finance-row"><label>APR %</label><input id="apr-input" type="number" step="0.1" value="' + state.apr + '"></div>' +
      '<div class="finance-row"><label>Term</label><div id="term-tabs">' +
      [36, 48, 60, 72].map(function (t) {
        return '<div class="term-tab' + (state.term === t ? ' active' : '') + '" data-term="' + t + '">' + t + 'mo</div>';
      }).join('') + '</div></div>' +
      '<div id="monthly-result"><span>Est. Monthly Payment</span><span class="amt">' + fmt(payment) + '/mo</span></div>' +
      '<div id="finance-caveat">Estimate only — for illustration while talking with a customer. Confirm actual rate, term, and approval through John Deere Financial before quoting a firm payment.</div>' +
      '</div>' +

      '<div id="actions">' +
      '<button class="secondary" id="new-quote-btn">New Quote</button>' +
      '<button class="primary" id="print-btn">Print Quote</button>' +
      '</div>';

    document.getElementById('price-input').addEventListener('change', function (e) {
      state.priceOverride = parseFloat(e.target.value) || 0;
      renderQuote();
    });
    document.getElementById('down-input').addEventListener('change', function (e) {
      state.down = parseFloat(e.target.value) || 0;
      renderQuote();
    });
    document.getElementById('apr-input').addEventListener('change', function (e) {
      state.apr = parseFloat(e.target.value) || 0;
      renderQuote();
    });
    document.querySelectorAll('.term-tab').forEach(function (el) {
      el.addEventListener('click', function () { state.term = parseInt(el.dataset.term, 10); renderQuote(); });
    });
    document.querySelectorAll('.impl-row').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = el.dataset.id;
        var idx = state.selectedImpl.indexOf(id);
        if (idx >= 0) state.selectedImpl.splice(idx, 1); else state.selectedImpl.push(id);
        renderQuote();
      });
    });
    document.getElementById('new-quote-btn').addEventListener('click', function () {
      state.selectedId = null; state.selectedImpl = []; state.priceOverride = null; state.down = 0;
      renderModelList(); renderQuote();
    });
    document.getElementById('print-btn').addEventListener('click', function () { window.print(); });
  }

  document.getElementById('search-box').addEventListener('input', function (e) {
    state.search = e.target.value; renderModelList();
  });

  loadData().then(function (data) {
    DATA = data;
    document.getElementById('site-title').textContent = DATA.settings.siteTitle;
    renderPromoBanner();
    renderCatTabs();
    renderModelList();
    renderQuote();
  }).catch(function (err) {
    console.error('[staff tool] failed to load catalog:', err);
    var el = document.getElementById('load-error');
    el.style.display = 'block';
    el.textContent = 'Could not load the catalog from Airtable. Check config.js has the right base ID/token, and that the token has access to this base. (' + err.message + ')';
  });
})();
