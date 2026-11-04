/**
 * RackController.js
 * Manages Skeuomorphic Bakelite Rotary Knobs, Stepped Frequency Selectors,
 * Toggle Switches, Double-Click Reset, Mouse-Wheel Fine Adjustment, and Parameter Binding.
 */

export class RackController {
  constructor() {
    this.knobs = new Map();
    this.activeDrag = null;

    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerUp = this._handlePointerUp.bind(this);

    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
  }

  /**
   * Registers all `.bakelite-knob` elements in the DOM and binds their callbacks.
   * Each `.bakelite-knob` element supports data attributes:
   *   data-id: unique knob identifier
   *   data-min: numeric minimum
   *   data-max: numeric maximum
   *   data-step: step increment (or comma-separated discrete values in data-steps)
   *   data-value: initial default value
   *   data-unit: unit suffix ('dB', 'Hz', 'kHz', '%', '')
   */
  initKnobs(onKnobChange) {
    this.onKnobChange = onKnobChange;
    const knobEls = document.querySelectorAll('.bakelite-knob');

    knobEls.forEach((el) => {
      const id = el.dataset.id;
      if (!id) return;

      const discreteSteps = el.dataset.steps
        ? el.dataset.steps.split(',').map((s) => parseFloat(s.trim()))
        : null;

      const min = discreteSteps ? discreteSteps[0] : parseFloat(el.dataset.min ?? '0');
      const max = discreteSteps ? discreteSteps[discreteSteps.length - 1] : parseFloat(el.dataset.max ?? '10');
      const step = parseFloat(el.dataset.step ?? '0.1');
      const defaultValue = parseFloat(el.dataset.value ?? String(min));
      const unit = el.dataset.unit ?? '';

      const wrapper = el.closest('.knob-wrapper');
      const indicator = el.querySelector('.knob-indicator');
      const readout = wrapper ? wrapper.querySelector('.knob-readout') : null;

      const knobObj = {
        id,
        el,
        indicator,
        readout,
        min,
        max,
        step,
        discreteSteps,
        value: defaultValue,
        defaultValue,
        unit
      };

      this.knobs.set(id, knobObj);
      this._renderKnobState(knobObj);

      // Pointer down starts vertical rotary drag
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        this.activeDrag = {
          knob: knobObj,
          startY: e.clientY,
          startVal: knobObj.value
        };
      });

      // Double-click resets knob to factory default
      el.addEventListener('dblclick', (e) => {
        e.preventDefault();
        this.setKnobValue(id, knobObj.defaultValue, true);
      });

      // Mouse wheel fine-tunes knob
      el.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault();
          const dir = e.deltaY < 0 ? 1 : -1;
          if (knobObj.discreteSteps) {
            const curIdx = this._findClosestStepIndex(knobObj.discreteSteps, knobObj.value);
            const nextIdx = Math.max(0, Math.min(knobObj.discreteSteps.length - 1, curIdx + dir));
            this.setKnobValue(id, knobObj.discreteSteps[nextIdx], true);
          } else {
            const range = knobObj.max - knobObj.min;
            const delta = dir * Math.max(knobObj.step, range * 0.025);
            this.setKnobValue(id, knobObj.value + delta, true);
          }
        },
        { passive: false }
      );
    });
  }

  _findClosestStepIndex(steps, val) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < steps.length; i++) {
      const d = Math.abs(steps[i] - val);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  _handlePointerMove(e) {
    if (!this.activeDrag) return;
    const { knob, startY, startVal } = this.activeDrag;
    const dy = startY - e.clientY;
    const sensitivity = e.shiftKey ? 320 : 135; // Shift key enables precision trim

    if (knob.discreteSteps) {
      const startIdx = this._findClosestStepIndex(knob.discreteSteps, startVal);
      const stepOffset = Math.round((dy / 110) * (knob.discreteSteps.length - 1));
      const nextIdx = Math.max(0, Math.min(knob.discreteSteps.length - 1, startIdx + stepOffset));
      this.setKnobValue(knob.id, knob.discreteSteps[nextIdx], true);
    } else {
      const range = knob.max - knob.min;
      const rawVal = startVal + (dy / sensitivity) * range;
      this.setKnobValue(knob.id, rawVal, true);
    }
  }

  _handlePointerUp() {
    this.activeDrag = null;
  }

  /**
   * Programmatically or interactively updates a knob's value & visual rotation (-135deg to +135deg)
   */
  setKnobValue(id, rawValue, triggerCallback = false) {
    const knob = this.knobs.get(id);
    if (!knob) return;

    let finalVal = rawValue;
    if (knob.discreteSteps) {
      const idx = this._findClosestStepIndex(knob.discreteSteps, rawValue);
      finalVal = knob.discreteSteps[idx];
    } else {
      const clamped = Math.max(knob.min, Math.min(knob.max, rawValue));
      finalVal = Math.round(clamped / knob.step) * knob.step;
      // Avoid floating point precision artifacts
      finalVal = parseFloat(finalVal.toFixed(4));
    }

    if (finalVal === knob.value && triggerCallback) return;
    knob.value = finalVal;
    this._renderKnobState(knob);

    if (triggerCallback && this.onKnobChange) {
      this.onKnobChange(id, finalVal);
    }
  }

  _renderKnobState(knob) {
    let norm = 0;
    if (knob.discreteSteps) {
      const idx = this._findClosestStepIndex(knob.discreteSteps, knob.value);
      norm = idx / Math.max(1, knob.discreteSteps.length - 1);
    } else {
      norm = (knob.value - knob.min) / Math.max(1e-6, knob.max - knob.min);
    }

    const angleDeg = -135 + norm * 270;
    if (knob.indicator) {
      knob.indicator.style.transform = `rotate(${angleDeg.toFixed(1)}deg)`;
    }

    if (knob.readout) {
      knob.readout.textContent = this._formatReadout(knob.value, knob.unit, knob.step);
    }
  }

  _formatReadout(val, unit, step) {
    if (unit === 'pan') {
      if (Math.abs(val) < 0.06) return 'CENTER';
      const pct = Math.round(Math.abs(val) * 100);
      return val < 0 ? `L ${pct}%` : `R ${pct}%`;
    }
    if (unit === 'Hz' && val >= 1000) {
      return `${(val / 1000).toFixed(val % 1000 === 0 ? 0 : 1)} kHz`;
    }
    if (unit === 'dB') {
      const sign = val > 0 ? '+' : '';
      return `${sign}${val.toFixed(step >= 1 ? 0 : 1)} dB`;
    }
    if (unit === '%') {
      return `${Math.round(val * 100)}%`;
    }
    const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
    return `${val.toFixed(decimals)}${unit ? ' ' + unit : ''}`;
  }
}
