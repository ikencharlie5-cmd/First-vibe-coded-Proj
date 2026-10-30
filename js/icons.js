// Item icons drawn on a canvas at startup, and small inline SVG icons for the interface.
'use strict';

const Icons = (() => {
  const cache = {};
  const S = 64;
  const METAL = { copper: '#c77a3a', iron: '#a5a5a8', steel: '#dfe6ee', starmetal: '#9a86ff', stone: '#8d8a85', gold: '#e8c547', frost: '#bfe8ff' };
  const WOOD = { pine: ['#a07448', '#d9b17a'], oak: ['#6e4a2a', '#b88a56'], ironwood: ['#3d3434', '#5fb39c'], frostwood: ['#8a8e96', '#e0eef4'] };

  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)))));
    return `rgb(${c.join(',')})`;
  }
  function outline(g, w = 3) { g.lineWidth = w; g.strokeStyle = 'rgba(25,15,5,0.85)'; g.lineJoin = 'round'; g.stroke(); }
  function poly(g, pts, fill) {
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
    g.closePath(); g.fillStyle = fill; g.fill(); outline(g);
  }
  function ellipse(g, x, y, rx, ry, fill, rot = 0) {
    g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); outline(g);
  }

  const draw = {
    log(g, wood) {
      const [bark, inner] = WOOD[wood];
      g.save(); g.translate(32, 34); g.rotate(-0.5);
      g.beginPath(); g.rect(-24, -11, 40, 22); g.fillStyle = bark; g.fill(); outline(g);
      g.strokeStyle = shade(bark, -0.35); g.lineWidth = 2;
      for (const y of [-5, 2]) { g.beginPath(); g.moveTo(-20, y); g.lineTo(10, y + 1); g.stroke(); }
      ellipse(g, 16, 0, 7, 11, inner);
      g.strokeStyle = shade(inner, -0.3); g.lineWidth = 1.5;
      g.beginPath(); g.ellipse(16, 0, 3.5, 6, 0, 0, Math.PI * 2); g.stroke();
      g.restore();
    },
    plank(g, wood) {
      const c = WOOD[wood][1];
      for (const [y, x] of [[40, 8], [30, 12], [20, 6]]) {
        g.beginPath(); g.rect(x, y, 46, 9); g.fillStyle = shade(c, (y - 30) / 120); g.fill(); outline(g, 2.5);
        g.strokeStyle = shade(c, -0.25); g.lineWidth = 1;
        g.beginPath(); g.moveTo(x + 6, y + 4.5); g.lineTo(x + 40, y + 4.5); g.stroke();
      }
    },
    ore(g, rock, nugget) {
      poly(g, [[12, 40], [18, 20], [34, 12], [50, 20], [54, 38], [40, 52], [20, 52]], rock);
      for (const [x, y, r] of [[26, 28, 5], [40, 36, 4], [34, 22, 3]]) {
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = nugget; g.fill();
        g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.arc(x - 1, y - 1, r / 3, 0, Math.PI * 2); g.fill();
      }
    },
    bar(g, metal) {
      poly(g, [[8, 44], [16, 26], [52, 26], [58, 44]], METAL[metal]);
      poly(g, [[16, 26], [22, 18], [48, 18], [52, 26]], shade(METAL[metal], 0.35));
    },
    fish(g, body, belly) {
      g.save(); g.translate(32, 32); g.rotate(-0.3);
      poly(g, [[16, 0], [28, -11], [28, 11]], shade(body, -0.15));
      ellipse(g, -2, 0, 21, 11, body);
      g.beginPath(); g.ellipse(-2, 4, 15, 4, 0, 0, Math.PI); g.fillStyle = belly; g.fill();
      g.beginPath(); g.arc(-14, -3, 2.5, 0, Math.PI * 2); g.fillStyle = '#111'; g.fill();
      g.restore();
    },
    sword(g, metal) {
      g.save(); g.translate(32, 32); g.rotate(Math.PI / 4);
      poly(g, [[-4, -28], [0, -32], [4, -28], [4, 10], [-4, 10]], METAL[metal]);
      g.beginPath(); g.moveTo(0, -26); g.lineTo(0, 8); g.strokeStyle = shade(METAL[metal], 0.4); g.lineWidth = 1.5; g.stroke();
      poly(g, [[-12, 10], [12, 10], [12, 15], [-12, 15]], '#8a6a3a');
      poly(g, [[-3, 15], [3, 15], [3, 26], [-3, 26]], '#5a3a1e');
      ellipse(g, 0, 28, 4, 4, '#c9a14a');
      g.restore();
    },
    shield(g, metal) {
      poly(g, [[14, 12], [50, 12], [50, 34], [32, 54], [14, 34]], METAL[metal]);
      poly(g, [[20, 17], [44, 17], [44, 33], [32, 47], [20, 33]], shade(METAL[metal], -0.18));
      ellipse(g, 32, 29, 5, 5, shade(METAL[metal], 0.4));
    },
    helm(g, metal) {
      g.beginPath(); g.moveTo(12, 46); g.lineTo(12, 30); g.arc(32, 30, 20, Math.PI, 0); g.lineTo(52, 46); g.closePath();
      g.fillStyle = METAL[metal]; g.fill(); outline(g);
      poly(g, [[29, 30], [35, 30], [35, 50], [29, 50]], shade(METAL[metal], -0.25));
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(16, 32, 11, 5); g.fillRect(37, 32, 11, 5);
    },
    platebody(g, metal) {
      poly(g, [[14, 14], [24, 10], [32, 16], [40, 10], [50, 14], [54, 30], [46, 32], [46, 54], [18, 54], [18, 32], [10, 30]], METAL[metal]);
      g.beginPath(); g.moveTo(32, 18); g.lineTo(32, 52); g.strokeStyle = shade(METAL[metal], -0.3); g.lineWidth = 2; g.stroke();
      g.beginPath(); g.moveTo(20, 38); g.lineTo(44, 38); g.stroke();
    },
    axe(g, metal) {
      g.save(); g.translate(32, 32); g.rotate(0.6);
      poly(g, [[-3, -26], [3, -26], [3, 28], [-3, 28]], '#7a5232');
      g.beginPath(); g.moveTo(2, -24); g.quadraticCurveTo(24, -24, 22, -6); g.lineTo(2, -10); g.closePath();
      g.fillStyle = METAL[metal]; g.fill(); outline(g);
      g.restore();
    },
    pickaxe(g, metal) {
      g.save(); g.translate(32, 34); g.rotate(0.5);
      poly(g, [[-3, -22], [3, -22], [3, 28], [-3, 28]], '#7a5232');
      g.beginPath(); g.moveTo(-26, -12); g.quadraticCurveTo(0, -32, 26, -12); g.quadraticCurveTo(0, -22, -26, -12);
      g.fillStyle = METAL[metal]; g.fill(); outline(g);
      g.restore();
    },
    rod(g) {
      g.beginPath(); g.moveTo(10, 56); g.lineTo(52, 8); g.strokeStyle = '#3a2210'; g.lineWidth = 6; g.stroke();
      g.strokeStyle = '#a07a44'; g.lineWidth = 3.5; g.stroke();
      g.beginPath(); g.moveTo(52, 8); g.quadraticCurveTo(58, 30, 46, 46); g.strokeStyle = '#eee'; g.lineWidth = 1; g.stroke();
      g.beginPath(); g.arc(44, 46, 3, 0, Math.PI); g.strokeStyle = '#ccc'; g.lineWidth = 2; g.stroke();
    },
    stick(g) {
      g.beginPath(); g.moveTo(12, 52); g.lineTo(52, 12); g.moveTo(32, 32); g.lineTo(42, 40);
      g.strokeStyle = '#3a2210'; g.lineWidth = 8; g.lineCap = 'round'; g.stroke();
      g.strokeStyle = '#9a7040'; g.lineWidth = 4.5; g.stroke();
    },
    stone(g) { poly(g, [[14, 40], [20, 22], [38, 16], [52, 28], [48, 46], [26, 50]], '#9a958d'); },
    club(g) {
      g.save(); g.translate(32, 32); g.rotate(0.7);
      poly(g, [[-3, 28], [3, 28], [8, -20], [0, -28], [-8, -20]], '#8a6034');
      g.restore();
    },
    bag(g, color) {
      poly(g, [[14, 24], [50, 24], [54, 52], [10, 52]], color);
      poly(g, [[16, 24], [48, 24], [44, 36], [20, 36]], shade(color, -0.2));
      g.beginPath(); g.arc(32, 18, 9, Math.PI, 0); g.strokeStyle = '#3a2210'; g.lineWidth = 4; g.stroke();
      ellipse(g, 32, 34, 3, 3, '#d9b14a');
    },
    pelt(g, color = '#8f8f96') { poly(g, [[12, 20], [22, 12], [30, 18], [40, 10], [52, 18], [50, 34], [56, 46], [40, 50], [32, 56], [22, 48], [10, 44], [16, 32]], color); },
    gem(g, color) {
      poly(g, [[32, 10], [50, 26], [32, 54], [14, 26]], color);
      poly(g, [[32, 10], [40, 26], [32, 54], [24, 26]], shade(color, 0.35));
    },
    ring(g, metal, stoneColor) {
      g.beginPath(); g.arc(32, 36, 15, 0, Math.PI * 2); g.lineWidth = 8; g.strokeStyle = '#2a1a0a'; g.stroke();
      g.lineWidth = 5; g.strokeStyle = metal; g.stroke();
      ellipse(g, 32, 20, 6, 6, stoneColor);
    },
    tusk(g) {
      g.beginPath(); g.moveTo(14, 54); g.quadraticCurveTo(14, 16, 50, 10); g.quadraticCurveTo(28, 26, 26, 56); g.closePath();
      g.fillStyle = '#f2ead0'; g.fill(); outline(g);
    },
    star(g, color) {
      const glow = g.createRadialGradient(32, 32, 2, 32, 32, 30);
      glow.addColorStop(0, 'rgba(200,180,255,0.9)'); glow.addColorStop(1, 'rgba(200,180,255,0)');
      g.fillStyle = glow; g.fillRect(0, 0, 64, 64);
      const pts = [];
      for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2 - Math.PI / 2, r = k % 2 ? 9 : 22; pts.push([32 + Math.cos(a) * r, 32 + Math.sin(a) * r]); }
      poly(g, pts, color);
    },
    scale(g, color = '#a8d8f0') {
      g.beginPath(); g.moveTo(32, 8); g.quadraticCurveTo(58, 20, 32, 56); g.quadraticCurveTo(6, 20, 32, 8);
      g.fillStyle = color; g.fill(); outline(g);
      g.beginPath(); g.moveTo(32, 14); g.lineTo(32, 48); g.strokeStyle = '#e8f8ff'; g.lineWidth = 2; g.stroke();
    },
    coin(g, face, mark) {
      for (const [x, y] of [[24, 40], [40, 36], [30, 26]]) {
        ellipse(g, x, y, 13, 13, face);
        g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.strokeStyle = mark; g.lineWidth = 2; g.stroke();
      }
    },
    boat(g) {
      poly(g, [[8, 40], [56, 40], [48, 54], [16, 54]], '#7a5232');
      g.beginPath(); g.moveTo(32, 8); g.lineTo(32, 40); g.strokeStyle = '#3a2210'; g.lineWidth = 3; g.stroke();
      poly(g, [[34, 10], [52, 36], [34, 36]], '#eee6d0');
      poly(g, [[30, 14], [14, 36], [30, 36]], '#d8cdb0');
    },
    sun(g) {
      g.fillStyle = '#ffd84a';
      for (let k = 0; k < 12; k++) { g.save(); g.translate(32, 32); g.rotate(k / 12 * Math.PI * 2); g.fillRect(-2, -28, 4, 10); g.restore(); }
      ellipse(g, 32, 32, 15, 15, '#e8a83a');
      ellipse(g, 32, 32, 8, 8, '#fff2b0');
    },
    ember(g) {
      const gl = g.createRadialGradient(32, 32, 2, 32, 32, 30);
      gl.addColorStop(0, 'rgba(255,160,60,0.9)'); gl.addColorStop(1, 'rgba(255,120,30,0)');
      g.fillStyle = gl; g.fillRect(0, 0, 64, 64);
      poly(g, [[32, 10], [48, 26], [44, 48], [32, 56], [20, 48], [16, 26]], '#ff7a2a');
      poly(g, [[32, 18], [40, 28], [32, 46], [24, 28]], '#ffd27a');
    },
    crown(g) {
      poly(g, [[10, 48], [10, 20], [20, 32], [32, 14], [44, 32], [54, 20], [54, 48]], '#e8c547');
      for (const [x, c] of [[20, '#c0392b'], [32, '#5a8ad8'], [44, '#5ad86a']]) ellipse(g, x, 40, 4, 4, c);
    },
    stinger(g) {
      g.beginPath(); g.moveTo(14, 54); g.quadraticCurveTo(10, 20, 44, 12); g.lineTo(52, 8); g.lineTo(46, 20); g.quadraticCurveTo(22, 26, 24, 56); g.closePath();
      g.fillStyle = '#9a6a2a'; g.fill(); outline(g);
      poly(g, [[44, 12], [56, 4], [48, 20]], '#2a1a0a');
    },
  };

  function render(id) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    const it = ITEMS[id] || {};
    const tier = id.split('_')[0];
    if (id.endsWith('_log')) draw.log(g, tier);
    else if (id.endsWith('_plank')) draw.plank(g, tier);
    else if (id === 'copper_ore') draw.ore(g, '#7a6a5a', '#ff8c3a');
    else if (id === 'iron_ore') draw.ore(g, '#6e6862', '#e8d6c2');
    else if (id === 'coal') draw.ore(g, '#2e2c2a', '#55524e');
    else if (id === 'gold_ore') draw.ore(g, '#8a7f68', '#ffd23a');
    else if (id.endsWith('_bar')) draw.bar(g, tier);
    else if (id === 'raw_minnow') draw.fish(g, '#9ab8c8', '#dfe8ec');
    else if (id === 'raw_trout') draw.fish(g, '#8aa070', '#e8b0a0');
    else if (id === 'raw_pike') draw.fish(g, '#6a8a5a', '#d8e0c0');
    else if (id === 'burnt_fish') draw.fish(g, '#2a2420', '#3a302a');
    else if (it.heal) draw.fish(g, '#c88a42', '#f0c070');
    else if (id.endsWith('_sword')) draw.sword(g, tier);
    else if (id.endsWith('_shield')) draw.shield(g, tier);
    else if (id.endsWith('_helm')) draw.helm(g, tier);
    else if (id.endsWith('_platebody')) draw.platebody(g, tier);
    else if (id.endsWith('_pickaxe')) draw.pickaxe(g, tier);
    else if (id.endsWith('_axe')) draw.axe(g, tier);
    else if (id === 'fishing_rod') draw.rod(g);
    else if (id === 'stick') draw.stick(g);
    else if (id === 'stone') draw.stone(g);
    else if (id === 'wooden_club') draw.club(g);
    else if (id === 'satchel') draw.bag(g, '#b08a5a');
    else if (id === 'leather_pack') draw.bag(g, '#7a4a2a');
    else if (id === 'explorer_pack') draw.bag(g, '#e8eef2');
    else if (id === 'lurker_hide') draw.pelt(g, '#5a6a42');
    else if (id === 'bear_pelt') draw.pelt(g, '#eef2f4');
    else if (id === 'troll_hide') draw.pelt(g, '#7a8a7a');
    else if (id === 'scorpion_stinger') draw.stinger(g);
    else if (id === 'doubloon') draw.coin(g, '#e8c547', '#9a7a1a');
    else if (id === 'ancient_coin') draw.coin(g, '#8aa08a', '#4a5a4a');
    else if (id === 'crypt_crown') draw.crown(g);
    else if (id === 'sailboat') draw.boat(g);
    else if (id === 'sun_sigil') draw.sun(g);
    else if (id === 'ember_core') draw.ember(g);
    else if (id === 'star_shard') draw.star(g, '#c8e8ff');
    else if (id === 'frostbane') draw.sword(g, 'frost');
    else if (id === 'wurm_scale') draw.scale(g, '#d8f0ff');
    else if (id === 'gold_ring') draw.ring(g, '#e8c547', '#5a8ad8');
    else if (id === 'wolf_pelt') draw.pelt(g);
    else if (id === 'rough_gem') draw.gem(g, '#b45ad8');
    else if (id === 'goblin_trinket') draw.ring(g, '#a5a5a8', '#5ad86a');
    else if (id === 'bandit_signet') draw.ring(g, '#e8c547', '#c0392b');
    else if (id === 'ogre_tusk') draw.tusk(g);
    else if (id === 'star_fragment') draw.star(g, '#d6ccff');
    else if (id === 'drake_scale') draw.scale(g);
    else draw.stone(g);
    return cv.toDataURL();
  }

  function item(id) { return cache[id] || (cache[id] = render(id)); }

  // ------------------------------------------------------------ interface icons (24x24 SVG)
  const P = {
    coin: '<circle cx="12" cy="12" r="8" fill="#e8c547" stroke="#7a5a10" stroke-width="2"/><path d="M12 7v10M9.5 9.5h4a2 2 0 010 4h-3a2 2 0 000 4h4" stroke="#7a5a10" stroke-width="1.6" fill="none"/>',
    bag: '<path d="M6 9h12l2 11H4z" fill="#b08a5a" stroke="#3a2210" stroke-width="1.8"/><path d="M9 9a3 3 0 016 0" stroke="#3a2210" stroke-width="1.8" fill="none"/>',
    sword: '<path d="M18 3l3 0 0 3-10 10-3-3z" fill="#d8dde4" stroke="#2a2a30" stroke-width="1.5"/><path d="M6 13l5 5M4 20l4-4" stroke="#7a5232" stroke-width="2.4" stroke-linecap="round"/>',
    skull: '<path d="M12 3a7 7 0 00-7 7c0 3 2 4 2 6h10c0-2 2-3 2-6a7 7 0 00-7-7z" fill="#e8e0cc" stroke="#3a2a1a" stroke-width="1.6"/><circle cx="9.5" cy="10" r="1.6" fill="#3a2a1a"/><circle cx="14.5" cy="10" r="1.6" fill="#3a2a1a"/><path d="M9 19h6" stroke="#3a2a1a" stroke-width="2"/>',
    people: '<circle cx="8" cy="8" r="3" fill="#d9b48a"/><circle cx="16" cy="8" r="3" fill="#d9b48a"/><path d="M3 20c0-4 2-6 5-6s5 2 5 6zM11 20c0-4 2-6 5-6s5 2 5 6z" fill="#6a8acf"/>',
    sun: '<circle cx="12" cy="12" r="5" fill="#ffd34a"/><g stroke="#ffd34a" stroke-width="2" stroke-linecap="round"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/></g>',
    moon: '<path d="M15 3a9 9 0 100 18A7 7 0 0115 3z" fill="#dfe6ff"/>',
    cloud: '<path d="M7 18h10a4 4 0 000-8 6 6 0 00-11 1 3.5 3.5 0 001 7z" fill="#dfe4ea"/>',
    rain: '<path d="M7 14h10a4 4 0 000-8 6 6 0 00-11 1 3.5 3.5 0 001 7z" fill="#b8c4d0"/><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3" stroke="#6ab0ff" stroke-width="2" stroke-linecap="round"/>',
    hammer: '<path d="M4 20l9-9" stroke="#8a5a32" stroke-width="3" stroke-linecap="round"/><path d="M11 5l5-2 5 5-2 5z" fill="#9aa0a8" stroke="#2a2a30" stroke-width="1.5"/>',
    anvil: '<path d="M3 8h13c2 0 4 1 5 3h-6l-1 3h-4l-1-3H5z" fill="#6a6a72" stroke="#1a1a20" stroke-width="1.4"/><path d="M8 14h7l2 6H6z" fill="#4a4a52" stroke="#1a1a20" stroke-width="1.4"/>',
    star: '<path d="M12 2l3 7 7 .5-5.5 4.5 2 7L12 17l-6.5 4 2-7L2 9.5 9 9z" fill="#ffd34a" stroke="#7a5a10" stroke-width="1.3"/>',
    castle: '<path d="M3 21V8h3v3h3V8h2v3h2V8h2v3h3V8h3v13z" fill="#b8b0a0" stroke="#3a3530" stroke-width="1.4"/><path d="M10 21v-5h4v5" fill="#4a3220"/>',
    map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" fill="#e8d8a8" stroke="#5a4020" stroke-width="1.5"/><path d="M9 4v14M15 6v14" stroke="#5a4020" stroke-width="1.2"/><path d="M5 12c2-2 4 0 6-1s3-2 6-1" stroke="#c0392b" stroke-width="1.4" fill="none" stroke-dasharray="2 2"/>',
    book: '<path d="M4 4h7a2 2 0 012 2v14a2 2 0 00-2-2H4z" fill="#8a3a2a" stroke="#2a1a10" stroke-width="1.4"/><path d="M20 4h-7a2 2 0 00-2 2v14a2 2 0 012-2h7z" fill="#a04a32" stroke="#2a1a10" stroke-width="1.4"/>',
    gear: '<circle cx="12" cy="12" r="3.2" fill="none" stroke="#d8d0b8" stroke-width="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" stroke="#d8d0b8" stroke-width="2.6" stroke-linecap="round"/>',
    house: '<path d="M3 11l9-7 9 7" fill="#9a3a2a" stroke="#3a1a10" stroke-width="1.6"/><path d="M5 10v10h14V10" fill="#e0d0a8" stroke="#3a1a10" stroke-width="1.6"/><path d="M10 20v-5h4v5" fill="#5a3a20"/>',
    wheel: '<circle cx="12" cy="12" r="8" fill="none" stroke="#7a5232" stroke-width="2.4"/><circle cx="12" cy="12" r="2" fill="#7a5232"/><path d="M12 4v16M4 12h16M6.3 6.3l11.4 11.4M17.7 6.3L6.3 17.7" stroke="#7a5232" stroke-width="1.3"/>',
    scroll: '<path d="M6 4h11a2 2 0 012 2v12a2 2 0 01-2 2H7a2 2 0 01-2-2V6" fill="#e8d8a8" stroke="#5a4020" stroke-width="1.5"/><path d="M8 9h8M8 12h8M8 15h5" stroke="#5a4020" stroke-width="1.2"/>',
  };
  const SKILL_ICON = {
    attack: ['sword', '#e05a4a'], strength: ['fist', '#e0a03a'], defence: ['shieldi', '#5a8ae0'], hitpoints: ['heart', '#e04a6a'],
    woodcutting: ['tree', '#5ab04a'], mining: ['pick', '#a0a0a8'], fishing: ['fishi', '#4ab0e0'], construction: ['hammer', '#c09060'],
    crafting: ['needle', '#c0a070'], carpentry: ['plank', '#d0a060'], smelting: ['fire', '#ff8a3a'], smithing: ['anvil', '#9a9aa2'], cooking: ['pot', '#e0c04a'],
  };
  const SKILL_P = {
    fist: c => `<rect x="6" y="8" width="12" height="11" rx="3" fill="${c}" stroke="#2a1a10" stroke-width="1.5"/><path d="M9 8v4M12 8v4M15 8v4" stroke="#2a1a10" stroke-width="1.2"/>`,
    shieldi: c => `<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z" fill="${c}" stroke="#1a1a30" stroke-width="1.5"/>`,
    heart: c => `<path d="M12 20s-8-5-8-11a4 4 0 018-1 4 4 0 018 1c0 6-8 11-8 11z" fill="${c}" stroke="#3a1020" stroke-width="1.4"/>`,
    tree: c => `<path d="M12 2l7 11H5z" fill="${c}" stroke="#1a3010" stroke-width="1.4"/><path d="M11 13h2v8h-2z" fill="#6a4a2a"/>`,
    pick: c => `<path d="M5 20l9-9" stroke="#8a5a32" stroke-width="2.6" stroke-linecap="round"/><path d="M4 8c5-5 11-5 16 0-5-2-11-2-16 0z" fill="${c}" stroke="#2a2a30" stroke-width="1.3"/>`,
    fishi: c => `<path d="M3 12c4-6 11-6 15 0-4 6-11 6-15 0z" fill="${c}" stroke="#103040" stroke-width="1.4"/><path d="M18 12l4-4v8z" fill="${c}" stroke="#103040" stroke-width="1.2"/>`,
    needle: c => `<path d="M5 19L19 5" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/><path d="M5 19c3-6 8-2 12-8" stroke="#c0392b" stroke-width="1.4" fill="none"/>`,
    plank: c => `<rect x="3" y="7" width="18" height="4" fill="${c}" stroke="#3a2210" stroke-width="1.3"/><rect x="5" y="13" width="16" height="4" fill="${c}" stroke="#3a2210" stroke-width="1.3"/>`,
    fire: c => `<path d="M12 2c2 4 6 6 6 11a6 6 0 01-12 0c0-3 2-4 3-7 1 2 2 3 3 3 0-3-1-5 0-7z" fill="${c}" stroke="#6a2a0a" stroke-width="1.3"/>`,
    pot: c => `<path d="M4 10h16l-2 9H6z" fill="#5a5a62" stroke="#1a1a20" stroke-width="1.4"/><path d="M8 7c0-2 2-2 2-4M13 7c0-2 2-2 2-4" stroke="${c}" stroke-width="1.6" fill="none"/>`,
  };
  function ui(name) {
    let body = P[name];
    if (name.startsWith('skill-')) {
      const [shape, color] = SKILL_ICON[name.slice(6)] || ['star', '#fff'];
      body = SKILL_P[shape] ? SKILL_P[shape](color) : P[shape];
    }
    return `<svg class="uico" viewBox="0 0 24 24" aria-hidden="true">${body || P.scroll}</svg>`;
  }

  return { item, ui };
})();
