/*
 * Shared Airtable REST client used by both the customer site and the
 * staff quick-quote tool. Reads config (base ID + token + table names)
 * from window.AIRTABLE_CONFIG, set in config.js — edit that file with
 * your own values, never this one.
 *
 * SECURITY NOTE: this token is embedded in a public static page. Anyone
 * who views source can read it. Scope it to ONLY this one Airtable base,
 * with ONLY the record read/write permissions each app actually needs —
 * never use an account-wide token here. See ../SETUP.md.
 */
(function (global) {
  'use strict';

  function cfg() {
    var c = global.AIRTABLE_CONFIG;
    if (!c || !c.baseId || !c.token) {
      throw new Error('AIRTABLE_CONFIG is missing baseId/token — check config.js');
    }
    return c;
  }

  function apiUrl(table, query) {
    var base = cfg().apiBase || 'https://api.airtable.com/v0';
    return base + '/' + cfg().baseId + '/' + encodeURIComponent(table) + (query || '');
  }

  function authHeaders(extra) {
    return Object.assign({ Authorization: 'Bearer ' + cfg().token }, extra || {});
  }

  // Fetches every record in a table, following Airtable's pagination
  // (100 records per page) until offset stops being returned.
  async function fetchAllRecords(table) {
    var records = [];
    var offset = null;
    do {
      var url = apiUrl(table, '?pageSize=100' + (offset ? '&offset=' + offset : ''));
      var res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) {
        var body = await res.text();
        throw new Error('Airtable fetch failed for "' + table + '": ' + res.status + ' ' + body);
      }
      var json = await res.json();
      records = records.concat(json.records);
      offset = json.offset || null;
    } while (offset);
    return records.map(function (r) { return Object.assign({ _id: r.id }, r.fields); });
  }

  async function createRecord(table, fields) {
    var res = await fetch(apiUrl(table), {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ fields: fields })
    });
    if (!res.ok) {
      var body = await res.text();
      throw new Error('Airtable create failed for "' + table + '": ' + res.status + ' ' + body);
    }
    return res.json();
  }

  // Permissive boolean parsing — Airtable checkbox fields come back as
  // real booleans, but CSV-imported columns can land as "TRUE"/"checked"/1
  // depending on how the column type was set during import.
  function truthy(v) {
    if (v === true) return true;
    if (v == null) return false;
    var s = String(v).trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'checked' || s === 'yes';
  }

  function num(v) {
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  global.AirtableClient = {
    fetchAllRecords: fetchAllRecords,
    createRecord: createRecord,
    truthy: truthy,
    num: num
  };
})(window);
