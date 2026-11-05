/**
 * ClipboardLabs.js
 * Interactive 1967 Studio Clipboard with 4 Guided Student Learning Modules.
 * 
 * Labs:
 *  1. Finding the Null (Through-Zero Cancellation)
 *  2. Manual Thumb Flanging ("Itchycoo Park" / "Tomorrow Never Knows")
 *  3. The Boundary Between Flanging and ADT (~15ms Haas Psychoacoustic Threshold)
 *  4. Bring Your Own Stem (Local Sandbox & Harmonic Analysis)
 */

export class ClipboardLabs {
  constructor(containerEl, physicsEngine, audioEngine, onLabEvent) {
    this.container = containerEl;
    this.physics = physicsEngine;
    this.audio = audioEngine;
    this.onLabEvent = onLabEvent;

    this.activeLabIndex = 0;
    this.completedLabs = [false, false, false, false];

    // Tracking variables for lab challenge verification
    this.lab1NullDurationSec = 0;
    this.lab2ReachedLag = false;
    this.lab2SweptThroughZero = false;
    this.lab3PassedThreshold = false;
    this.lab3CurrentZone = 'comb'; // 'comb' | 'haas'

    this.labs = [
      {
        id: 'lab1',
        number: 1,
        title: 'Finding the Null (Through-Zero Cancellation)',
        era: 'Abbey Road Studio 2 · 1966',
        objective: 'Align Deck B to exactly Δt = 0.0 ms with 180° phase inversion to achieve total acoustic silence.',
        steps: [
          { text: 'Set Preset Stem to "Drums" or "Noise"', check: () => ['drums', 'noise'].includes(this.audio.activeStemId) },
          { text: 'Engage 180° Phase Invert (Red Button)', check: () => this.audio.isPhaseInverted },
          { text: 'Set Deck B Mix to 100%', check: () => this.audio.wetDryMix >= 0.95 },
          { text: 'Tune BPO Varispeed until |Δt| < 0.15 ms (Total Null)', check: () => Math.abs(this.physics.deltaT_ms) < 0.15 }
        ],
        explanation: 'When two identical waveforms are delayed by exactly Δt = 0 with inverted polarity (180° out of phase), destructive interference is 100% complete: (+A) + (-A) = 0. This is the literal definition of Through-Zero flanging.'
      },
      {
        id: 'lab2',
        number: 2,
        title: 'Manual Thumb Flanging ("Itchycoo Park")',
        era: 'Olympic Studios · George Chkiantz · 1967',
        objective: 'Drag Deck B supply reel flange to build up >10 ms delay, then release to let motor inertia sweep through the zero point.',
        steps: [
          { text: 'Ensure audio is playing (Start Audio)', check: () => this.audio.isPlaying },
          { text: 'Click & hold Deck B supply reel rim to drag Δt > 10 ms', check: () => this.lab2ReachedLag },
          { text: 'Release mouse to let reel spring back across zero (Δt < 1 ms)', check: () => this.lab2SweptThroughZero }
        ],
        explanation: 'George Chkiantz and Ken Townsend originally braked the tape reel directly with their thumbs. As the capstan motor accelerates the tape back to 15 IPS, the rapid change in time delay creates the iconic "jet-plane" phase swoosh.'
      },
      {
        id: 'lab3',
        number: 3,
        title: 'The Boundary: Flanging vs. ADT (The Haas Effect)',
        era: 'Abbey Road ADT · Ken Townsend · 1966',
        objective: 'Load the Vocals preset and sweep Δt across the 15 ms psychoacoustic boundary to hear comb filtering turn into double tracking.',
        steps: [
          { text: 'Select "Vocals" stem preset', check: () => this.audio.activeStemId === 'vocals' },
          { text: 'Ensure Phase is Normal (0° in-phase)', check: () => !this.audio.isPhaseInverted },
          { text: 'Sweep Δt below 10 ms (Hollow comb filtering / phasing)', check: () => Math.abs(this.physics.deltaT_ms) < 8.0 },
          { text: 'Sweep Δt above 16 ms (Distinct double voice / Haas slapback)', check: () => Math.abs(this.physics.deltaT_ms) > 16.0 }
        ],
        explanation: 'Below ~15 ms, the human brain fuses the two audio arrivals into a single tonal event with hollow comb-filter coloration. Above 15–20 ms (the Haas threshold), the ear perceives two distinct acoustic events: Artificial Double Tracking (ADT)!'
      },
      {
        id: 'lab4',
        number: 4,
        title: 'Bring Your Own Stem (Local Sandbox)',
        era: 'Studio Sandbox & Transient File Pipeline',
        objective: 'Load your own audio file to test how broadband harmonic spectrums flange compared to pure low frequencies.',
        steps: [
          { text: 'Drop or select a personal .wav / .mp3 / .ogg file', check: () => this.audio.activeStemId === 'custom' },
          { text: 'Engage Automated LFO sweep or manual flange', check: () => this.physics.isLFOActive || this.physics.isBraking },
          { text: 'Switch CRT to Comb Filter view to observe moving notches', check: () => true }
        ],
        explanation: 'Instruments with dense high-frequency harmonics (cymbals, 12-string guitars, bright vocals) produce deep, dramatic comb filtering notches because dozens of frequency cancellation nulls fall within human audible range.'
      }
    ];

    this._render();
  }

