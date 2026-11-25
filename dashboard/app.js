// Token Radar's dashboard. It reads window.RADAR — written beside dashboard/ by main.ts — and
// renders the ranked board, the filter controls, a per-protocol detail view and the measured
// sector book. No network: every byte it shows is already in data.js, and no query leaves the page.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  var app = document.getElementById('main');
  var M = DATA.model;
  var state = { q: '', category: 'all', chain: 'all', tab: 'board', watchOnly: false, sort: 'implied', dir: -1, selected: null };

  // ---------- formatting ----------
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var sign = n < 0 ? '-' : '';
    var v = Math.abs(n);
    if (v >= 1e12) return sign + '$' + (v / 1e12).toFixed(2) + 'T';
    if (v >= 1e9) return sign + '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return sign + '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return sign + '$' + Math.round(v / 1e3) + 'K';
    return sign + '$' + Math.round(v);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 730) return (days / 365).toFixed(1) + 'y';
    if (days >= 365) return '1y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return (n >= 10 ? n.toFixed(1) : n.toFixed(2)) + 'x'; }

  // The model, restated in the page: the same arithmetic main.ts ran, so a reader can check any row.
  function impliedOf(row) {
    var growth = Math.min(M.growth_cap, Math.max(M.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * M.growth_weight;
    var age = row.age_days === null ? M.unknown_age_days : row.age_days;
    var maturity = M.maturity_floor + (Math.min(Math.max(age, 0), M.maturity_days) / M.maturity_days) * M.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * row.sector_multiple * growthMult * maturity * M.premium));
  }

  // ---------- tiny DOM helper ----------
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string' || typeof child === 'number') node.appendChild(document.createTextNode(String(child)));
      else node.appendChild(child);
    }
    return node;
  }

  // ---------- hash state, so a screenshot can capture a filter ----------
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var p = new URLSearchParams(hash);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('c')) state.category = p.get('c');
    if (p.get('ch')) state.chain = p.get('ch');
    if (p.get('p')) state.selected = p.get('p');
    if (p.get('tab') === 'live') state.tab = 'live';
    if (p.get('w') === '1') state.watchOnly = true;
    if (p.get('sort')) state.sort = p.get('sort');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('c', state.category);
    if (state.chain !== 'all') p.set('ch', state.chain);
    if (state.watchOnly) p.set('w', '1');
    if (state.tab === 'live') p.set('tab', 'live');
    if (state.sort !== 'implied') p.set('sort', state.sort);
    if (state.selected) p.set('p', state.selected);
    var next = p.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // ---------- filtering and sorting ----------
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchOnly && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.sector_multiple; bv = b.sector_multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.rank - b.rank;
    });
  }
  function chains() {
    var seen = {}, out = [];
    DATA.rows.forEach(function (r) {
      (r.chains || []).forEach(function (c) {
        if (!seen[c]) { seen[c] = 0; out.push(c); }
        seen[c] += 1;
      });
    });
    return out.sort(function (a, b) { return seen[b] - seen[a] || (a < b ? -1 : 1); }).filter(function (c) { return seen[c] >= 3; }).slice(0, 24);
  }
  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { var c = r.category || 'Other'; seen[c] = (seen[c] || 0) + 1; });
    return Object.keys(seen).sort(function (a, b) { return seen[b] - seen[a] || (a < b ? -1 : 1); });
  }

  // ---------- header and hero ----------
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark', 'aria-hidden': 'true' }),
        el('div', null,
          el('span', { class: 'brand-name', text: 'Token Radar' }),
          el('span', { class: 'brand-sub', text: 'pre-token launch intelligence' })
        )
      ),
      el('div', { class: 'top-meta' },
        el('span', { class: 'chip', text: 'snapshot ' }, el('span', { class: 'chip', text: DATA.as_of })),
        el('span', { class: 'chip' }, 'model ', el('b', { text: DATA.model_version })),
        el('span', { class: 'chip amber', text: DATA.board_size + ' launches ranked' })
      )
    );
  }

  function hero() {
    var top = DATA.rows[0];
    return el('section', { class: 'hero' },
      el('div', null,
        el('p', { class: 'eyebrow', text: 'every protocol that records no token, ranked by what one would be worth' }),
        el('h1', null, 'Which protocol launches next, ', el('em', null, 'and what is it worth?')),
        el('p', { class: 'lede' },
          'The radar reads one sealed snapshot of ', el('b', null, DATA.protocols_total + ' protocols'),
          ', keeps the ', el('b', null, String(DATA.board_size)),
          ' that record no token and are not a venue or a wrapped product, and prices each one from its own TVL, ',
          'its seven-day growth and the time it has run with no token. Every row carries the steps to farm it. ',
          'The implied value is the radar\u2019s claim, not a promise.'
        )
      ),
      el('div', { class: 'stamp' },
        'leader ', el('b', { text: top ? top.name : 'n/a' }), el('br'),
        'implied ', el('b', { text: top ? fmtUsd(top.implied_value_usd) : 'n/a' }), el('br'),
        'snapshot ', el('b', { text: DATA.as_of })
      )
    );
  }

  function kpis() {
    var watchCovered = DATA.rows.filter(function (r) { return r.watchlist; }).length;
    var measured = DATA.sectors.filter(function (s) { return s.measured; });
    var medianOfMeasured = 0;
    if (measured.length) {
      var vals = measured.map(function (s) { return s.multiple; }).sort(function (a, b) { return a - b; });
      medianOfMeasured = vals[vals.length >> 1];
    }
    return el('section', { class: 'kpis', 'aria-label': 'Snapshot at a glance' },
      el('div', { class: 'kpi' }, el('span', { text: 'Watchlist covered' }), el('b', { text: watchCovered + ' / ' + DATA.watchlist_size }), el('small', { text: 'the house floor, all of it' })),
      el('div', { class: 'kpi hot' }, el('span', { text: 'Launch subjects' }), el('b', { text: String(DATA.board_size) }), el('small', { text: 'pre-token, no venue or product' })),
      el('div', { class: 'kpi' }, el('span', { text: 'Below the floor' }), el('b', { text: String(DATA.early_size) }), el('small', { text: 'the early radar' })),
      el('div', { class: 'kpi cool' }, el('span', { text: 'Live peers measured' }), el('b', { text: String(DATA.live_size) }), el('small', { text: 'market cap / TVL by sector' })),
      el('div', { class: 'kpi' }, el('span', { text: 'Measured sectors' }), el('b', { text: String(measured.length) }), el('small', { text: 'median ' + fmtMult(medianOfMeasured) + ' across them' }))
    );
  }

  // ---------- controls ----------
  function controls() {
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Name, slug, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });

    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories (' + DATA.rows.length + ')' }),
      categories().map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });

    var chain = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains().map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chain.addEventListener('change', function () { state.chain = chain.value; writeHash(); render(); });

    var watch = el('input', { type: 'checkbox', id: 'watch', checked: state.watchOnly ? 'checked' : null });
    watch.addEventListener('change', function () { state.watchOnly = watch.checked; writeHash(); render(); });

    var boardTab = el('button', { type: 'button', 'aria-pressed': state.tab === 'board' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'board'; writeHash(); render(); } });
    var liveTab = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live peers (' + DATA.live_size + ')', onclick: function () { state.tab = 'live'; writeHash(); render(); } });

    var reset = el('button', { class: 'reset', type: 'button', text: 'Reset', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; writeHash(); render(); } });

    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), el('span', { class: 'search-wrap' }, search)),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chain),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Rows' }), el('div', { class: 'tabs' }, boardTab, liveTab)),
      el('label', { class: 'toggle' }, watch, 'Watchlist only'),
      reset,
      el('span', { class: 'spacer' }),
      el('span', { class: 'count', text: state.tab === 'board' ? filtered().length + ' of ' + DATA.rows.length + ' rows' : String(DATA.live.length) + ' live peers' })
    );
  }

  function sortHeader(key, label, numeric) {
    var active = state.sort === key;
    return el('th', { scope: 'col', class: numeric ? 'num' : null },
      el('button', { type: 'button', 'data-active': active ? 'true' : 'false', onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
        writeHash(); render();
      } }, label + (active ? (state.dir < 0 ? ' \u2193' : ' \u2191') : ''))
    );
  }

  function boardTable() {
    var list = sorted(filtered());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or choose another category to see the board again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; writeHash(); render(); } })
      ));
    }
    var top = list.slice().sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd; })[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var row = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num rank', text: '#' + r.rank }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', null,
            (r.category || 'Other') + ' \u00b7 ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'chain unnamed') + ' \u00b7 ',
            el('span', { class: r.watchlist ? 'pill watch' : 'pill early', text: r.watchlist ? 'watchlist' : 'early' })
          )
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num multi', text: fmtMult(r.sector_multiple) }),
        el('td', { class: 'value-cell' }, el('div', { class: 'value' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / top) * 100)) + '%' })),
          el('b', { text: fmtUsd(r.implied_value_usd) })
        ))
      );
      tbody.appendChild(row);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols, strongest implied value first. Click a row for its value model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank', true),
            sortHeader('name', 'Protocol', false),
            sortHeader('tvl', 'TVL', true),
            sortHeader('growth', '7d TVL', true),
            sortHeader('age', 'No token for', true),
            sortHeader('multiple', 'Sector', true),
            sortHeader('implied', 'Implied value', true)
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.slice(0, 60).forEach(function (r) {
      tbody.appendChild(el('tr', { tabindex: '0' },
        el('td', { class: 'num rank', text: 'live' }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { text: (r.category || 'Other') + ' \u00b7 ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'chain unnamed') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtMult(r.ratio) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', null, el('span', { class: 'pill', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'The peer set the model measures: live-token protocols and their market cap over TVL. Their category median prices the pre-token board.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', class: 'num', text: 'Status' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', class: 'num', text: 'TVL' }),
            el('th', { scope: 'col', class: 'num', text: 'Market cap' }),
            el('th', { scope: 'col', class: 'num', text: 'MC / TVL' }),
            el('th', { scope: 'col', class: 'num', text: '7d' }),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  // ---------- method panels ----------
  function methodPanels() {
    var sectors = DATA.sectors.slice().sort(function (a, b) { return b.multiple - a.multiple || (a.category < b.category ? -1 : 1); });
    return el('section', { class: 'method' },
      el('div', { class: 'card' },
        el('h2', { text: 'How the implied value is built' }),
        el('p', { text: 'One function scores every row. Its sector multiple is measured from the snapshot\u2019s own live protocols, so no protocol name is special-cased and nothing is hand-picked.' }),
        el('div', { class: 'formula' },
          'implied = round( ', el('span', { class: 'k', text: 'tvl' }), ' \u00d7 ',
          el('span', { class: 'm', text: 'sectorMultiple' }), ' \u00d7 growth \u00d7 maturity \u00d7 ',
          el('span', { class: 'k', text: String(M.premium) }), ' )'
        ),
        el('ul', { class: 'legend' },
          el('li', null, el('b', { text: 'Sector multiple' }), el('span', null, 'the median market-cap-to-TVL ratio of the live protocols in the same category, clamped to ' + M.multiple_floor + 'x\u2013' + M.multiple_cap + 'x. Categories with fewer than ' + M.peer_min + ' live peers use the whole market\u2019s median.')),
          el('li', null, el('b', { text: 'Growth' }), el('span', null, '1 + change_7d, clamped to ' + M.growth_floor + '%\u2026+' + M.growth_cap + '% and weighted ' + M.growth_weight + ', so momentum moves a row without letting one week dominate it.')),
          el('li', null, el('b', { text: 'Maturity' }), el('span', null, M.maturity_floor + ' plus up to ' + M.maturity_range + ' for the first ' + (M.maturity_days / 365) + ' years with no token: a protocol that has survived longer is more likely to still be here at launch.')),
          el('li', null, el('b', { text: 'Premium' }), el('span', null, String(M.premium) + 'x, the one stated assumption: a token lists with a small float, so its fully diluted value runs above the multiple its category\u2019s liquid peers trade at.'))
        )
      ),
      el('div', { class: 'card' },
        el('h2', { text: 'The sector book, measured on ' + DATA.as_of }),
        el('p', { text: 'Median market cap over TVL for each category with live protocols. The same book prices the board; rows from a thin category fall back to the market median.' }),
        el('div', { class: 'sectors' },
          sectors.map(function (s) {
            return el('div', { class: 'sector' },
              el('span', { text: s.category }),
              el('span', null, el('b', { text: fmtMult(s.multiple) }), ' ', el('small', { text: s.peers + (s.peers === 1 ? ' peer' : ' peers') + (s.measured ? '' : '*') }))
            );
          })
        ),
        el('p', { class: 'note', text: '* below ' + M.peer_min + ' live peers: the whole market\u2019s median is used instead. A protocol that records no token may still have one DefiLlama does not carry; every row says what the record shows, never what the protocol promises.' })
      )
    );
  }

  // ---------- detail ----------
  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var grown = impliedOf(row);
    var agrees = grown === row.implied_value_usd;
    var sector = DATA.sectors.filter(function (s) { return s.category === (row.category || 'Other'); })[0];

    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('p', { class: 'eyebrow', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' \u00b7 ' + (row.watchlist ? 'on the house watchlist' : 'below the floor, found early') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' \u00b7 ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'chain unnamed') + ' \u00b7 ' + row.slug })
      ),
      el('button', { class: 'close', type: 'button', text: 'Close', 'aria-label': 'Close details', onclick: function () { dialog.close(); } })
    ));

    dialog.appendChild(el('div', { class: 'detail-body' },
      el('section', { class: 'detail-section' },
        el('h3', { text: 'Implied launch value' }),
        el('div', { class: 'headline', text: fmtUsd(row.implied_value_usd) }),
        el('p', { class: 'headline-note', text: 'Fully diluted, if the record stays as it is today. Not a price, and not a promise of a token.' }),
        el('div', { class: 'equation' },
          el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
          el('div', null, el('span', { text: 'Sector multiple' }), el('b', { text: fmtMult(row.sector_multiple) })),
          el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { text: fmtMult(row.growth_multiplier) })),
          el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { text: fmtMult(row.maturity_multiplier) })),
          el('div', null, el('span', { text: 'Launch premium' }), el('b', { text: fmtMult(M.premium) })),
          el('div', null, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) }))
        ),
        el('div', { class: 'facts' },
          el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
          el('div', null, el('span', { text: '7d TVL' }), el('b', { class: row.change_7d !== null && row.change_7d < 0 ? 'neg' : 'pos', text: fmtPct(row.change_7d) })),
          el('div', null, el('span', { text: 'No token for' }), el('b', { text: fmtAge(row.age_days) }))
        ),
        el('p', { class: 'note' },
          'This page re-runs the model on the snapshot figures and gets ' + fmtUsd(grown) + ', ' +
          (agrees ? 'the same number board.json carries.' : 'which differs from board.json: the data would be stale.') +
          ' Sector multiple from ' + (sector ? sector.peers : row.peer_count) + ' live ' +
          ((sector ? sector.peers : row.peer_count) === 1 ? 'peer' : 'peers') + ' in ' + (row.category || 'Other') +
          (sector && !sector.measured ? '; too thin to measure, so the whole market\u2019s median prices it.' : '.')
        )
      ),
      el('section', { class: 'detail-section' },
        el('h3', { text: 'How to farm it' }),
        el('ol', { class: 'steps' }, row.farm_steps.map(function (step) {
          var at = step.indexOf(' Cost: ');
          var action = at >= 0 ? step.slice(0, at) : step;
          var tail = at >= 0 ? step.slice(at + 7) : '';
          var timeAt = tail.lastIndexOf(' Time: ');
          var cost = timeAt >= 0 ? tail.slice(0, timeAt) : tail;
          var time = timeAt >= 0 ? tail.slice(timeAt + 7) : '';
          if (time.slice(-1) === '.') time = time.slice(0, -1);
          return el('li', null, action, el('span', { class: 'cost', text: cost + ' \u00b7 ' + time }));
        })),
        el('p', { class: 'note', text: 'Capital and hold time follow this protocol\u2019s TVL tier and age; the action follows its category and chain. Nothing here is financial advice: a farm position can lose its capital.' })
      )
    ));

    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  // ---------- render ----------
  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    shell.appendChild(kpis());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'board' ? boardTable() : liveTable());
    if (state.tab === 'board') shell.appendChild(methodPanels());
    shell.appendChild(el('footer', { class: 'foot' },
      el('span', null, 'Token Radar \u00b7 model ', el('code', { text: DATA.model_version }), ' \u00b7 snapshot ', el('code', { text: DATA.as_of }), ' \u00b7 ', el('code', { text: String(DATA.board_size) }), ' launch subjects, ', el('code', { text: String(DATA.live_size) }), ' live peers'),
      el('span', { text: 'Static page, no network, no tracking. Implied values are the radar\u2019s own claim.' })
    ));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('hashchange', function () {
    var before = state.selected;
    readHash();
    if (state.selected && state.selected !== before) openDetail(state.selected);
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
