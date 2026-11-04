/**
 * CuttingLathe.js
 * Stage 4: Scully 601 / Neumann AM-32B Master Disc Cutting Lathe (RIAA Pre/De-Emphasis,
 * Stylus HF Acceleration Limiter, Inner-Groove Tangential Velocity Loss, Shellac/Vinyl Surface Wear)
 * + 1950s Control Room Monitor Speaker Simulation (Altec 604B Duplex Coaxial vs. 1954 AM Tube Radio vs. Flat).
 */

export class CuttingLathe {
  constructor(audioContext) {
    this.ctx = audioContext;

    this.inputNode = this.ctx.createGain();
    this.outputNode = this.ctx.createGain();

    this.telemetry = {
      accelLimiting: 0,
      scanCutoffHz: 14500,
      tangentialIps: 19.5
    };

    // Monitor mode: 'altec604' | 'amRadio' | 'flat'
    this.monitorMode = 'altec604';

    this._buildLatheGraph();
  }

  _buildLatheGraph() {
    this.latheWorklet = new AudioWorkletNode(this.ctx, 'cutting-lathe-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });

    this.latheWorklet.port.onmessage = (e) => {
      if (e.data) {
        this.telemetry.accelLimiting = e.data.accelLimiting || 0;
        this.telemetry.scanCutoffHz = e.data.scanCutoffHz || 14500;
        this.telemetry.tangentialIps = e.data.tangentialIps || 19.5;
      }
    };

    // Control Room Monitor Voicing Filter Bank (Altec 604B Duplex Coaxial / 1954 AM Radio / Flat)
    this.monHPF = this.ctx.createBiquadFilter();
    this.monHPF.type = 'highpass';

    this.monCabinetRes = this.ctx.createBiquadFilter();
    this.monCabinetRes.type = 'peaking';

    this.monHornDip = this.ctx.createBiquadFilter();
    this.monHornDip.type = 'peaking';

    this.monLPF = this.ctx.createBiquadFilter();
    this.monLPF.type = 'lowpass';

    this.inputNode.connect(this.latheWorklet);
    this.latheWorklet.connect(this.monHPF);
    this.monHPF.connect(this.monCabinetRes);
    this.monCabinetRes.connect(this.monHornDip);
    this.monHornDip.connect(this.monLPF);
    this.monLPF.connect(this.outputNode);

    this.setMonitorMode(this.monitorMode);
  }

  setLatheParam(paramName, value) {
    const param = this.latheWorklet.parameters.get(paramName);
    if (param) {
      param.setTargetAtTime(value, this.ctx.currentTime, 0.015);
    }
  }

  /**
   * Configures the final Control Room Monitor speaker voicing
   *  - 'altec604': Altec Lansing 604B 15" Duplex Coaxial in 612 Vented Utility Cabinet
   *  - 'amRadio': 1954 Zenith/RCA 5-Tube All-American Five Bakelite Table/Car Radio
   *  - 'flat': Direct Modern Reference Monitor
   */
  setMonitorMode(mode) {
    this.monitorMode = mode;
    const now = this.ctx.currentTime;

    if (mode === 'altec604') {
      // Altec 604B: 52 Hz vented cabinet roll-off, +2.4 dB 95 Hz woofer warmth,
      // +2.2 dB 1.8 kHz multicellular sectoral horn presence, 15.5 kHz air roll-off
      this.monHPF.frequency.setTargetAtTime(48, now, 0.02);
      this.monHPF.Q.setTargetAtTime(0.85, now, 0.02);

      this.monCabinetRes.frequency.setTargetAtTime(98, now, 0.02);
      this.monCabinetRes.Q.setTargetAtTime(1.2, now, 0.02);
      this.monCabinetRes.gain.setTargetAtTime(2.4, now, 0.02);

      this.monHornDip.frequency.setTargetAtTime(1850, now, 0.02);
      this.monHornDip.Q.setTargetAtTime(1.4, now, 0.02);
      this.monHornDip.gain.setTargetAtTime(2.1, now, 0.02);

      this.monLPF.frequency.setTargetAtTime(15500, now, 0.02);
      this.monLPF.Q.setTargetAtTime(0.707, now, 0.02);
    } else if (mode === 'amRadio') {
      // 1954 Bakelite 4" Speaker AM Broadcast Receiver (240 Hz - 3800 Hz bandpass + 850 Hz box resonance)
      this.monHPF.frequency.setTargetAtTime(250, now, 0.02);
      this.monHPF.Q.setTargetAtTime(1.35, now, 0.02);

      this.monCabinetRes.frequency.setTargetAtTime(420, now, 0.02);
      this.monCabinetRes.Q.setTargetAtTime(1.8, now, 0.02);
      this.monCabinetRes.gain.setTargetAtTime(3.5, now, 0.02);

      this.monHornDip.frequency.setTargetAtTime(1450, now, 0.02);
      this.monHornDip.Q.setTargetAtTime(1.5, now, 0.02);
      this.monHornDip.gain.setTargetAtTime(3.2, now, 0.02);

      this.monLPF.frequency.setTargetAtTime(3800, now, 0.02);
      this.monLPF.Q.setTargetAtTime(1.1, now, 0.02);
    } else {
      // Flat Direct Reference
      this.monHPF.frequency.setTargetAtTime(16, now, 0.02);
      this.monHPF.Q.setTargetAtTime(0.707, now, 0.02);

      this.monCabinetRes.gain.setTargetAtTime(0.0, now, 0.02);
      this.monHornDip.gain.setTargetAtTime(0.0, now, 0.02);

      this.monLPF.frequency.setTargetAtTime(20000, now, 0.02);
      this.monLPF.Q.setTargetAtTime(0.707, now, 0.02);
    }
  }
}