  /**
   * Called every animation frame from the master loop to check student progress
   * @param {number} dt
   */
  update(dt) {
    const curLab = this.labs[this.activeLabIndex];
    const state = this.physics.getState();

    // Lab 1 Logic
    if (this.activeLabIndex === 0) {
      if (['drums', 'noise'].includes(this.audio.activeStemId) &&
          this.audio.isPhaseInverted &&
          this.audio.wetDryMix >= 0.95 &&
          Math.abs(state.deltaT_ms) < 0.15 &&
          this.audio.isPlaying) {
        this.lab1NullDurationSec += dt;
        if (this.lab1NullDurationSec > 1.2) {
          this.completedLabs[0] = true;
        }
      } else {
        this.lab1NullDurationSec = Math.max(0, this.lab1NullDurationSec - dt * 0.5);
      }
    }

    // Lab 2 Logic
    if (this.activeLabIndex === 1) {
      if (state.deltaT_ms > 9.5) {
        this.lab2ReachedLag = true;
      }
      if (this.lab2ReachedLag && !state.isBraking && Math.abs(state.deltaT_ms) < 1.2) {
        this.lab2SweptThroughZero = true;
        this.completedLabs[1] = true;
      }
    }

    // Lab 3 Logic
    if (this.activeLabIndex === 2) {
      if (this.audio.activeStemId === 'vocals' && !this.audio.isPhaseInverted) {
        if (Math.abs(state.deltaT_ms) > 16.0) {
          this.lab3PassedThreshold = true;
          this.completedLabs[2] = true;
        }
      }
    }

    // Lab 4 Logic
    if (this.activeLabIndex === 3) {
      if (this.audio.activeStemId === 'custom') {
        this.completedLabs[3] = true;
      }
    }

    this._updateProgressDOM();
  }

  selectLab(index) {
    if (index >= 0 && index < this.labs.length) {
      this.activeLabIndex = index;
      this._render();
    }
  }

  /**
   * Pre-configures console parameters for the selected lab
   */
  autoConfigureLab(index) {
    const state = this.physics.getState();

    if (index === 0) {
      // Lab 1: Drums, Invert Phase, Wet 100%
      this.audio.selectStem('drums');
      this.audio.setPhaseInvert(true);
      this.audio.setWetDryMix(1.0);
      this.physics.setBPOFrequency(49.2); // Start close to null so student can dial it in
      if (!this.audio.isPlaying) this.audio.play();
    } else if (index === 1) {
      // Lab 2: Guitars, Normal Phase, Ready for Thumb Braking
      this.audio.selectStem('guitars');
      this.audio.setPhaseInvert(false);
      this.audio.setWetDryMix(1.0);
      this.physics.resetToZeroPoint();
      if (!this.audio.isPlaying) this.audio.play();
    } else if (index === 2) {
      // Lab 3: Vocals, Normal Phase, 5ms delay to start
      this.audio.selectStem('vocals');
      this.audio.setPhaseInvert(false);
      this.audio.setWetDryMix(1.0);
      this.physics.setBPOFrequency(48.5);
      if (!this.audio.isPlaying) this.audio.play();
    }

    this._render();
    if (this.onLabEvent) {
      this.onLabEvent('configured', index);
    }
  }

