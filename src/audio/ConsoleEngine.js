/**
 * ConsoleEngine.js
 * Stage 2: 1950s RCA 76-D / UA 610 4-Channel Rotary Tube Mixing Console,
 * Passive Summing Bus with Inter-Channel Crosstalk, Pultec EQP-1A3 Master EQ,
 * and Fairchild 660 Variable-Mu Master Tube Compressor.
 */

export class ConsoleEngine {
  constructor(audioContext) {
    this.ctx = audioContext;

    this.channelNames = [
      'CH 1: BASS',
      'CH 2: GUITAR',
      'CH 3: DRUMS',
      'CH 4: VOCAL'
    ];

    this.channels = [];
    this.summingBus = this.ctx.createGain();
    this.auxSendBus = this.ctx.createGain();
    this.outputNode = this.ctx.createGain();

    // Telemetry state for UI meters & signal flow canvas
    this.telemetry = {
      channelPeaks: [0, 0, 0, 0],
      channelHarmonics: [0, 0, 0, 0],
      variMuGrDb: 0,
      variMuPeakIn: 0,
      variMuPeakOut: 0
    };

    this._initConsoleGraph();
  }

  _initConsoleGraph() {
    // Default initial settings per channel strip (clean, warm tube headroom out of the box)
    const defaults = [
      { micModel: 1, driveDb: 3.0, faderDb: 0.0, panPos: 0.0, auxSend: 0.08, distFt: 2.5 },  // Ch 1: Bass (RCA 44-BX, Center)
      { micModel: 2, driveDb: 4.0, faderDb: -1.5, panPos: -0.55, auxSend: 0.28, distFt: 2.3 }, // Ch 2: Guitar (Shure 55SH, Left-ish)
      { micModel: 0, driveDb: 2.0, faderDb: -1.0, panPos: 0.55, auxSend: 0.12, distFt: 4.2 },  // Ch 3: Drums (U47, Right-ish)
      { micModel: 0, driveDb: 4.0, faderDb: 1.5, panPos: 0.0, auxSend: 0.52, distFt: 1.9 }   // Ch 4: Vocal (U47, Center + Slapback send)
    ];

    for (let i = 0; i < 4; i++) {
      const cfg = defaults[i];
      const inputNode = this.ctx.createGain();

      // Instantiate Mic & Tube Preamp AudioWorkletNode
      const micWorklet = new AudioWorkletNode(this.ctx, 'mic-preamp-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2]
      });

      micWorklet.parameters.get('micModel').value = cfg.micModel;
      micWorklet.parameters.get('distanceFeet').value = cfg.distFt;
      micWorklet.parameters.get('driveDb').value = cfg.driveDb;
      micWorklet.parameters.get('transformerSat').value = 0.5;
      micWorklet.parameters.get('padEnabled').value = 0;
      micWorklet.parameters.get('phaseInvert').value = 0;

      micWorklet.port.onmessage = (e) => {
        if (e.data) {
          this.telemetry.channelPeaks[i] = e.data.peak || 0;
          this.telemetry.channelHarmonics[i] = e.data.harmonic || 0;
        }
      };

      // Daven Rotary Fader Attenuator
      const faderNode = this.ctx.createGain();
      faderNode.gain.value = Math.pow(10, cfg.faderDb / 20);

      // 1950s 3-Position LCR / Rotary Pan Network (-4.5 dB center law)
      const pannerNode = this.ctx.createStereoPanner();
      pannerNode.pan.value = cfg.panPos;

      // Echo / Slapback Aux Send (Post-Fader)
      const auxSendNode = this.ctx.createGain();
      auxSendNode.gain.value = cfg.auxSend;

      // Channel Analyser for real-time per-channel metering
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 256;

      // Solo Gate Node (Post-Fader so fader level still works normally when soloed, while gating non-soloed mic channels)
      const soloGateNode = this.ctx.createGain();
      soloGateNode.gain.value = 1.0;

      // Connect strip: Input -> MicPreampWorklet -> Fader -> SoloGate -> Panner -> SummingBus
      inputNode.connect(micWorklet);
      micWorklet.connect(faderNode);
      faderNode.connect(soloGateNode);
      soloGateNode.connect(analyser);
      soloGateNode.connect(pannerNode);
      pannerNode.connect(this.summingBus);

      // Post-fader Aux Send to Slapback Tape Echo (also gated by solo so non-soloed mics don't feed slapback)
      soloGateNode.connect(auxSendNode);
      auxSendNode.connect(this.auxSendBus);

      this.channels.push({
        index: i,
        name: this.channelNames[i],
        inputNode,
        micWorklet,
        faderNode,
        soloGateNode,
        pannerNode,
        auxSendNode,
        analyser,
        state: {
          micModel: cfg.micModel,
          driveDb: cfg.driveDb,
          faderDb: cfg.faderDb,
          panPos: cfg.panPos,
          auxSend: cfg.auxSend,
          pad: false,
          phaseInvert: false,
          solo: false
        }
      });
    }

