/* NEON Studio: all instruments are generated with Web Audio; no files required. */
const sounds = [
  ['Drums','Kick','kick','#31f6e5'],['Drums','Snare','snare','#31f6e5'],['Drums','Hi-Hat','hat','#31f6e5'],['Drums','Clap','clap','#31f6e5'],['Drums','Tom','tom','#31f6e5'],
  ['Piano','Grand Chords','chord','#b6ff43'],['Piano','Melody Loop','piano','#b6ff43'],['Piano','Staccato Keys','keys','#b6ff43'],['Piano','Rhodes Glow','rhodes','#b6ff43'],['Piano','Bass Keys','bass','#b6ff43'],
  ['Saxophone','Jazz Lick','sax','#ffbb4b'],['Saxophone','Blue Riff','sax2','#ffbb4b'],['Saxophone','Warm Sustain','sustain','#ffbb4b'],['Saxophone','Brass Pop','brass','#ffbb4b'],['Saxophone','Night Note','sax3','#ffbb4b'],
  ['Violin','Orchestral Stab','violin','#bd82ff'],['Violin','String Ensemble','strings','#bd82ff'],['Violin','Tremolo','tremolo','#bd82ff'],['Violin','Cinematic Rise','rise','#bd82ff'],['Violin','High Harmony','high','#bd82ff']
].map(([family,name,type,color],i)=>({family,name,type,color,volume:.75,mute:false,solo:false,steps:Array(16).fill(false),index:i}));

[0,4,8,12].forEach(i=>sounds[0].steps[i]=true);
[4,12].forEach(i=>sounds[1].steps[i]=true);
[2,6,10,14].forEach(i=>sounds[2].steps[i]=true);
[3,11].forEach(i=>sounds[5].steps[i]=true);
[7,15].forEach(i=>sounds[10].steps[i]=true);
[0,8].forEach(i=>sounds[16].steps[i]=true);

const $ = s => document.querySelector(s);
const rows = $('#sequencerRows');
const template = $('#channelTemplate');

let ctx, master, analyser, mediaDest;
let playing = false;
let currentStep = 0;
let nextNoteTime = 0;
let schedulerId;
let startAt = 0;
let mediaRecorder, masterRecorder, micStream;
let vocalURL = '';
let vocalSynced = false;
let vocalSource;
let exportChunks = [];

const bpm = () => +$('#tempo').value;
const stepDuration = () => 60 / bpm() / 4;

function buildUI() {
  $('#stepLabels').innerHTML =
    '<span></span>' +
    Array.from({ length: 16 }, (_, i) =>
      `<span>${String(i + 1).padStart(2, '0')}</span>`
    ).join('') +
    '<span></span>';

  sounds.forEach(sound => {
    const node = template.content.cloneNode(true);
    const row = node.querySelector('.channel');

    row.style.setProperty('--channel', sound.color);
    row.dataset.index = sound.index;

    node.querySelector('strong').textContent = sound.name;
    node.querySelector('small').textContent = sound.family;

    const pads = node.querySelector('.pads');

    sound.steps.forEach((on, step) => {
      const pad = document.createElement('button');
      pad.className = 'pad' + (on ? ' on' : '');
      pad.dataset.step = step;
      pad.setAttribute('aria-label', `${sound.name}, step ${step + 1}`);
      pads.append(pad);
    });

    rows.append(node);
  });

  for (let i = 0; i < 10; i++) {
    $('#meter').append(document.createElement('i'));
  }
}

function initAudio() {
  if (ctx) return;

  ctx = new (window.AudioContext || window.webkitAudioContext)();

  master = ctx.createGain();
  master.gain.value = +$('#masterVolume').value;

  analyser = ctx.createAnalyser();
  analyser.fftSize = 32;

  mediaDest = ctx.createMediaStreamDestination();

  master.connect(analyser).connect(ctx.destination);
  master.connect(mediaDest);

  drawMeter();
}

function noiseBuffer(seconds = .25) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < data.length; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  return buffer;
}

function env(gain, time, attack = .01, decay = .2, peak = .35) {
  gain.gain.setValueAtTime(.0001, time);
  gain.gain.exponentialRampToValueAtTime(peak, time + attack);
  gain.gain.exponentialRampToValueAtTime(.0001, time + attack + decay);
}

function osc(type, frequency, time, duration = .25, volume = .35, slide = 0) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, time);

  if (slide) {
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(30, frequency + slide),
      time + duration
    );
  }

  env(gain, time, .008, duration, volume);
  oscillator.connect(gain).connect(master);

  oscillator.start(time);
  oscillator.stop(time + duration + .04);
}