  _render() {
    const lab = this.labs[this.activeLabIndex];
    const isDone = this.completedLabs[this.activeLabIndex];

    this.container.innerHTML = `
      <div class="clipboard-card">
        <!-- Clipboard Header & Metal Clip -->
        <div class="clipboard-metal-clip">
          <div class="clip-rivet"></div>
          <div class="clip-label">EMI ABBEY ROAD STUDIO 2 · RECORDING LOG</div>
          <div class="clip-rivet"></div>
        </div>

        <div class="clipboard-body">
          <!-- Lab Navigation Tabs -->
          <div class="lab-tabs">
            ${this.labs.map((l, idx) => `
              <button class="lab-tab-btn ${idx === this.activeLabIndex ? 'active' : ''} ${this.completedLabs[idx] ? 'completed' : ''}" data-lab-idx="${idx}">
                <span>LAB ${l.number}</span>
                ${this.completedLabs[idx] ? '<span class="check-badge">✓</span>' : ''}
              </button>
            `).join('')}
          </div>

          <!-- Active Lab Header -->
          <div class="lab-info-header">
            <div class="lab-era-badge">${lab.era}</div>
            <h3 class="lab-title">${lab.title}</h3>
            <p class="lab-obj"><strong>Goal:</strong> ${lab.objective}</p>
          </div>

          <!-- Step-by-Step Task Checklist -->
          <div class="lab-steps-list" id="lab-steps-container">
            ${lab.steps.map((step, sIdx) => {
              const checked = step.check();
              return `
                <div class="lab-step-item ${checked ? 'step-done' : ''}" id="step-item-${sIdx}">
                  <span class="step-checkbox">${checked ? '☑' : '☐'}</span>
                  <span class="step-text">${step.text}</span>
                </div>
              `;
            }).join('')}
          </div>

          <!-- Status & Auto-Setup Bar -->
          <div class="lab-action-bar">
            <button type="button" class="btn-auto-setup" id="btn-lab-setup">
              ⚡ Pre-Configure Console for Lab ${lab.number}
            </button>
            <div class="lab-status-badge ${isDone ? 'done' : 'in-progress'}" id="lab-status-badge">
              ${isDone ? '★ LAB COMPLETE! ★' : '● In Progress'}
            </div>
          </div>

          <!-- Historical Engineering Note -->
          <div class="lab-historical-box">
            <div class="box-tag">ARCHIVAL DSP NOTE</div>
            <p>${lab.explanation}</p>
          </div>
        </div>
      </div>
    `;

    // Bind Lab Tab Buttons
    this.container.querySelectorAll('.lab-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.labIdx, 10);
        this.selectLab(idx);
      });
    });

    // Bind Pre-Configure Button
    const setupBtn = this.container.querySelector('#btn-lab-setup');
    if (setupBtn) {
      setupBtn.addEventListener('click', () => {
        this.autoConfigureLab(this.activeLabIndex);
      });
    }
  }

  /**
   * Fast DOM update for checklist checkmarks and status badge
   */
  _updateProgressDOM() {
    const lab = this.labs[this.activeLabIndex];
    const isDone = this.completedLabs[this.activeLabIndex];

    lab.steps.forEach((step, sIdx) => {
      const el = this.container.querySelector(`#step-item-${sIdx}`);
      if (el) {
        const checked = step.check();
        if (checked && !el.classList.contains('step-done')) {
          el.classList.add('step-done');
          el.querySelector('.step-checkbox').textContent = '☑';
        } else if (!checked && el.classList.contains('step-done')) {
          el.classList.remove('step-done');
          el.querySelector('.step-checkbox').textContent = '☐';
        }
      }
    });

    const badge = this.container.querySelector('#lab-status-badge');
    if (badge) {
      if (isDone && !badge.classList.contains('done')) {
        badge.className = 'lab-status-badge done';
        badge.textContent = '★ LAB COMPLETE! ★';
      }
    }
  }
}