    // Master Bus Insert 1: Pultec EQP-1A3 Passive Program Equalizer
    this.pultecNode = new AudioWorkletNode(this.ctx, 'pultec-eq-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });

    // Master Bus Insert 2: Fairchild 660 / Gates STA-Level Variable-Mu Tube Compressor
    this.variMuNode = new AudioWorkletNode(this.ctx, 'vari-mu-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });

    this.variMuNode.port.onmessage = (e) => {
      if (e.data) {
        this.telemetry.variMuGrDb = e.data.grDb || 0;
        this.telemetry.variMuPeakIn = e.data.peakIn || 0;
        this.telemetry.variMuPeakOut = e.data.peakOut || 0;
      }
    };

    // Route: SummingBus -> Pultec EQP-1A3 -> Fairchild 660 Vari-Mu -> Console Output
    this.summingBus.connect(this.pultecNode);
    this.pultecNode.connect(this.variMuNode);
    this.variMuNode.connect(this.outputNode);
  }

  /**
   * Updates channel microphone model (0 = U47, 1 = RCA 44-BX, 2 = Shure 55SH)
   */
  setChannelMicModel(chIdx, modelIdx) {
    const ch = this.channels[chIdx];
    if (!ch) return;
    ch.state.micModel = modelIdx;
    ch.micWorklet.parameters.get('micModel').setValueAtTime(modelIdx, this.ctx.currentTime);
  }

  /**
   * Synchronizes physical mic-to-source distance (ft) into the MicWorklet for accurate Proximity Effect
   */
  setChannelDistance(chIdx, distFeet) {
    const ch = this.channels[chIdx];
    if (!ch) return;
    ch.micWorklet.parameters.get('distanceFeet').setTargetAtTime(
      Math.max(0.25, distFeet),
      this.ctx.currentTime,
      0.015
    );
  }

  setChannelDrive(chIdx, driveDb) {
    const ch = this.channels[chIdx];
    if (!ch) return;
    ch.state.driveDb = driveDb;
    ch.micWorklet.parameters.get('driveDb').setTargetAtTime(driveDb, this.ctx.currentTime, 0.015);
  }

  setChannelFader(chIdx, faderDb) {
    const ch = this.channels[chIdx];
    if (!ch) return;
    ch.state.faderDb = faderDb;
    const linear = faderDb <= -45 ? 0.0 : Math.pow(10, faderDb / 20);
    ch.faderNode.gain.setTargetAtTime(linear, this.ctx.currentTime, 0.015);
  }

  setChannelPan(chIdx, panPos) {
    const ch = this.channels[chIdx];
    if (!ch) return;
    ch.state.panPos = panPos;
    ch.pannerNode.pan.setTargetAtTime(panPos, this.ctx.currentTime, 0.015);
  }

  setChannelAuxSend(chIdx, sendLevel) {
    const ch = this.channels[chIdx];
    if (!ch) return;
    ch.state.auxSend = sendLevel;
    ch.auxSendNode.gain.setTargetAtTime(sendLevel, this.ctx.currentTime, 0.015);
  }

  setChannelPad(chIdx, enabled) {
    const ch = this.channels[chIdx];
    if (!ch) return;
    ch.state.pad = Boolean(enabled);
    ch.micWorklet.parameters.get('padEnabled').setValueAtTime(enabled ? 1 : 0, this.ctx.currentTime);
  }

  setChannelPhaseInvert(chIdx, inverted) {
    const ch = this.channels[chIdx];
    if (!ch) return;
    ch.state.phaseInvert = Boolean(inverted);
    ch.micWorklet.parameters.get('phaseInvert').setValueAtTime(inverted ? 1 : 0, this.ctx.currentTime);
  }

  setChannelSolo(chIdx, solo) {
    const ch = this.channels[chIdx];
    if (!ch) return;
    ch.state.solo = Boolean(solo);
    this._updateSoloGates();
  }

  _updateSoloGates() {
    const anySolo = this.channels.some((c) => c.state.solo);
    const now = this.ctx.currentTime;
    for (const ch of this.channels) {
      const open = !anySolo || ch.state.solo;
      ch.soloGateNode.gain.setTargetAtTime(open ? 1.0 : 0.0, now, 0.015);
    }
  }

  /**
   * Pultec EQP-1A3 Parameter Controls
   */
  setPultecParam(paramName, value) {
    const param = this.pultecNode.parameters.get(paramName);
    if (param) {
      param.setTargetAtTime(value, this.ctx.currentTime, 0.015);
    }
  }

  /**
   * Fairchild 660 Vari-Mu Parameter Controls
   */
  setVariMuParam(paramName, value) {
    const param = this.variMuNode.parameters.get(paramName);
    if (param) {
      param.setTargetAtTime(value, this.ctx.currentTime, 0.015);
    }
  }
}