function trigger(sound, time) {
  if (sound.mute || (sounds.some(x => x.solo) && !sound.solo)) return;

  const v = sound.volume;

  if (['snare', 'hat', 'clap'].includes(sound.type)) {
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    source.buffer = noiseBuffer(sound.type === 'hat' ? .06 : .18);
    filter.type = 'highpass';
    filter.frequency.value = sound.type === 'hat' ? 7000 : 1200;

    env(gain, time, .002, sound.type === 'hat' ? .05 : .16, .28 * v);

    source.connect(filter).connect(gain).connect(master);
    source.start(time);
    return;
  }

  if (sound.type === 'kick') {
    osc('sine', 145, time, .33, .65 * v, -105);
    return;
  }

  if (sound.type === 'tom') {
    osc('sine', 180, time, .25, .4 * v, -80);
    return;
  }

  const frequency = {
    chord: 261.6, piano: 392, keys: 523, rhodes: 329, bass: 110,
    sax: 294, sax2: 349, sustain: 220, brass: 440, sax3: 262,
    violin: 440, strings: 293, tremolo: 587, rise: 220, high: 659
  }[sound.type] || 330;

  const wave = sound.family === 'Piano'
    ? 'triangle'
    : sound.family === 'Violin'
      ? 'sawtooth'
      : 'square';

  const duration = sound.type === 'sustain' || sound.type === 'strings'
    ? 1.1
    : sound.type === 'tremolo'
      ? .5
      : .36;

  osc(wave, frequency, time, duration, .18 * v);

  if (sound.type === 'chord') {
    osc('triangle', frequency * 1.25, time, .36, .13 * v);
    osc('triangle', frequency * 1.5, time, .36, .13 * v);
  }

  if (sound.type === 'tremolo') {
    osc('sine', frequency * 1.01, time + .07, .25, .12 * v);
  }

  if (sound.type === 'rise') {
    osc('sawtooth', frequency * .5, time, .6, .12 * v, frequency);
  }
}

function schedule() {
  while (nextNoteTime < ctx.currentTime + .12) {
    sounds.forEach(sound => {
      if (sound.steps[currentStep]) {
        trigger(sound, nextNoteTime);
      }
    });

    highlight(currentStep);
    currentStep = (currentStep + 1) % 16;
    nextNoteTime += stepDuration();
  }

  schedulerId = setTimeout(schedule, 25);
}

function start() {
  initAudio();
  ctx.resume();

  if (playing) return;

  playing = true;
  currentStep = 0;
  nextNoteTime = ctx.currentTime + .05;
  startAt = performance.now();

  schedule();

  if (vocalSynced && vocalURL) {
    const audio = $('#vocalAudio');
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }
}

function stop() {
  playing = false;
  clearTimeout(schedulerId);
  highlight(-1);

  if (vocalSynced) {
    $('#vocalAudio').pause();
    $('#vocalAudio').currentTime = 0;
  }
}

function highlight(step) {
  document.querySelectorAll('.pad').forEach(pad => {
    pad.classList.toggle('playhead', +pad.dataset.step === step);
  });
}

function drawMeter() {
  if (!analyser) return;

  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);

  $('#meter').querySelectorAll('i').forEach((bar, i) => {
    const height = 6 + ((data[i] || 0) / 255) * 31;
    bar.style.height = `${height}px`;
    bar.classList.toggle('active', data[i] > 20);
  });

  requestAnimationFrame(drawMeter);
}

function setStatus(text, recording = false) {
  const status = $('#recordStatus');
  status.classList.toggle('recording', recording);
  status.innerHTML = `<b></b> ${text}`;
}

function updateClock() {
  const seconds = playing ? (performance.now() - startAt) / 1000 : 0;
  const minutes = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1).padStart(4, '0');

  $('#clock').textContent = `${String(minutes).padStart(2, '0')}:${secs}`;
  requestAnimationFrame(updateClock);
}

rows.addEventListener('click', event => {
  const row = event.target.closest('.channel');
  if (!row) return;

  const sound = sounds[row.dataset.index];

  if (event.target.classList.contains('pad')) {
    const step = +event.target.dataset.step;
    sound.steps[step] = !sound.steps[step];
    event.target.classList.toggle('on', sound.steps[step]);
  }

  if (event.target.classList.contains('mute')) {
    sound.mute = !sound.mute;
    event.target.classList.toggle('active', sound.mute);
  }

  if (event.target.classList.contains('solo')) {
    sound.solo = !sound.solo;
    event.target.classList.toggle('active', sound.solo);
  }
});

rows.addEventListener('input', event => {
  if (event.target.matches('.channel-volume')) {
    sounds[event.target.closest('.channel').dataset.index].volume = +event.target.value;
  }
});

$('#playBtn').onclick = start;
$('#stopBtn').onclick = stop;

$('#tempo').oninput = event => {
  $('#bpmValue').textContent = event.target.value;
};

$('#masterVolume').oninput = event => {
  if (master) master.gain.value = +event.target.value;
};

$('#clearPattern').onclick = () => {
  sounds.forEach(sound => sound.steps.fill(false));
  document.querySelectorAll('.pad').forEach(pad => pad.classList.remove('on'));
};

function session() {
  return {
    bpm: bpm(),
    channels: sounds.map(sound => ({
      steps: sound.steps,
      volume: sound.volume,
      mute: sound.mute,
      solo: sound.solo
    }))
  };
}

