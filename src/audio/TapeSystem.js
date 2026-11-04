/**
 * TapeSystem.js
 * Stage 3: Ampex 300 / 350 1/4-Inch Master Magnetic Tape System &
 * Sun Studio Second-Deck Ampex 350 Slapback Tape Echo.
 *
 * Physical Slapback Delay Equation:
 *   Delta_t = d_head / v_tape
 *   where d_head = 2.025 inches (Ampex 350 Record-to-Reproduce head spacing):
 *     - At 15 IPS:  Delta_t = 2.025 / 15.0 = 0.135 sec (135 ms classic Elvis/Sun slapback)
 *     - At 7.5 IPS: Delta_t = 2.025 / 7.5  = 0.270 sec (270 ms long ballad slapback)
 */

export class TapeSystem {
  constructor(audioContext) {
    this.ctx = audioContext;

    this.inputNode = this.ctx.createGain();
    this.auxSlapbackInput = this.ctx.createGain();
    this.outputNode = this.ctx.createGain();

    // Ampex 350 physical Record-to-Reproduce head distance in inches
    this.headSpacingInches = 2.025;
    this.slapbackSpeedIps = 15.0; // 15 or 7.5 IPS

    this.telemetry = {
      masterSaturation: 0,
      slapbackDelayMs: 135
    };

    this._buildTapeGraph();
  }

  _buildTapeGraph() {
    // 1. Sun Studio Slapback Tape Deck (Ampex 350 Auxiliary Machine)
    this.slapbackDelay = this.ctx.createDelay(1.0);
    this.slapbackDelay.delayTime.value = this.headSpacingInches / this.slapbackSpeedIps; // 0.135s

    // Slapback tape oxide high-pass (140 Hz) and gap loss low-pass (4.2 kHz)
    this.slapHPF = this.ctx.createBiquadFilter();
    this.slapHPF.type = 'highpass';
    this.slapHPF.frequency.value = 145;

    this.slapLPF = this.ctx.createBiquadFilter();
    this.slapLPF.type = 'lowpass';
    this.slapLPF.frequency.value = 4200;

    // Dedicated TapeWorklet for the Slapback Deck so the echo repeat has its own oxide saturation & wow/flutter
    this.slapTapeWorklet = new AudioWorkletNode(this.ctx, 'tape-machine-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });
    this.slapTapeWorklet.parameters.get('tapeSpeed').value = 15;
    this.slapTapeWorklet.parameters.get('recordDriveDb').value = 6.5;
    this.slapTapeWorklet.parameters.get('wowFlutter').value = 0.42;
    this.slapTapeWorklet.parameters.get('hissLevel').value = 0.12;

    // Regeneration (Feedback from Reproduce head back to Record input)
    this.slapFeedbackGain = this.ctx.createGain();
    this.slapFeedbackGain.gain.value = 0.18;

    // Slapback Return Level into Master Tape Deck
    this.slapReturnGain = this.ctx.createGain();
    this.slapReturnGain.gain.value = 0.48;

    // Wire Slapback Loop:
    // auxSlapbackInput -> slapDelay -> slapHPF -> slapLPF -> slapTapeWorklet -> slapReturnGain
    this.auxSlapbackInput.connect(this.slapbackDelay);
    this.slapbackDelay.connect(this.slapHPF);
    this.slapHPF.connect(this.slapLPF);
    this.slapLPF.connect(this.slapTapeWorklet);
    this.slapTapeWorklet.connect(this.slapReturnGain);

    // Feedback path: slapTapeWorklet -> slapFeedbackGain -> slapbackDelay
    this.slapTapeWorklet.connect(this.slapFeedbackGain);
    this.slapFeedbackGain.connect(this.slapbackDelay);

    // 2. Ampex 300 Master 1/4-Inch Recorder Worklet
    this.masterTapeSum = this.ctx.createGain();
    this.inputNode.connect(this.masterTapeSum);
    this.slapReturnGain.connect(this.masterTapeSum);

    this.masterTapeWorklet = new AudioWorkletNode(this.ctx, 'tape-machine-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });

    this.masterTapeWorklet.port.onmessage = (e) => {
      if (e.data && typeof e.data.saturation === 'number') {
        this.telemetry.masterSaturation = e.data.saturation;
      }
    };

    this.masterTapeSum.connect(this.masterTapeWorklet);
    this.masterTapeWorklet.connect(this.outputNode);
  }

  /**
   * Sets Master Tape speed (15 IPS or 7.5 IPS)
   */
  setMasterSpeed(ips) {
    const speed = ips >= 11.25 ? 15 : 7.5;
    this.masterTapeWorklet.parameters.get('tapeSpeed').setValueAtTime(speed, this.ctx.currentTime);
  }

  /**
   * Sets Slapback Tape Deck speed (15 IPS = 135ms delay, 7.5 IPS = 270ms delay)
   */
  setSlapbackSpeed(ips) {
    this.slapbackSpeedIps = ips >= 11.25 ? 15.0 : 7.5;
    const delaySec = this.headSpacingInches / this.slapbackSpeedIps;
    this.telemetry.slapbackDelayMs = Math.round(delaySec * 1000);

    // Smooth pitch-gliding capstan transition when switching slapback ips
    const now = this.ctx.currentTime;
    this.slapbackDelay.delayTime.setTargetAtTime(delaySec, now, 0.045);
    this.slapTapeWorklet.parameters.get('tapeSpeed').setValueAtTime(this.slapbackSpeedIps, now);
    this.slapLPF.frequency.setTargetAtTime(this.slapbackSpeedIps === 15.0 ? 4200 : 2800, now, 0.03);
  }

  setSlapbackReturn(level) {
    this.slapReturnGain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.015);
  }

  setSlapbackFeedback(feedback) {
    // Clamp below 0.85 to prevent runaway self-oscillation unless pushed intentionally
    const clamped = Math.max(0.0, Math.min(0.88, feedback));
    this.slapFeedbackGain.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.015);
  }

  setMasterParam(paramName, value) {
    const param = this.masterTapeWorklet.parameters.get(paramName);
    if (param) {
      param.setTargetAtTime(value, this.ctx.currentTime, 0.015);
    }
  }
}
