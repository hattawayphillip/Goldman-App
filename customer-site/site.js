/*
 * Goldman Equipment — customer catalog + quote-request site.
 *
 * Reads its catalog (categories, equipment, attachments, active promo,
 * site settings) live from Airtable via ../airtable-client.js, and writes
 * quote requests back to the QuoteRequests table the same way — so an
 * edit in Airtable shows up here on next page load, and every submitted
 * quote lands somewhere the sales team can see it centrally.
 *
 * Requires config.js (see ../config.js.template) loaded before this file.
 */
(function () {
  'use strict';

  var AC = window.AirtableClient;
  var TABLES = window.AIRTABLE_CONFIG.tables;

  var root = document.getElementById('ge-root');
  var loadingEl = document.getElementById('ge-loading');
  var appEl = document.getElementById('ge-app');

  var state = {
    data: null,
    filter: 'All',
    quoteOpen: false,
    quoteStep: 'form',
    quoteModelId: null,
    selectedImpl: [],
    qf: { name: '', phone: '', email: '', message: '' },
    submitting: false
  };

  function fmt(n) { return '$' + Math.round(n).toLocaleString(); }

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    var end = new Date(dateStr + 'T23:59:59');
    if (isNaN(end)) return null;
    return Math.ceil((end - new Date()) / 86400000);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- Data load --------------------------------------------------------

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

      var models = equipment
        .filter(function (m) { return AC.truthy(m.Visible); })
        .map(function (m) {
          return {
            id: m._id,
            cat: m.CategoryKey,
            label: m.Name,
            blurb: m.Description || '',
            photo: null,
            msrp: AC.num(m.MSRP),
            salePrice: AC.num(m.SalePrice),
            monthlyPayment: AC.num(m.MonthlyPayment),
            financeTeaser: m.FinanceTeaser || '',
            featured: AC.truthy(m.Featured),
            visible: true
          };
        });

      var atts = attachments.map(function (a) {
        return {
          id: a._id,
          cat: a.ImplementCategory,
          brand: a.Brand,
          model: a.Model,
          desc: a.Description,
          price: AC.num(a.Price),
          equipmentCategoryKey: a.EquipmentCategoryKey
        };
      });

      var activePromo = promotions.filter(function (p) { return AC.truthy(p.Active); })[0] || promotions[0] || {};
      var siteSettings = settings[0] || {};

      return {
        categories: categories.map(function (c) { return { key: c.Key, name: c.Name, icon: c.Icon }; }),
        models: models,
        attachments: atts,
        promo: {
          headline: activePromo.Headline || 'Special Offers',
          dateRange: activePromo.DateRangeText || '',
          endDate: activePromo.EndDate || '',
          bulletin: activePromo.Bulletin || '',
          badge: activePromo.BadgeText || ''
        },
        settings: {
          siteTitle: siteSettings.SiteTitle || 'Goldman Equipment',
          siteSub: siteSettings.SiteSubtitle || 'John Deere Dealer',
          analyticsId: siteSettings.AnalyticsId || ''
        }
      };
    });
  }

  function loadAnalytics(data) {
    var id = (data.settings.analyticsId || '').trim();
    if (!id || window.gtag) return;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', id);
  }

  function track(name, params) {
    try { if (window.gtag) window.gtag('event', name, params || {}); } catch (e) { /* analytics is best-effort */ }
  }

  // ---- Rendering ----------------------------------------------------

  function iconSvg(icon) {
    switch (icon) {
      case 'tractor': return '<circle cx="7" cy="17" r="3.4"></circle><circle cx="18" cy="17" r="2.2"></circle><path d="M7 17V8.5h3.2l2.6 4h3.7a1.8 1.8 0 0 1 1.8 1.8v2.7"></path><path d="M10.2 12.5h6.3"></path><path d="M7 8.5H5"></path>';
      case 'mower': return '<rect x="5" y="9" width="11" height="6" rx="2"></rect><circle cx="7.5" cy="17" r="2"></circle><circle cx="15.5" cy="17" r="2"></circle><path d="M16 11h3.5a1.5 1.5 0 0 1 1.5 1.5V13"></path><path d="M5 9l2-4h4"></path>';
      case 'house': return '<path d="M4 11.5 12 4l8 7.5"></path><path d="M6 10v9h12v-9"></path><path d="M10 19v-5h4v5"></path>';
      case 'utv': return '<rect x="3" y="10" width="14" height="5" rx="1.5"></rect><path d="M17 11h2.5A1.5 1.5 0 0 1 21 12.5V14"></path><circle cx="7" cy="17" r="2.2"></circle><circle cx="15" cy="17" r="2.2"></circle><path d="M6 10V7.5a1 1 0 0 1 1-1h5"></path>';
      default: return '';
    }
  }

  function renderHeader(d) {
    return '' +
      '<div style="position:sticky;top:0;z-index:20;background:linear-gradient(150deg,#14330F,#367C2B 80%);color:#fff;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 2px 14px rgba(10,31,8,.25);">' +
      '<div style="display:flex;align-items:center;gap:12px;">' +
      '<div style="width:38px;height:38px;border-radius:10px;background:#FFDE00;color:#14330F;display:flex;align-items:center;justify-content:center;font-family:\'Anton\',sans-serif;font-size:16px;flex-shrink:0;">GE</div>' +
      '<div><div style="font-size:17px;font-weight:900;letter-spacing:.2px;">' + esc(d.settings.siteTitle) + '</div>' +
      '<div style="font-size:10.5px;opacity:.85;text-transform:uppercase;letter-spacing:1px;margin-top:1px;">' + esc(d.settings.siteSub) + '</div></div>' +
      '</div></div>';
  }

  function renderHero(d) {
    var dl = daysUntil(d.promo.endDate);
    var countdownHtml = '';
    if (dl != null) {
      var text, bg = 'rgba(0,0,0,.22)';
      if (dl > 1) text = dl + ' days left';
      else if (dl === 1) text = 'Last day!';
      else if (dl === 0) text = 'Ends today!';
      else { text = 'Sale end date has passed'; bg = 'rgba(192,57,43,.35)'; }
      countdownHtml = '<div style="display:inline-flex;align-items:center;gap:7px;background:' + bg + ';border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:7px 18px;margin-top:12px;font-size:12.5px;font-weight:700;">' +
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5V12l3 2"></path></svg>' +
        esc(text) + '</div>';
    }
    var badgeHtml = d.promo.badge ? (
      '<div><div style="display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.3);border-radius:999px;padding:8px 20px;margin-top:20px;font-size:12.5px;font-weight:800;">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 3H5a2 2 0 0 0-2 2v6.5a2 2 0 0 0 .6 1.4l9 9a2 2 0 0 0 2.8 0l6.5-6.5a2 2 0 0 0 0-2.8l-9-9a2 2 0 0 0-1.4-.6Z"></path><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"></circle></svg>' +
      esc(d.promo.badge) + '</div></div>'
    ) : '';

    return '<div style="position:relative;overflow:hidden;background:linear-gradient(120deg,#14330F,#2C6624,#367C2B,#2C6624);background-size:300% 300%;animation:ge-gradientshift 16s ease infinite;color:#fff;padding:56px 20px 48px;text-align:center;">' +
      '<div style="position:absolute;top:-60px;right:-40px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgba(255,222,0,.35),transparent 70%);filter:blur(6px);animation:ge-drift1 9s ease-in-out infinite;pointer-events:none;"></div>' +
      '<div style="position:absolute;bottom:-80px;left:-60px;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.12),transparent 70%);filter:blur(8px);animation:ge-drift2 11s ease-in-out infinite;pointer-events:none;"></div>' +
      '<div style="position:relative;max-width:640px;margin:0 auto;">' +
      '<div style="font-size:12px;font-weight:800;letter-spacing:4px;text-transform:uppercase;opacity:.88;margin-bottom:14px;">Goldman Equipment</div>' +
      '<div style="font-family:\'Anton\',Impact,sans-serif;font-size:clamp(38px,9vw,68px);font-weight:400;letter-spacing:.5px;line-height:.95;text-transform:uppercase;color:#FFDE00;text-shadow:0 3px 0 rgba(0,0,0,.25),0 8px 24px rgba(0,0,0,.3);">' + esc(d.promo.headline) + '</div>' +
      '<div style="font-size:16px;font-weight:800;margin-top:14px;letter-spacing:.3px;">' + esc(d.promo.dateRange) + '</div>' +
      countdownHtml +
      '<div style="font-size:14px;margin-top:18px;opacity:.95;line-height:1.6;">' + esc(d.promo.bulletin) + '</div>' +
      badgeHtml +
      '</div></div>';
  }

  function visibleCategoryKeys(d) {
    var set = {};
    d.models.forEach(function (m) { set[m.cat] = true; });
    return set;
  }

  function renderFilterChips(d) {
    var chipBase = 'flex-shrink:0;padding:10px 18px;border-radius:999px;font-size:13px;font-weight:800;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:7px;border:1.5px solid;';
    var active = chipBase + 'background:#367C2B;border-color:#367C2B;color:#fff;box-shadow:0 4px 12px rgba(54,124,43,.35);';
    var inactive = chipBase + 'background:#fff;border-color:#e3e7e1;color:#4a544e;';
    var visKeys = visibleCategoryKeys(d);
    var chips = [{ key: 'All', label: 'All' }].concat(
      d.categories.filter(function (c) { return visKeys[c.key]; })
    );
    var html = chips.map(function (c) {
      var style = state.filter === (c.key || 'All') ? active : inactive;
      return '<button class="ge-chip" data-key="' + esc(c.key || 'All') + '" style="' + style + '">' + esc(c.label || c.name) + '</button>';
    }).join('');
    return '<div style="position:sticky;top:62px;z-index:15;background:#f4f6f2;padding:14px 16px 10px;border-bottom:1px solid #e3e7e1;">' +
      '<div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:2px;">' + html + '</div></div>';
  }

  function modelCard(m) {
    var hasDeal = m.salePrice > 0 && m.msrp > m.salePrice;
    var photoHtml = m.photo
      ? '<img src="' + esc(m.photo) + '" alt="' + esc(m.label) + '" style="width:100%;height:180px;object-fit:cover;display:block;">'
      : '<div style="width:100%;height:180px;background:#eef1ec;display:flex;align-items:center;justify-content:center;color:#a8b0a5;font-size:12px;font-weight:700;">Photo coming soon</div>';
    var ribbon = m.featured
      ? '<div style="position:absolute;top:15px;left:-34px;background:#FFDE00;color:#231d00;font-weight:900;font-size:11px;letter-spacing:1px;padding:5px 38px;transform:rotate(-45deg);box-shadow:0 2px 8px rgba(0,0,0,.25);z-index:2;">HOT DEAL</div>'
      : '';
    var msrpHtml = hasDeal ? '<span style="font-size:14px;color:#a7ada6;text-decoration:line-through;">' + fmt(m.msrp) + '</span>' : '';
    var saveHtml = hasDeal ? '<div style="display:inline-block;background:#FFDE00;color:#231d00;font-size:11px;font-weight:900;padding:3px 12px;border-radius:999px;margin-top:9px;">YOU SAVE ' + fmt(m.msrp - m.salePrice) + '</div>' : '';
    var monthlyHtml = m.monthlyPayment > 0
      ? '<div style="margin-top:11px;background:#EEF6EC;border:1px solid #A9D2A0;border-radius:10px;padding:9px 12px;display:flex;align-items:baseline;justify-content:space-between;">' +
        '<span style="font-size:10.5px;font-weight:800;color:#8a938d;text-transform:uppercase;letter-spacing:.4px;">Or As Low As</span>' +
        '<span style="font-family:\'Anton\',sans-serif;font-size:20px;font-weight:400;color:#23511D;">' + fmt(m.monthlyPayment) + '/mo</span></div>'
      : '';

    return '<div class="ge-card" style="background:#fff;border-radius:18px;border:1px solid #e3e7e1;overflow:hidden;box-shadow:0 2px 8px rgba(28,36,32,.06),0 1px 2px rgba(28,36,32,.05);position:relative;animation:ge-rise .45s ease both;">' +
      ribbon +
      '<div style="width:100%;height:180px;">' + photoHtml + '</div>' +
      '<div style="padding:18px 18px 20px;">' +
      '<div style="font-size:19px;font-weight:900;letter-spacing:-.2px;color:#1c2420;">' + esc(m.label) + '</div>' +
      '<div style="font-size:12.5px;color:#8a938d;margin-top:5px;line-height:1.5;min-height:36px;">' + esc(m.blurb) + '</div>' +
      '<div style="margin-top:15px;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;">' + msrpHtml +
      '<span style="font-family:\'Anton\',sans-serif;font-size:29px;font-weight:400;color:#1d6b2e;letter-spacing:.2px;">' + (m.salePrice > 0 ? fmt(m.salePrice) : 'Call for Price') + '</span></div>' +
      saveHtml + monthlyHtml +
      '<div style="font-size:12px;color:#23511D;font-weight:700;margin-top:9px;">' + esc(m.financeTeaser) + '</div>' +
      '<button class="ge-cta ge-open-quote" data-id="' + esc(m.id) + '" style="width:100%;margin-top:15px;background:linear-gradient(140deg,#367C2B,#23511D);color:#fff;border:none;border-radius:12px;padding:13px;font-size:14.5px;font-weight:800;cursor:pointer;box-shadow:0 4px 14px rgba(54,124,43,.35);">Get My Quote &rarr;</button>' +
      '</div></div>';
  }

  function renderCatalog(d) {
    var visibleModels = d.models.filter(function (m) {
      return m.visible && (state.filter === 'All' || m.cat === state.filter);
    });
    if (!visibleModels.length) {
      return '<div style="padding:22px 16px 60px;max-width:1100px;margin:0 auto;">' +
        '<div style="text-align:center;padding:70px 20px;color:#8a938d;">' +
        '<div style="font-size:19px;font-weight:800;color:#4a544e;margin-bottom:8px;">New deals coming soon!</div>' +
        '<div style="font-size:14px;">Check back shortly, or call us — we\'d love to help you find the right equipment.</div>' +
        '</div></div>';
    }

    var sectionsHtml;
    if (state.filter === 'All') {
      sectionsHtml = d.categories.map(function (cat) {
        var inCat = visibleModels.filter(function (m) { return m.cat === cat.key; });
        if (!inCat.length) return '';
        var header = '<div style="font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:1.2px;color:#23511D;margin:26px 2px 14px;display:flex;align-items:center;gap:10px;">' +
          '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + iconSvg(cat.icon) + '</svg>' +
          esc(cat.name) + '<span style="flex:1;height:1px;background:#A9D2A0;opacity:.6;"></span></div>';
        return header + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px;">' +
          inCat.map(modelCard).join('') + '</div>';
      }).join('');
    } else {
      sectionsHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px;">' +
        visibleModels.map(modelCard).join('') + '</div>';
    }
    return '<div style="padding:22px 16px 60px;max-width:1100px;margin:0 auto;">' + sectionsHtml + '</div>';
  }

  function renderTrustBar() {
    return '<div style="background:#fff;border-top:1px solid #e3e7e1;border-bottom:1px solid #e3e7e1;padding:26px 16px;display:flex;justify-content:center;gap:32px;flex-wrap:wrap;text-align:center;">' +
      ['Local, Family-Owned Dealer', 'Full Service &amp; Parts', 'John Deere Financial Available', 'No-Pressure Quotes'].map(function (t) {
        return '<div style="font-size:12.5px;font-weight:700;color:#4a544e;max-width:150px;">' + t + '</div>';
      }).join('') + '</div>';
  }

  function renderFooter() {
    return '<div style="padding:28px 16px 44px;text-align:center;color:#8a938d;font-size:12px;line-height:1.7;">' +
      '<div><strong style="color:#4a544e;">Goldman Equipment</strong> — Your Local John Deere Dealer</div>' +
      '<div>*See dealer for full financing terms. Subject to credit approval. Pricing and availability subject to change.</div></div>';
  }

  // ---- Quote modal ----------------------------------------------------

  function renderQuoteModal(d) {
    if (!state.quoteOpen) return '';
    var m = d.models.filter(function (x) { return x.id === state.quoteModelId; })[0];
    var modelLabel = m ? m.label : 'General Inquiry';
    var body = '';

    if (state.quoteStep === 'implements') {
      var selAtt = d.attachments.filter(function (a) { return state.selectedImpl.indexOf(a.id) >= 0; });
      var subtotal = selAtt.reduce(function (s, a) { return s + a.price; }, 0);
      var groups = {};
      d.attachments.forEach(function (a) { (groups[a.cat] = groups[a.cat] || []).push(a); });
      var groupsHtml = Object.keys(groups).map(function (cat) {
        var itemsHtml = groups[cat].map(function (a) {
          var selected = state.selectedImpl.indexOf(a.id) >= 0;
          var rowStyle = 'display:flex;align-items:center;gap:10px;padding:9px 10px;background:#fff;border:1.5px solid;border-radius:9px;margin-bottom:6px;cursor:pointer;' +
            (selected ? 'border-color:#367C2B;background:linear-gradient(90deg,#EEF6EC,#fff 70%);' : 'border-color:#e3e7e1;');
          var cbStyle = 'width:21px;height:21px;border:2px solid;border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;' +
            (selected ? 'background:#367C2B;border-color:#367C2B;' : 'border-color:#cfd5cd;');
          var check = selected ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 9.5 17 19 7"></path></svg>' : '';
          return '<div class="ge-impl-row ge-toggle-impl" data-id="' + esc(a.id) + '" style="' + rowStyle + '">' +
            '<div style="' + cbStyle + '">' + check + '</div>' +
            '<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:800;">' + esc(a.brand + ' ' + a.model) + '</div>' +
            '<div style="font-size:11px;color:#8a938d;">' + esc(a.desc) + '</div></div>' +
            '<div style="font-size:13px;font-weight:800;color:#1c2420;white-space:nowrap;">' + fmt(a.price) + '</div></div>';
        }).join('');
        return '<div style="font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:#8a938d;margin:14px 0 8px;">' + esc(cat) + '</div>' + itemsHtml;
      }).join('');

      body = '<div style="background:#EEF6EC;border:1px solid #A9D2A0;border-radius:12px;padding:11px 15px;display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:800;color:#23511D;margin-bottom:14px;">' +
        '<span>Implements Selected: ' + selAtt.length + '</span><span>+' + fmt(subtotal) + '</span></div>' +
        groupsHtml +
        '<button type="button" id="ge-continue-form" style="width:100%;background:linear-gradient(140deg,#367C2B,#23511D);color:#fff;border:none;border-radius:12px;padding:14px;font-size:15.5px;font-weight:800;cursor:pointer;margin-top:6px;box-shadow:0 4px 14px rgba(54,124,43,.35);">Continue to Quote &rarr;</button>' +
        '<button type="button" id="ge-skip-implements" style="width:100%;background:none;border:none;color:#8a938d;font-size:13px;font-weight:700;cursor:pointer;padding:10px;margin-top:2px;text-decoration:underline;">Skip — Just the Equipment</button>';
    } else if (state.quoteStep === 'form') {
      var selAtt2 = d.attachments.filter(function (a) { return state.selectedImpl.indexOf(a.id) >= 0; });
      var implTotal = selAtt2.reduce(function (s, a) { return s + a.price; }, 0);
      var basePrice = m ? (m.salePrice > 0 ? m.salePrice : m.msrp) : 0;
      var estTotal = basePrice + implTotal;
      var implSummary = selAtt2.length ? '<div>' + esc(selAtt2.map(function (a) { return a.brand + ' ' + a.model; }).join(', ')) + '</div>' : '';
      var estHtml = estTotal > 0 ? '<div>Estimated Total: <strong style="color:#1d6b2e;">' + fmt(estTotal) + '</strong></div>' : '';

      body = '<form id="ge-quote-form">' +
        '<div style="background:#EEF6EC;border:1px solid #A9D2A0;border-radius:12px;padding:13px 15px;margin-bottom:16px;font-size:13px;line-height:1.7;">' +
        '<div><strong>' + esc(modelLabel) + '</strong></div>' + implSummary + estHtml + '</div>' +
        field('Full Name', 'text', 'qfName', state.qf.name, 'Your name', true) +
        field('Phone Number', 'tel', 'qfPhone', state.qf.phone, '(000) 000-0000', true) +
        field('Email', 'email', 'qfEmail', state.qf.email, 'name@email.com', true) +
        field('Anything else we should know? (optional)', 'text', 'qfMessage', state.qf.message, 'Trade-in, financing questions, timeline...', false) +
        '<button type="submit" ' + (state.submitting ? 'disabled' : '') + ' style="width:100%;background:linear-gradient(140deg,#367C2B,#23511D);color:#fff;border:none;border-radius:12px;padding:14px;font-size:15.5px;font-weight:800;cursor:pointer;margin-top:6px;box-shadow:0 4px 14px rgba(54,124,43,.35);">' +
        (state.submitting ? 'Sending...' : 'Request My Quote') + '</button>' +
        '<div style="font-size:11px;color:#8a938d;margin-top:12px;line-height:1.5;">By submitting, you agree to be contacted by Goldman Equipment about this inquiry. Pricing shown is an estimate — final pricing and financing terms are confirmed at the dealership and subject to credit approval.</div>' +
        '</form>';
    } else if (state.quoteStep === 'success') {
      body = '<div style="text-align:center;padding:20px 4px;">' +
        '<div style="width:64px;height:64px;border-radius:50%;background:#EEF6EC;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;color:#1d6b2e;">' +
        '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 9.5 17 19 7"></path></svg></div>' +
        '<div style="font-size:19px;font-weight:900;margin-bottom:6px;">Thanks — we\'ve got it!</div>' +
        '<div style="font-size:13.5px;color:#8a938d;line-height:1.6;">A member of the Goldman Equipment team will reach out shortly to confirm pricing and answer any questions.</div></div>';
    }

    return '<div id="ge-quote-overlay" style="position:fixed;inset:0;background:rgba(16,22,18,.6);backdrop-filter:blur(3px);z-index:100;display:flex;align-items:center;justify-content:center;padding:20px;">' +
      '<div id="ge-quote-dialog" style="background:#fff;border-radius:22px;width:100%;max-width:480px;max-height:88vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3);animation:ge-rise .3s ease both;">' +
      '<div style="padding:20px 22px 6px;display:flex;justify-content:space-between;align-items:flex-start;">' +
      '<div><div style="font-size:19px;font-weight:900;">Get Your Quote</div><div style="font-size:13px;color:#8a938d;margin-top:3px;">' + esc(modelLabel) + '</div></div>' +
      '<button id="ge-close-quote" style="background:#f2f4f0;border:none;font-size:15px;width:32px;height:32px;border-radius:50%;cursor:pointer;color:#4a544e;flex-shrink:0;">&times;</button>' +
      '</div><div style="padding:16px 22px 26px;">' + body + '</div></div></div>';
  }

  function field(label, type, name, value, placeholder, required) {
    return '<div style="margin-bottom:13px;">' +
      '<label style="font-size:11.5px;font-weight:800;color:#4a544e;margin-bottom:5px;display:block;text-transform:uppercase;letter-spacing:.5px;">' + esc(label) + '</label>' +
      '<input type="' + type + '" name="' + name + '" value="' + esc(value) + '" placeholder="' + esc(placeholder) + '" ' + (required ? 'required' : '') +
      ' style="width:100%;border:1.5px solid #e3e7e1;border-radius:12px;padding:12px 13px;font-size:16px;font-weight:600;outline:none;background:#fbfcfa;"></div>';
  }

  // ---- Full render ----------------------------------------------------

  function render() {
    var d = state.data;
    appEl.innerHTML = renderHeader(d) + renderHero(d) + renderFilterChips(d) + renderCatalog(d) +
      renderTrustBar() + renderFooter() + renderQuoteModal(d);
    wireEvents(d);
  }

  function wireEvents(d) {
    appEl.querySelectorAll('.ge-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.dataset.key;
        state.filter = key;
        track('view_category', { category_key: key });
        render();
      });
    });

    appEl.querySelectorAll('.ge-open-quote').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.id;
        var m = d.models.filter(function (x) { return x.id === id; })[0];
        track('select_item', { item_id: id, item_name: m ? m.label : 'General Inquiry' });
        var showImpl = !!(m && d.attachments.some(function (a) { return a.equipmentCategoryKey === m.cat; }));
        state.quoteOpen = true;
        state.quoteModelId = id;
        state.selectedImpl = [];
        state.quoteStep = showImpl ? 'implements' : 'form';
        state.qf = { name: '', phone: '', email: '', message: '' };
        render();
      });
    });

    var overlay = document.getElementById('ge-quote-overlay');
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) { state.quoteOpen = false; render(); }
      });
      var dialog = document.getElementById('ge-quote-dialog');
      dialog.addEventListener('click', function (e) { e.stopPropagation(); });
    }
    var closeBtn = document.getElementById('ge-close-quote');
    if (closeBtn) closeBtn.addEventListener('click', function () { state.quoteOpen = false; render(); });

    appEl.querySelectorAll('.ge-toggle-impl').forEach(function (row) {
      row.addEventListener('click', function () {
        var id = row.dataset.id;
        var idx = state.selectedImpl.indexOf(id);
        if (idx >= 0) state.selectedImpl.splice(idx, 1); else state.selectedImpl.push(id);
        render();
      });
    });

    var continueBtn = document.getElementById('ge-continue-form');
    if (continueBtn) continueBtn.addEventListener('click', function () { state.quoteStep = 'form'; render(); });
    var skipBtn = document.getElementById('ge-skip-implements');
    if (skipBtn) skipBtn.addEventListener('click', function () { state.selectedImpl = []; state.quoteStep = 'form'; render(); });

    var form = document.getElementById('ge-quote-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        state.qf = {
          name: form.qfName.value, phone: form.qfPhone.value,
          email: form.qfEmail.value, message: form.qfMessage.value
        };
        submitQuote(d);
      });
    }
  }

  function submitQuote(d) {
    state.submitting = true;
    render();

    var m = d.models.filter(function (x) { return x.id === state.quoteModelId; })[0];
    var selAtt = d.attachments.filter(function (a) { return state.selectedImpl.indexOf(a.id) >= 0; });
    var implTotal = selAtt.reduce(function (s, a) { return s + a.price; }, 0);
    var basePrice = m ? (m.salePrice > 0 ? m.salePrice : m.msrp) : 0;
    var estTotal = basePrice + implTotal;

    var payload = {
      EquipmentName: m ? m.label : 'General Inquiry',
      ImplementsSummary: selAtt.map(function (a) { return a.brand + ' ' + a.model; }).join(', '),
      EstimatedTotal: estTotal,
      ContactName: state.qf.name,
      ContactPhone: state.qf.phone,
      ContactEmail: state.qf.email,
      Message: state.qf.message,
      Status: 'New'
    };

    AC.createRecord(TABLES.quoteRequests, payload)
      .catch(function (err) { console.error('[quote submit] failed:', err); })
      .then(function () {
        track('generate_lead', { item_id: state.quoteModelId || 'general' });
        state.submitting = false;
        state.quoteStep = 'success';
        render();
      });
  }

  // ---- Boot -------------------------------------------------------------

  loadData().then(function (data) {
    state.data = data;
    loadingEl.style.display = 'none';
    appEl.style.display = '';
    render();
    loadAnalytics(data);
  }).catch(function (err) {
    console.error('[Goldman Equipment] failed to load catalog data:', err);
    loadingEl.innerHTML = '<div style="text-align:center;color:#8a938d;padding:0 20px;">' +
      'Sorry — we couldn\'t load the current inventory. Please refresh, or call the dealership directly.</div>';
  });
})();