$('#savePattern').onclick = () => {
  localStorage.setItem('neon-studio-session', JSON.stringify(session()));
  $('#savePattern').textContent = 'Saved ✓';

  setTimeout(() => {
    $('#savePattern').textContent = 'Save Session';
  }, 1200);
};

$('#exportJson').onclick = () => {
  download(
    new Blob([JSON.stringify(session(), null, 2)], { type: 'application/json' }),
    'neon-session.json'
  );
};

$('#importJson').onchange = async event => {
  try {
    const imported = JSON.parse(await event.target.files[0].text());

    $('#tempo').value = imported.bpm || 120;
    $('#tempo').dispatchEvent(new Event('input'));

    imported.channels?.forEach((channel, index) => {
      Object.assign(sounds[index], channel);
    });

    rows.innerHTML = '';
    buildRows();
  } catch {
    alert('That file is not a valid NEON session.');
  }

  event.target.value = '';
};

function buildRows() {
  sounds.forEach(sound => {
    const node = template.content.cloneNode(true);
    const row = node.querySelector('.channel');

    row.style.setProperty('--channel', sound.color);
    row.dataset.index = sound.index;

    node.querySelector('strong').textContent = sound.name;
    node.querySelector('small').textContent = sound.family;
    node.querySelector('.channel-volume').value = sound.volume;
    node.querySelector('.mute').classList.toggle('active', sound.mute);
    node.querySelector('.solo').classList.toggle('active', sound.solo);

    sound.steps.forEach((on, step) => {
      const pad = document.createElement('button');
      pad.className = 'pad' + (on ? ' on' : '');
      pad.dataset.step = step;
      node.querySelector('.pads').append(pad);
    });

    rows.append(node);
  });
}

function download(blob, name) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();

  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

$('#vocalRecordBtn').onclick = async () => {
  if (mediaRecorder?.state === 'recording') {
    mediaRecorder.stop();
    return;
  }

  try {
    initAudio();
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    let count = 3;
    $('#countdown').textContent = count;
    setStatus('ARMED');

    const tick = setInterval(() => {
      $('#countdown').textContent = --count;

      if (count <= 0) {
        clearInterval(tick);
        beginVocal();
      }
    }, 1000);
  } catch (error) {
    $('#vocalHint').textContent = 'Microphone access was not available: ' + error.message;
    setStatus('MIC BLOCKED');
  }
};

function beginVocal() {
  exportChunks = [];
  mediaRecorder = new MediaRecorder(micStream);

  mediaRecorder.ondataavailable = event => {
    if (event.data.size) exportChunks.push(event.data);
  };

  mediaRecorder.onstop = () => {
    vocalURL = URL.createObjectURL(
      new Blob(exportChunks, { type: mediaRecorder.mimeType })
    );

    const audio = $('#vocalAudio');
    audio.src = vocalURL;
    audio.volume = +$('#vocalVolume').value;

    if (!vocalSource) {
      vocalSource = ctx.createMediaElementSource(audio);
      vocalSource.connect(master);
    }

    $('#vocalPlayBtn').disabled = false;
    $('#vocalSyncBtn').disabled = false;
    $('#countdown').textContent = 'OK';

    setStatus('TAKE READY');
    $('#vocalHint').textContent =
      'Vocal captured. Listen or sync it to the transport.';

    micStream.getTracks().forEach(track => track.stop());
  };

  mediaRecorder.start();
  setStatus('RECORDING', true);
  $('#countdown').textContent = 'REC';
}

$('#vocalPlayBtn').onclick = () => $('#vocalAudio').play();

$('#vocalVolume').oninput = event => {
  $('#vocalAudio').volume = +event.target.value;
};

$('#vocalSyncBtn').onclick = event => {
  vocalSynced = !vocalSynced;
  event.currentTarget.classList.toggle('active', vocalSynced);
  event.currentTarget.textContent = vocalSynced
    ? 'Synced to Beat'
    : 'Sync to Beat';
};

$('#masterRecordBtn').onclick = () => {
  initAudio();

  if (masterRecorder?.state === 'recording') {
    masterRecorder.stop();
    return;
  }

  const recorder = new MediaRecorder(mediaDest.stream);
  masterRecorder = recorder;
  exportChunks = [];

  recorder.ondataavailable = event => {
    if (event.data.size) exportChunks.push(event.data);
  };

  recorder.onstop = () => {
    const blob = new Blob(exportChunks, { type: recorder.mimeType });

    $('#downloadBtn').disabled = false;
    $('#downloadBtn').onclick = () => {
      download(blob, 'neon-studio-master.webm');
    };

    $('#exportHint').textContent = 'Master recording is ready to download.';
    $('#masterRecordBtn').classList.remove('active');
  };

  recorder.start();
  $('#masterRecordBtn').classList.add('active');
  $('#exportHint').textContent =
    'Recording master output… press red button to finish.';
};

buildUI();
updateClock();