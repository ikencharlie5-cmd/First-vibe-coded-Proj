// Ironhold's sound: music, effects and ambience, all synthesised live with the Web Audio API.
// No audio files. Reads `settings` for volumes; the game calls Sound.update() with the scene.
'use strict';

const Sound = (() => {
  let ctx = null, master, musicBus, sfxBus, ambBus, reverb, noise;
  let scene = { mood: 'wilds', town: null, water: 0, fire: 0, night: false, rain: false, wind: 0.2, forest: false };
  const amb = {};
  let nextBarTime = 0, bar = 0, mood = 'wilds', melodyNote = 0;
  let lastSfx = {};

  // ------------------------------------------------------------ setup
  function init() { /* the AudioContext is created on the first click or key press */ }

  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      build();
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function build() {
    master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);
    musicBus = gainNode(0, master);
    sfxBus = gainNode(0, master);
    ambBus = gainNode(0, master);
    // A soft hall reverb, built from decaying noise.
    reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.6, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    reverb.buffer = ir;
    reverb.connect(gainNode(0.32, master));
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    applyVolumes();
    buildAmbience();
    nextBarTime = ctx.currentTime + 0.3;
    setInterval(schedule, 120);
    setInterval(ambientTick, 250);
  }

  function applyVolumes() {
    if (!ctx) return;
    const m = settings.muted ? 0 : 1, t = ctx.currentTime;
    musicBus.gain.setTargetAtTime(settings.music * 0.55 * m, t, 0.2);
    sfxBus.gain.setTargetAtTime(settings.sfx * 0.8 * m, t, 0.05);
    ambBus.gain.setTargetAtTime(settings.ambient * 0.7 * m, t, 0.2);
  }

  function gainNode(v, dest) { const g = ctx.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; }
  function osc(type, freq, t) { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); return o; }
  function filt(type, freq, q = 1) { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; }
  function noiseSrc(t, loop) {
    const s = ctx.createBufferSource();
    s.buffer = noise; s.loop = !!loop;
    s.playbackRate.value = 0.9 + Math.random() * 0.2;
    return s;
  }
  // Envelope helper: quick attack, exponential fall.
  function env(g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  // ------------------------------------------------------------ instruments
  function lute(midi, t, vol = 0.12, dest = musicBus) {
    const f = mtof(midi);
    const g = gainNode(0, dest), lp = filt('lowpass', 3200, 2);
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.5);
    lp.connect(g);
    for (const [type, mul, det] of [['sawtooth', 1, -4], ['triangle', 1, 5], ['sine', 2, 0]]) {
      const o = osc(type, f * mul, t);
      o.detune.value = det;
      const og = gainNode(type === 'sine' ? 0.3 : 0.5, lp);
      o.connect(og);
      o.start(t); o.stop(t + 1.8);
    }
    env(g, t, vol, 0.004, 1.5);
    g.connect(reverb);
  }

  function flute(midi, t, dur, vol = 0.07) {
    const f = mtof(midi);
    const g = gainNode(0, musicBus);
    g.connect(reverb);
    const o = osc('sine', f, t), o2 = osc('triangle', f * 2, t);
    const vib = osc('sine', 5.2, t), vibG = gainNode(0, null);
    vibG.gain.setValueAtTime(0, t);
    vibG.gain.linearRampToValueAtTime(f * 0.006, t + 0.25);
    vib.connect(vibG); vibG.connect(o.frequency); vibG.connect(o2.frequency);
    o.connect(g); o2.connect(gainNode(0.12, g));
    const breath = noiseSrc(t), bf = filt('bandpass', f * 1.5, 3);
    breath.connect(bf).connect(gainNode(0.15, g));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.08);
    g.gain.setValueAtTime(vol, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.2);
    for (const n of [o, o2, vib, breath]) { n.start(t); n.stop(t + dur + 0.3); }
  }

  function drone(root, t, dur, vol = 0.045) {
    const g = gainNode(0, musicBus), lp = filt('lowpass', 700);
    lp.connect(g); g.connect(reverb);
    for (const m of [root - 12, root - 5]) {
      const o = osc('triangle', mtof(m), t);
      o.connect(lp);
      o.start(t); o.stop(t + dur + 1.2);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.8);
    g.gain.setValueAtTime(vol, t + dur - 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1);
  }

  function drum(t, vol = 0.35, pitch = 1) {
    const g = gainNode(0, musicBus), o = osc('sine', 120 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(48 * pitch, t + 0.18);
    o.connect(g);
    env(g, t, vol, 0.004, 0.32);
    o.start(t); o.stop(t + 0.4);
    const n = noiseSrc(t), ng = gainNode(0, musicBus), lp = filt('lowpass', 900);
    n.connect(lp).connect(ng);
    env(ng, t, vol * 0.25, 0.002, 0.08);
    n.start(t); n.stop(t + 0.15);
  }

  // ------------------------------------------------------------ music
  // Each mood has a scale (MIDI notes), chord roots as scale steps, a tempo and a texture.
  const MOODS = {
    wilds:  { scale: [62, 64, 65, 67, 69, 71, 72], chords: [0, 6, 3, 0, 4, 6, 3, 0], bpm: 74, flute: 0.55, arp: 'gentle' },
    town:   { scale: [67, 69, 71, 72, 74, 76, 78], chords: [0, 3, 4, 0, 5, 3, 4, 0], bpm: 96, flute: 0.65, arp: 'busy' },
    night:  { scale: [64, 66, 67, 69, 71, 72, 74], chords: [0, 5, 3, 4, 0, 5, 6, 0], bpm: 58, flute: 0.35, arp: 'sparse' },
    combat: { scale: [57, 59, 60, 62, 64, 65, 67], chords: [0, 6, 5, 4, 0, 6, 5, 4], bpm: 124, flute: 0.4, arp: 'drive', drums: true },
  };
  const triad = (m, step) => [0, 2, 4].map(k => {
    const i = step + k;
    return m.scale[i % 7] + 12 * Math.floor(i / 7);
  });

  function schedule() {
    if (!ctx || settings.muted || settings.music <= 0) { if (ctx) nextBarTime = Math.max(nextBarTime, ctx.currentTime + 0.1); return; }
    while (nextBarTime < ctx.currentTime + 0.4) {
      if (scene.mood !== mood && (bar % 2 === 0 || scene.mood === 'combat')) { mood = scene.mood; bar = 0; }
      playBar(MOODS[mood], nextBarTime);
      nextBarTime += 4 * 60 / MOODS[mood].bpm;
      bar++;
    }
  }

  function playBar(m, t) {
    const beat = 60 / m.bpm, step = m.chords[bar % m.chords.length], chord = triad(m, step);
    const root = m.scale[step % 7];
    if (bar % 2 === 0) drone(root - 12, t, beat * 8);
    // Lute: picked arpeggios over the chord.
    const patterns = {
      gentle: [[0, 0], [1, 1], [2, 2], [3, 1], [4, 3], [6, 2]],
      busy: [[0, 0], [0.5, 1], [1, 2], [1.5, 1], [2, 0], [2.5, 2], [3, 3], [3.5, 2]],
      sparse: [[0, 0], [1.5, 2], [3, 1]],
      drive: [[0, 0], [0.5, 0], [1, 2], [1.5, 1], [2, 0], [2.5, 0], [3, 3], [3.5, 2]],
    }[m.arp];
    const notes = [chord[0] - 12, chord[0], chord[1], chord[2]];
    for (const [b, n] of patterns) {
      if (b >= 4) continue;
      lute(notes[n], t + b * beat + (Math.random() - 0.5) * 0.012, m.arp === 'sparse' ? 0.08 : 0.1);
    }
    if (m.drums) for (const [b, v] of [[0, 0.4], [1.5, 0.22], [2, 0.32], [3, 0.22], [3.5, 0.18]]) drum(t + b * beat, v, b === 0 ? 1 : 1.3);
    // Flute: a wandering melody that leans on chord tones.
    if (Math.random() < m.flute) {
      let b = Math.random() < 0.5 ? 0 : 1;
      if (!melodyNote) melodyNote = chord[1] + 12;
      while (b < 4) {
        const len = [0.5, 1, 1, 1.5, 2][Math.floor(Math.random() * 5)] * (m.arp === 'sparse' ? 1.5 : 1);
        const pool = m.scale.map(n => n + 12).concat(m.scale.map(n => n + 24));
        const near = pool.filter(n => Math.abs(n - melodyNote) <= 4 && n !== melodyNote);
        const chordish = near.filter(n => chord.some(c => (n - c) % 12 === 0));
        const choices = chordish.length && Math.random() < 0.6 ? chordish : near;
        melodyNote = choices[Math.floor(Math.random() * choices.length)] || melodyNote;
        melodyNote = Math.max(m.scale[0] + 10, Math.min(m.scale[0] + 31, melodyNote));
        if (Math.random() > 0.18) flute(melodyNote, t + b * beat, Math.min(len, 4 - b) * beat * 0.95, mood === 'combat' ? 0.05 : 0.065);
        b += len;
      }
    }
  }

  // ------------------------------------------------------------ effects
  function blip(type, f0, f1, t, dur, vol, dest = sfxBus, filter) {
    const g = gainNode(0, dest), o = osc(type, f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    if (filter) { o.connect(filter); filter.connect(g); } else o.connect(g);
    env(g, t, vol, 0.004, dur);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function burst(t, dur, vol, type, freq, q = 1, sweepTo, dest = sfxBus) {
    const n = noiseSrc(t), f = filt(type, freq, q), g = gainNode(0, dest);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    n.connect(f).connect(g);
    env(g, t, vol, 0.003, dur);
    n.start(t); n.stop(t + dur + 0.05);
  }
  function chime(notes, t, gap, vol = 0.12) {
    notes.forEach((m, k) => {
      blip('triangle', mtof(m), null, t + k * gap, 0.9, vol);
      blip('sine', mtof(m + 12), null, t + k * gap, 0.6, vol * 0.4);
    });
  }

  const SFX = {
    chop: t => { burst(t, 0.09, 0.5, 'bandpass', 700, 1.2); blip('sine', 150, 60, t, 0.12, 0.5); },
    treefall: t => { burst(t, 0.9, 0.35, 'lowpass', 900, 0.7, 120); blip('sine', 90, 40, t + 0.5, 0.4, 0.5); },
    mine: t => { blip('triangle', 1900, 1700, t, 0.3, 0.25); blip('triangle', 2870, null, t, 0.22, 0.12); burst(t, 0.05, 0.35, 'highpass', 2500); },
    splash: t => burst(t, 0.45, 0.35, 'lowpass', 2400, 0.8, 300),
    pick: t => burst(t, 0.14, 0.25, 'highpass', 1800),
    build: t => { blip('sine', 240, 150, t, 0.1, 0.45); burst(t, 0.06, 0.3, 'bandpass', 650, 2); },
    built: t => { SFX.build(t); chime([67, 71, 74], t + 0.15, 0.09, 0.1); },
    place: t => { blip('sine', 110, 55, t, 0.25, 0.55); burst(t, 0.15, 0.25, 'lowpass', 600); },
    anvil: t => { blip('square', 1250, null, t, 0.25, 0.08, sfxBus, filt('bandpass', 1800, 4)); blip('triangle', 2600, null, t, 0.4, 0.12); },
    furnace: t => { burst(t, 0.5, 0.25, 'lowpass', 500, 0.7, 1400); burst(t + 0.3, 0.3, 0.12, 'highpass', 3000); },
    saw: t => { for (let k = 0; k < 4; k++) burst(t + k * 0.11, 0.09, 0.18, 'bandpass', 1500 + (k % 2) * 400, 3); },
    sizzle: t => burst(t, 0.7, 0.12, 'highpass', 3500),
    craft: t => { blip('sine', 300, 200, t, 0.08, 0.35); blip('sine', 340, 220, t + 0.12, 0.08, 0.3); },
    hit: t => { burst(t, 0.1, 0.5, 'lowpass', 1000); blip('sine', 110, 50, t, 0.14, 0.6); },
    miss: t => burst(t, 0.2, 0.25, 'bandpass', 3000, 1.5, 700),
    hurt: t => { blip('sawtooth', 220, 110, t, 0.18, 0.15, sfxBus, filt('lowpass', 900)); burst(t, 0.08, 0.35, 'lowpass', 800); },
    block: t => { blip('triangle', 900, 700, t, 0.15, 0.12); },
    defeat: t => { blip('sine', 160, 50, t, 0.4, 0.5); chime([69, 76], t + 0.2, 0.1, 0.08); },
    death: t => chime([62, 58, 55, 50], t, 0.25, 0.15),
    growl: t => { blip('sawtooth', 85, 70, t, 0.5, 0.12, sfxBus, filt('lowpass', 400)); burst(t, 0.4, 0.15, 'lowpass', 300); },
    coins: t => { for (const [k, f] of [[0, 2400], [1, 3100], [2, 2700]]) blip('triangle', f, null, t + k * 0.06, 0.25, 0.1); },
    levelup: t => chime([67, 71, 74, 79], t, 0.11, 0.16),
    discover: t => chime([69, 76, 81], t, 0.18, 0.12),
    chest: t => { blip('sine', 180, 120, t, 0.2, 0.4); SFX.coins(t + 0.15); },
    shrine: t => chime([72, 76, 79, 84], t, 0.15, 0.1),
    eat: t => { for (let k = 0; k < 3; k++) burst(t + k * 0.1, 0.06, 0.3, 'bandpass', 2200, 2); },
    alarm: t => { for (let k = 0; k < 3; k++) { blip('sine', 880, null, t + k * 0.45, 1.2, 0.15); blip('sine', 2112, null, t + k * 0.45, 0.6, 0.06); } },
    open: t => burst(t, 0.12, 0.12, 'bandpass', 2600, 1.5, 1200),
    click: t => blip('sine', 1300, 900, t, 0.04, 0.08),
    step: t => burst(t, 0.05, 0.08 + Math.random() * 0.05, 'lowpass', 700 + Math.random() * 300),
    stepstone: t => burst(t, 0.04, 0.09 + Math.random() * 0.04, 'bandpass', 1500 + Math.random() * 400, 2),
  };

  function sfx(name) {
    if (!ctx || !SFX[name] || settings.muted) return;
    const now = ctx.currentTime;
    if (lastSfx[name] && now - lastSfx[name] < 0.04) return;
    lastSfx[name] = now;
    SFX[name](now + 0.01);
  }

  // ------------------------------------------------------------ ambience
  function loopLayer(type, freq, q) {
    const n = noiseSrc(0, true), f = filt(type, freq, q), g = gainNode(0, ambBus);
    n.connect(f).connect(g);
    n.start();
    return { g, f };
  }
  function buildAmbience() {
    amb.wind = loopLayer('bandpass', 420, 0.6);
    amb.water = loopLayer('lowpass', 520, 0.7);
    amb.rain = loopLayer('bandpass', 2600, 0.4);
    amb.crowd = loopLayer('bandpass', 520, 2.2);
  }
  function setLayer(layer, v) { layer.g.gain.setTargetAtTime(v, ctx.currentTime, 0.8); }

  function ambientTick() {
    if (!ctx) return;
    const t = ctx.currentTime, s = scene;
    setLayer(amb.wind, 0.05 + s.wind * 0.22 + (s.rain ? 0.06 : 0) + Math.random() * 0.03);
    amb.wind.f.frequency.setTargetAtTime(300 + Math.random() * 300 + s.wind * 200, t, 1.5);
    setLayer(amb.water, s.water * 0.35);
    setLayer(amb.rain, s.rain ? 0.22 : 0);
    setLayer(amb.crowd, s.town ? 0.05 + Math.random() * 0.06 : 0);
    // One-off sounds sprinkled in.
    const r = Math.random();
    if (!s.night && !s.rain && !s.town && r < (s.forest ? 0.22 : 0.12)) bird(t + Math.random() * 0.2);
    if (s.night && !s.rain && r < 0.35) cricket(t);
    if (s.fire > 0 && Math.random() < 0.6) for (let k = 0; k < 3; k++) burst(t + Math.random() * 0.25, 0.015, s.fire * 0.25, 'highpass', 2500, 1, null, ambBus);
    if (s.town === 'stonedeep' && Math.random() < 0.3) { blip('triangle', 2000, null, t, 0.3, 0.05, ambBus); }
    if (s.town === 'saltmere' && Math.random() < 0.06) gull(t);
    if (s.town === 'thornwood' && Math.random() < 0.12) { burst(t, 0.08, 0.12, 'bandpass', 600, 1, null, ambBus); blip('sine', 130, 60, t, 0.1, 0.12, ambBus); }
    if (s.town === 'ratsnest' && Math.random() < 0.1) { for (let k = 0; k < 3; k++) blip('sawtooth', 180 + Math.random() * 120, 150, t + k * 0.09, 0.08, 0.02, ambBus, filt('bandpass', 900, 3)); }
    if (s.water > 0.2 && Math.random() < 0.05) burst(t, 0.25, s.water * 0.12, 'lowpass', 1600, 0.8, 300, ambBus);
  }
  function bird(t) {
    const base = 2600 + Math.random() * 1600, n = 2 + Math.floor(Math.random() * 4);
    for (let k = 0; k < n; k++) {
      const st = t + k * (0.08 + Math.random() * 0.06);
      blip('sine', base * (0.9 + Math.random() * 0.25), base * (1.1 + Math.random() * 0.3), st, 0.07, 0.035, ambBus);
    }
  }
  function cricket(t) {
    for (let k = 0; k < 4; k++) blip('sine', 4400 + Math.random() * 300, null, t + k * 0.045, 0.025, 0.012, ambBus);
  }
  function gull(t) {
    for (let k = 0; k < 2; k++) blip('sawtooth', 900, 1400, t + k * 0.22, 0.18, 0.025, ambBus, filt('bandpass', 1300, 2));
  }

  function update(sc) { scene = sc; }

  return { init, unlock, sfx, update, applyVolumes };
})();
