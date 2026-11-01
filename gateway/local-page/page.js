// TrekLink Field Station local page (gateway-sync task 5.2). Polls the station's own local API on this
// origin; every read is of memory on this laptop, so the page keeps working with the uplink down. Text heard
// from the mesh is written with textContent only, never as HTML.
(function () {
  'use strict';

  // How often the page asks the station for news; a display rate, not a business rule.
  var POLL_MS = 2000;
  // Events kept on screen; the station keeps its own, larger log.
  var LOG_ROWS = 200;

  var lastSeq = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function setText(id, text) {
    $(id).textContent = text;
  }

  function get(path) {
    return fetch(path, { cache: 'no-store', headers: { Accept: 'application/json' } }).then(function (res) {
      return res.json().then(function (body) {
        if (!body || body.isSuccess !== true) throw new Error((body && body.message) || 'HTTP ' + res.status);
        return body.result;
      });
    });
  }

  function ago(iso) {
    if (!iso) return 'never';
    var seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
    if (seconds < 60) return seconds + ' s ago';
    if (seconds < 3600) return Math.floor(seconds / 60) + ' min ago';
    return Math.floor(seconds / 3600) + ' h ' + Math.floor((seconds % 3600) / 60) + ' min ago';
  }

  function clock(iso) {
    return iso ? new Date(iso).toLocaleTimeString() : '';
  }

  function when(iso) {
    return iso ? clock(iso) + ' (' + ago(iso) + ')' : 'never';
  }

  function duration(seconds) {
    if (seconds < 60) return seconds + ' s';
    if (seconds < 3600) return Math.floor(seconds / 60) + ' min ' + (seconds % 60) + ' s';
    return Math.floor(seconds / 3600) + ' h ' + Math.floor((seconds % 3600) / 60) + ' min';
  }

  function badge(text, kind) {
    var span = document.createElement('span');
    span.className = 'badge badge--' + kind;
    span.textContent = text;
    return span;
  }

  function renderQueue(queue) {
    ['P0', 'P1', 'P2', 'P3'].forEach(function (tier) {
      setText('depth-' + tier, String(queue.depth[tier]));
    });
    setText('queue-total', queue.total === 0 ? 'Nothing, all sent' : queue.total + ' events');
    setText(
      'queue-oldest',
      queue.oldest
        ? 'waiting ' + duration(queue.oldest.ageSeconds) + ', tried ' + queue.oldest.retryCount + ' times'
        : 'none',
    );
    setText('queue-flush', when(queue.lastFlushAt));
    var shed = queue.shed.P2 + queue.shed.P3;
    setText('queue-shed', shed === 0 ? 'none' : queue.shed.P2 + ' P2, ' + queue.shed.P3 + ' P3 since start');
  }

  function renderUplink(uplink) {
    var broker = uplink.broker;
    var up = broker.connected;
    var el = $('uplink-badge');
    el.className = 'badge ' + (up ? 'badge--up' : 'badge--down');
    el.textContent = up ? 'Uplink: connected' : 'Uplink: offline, queuing';
    setText('broker-state', up ? 'Connected' : 'Not connected');
    setText('broker-since', broker.since ? when(broker.since) : 'not connected yet');
    setText('broker-url', broker.url);
    setText('broker-error', broker.lastError ? broker.lastError.message + ', ' + ago(broker.lastError.at) : 'none');
    var serial = uplink.serial;
    var mode = serial.simulation ? 'simulation (no node on the port)' : serial.port;
    setText('serial-state', mode + (serial.reading ? ', reading' : ', not reading'));
    setText('serial-last', when(serial.lastFrameAt));
  }

  function renderNodes(nodes) {
    var list = $('nodes');
    var template = $('node-template');
    list.textContent = '';
    $('nodes-empty').hidden = nodes.length > 0;
    setText('nodes-count', nodes.length ? '(' + nodes.length + ')' : '');
    var sos = [];
    nodes.forEach(function (node) {
      var item = template.content.firstElementChild.cloneNode(true);
      item.querySelector('.node__id').textContent = node.nodeId;
      var flags = item.querySelector('.node__flags');
      if (node.sosActive) {
        item.classList.add('node--sos');
        flags.appendChild(badge(node.sosKind === 'FALL_SOS' ? 'FALL SOS' : 'SOS', 'sos'));
        sos.push(node.nodeId + ' at ' + clock(node.lastSosAt));
      }
      if (node.stale) {
        item.classList.add('node--stale');
        flags.appendChild(badge('Stale', 'stale'));
      }
      var p = node.position;
      item.querySelector('.node__position').textContent = p
        ? p.latitude.toFixed(5) + ', ' + p.longitude.toFixed(5) + (p.altitude !== null ? ', ' + p.altitude + ' m' : '')
        : 'no position yet';
      var b = node.battery;
      item.querySelector('.node__battery').textContent = b
        ? (b.level !== null ? b.level + '%' : '') + (b.voltage !== null ? (b.level !== null ? ', ' : '') + b.voltage.toFixed(2) + ' V' : '')
        : 'no reading yet';
      item.querySelector('.node__heard').textContent = when(node.lastHeardAt);
      list.appendChild(item);
    });
    $('sos-banner').hidden = sos.length === 0;
    setText('sos-text', sos.join('; '));
  }

  function renderEvents(page) {
    var list = $('log');
    // The station restarted: its sequence began again. Clear the rows and read its log from the start on
    // the next poll.
    if (page.lastSeq < lastSeq) {
      list.textContent = '';
      lastSeq = 0;
      return;
    }
    var atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 8;
    page.events.forEach(function (event) {
      var row = document.createElement('li');
      var time = document.createElement('span');
      time.className = 'mono';
      time.textContent = clock(event.heardAt);
      var kind = document.createElement('span');
      kind.className = 'log__kind' + (event.kind === 'SOS' || event.kind === 'FALL_SOS' ? ' log__kind--sos' : '');
      kind.textContent = event.nodeId + ' ' + event.kind.replace('_', ' ');
      var summary = document.createElement('span');
      summary.className = 'log__summary';
      summary.textContent = event.summary;
      row.appendChild(time);
      row.appendChild(kind);
      row.appendChild(summary);
      list.appendChild(row);
    });
    while (list.children.length > LOG_ROWS) list.removeChild(list.firstElementChild);
    lastSeq = page.lastSeq;
    $('log-empty').hidden = list.children.length > 0;
    if (atBottom) list.scrollTop = list.scrollHeight;
  }

  function poll() {
    Promise.all([get('/local/queue'), get('/local/uplink'), get('/local/nodes'), get('/local/events?after=' + lastSeq)])
      .then(function (results) {
        renderQueue(results[0]);
        renderUplink(results[1]);
        renderNodes(results[2]);
        renderEvents(results[3]);
        $('page-error').hidden = true;
        setText('refreshed', 'Updated ' + new Date().toLocaleTimeString());
      })
      .catch(function () {
        $('page-error').hidden = false;
      })
      .then(function () {
        setTimeout(poll, POLL_MS);
      });
  }

  poll();
})();
