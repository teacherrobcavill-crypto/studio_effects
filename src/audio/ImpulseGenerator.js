/**
 * Dynamic Multi-Band Sabine RT60 Impulse Response Generator
 * Synthesizes a physical stereo impulse response buffer where Low (125Hz),
 * Mid (1kHz), and High (4kHz) bands decay independently according to
 * e^(-6.9078 * t / RT60_band).
 */

const LN_1000 = 6.90775527898; // ln(10^(60/20)) for -60 dB decay

export class ImpulseGenerator {
  constructor(audioContext) {
    this.ctx = audioContext;
  }

  /**
   * Generates a stereo AudioBuffer for the ConvolverNode based on current room acoustics.
   * @param {Object} reverbData - Output of computeRoomReverb()
   * @param {number} itdgMs - Initial Time Delay Gap in ms
   * @returns {AudioBuffer}
   */
  generateImpulseBuffer(reverbData, itdgMs = 8.0) {
    const sampleRate = this.ctx.sampleRate;
    const rt125 = Math.min(4.5, Math.max(0.08, reverbData.eyring[125]));
    const rt1k = Math.min(4.5, Math.max(0.06, reverbData.eyring[1000]));
    const rt4k = Math.min(4.0, Math.max(0.05, reverbData.eyring[4000]));

    const maxRt = Math.max(rt125, rt1k, rt4k);
    // Buffer duration needs to cover down to ~-50dB smoothly without abrupt cutoff
    const durationSec = Math.min(4.2, Math.max(0.25, maxRt * 0.92));
    const length = Math.max(1024, Math.floor(sampleRate * durationSec));

    const buffer = this.ctx.createBuffer(2, length, sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    // One-pole crossover coefficients for 3-band splitting (Low < 320 Hz, Mid 320-2400 Hz, High > 2400 Hz)
    const aLow = 1.0 - Math.exp((-2.0 * Math.PI * 320.0) / sampleRate);
    const aHigh = 1.0 - Math.exp((-2.0 * Math.PI * 2400.0) / sampleRate);

    // Decay constants per sample: exp(-6.9078 / (RT60 * sr))
    const decayLow = Math.exp(-LN_1000 / (rt125 * sampleRate));
    const decayMid = Math.exp(-LN_1000 / (rt1k * sampleRate));
    const decayHigh = Math.exp(-LN_1000 / (rt4k * sampleRate));

    let envLow = 1.0;
    let envMid = 1.0;
    let envHigh = 1.0;

    let lp1L = 0, lp2L = 0;
    let lp1R = 0, lp2R = 0;

    // Diffuse field onset ramps in after the first early reflection (ITDG)
    const onsetSamples = Math.max(32, Math.floor((itdgMs * 0.001) * sampleRate));
    const buildUpSamples = Math.max(64, Math.floor(0.018 * sampleRate));

    // Subtle normalization so longer rooms don't clip the convolver
    const normGain = 0.26 / Math.pow(Math.max(0.15, rt1k), 0.32);

    for (let i = 0; i < length; i++) {
      // Advance 3-band exponential Sabine/Eyring envelopes
      envLow *= decayLow;
      envMid *= decayMid;
      envHigh *= decayHigh;

      // Smooth onset envelope after ITDG
      let onset = 1.0;
      if (i < onsetSamples) {
        onset = 0.15 * (i / onsetSamples);
      } else if (i < onsetSamples + buildUpSamples) {
        const p = (i - onsetSamples) / buildUpSamples;
        onset = 0.15 + 0.85 * (p * (2 - p));
      }

      // Decorrelated stereo Gaussian-like white noise
      const wL = (Math.random() * 2 - 1) + (Math.random() * 2 - 1) * 0.5;
      const wR = (Math.random() * 2 - 1) + (Math.random() * 2 - 1) * 0.5;

      // Split Left into Low / Mid / High bands
      lp1L += aLow * (wL - lp1L);
      lp2L += aHigh * (wL - lp2L);
      const lowL = lp1L;
      const midL = lp2L - lp1L;
      const highL = wL - lp2L;

      // Split Right into Low / Mid / High bands
      lp1R += aLow * (wR - lp1R);
      lp2R += aHigh * (wR - lp2R);
      const lowR = lp1R;
      const midR = lp2R - lp1R;
      const highR = wR - lp2R;

      // Reconstruct frequency-dependent decaying tail
      const sampleL = (lowL * envLow * 1.35 + midL * envMid + highL * envHigh * 0.9) * onset * normGain;
      const sampleR = (lowR * envLow * 1.35 + midR * envMid + highR * envHigh * 0.9) * onset * normGain;

      // Cosine fade out on final 256 samples to guarantee zero end-click
      const tailFade = i > length - 256 ? (length - i) / 256 : 1.0;
      left[i] = sampleL * tailFade;
      right[i] = sampleR * tailFade;
    }

    return buffer;
  }
}
