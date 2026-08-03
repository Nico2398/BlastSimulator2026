/* BlastSimulator2026 — icon set. Chunky filled geometric glyphs, 24px grid, currentColor.
   Usage: <bs-icon name="blast" size="18"></bs-icon>  (no emoji anywhere; all drawn) */
(function () {
  var I = {
    // --- navigation / tools -------------------------------------------------
    blast: '<circle cx="11" cy="15.5" r="7.5"/><path d="M17 8.5c1.4-2 2.8-2.6 4.2-2.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M21 2.6l.85 1.95 1.95.85-1.95.85L21 8.2l-.85-1.95L18.2 5.4l1.95-.85z"/>',
    survey: '<circle cx="12" cy="12" r="9.4" fill="none" stroke="currentColor" stroke-width="2.6"/><circle cx="12" cy="12" r="3.4"/>',
    contract: '<path fill-rule="evenodd" d="M4 2h10l6 6v14H4V2zm3 9h10v2.2H7V11zm0 4.4h10v2.2H7v-2.2zm0-8.8h5v2.2H7V6.6z"/>',
    build: '<path fill-rule="evenodd" d="M2 21h20v2.2H2zM4 9h6.4v10.4H4zm8.6-6H19v16.4h-6.4z"/>',
    vehicle: '<path fill-rule="evenodd" d="M2 5h11v10H2zm12 4h4.2l3.8 4v2h-8zM6.6 20.6a2.7 2.7 0 100-5.4 2.7 2.7 0 000 5.4zm11 0a2.7 2.7 0 100-5.4 2.7 2.7 0 000 5.4z"/>',
    crew: '<path fill-rule="evenodd" d="M12 1.6c-3.1 0-5.3 2.3-5.3 5.2v.9H3.6v2.4h16.8V7.7h-3.1v-.9c0-2.9-2.2-5.2-5.3-5.2zM12 12.4c-4.1 0-7.3 2.5-7.3 5.6v4.4h14.6v-4.4c0-3.1-3.2-5.6-7.3-5.6z"/>',
    ops: '<path fill-rule="evenodd" d="M3 4h18v16H3V4zm2.4 2.4v3.4h13.2V6.4H5.4zm0 5.8v5.4h13.2v-5.4H5.4z"/>',
    finance: '<path fill-rule="evenodd" d="M12 2c4.4 0 8 1.6 8 3.6S16.4 9.2 12 9.2 4 7.6 4 5.6 7.6 2 12 2zM4 8.8c1.7 1.4 4.6 2.2 8 2.2s6.3-.8 8-2.2v3.4c0 2-3.6 3.6-8 3.6s-8-1.6-8-3.6V8.8zm0 6.2c1.7 1.4 4.6 2.2 8 2.2s6.3-.8 8-2.2v3.4c0 2-3.6 3.6-8 3.6s-8-1.6-8-3.6V15z"/>',
    shady: '<path fill-rule="evenodd" d="M9.4 2h5.2a2.2 2.2 0 012.2 2.2V6h-2.4V4.4H9.6V6H7.2V4.2A2.2 2.2 0 019.4 2zM2.8 7h18.4a1 1 0 011 1v12.2a1 1 0 01-1 1H2.8a1 1 0 01-1-1V8a1 1 0 011-1zm7.6 5.4v2.6h3.2v-2.6h-3.2z"/>',
    settings: '<path fill-rule="evenodd" d="M13.6 1h-3.2l-.5 2.7c-.7.2-1.4.5-2 .9L5.6 3.1 3.1 5.6l1.5 2.3c-.4.6-.7 1.3-.9 2L1 10.4v3.2l2.7.5c.2.7.5 1.4.9 2l-1.5 2.3 2.5 2.5 2.3-1.5c.6.4 1.3.7 2 .9l.5 2.7h3.2l.5-2.7c.7-.2 1.4-.5 2-.9l2.3 1.5 2.5-2.5-1.5-2.3c.4-.6.7-1.3.9-2l2.7-.5v-3.2l-2.7-.5c-.2-.7-.5-1.4-.9-2l1.5-2.3-2.5-2.5-2.3 1.5c-.6-.4-1.3-.7-2-.9L13.6 1zM12 8.2a3.8 3.8 0 110 7.6 3.8 3.8 0 010-7.6z"/>',

    // --- status -------------------------------------------------------------
    warn: '<path fill-rule="evenodd" d="M12 2.2L23 21H1L12 2.2zm-1.15 6.3v6.1h2.3V8.5h-2.3zm0 7.7v2.3h2.3v-2.3h-2.3z"/>',
    crit: '<path fill-rule="evenodd" d="M8 2h8l6 6v8l-6 6H8l-6-6V8l6-6zm2.85 4.4v7.2h2.3V6.4h-2.3zm0 9.1v2.4h2.3v-2.4h-2.3z"/>',
    lock: '<path fill-rule="evenodd" d="M12 1a5.5 5.5 0 00-5.5 5.5V9H5v13h14V9h-1.5V6.5A5.5 5.5 0 0012 1zm0 2.4a3.1 3.1 0 013.1 3.1V9H8.9V6.5A3.1 3.1 0 0112 3.4zm0 9.6a2 2 0 011 3.75V19h-2v-2.25A2 2 0 0112 13z"/>',
    check: '<path d="M9.2 18.6L2.6 12l2.3-2.3 4.3 4.3L19.1 4.1l2.3 2.3z"/>',
    x: '<path d="M18.8 3.1L12 9.9 5.2 3.1 3.1 5.2 9.9 12l-6.8 6.8 2.1 2.1L12 14.1l6.8 6.8 2.1-2.1L14.1 12l6.8-6.8z"/>',
    clock: '<path fill-rule="evenodd" d="M12 1a11 11 0 100 22 11 11 0 000-22zm0 2.6a8.4 8.4 0 110 16.8 8.4 8.4 0 010-16.8zM10.9 6h2.2v6.1l4 2.4-1.1 1.9-5.1-3V6z"/>',
    union: '<path fill-rule="evenodd" d="M4 1h2.4v22H4V1zm3.8 1.4h13L18.2 6.8l2.6 4.4h-13V2.4z"/>',
    injured: '<path fill-rule="evenodd" d="M3 3h18v18H3V3zm7.4 3.4v4h-4v3.2h4v4h3.2v-4h4v-3.2h-4v-4h-3.2z"/>',
    collapse: '<path fill-rule="evenodd" d="M6 12.6a3 3 0 100-6 3 3 0 000 6zM10 15h9.4a2.6 2.6 0 012.6 2.6V20H12.6A2.6 2.6 0 0110 17.4V15z"/>',
    training: '<path fill-rule="evenodd" d="M12 2.6L1 8.2l11 5.6 11-5.6-11-5.6zM5 12.4v4.8c0 2.3 3.1 4.2 7 4.2s7-1.9 7-4.2v-4.8l-7 3.6-7-3.6z"/>',
    rest: '<path fill-rule="evenodd" d="M2 6h2.6v5.4H11V8.4h8.4A2.6 2.6 0 0122 11v7h-2.6v-2.6H4.6V18H2V6zm4.6 1.6a2.3 2.3 0 100 4.6 2.3 2.3 0 000-4.6z"/>',
    drive: '<path fill-rule="evenodd" d="M12 1a11 11 0 100 22 11 11 0 000-22zm0 2.6a8.4 8.4 0 018.3 7.1H15a3.2 3.2 0 00-6 0H3.7A8.4 8.4 0 0112 3.6zm-1.6 10.8v5.9a8.4 8.4 0 01-6.6-5.9h6.6zm3.2 0h6.6a8.4 8.4 0 01-6.6 5.9v-5.9z"/>',
    skull: '<path fill-rule="evenodd" d="M12 1C6.5 1 3 4.8 3 9.6c0 3 1.4 5 3.4 6.3V21h11.2v-5.1C19.6 14.6 21 12.6 21 9.6 21 4.8 17.5 1 12 1zM8.6 8a2.4 2.4 0 110 4.8 2.4 2.4 0 010-4.8zm6.8 0a2.4 2.4 0 110 4.8 2.4 2.4 0 010-4.8z"/>',

    // --- resources / world --------------------------------------------------
    rock: '<path d="M7 3.2l9.4-1.4L22.4 9 18 21.6H6.2L1.4 9.6z"/>',
    ore: '<path d="M7 2h10l5 7-10 13L2 9z"/><path d="M7 2h10l5 7H2z" opacity=".42"/>',
    water: '<path d="M12 1.4S3.8 10.3 3.8 15.2A8.2 8.2 0 0020.2 15.2C20.2 10.3 12 1.4 12 1.4z"/>',
    storage: '<path fill-rule="evenodd" d="M2 9l10-6 10 6v13h-4.2v-8H6.2v8H2V9zm6.4 7h7.2v6H8.4v-6z"/>',
    hole: '<path fill-rule="evenodd" d="M12 2c-5.5 0-9.8 2.6-9.8 5.8S6.5 13.6 12 13.6s9.8-2.6 9.8-5.8S17.5 2 12 2zm0 3.2c3.7 0 6.6 1.2 6.6 2.6S15.7 10.4 12 10.4 5.4 9.2 5.4 7.8 8.3 5.2 12 5.2z"/><path d="M2.2 10.4v5.2c0 3.2 4.3 5.8 9.8 5.8s9.8-2.6 9.8-5.8v-5.2c0 3.2-4.3 5.6-9.8 5.6s-9.8-2.4-9.8-5.6z" opacity=".45"/>',
    zone: '<circle cx="12" cy="12" r="9.4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-dasharray="4 3.4"/><circle cx="12" cy="12" r="2.8"/>',
    grid: '<path fill-rule="evenodd" d="M3 3h7.4v7.4H3V3zm10.6 0H21v7.4h-7.4V3zM3 13.6h7.4V21H3v-7.4zm10.6 0H21V21h-7.4v-7.4z"/>',
    layers: '<path d="M12 2l10 5.5-10 5.5L2 7.5z"/><path d="M2 12.4l10 5.5 10-5.5-2.7-1.5-7.3 4-7.3-4z" opacity=".5"/>',
    pick: '<path d="M3 20.9L14.7 9.2l2.4 2.4L5.4 23.3zM12 2c4.1 0 8.1 2 10.5 5.5l-2.2 1.6C18.2 6.3 15.1 4.7 12 4.7S5.8 6.3 3.7 9.1L1.5 7.5C3.9 4 7.9 2 12 2z"/>',
    bolt: '<path d="M13.4 1L3.8 13.4h6L8.4 23l9.8-12.6h-6z"/>',
    flame: '<path d="M12 1c1.2 4.2-2 5.4-2 8.4a3 3 0 003 3c1.7 0 2.6-1 2.9-2.5 1.7 1.7 2.5 3.8 2.5 5.7a8.4 8.4 0 11-16.8 0C1.6 9.4 8 8.2 12 1z"/>',
    fuel: '<path fill-rule="evenodd" d="M3 3h10v18H3V3zm2.4 2.4v5h5.2v-5H5.4zM15 7.6l2.6-2.6 3.4 3.4v9.2a2.6 2.6 0 11-5.2 0V13H15V7.6z"/>',

    // --- weather ------------------------------------------------------------
    sun: '<circle cx="12" cy="12" r="5.6"/><path fill-rule="evenodd" d="M10.9 0h2.2v3.6h-2.2zm0 20.4h2.2V24h-2.2zM24 10.9v2.2h-3.6v-2.2zM3.6 10.9v2.2H0v-2.2zM19.4 3.1l1.5 1.5-2.6 2.6-1.5-1.5zM5.7 16.8l1.5 1.5-2.6 2.6-1.5-1.5zm13.7 4.1l-1.5 1.5-2.6-2.6 1.5-1.5zM4.6 3.1l2.6 2.6-1.5 1.5-2.6-2.6z"/>',
    cloud: '<path d="M6.8 19.6A5.6 5.6 0 016.2 8.5a7 7 0 0113.4 2.1 4.6 4.6 0 01-1.1 9H6.8z"/>',
    rain: '<path d="M6.8 15.4A5.6 5.6 0 016.2 4.3a7 7 0 0113.4 2.1 4.6 4.6 0 01-1.1 9H6.8z"/><path d="M6.8 17.4l-1.6 5h2.4l1.6-5zm5 0l-1.6 5h2.4l1.6-5zm5 0l-1.6 5h2.4l1.6-5z"/>',
    storm: '<path d="M6.8 14.4A5.6 5.6 0 016.2 3.3a7 7 0 0113.4 2.1 4.6 4.6 0 01-1.1 9H6.8z"/><path d="M13.6 15.4h4.2l-6.4 8.2 1.4-5H9z"/>',
    heat: '<circle cx="12" cy="8.6" r="5.8"/><path d="M2 17.4c2-1.7 4-1.7 6 0s4 1.7 6 0 4-1.7 6 0V20c-2-1.7-4-1.7-6 0s-4 1.7-6 0-4-1.7-6 0v-2.6z"/>',
    cold: '<path d="M10.9 1h2.2v22h-2.2z"/><path d="M2.5 5.9l1.1-1.9 18.9 10.9-1.1 1.9z"/><path d="M21.5 5.9l1.1 1.9L3.7 18.7l-1.1-1.9z"/>',

    // --- events -------------------------------------------------------------
    gavel: '<path d="M2.6 18.6l7.8-7.8 2.9 2.9-7.8 7.8zM12.6 2.2l7.1 7.1-2.3 2.3-7.1-7.1zM9.5 8.4l6.2 6.2-2.1 2.1-6.2-6.2zM13.6 21h8.4v2.4h-8.4z"/>',
    podium: '<path fill-rule="evenodd" d="M9 2h6v3.4l4 1.6v2.2H5V7l4-1.6V2zm-1 9.4h8L17.4 22H6.6z"/>',
    fedora: '<path fill-rule="evenodd" d="M9 3h6a2.2 2.2 0 012.2 2.2v6.5c3 .8 4.9 2.1 4.9 3.6 0 2.4-4.5 4.3-10.1 4.3S1.9 17.7 1.9 15.3c0-1.5 1.9-2.8 4.9-3.6V5.2A2.2 2.2 0 019 3z"/>',
    bell: '<path fill-rule="evenodd" d="M12 1a2 2 0 012 2v.7A7 7 0 0119 10.4V15l2 3.2V20H3v-1.8L5 15v-4.6A7 7 0 0110 3.7V3a2 2 0 012-2zm-2.9 20.2h5.8A3 3 0 019.1 21.2z"/>',
    horn: '<path fill-rule="evenodd" d="M3 8.6h4.6L16 3.4v17.2L7.6 15.4H3V8.6zm15.4-1.4A6.8 6.8 0 0121 12a6.8 6.8 0 01-2.6 5.2l-1.6-1.9A4.4 4.4 0 0018.6 12a4.4 4.4 0 00-1.8-3.3l1.6-1.5z"/>',
    star: '<path d="M12 1.4l3.2 6.7 7.3.9-5.4 5 1.5 7.2L12 17.6l-6.6 3.6 1.5-7.2-5.4-5 7.3-.9z"/>',

    // --- controls -----------------------------------------------------------
    plus: '<path d="M10.4 3h3.2v7.4H21v3.2h-7.4V21h-3.2v-7.4H3v-3.2h7.4z"/>',
    minus: '<path d="M3 10.4h18v3.2H3z"/>',
    play: '<path d="M5 2.6l15 9.4-15 9.4z"/>',
    pause: '<path d="M4 3h5.4v18H4zM14.6 3H20v18h-5.4z"/>',
    locate: '<path fill-rule="evenodd" d="M10.9 1h2.2v3.3a8 8 0 016.6 6.6H23v2.2h-3.3a8 8 0 01-6.6 6.6V23h-2.2v-3.3a8 8 0 01-6.6-6.6H1v-2.2h3.3a8 8 0 016.6-6.6V1zM12 6.4a5.6 5.6 0 100 11.2 5.6 5.6 0 000-11.2zm0 3.2a2.4 2.4 0 110 4.8 2.4 2.4 0 010-4.8z"/>',
    chev: '<path d="M6.4 8.6L12 14.2l5.6-5.6 2.2 2.2L12 18.6 4.2 10.8z"/>',
    chevR: '<path d="M8.8 4.2L16.6 12l-7.8 7.8-2.4-2.4L11.8 12 6.4 6.6z"/>',
    up: '<path d="M12 3l8.4 9.4h-5.2V21H8.8v-8.6H3.6z"/>',
    down: '<path d="M12 21l-8.4-9.4h5.2V3h6.4v8.6h5.2z"/>',
    trash: '<path fill-rule="evenodd" d="M9 1h6l1 2h5v2.6H3V3h5zM5 7h14l-1.1 16H6.1L5 7zm3.9 3v10h2.1V10H8.9zm4.1 0v10h2.1V10H13z"/>',
    edit: '<path d="M3 17.2L16.4 3.8l3.8 3.8L6.8 21H3z"/>',
    save: '<path fill-rule="evenodd" d="M3 3h14.2L21 6.8V21H3V3zm4.2 2.2v5.2h8V5.2h-8zM8 14.2h8V21H8z"/>',
    map: '<path fill-rule="evenodd" d="M9 2L2 5v17l7-3 6 3 7-3V2l-7 3z"/>',
    search: '<path fill-rule="evenodd" d="M10.5 2a8.5 8.5 0 105.2 15.2l5 5 2.1-2.1-5-5A8.5 8.5 0 0010.5 2zm0 2.6a5.9 5.9 0 110 11.8 5.9 5.9 0 010-11.8z"/>',
    dots: '<path d="M12 3.4a2.5 2.5 0 110 5 2.5 2.5 0 010-5zm0 6.1a2.5 2.5 0 110 5 2.5 2.5 0 010-5zm0 6.1a2.5 2.5 0 110 5 2.5 2.5 0 010-5z"/>',
    eye: '<path fill-rule="evenodd" d="M12 4C6 4 1.6 8.3 1 12c.6 3.7 5 8 11 8s10.4-4.3 11-8c-.6-3.7-5-8-11-8zm0 3.4a4.6 4.6 0 110 9.2 4.6 4.6 0 010-9.2z"/>',
    wrench: '<path d="M20.8 5.2l-3.9 3.9-2-2 3.9-3.9a6 6 0 00-7.9 7.3L3 18.4 5.6 21l8-7.9a6 6 0 007.2-7.9z"/>',
    person: '<path fill-rule="evenodd" d="M12 2.4a4.6 4.6 0 100 9.2 4.6 4.6 0 000-9.2zM3.8 21.6a8.2 8.2 0 0116.4 0V22H3.8z"/>',
    tag: '<path fill-rule="evenodd" d="M2 2h9.6L22 12.4 12.4 22 2 11.6V2zm4.7 2.7a2.4 2.4 0 100 4.8 2.4 2.4 0 000-4.8z"/>'
  };
  I.explosive = I.blast; I.report = I.contract; I.crane = I.build; I.money = I.finance;

  class BsIcon extends HTMLElement {
    static get observedAttributes() { return ['name', 'size', 'op']; }
    connectedCallback() { this.render(); }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    render() {
      var n = this.getAttribute('name') || '';
      var s = parseFloat(this.getAttribute('size') || '16');
      var op = this.getAttribute('op');
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML =
        '<style>:host{display:inline-flex;align-items:center;justify-content:center;width:' + s + 'px;height:' + s + 'px;flex:0 0 auto;line-height:0' + (op ? ';opacity:' + op : '') + '}svg{display:block;overflow:visible}</style>' +
        '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="currentColor">' + (I[n] || '') + '</svg>';
    }
  }
  if (!customElements.get('bs-icon')) customElements.define('bs-icon', BsIcon);
  window.BS_ICON_NAMES = Object.keys(I);
})();
