/**
 * Eval bar component — vertical bar showing white/black advantage.
 * White section always stays on the side of the white pieces.
 */

export class EvalBar {
    constructor(container) {
        this.container = container;
        this.container.classList.add('eval-bar');
        this.container.setAttribute('role', 'meter');
        this.container.setAttribute('aria-label', 'Evaluation');
        this.container.setAttribute('aria-valuemin', '-10');
        this.container.setAttribute('aria-valuemax', '10');
        this.container.setAttribute('aria-valuenow', '0');
        this.container.setAttribute('aria-valuetext', '0.0');
        this.container.innerHTML = `
            <div class="eval-bar-white" style="height: 50%" aria-hidden="true"></div>
            <div class="eval-bar-black" aria-hidden="true"></div>
            <div class="eval-bar-label" aria-hidden="true">0.0</div>
        `;
        this.whiteBar = this.container.querySelector('.eval-bar-white');
        this.label = this.container.querySelector('.eval-bar-label');
        this.flipped = false;
    }

    /**
     * Set board orientation so white part of eval bar matches white pieces side.
     * @param {'white'|'black'} orientation - which color is at the bottom of the board
     */
    setOrientation(orientation) {
        this.flipped = orientation === 'black';
        this.container.classList.toggle('eval-bar-flipped', this.flipped);
    }

    /**
     * Update eval bar with centipawn value or mate.
     * @param {number|null} cp - centipawns from white's perspective
     * @param {number|null} mate - mate in N moves (positive = white mates)
     */
    update(cp, mate = null) {
        let pct, text;

        if (mate !== null && mate !== undefined) {
            pct = mate > 0 ? 98 : 2;
            text = `M${Math.abs(mate)}`;
        } else if (cp !== null && cp !== undefined) {
            // Sigmoid mapping: cp -> percentage
            pct = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
            pct = Math.max(2, Math.min(98, pct));

            const val = Math.abs(cp / 100).toFixed(1);
            text = cp >= 0 ? `+${val}` : `-${val}`;
        } else {
            pct = 50;
            text = '0.0';
        }

        this.whiteBar.style.height = `${pct}%`;
        // Width is controlled by CSS --eval-pct for horizontal mode (tablet)
        this.container.style.setProperty('--eval-pct', `${pct}%`);
        this.label.textContent = text;

        // Update ARIA meter attributes
        const numericVal = (cp !== null && cp !== undefined) ? (cp / 100) : 0;
        this.container.setAttribute('aria-valuenow', String(Math.round(numericVal * 10) / 10));
        this.container.setAttribute('aria-valuetext', text);

        // Color the label based on who's winning
        if (pct > 55) {
            this.label.className = 'eval-bar-label white-winning';
        } else if (pct < 45) {
            this.label.className = 'eval-bar-label black-winning';
        } else {
            this.label.className = 'eval-bar-label';
        }
    }

    reset() {
        this.update(0);
    }
}
