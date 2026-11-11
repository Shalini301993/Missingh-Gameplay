// The capsule machine: a glass globe of tumbling capsules, a dial, a chute and the reveal.
// Everything is drawn with vector shapes, so there are no image assets to load.

/* global Phaser */

export const STAGE = { width: 600, height: 640, zoom: 2 };

const INK = 0x1c1b19;
const PAPER = 0xf6f3ee;
const WALL = 0xece7df;
const BRASS = 0xc39a3b;
const RARITY_COLOUR = { common: 0x6f6a62, rare: 0x2f5d9b, legendary: 0xc39a3b };
const CAPSULE_COLOURS = [0xc8452c, 0x2f5d9b, 0x4f7a5a, 0xc39a3b, 0xe3a5b4, 0x6f6a62, 0xc8452c, 0x4f7a5a];

const GLOBE = { x: 300, y: 232, r: 186 };
const DIAL = { x: 392, y: 522, r: 34 };
const CHUTE = { x: 236, y: 546, w: 96, h: 74 };
const BALL_R = 25;

export class MachineScene extends Phaser.Scene {
  constructor({ onLever, reducedMotion = false } = {}) {
    super('machine');
    this.onLever = onLever;
    this.reducedMotion = reducedMotion;
    this.balls = [];
    this.shakeUntil = 0;
    this.ready = new Promise((resolve) => { this.markReady = resolve; });
  }

  create() {
    this.cameras.main.setZoom(STAGE.zoom);
    this.cameras.main.centerOn(STAGE.width / 2, STAGE.height / 2);

    this.drawCabinet();
    this.spawnBalls();
    this.drawGlass();
    this.drawDial();

    this.veil = this.add.rectangle(STAGE.width / 2, STAGE.height / 2, STAGE.width, STAGE.height, PAPER, 1)
      .setAlpha(0).setDepth(50);
    this.markReady();
  }

  drawCabinet() {
    const g = this.add.graphics();
    // Shadow on the floor.
    g.fillStyle(INK, 0.1);
    g.fillEllipse(300, 622, 380, 22);
    // Plinth.
    g.fillStyle(INK, 1);
    g.fillRoundedRect(150, 432, 300, 186, 6);
    g.fillRect(172, 414, 256, 22);
    // Brass plaque.
    g.fillStyle(BRASS, 1);
    g.fillRect(190, 452, 220, 30);
    this.add.text(300, 467, 'CURIO  CAPSULE', {
      fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '15px', color: '#1c1b19',
    }).setOrigin(0.5).setLetterSpacing?.(3);
    // Chute.
    g.fillStyle(0x0d0c0b, 1);
    g.fillRoundedRect(CHUTE.x - CHUTE.w / 2, CHUTE.y - CHUTE.h / 2, CHUTE.w, CHUTE.h, 8);
    g.lineStyle(1.5, BRASS, 1);
    g.strokeRoundedRect(CHUTE.x - CHUTE.w / 2, CHUTE.y - CHUTE.h / 2, CHUTE.w, CHUTE.h, 8);
    // Back of the globe.
    g.fillStyle(WALL, 1);
    g.fillCircle(GLOBE.x, GLOBE.y, GLOBE.r);
  }

  drawGlass() {
    const g = this.add.graphics().setDepth(10);
    g.lineStyle(2.5, INK, 1);
    g.strokeCircle(GLOBE.x, GLOBE.y, GLOBE.r);
    g.lineStyle(5, 0xffffff, 0.7);
    g.beginPath();
    g.arc(GLOBE.x, GLOBE.y, GLOBE.r - 16, Phaser.Math.DegToRad(200), Phaser.Math.DegToRad(250));
    g.strokePath();
  }

  drawDial() {
    const g = this.add.graphics();
    g.fillStyle(BRASS, 1);
    g.fillCircle(0, 0, DIAL.r);
    g.lineStyle(1.5, INK, 1);
    g.strokeCircle(0, 0, DIAL.r);
    g.fillStyle(INK, 1);
    g.fillRoundedRect(-7, -DIAL.r + 5, 14, DIAL.r * 2 - 10, 7);
    g.fillStyle(BRASS, 1);
    g.fillCircle(0, 0, 4);
    this.dial = this.add.container(DIAL.x, DIAL.y, [g]);
    this.dial.setSize(DIAL.r * 2 + 16, DIAL.r * 2 + 16);
    this.dial.setInteractive({ useHandCursor: true });
    this.dial.on('pointerdown', () => this.onLever?.());
  }

  makeCapsule(colour, radius = BALL_R) {
    const top = this.add.graphics();
    top.fillStyle(colour, 1);
    top.beginPath();
    top.arc(0, 0, radius, Math.PI, 0, false);
    top.closePath();
    top.fillPath();
    const bottom = this.add.graphics();
    bottom.fillStyle(PAPER, 1);
    bottom.beginPath();
    bottom.arc(0, 0, radius, 0, Math.PI, false);
    bottom.closePath();
    bottom.fillPath();
    const outline = this.add.graphics();
    outline.lineStyle(1.5, INK, 1);
    outline.strokeCircle(0, 0, radius);
    outline.lineBetween(-radius, 0, radius, 0);
    const container = this.add.container(0, 0, [bottom, top, outline]);
    container.parts = { top, bottom, outline };
    return container;
  }

  spawnBalls() {
    for (let i = 0; i < 15; i += 1) {
      const view = this.makeCapsule(CAPSULE_COLOURS[i % CAPSULE_COLOURS.length]).setDepth(5);
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.random() * (GLOBE.r - BALL_R * 2);
      this.balls.push({
        view,
        x: GLOBE.x + Math.cos(angle) * distance,
        y: GLOBE.y + Math.sin(angle) * distance * 0.6,
        vx: (Math.random() - 0.5) * 120,
        vy: 0,
        spin: Math.random() * Math.PI * 2,
      });
    }
  }

  update(time, delta) {
    const dt = Math.min(delta, 32) / 1000;
    const shaking = time < this.shakeUntil;
    const limit = GLOBE.r - BALL_R - 2;

    for (const ball of this.balls) {
      if (shaking && Math.random() < 0.18) {
        ball.vx += (Math.random() - 0.5) * 900;
        ball.vy -= 250 + Math.random() * 500;
      }
      ball.vy += 1100 * dt;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      const dx = ball.x - GLOBE.x;
      const dy = ball.y - GLOBE.y;
      const distance = Math.hypot(dx, dy);
      if (distance > limit) {
        const nx = dx / distance;
        const ny = dy / distance;
        ball.x = GLOBE.x + nx * limit;
        ball.y = GLOBE.y + ny * limit;
        const normalSpeed = ball.vx * nx + ball.vy * ny;
        if (normalSpeed > 0) {
          ball.vx -= 1.45 * normalSpeed * nx;
          ball.vy -= 1.45 * normalSpeed * ny;
        }
        ball.vx *= 0.985;
        ball.vy *= 0.985;
      }
    }

    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 0; i < this.balls.length; i += 1) {
        for (let j = i + 1; j < this.balls.length; j += 1) {
          const a = this.balls[i];
          const b = this.balls[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distance = Math.hypot(dx, dy) || 0.001;
          const overlap = BALL_R * 2 - distance;
          if (overlap <= 0) continue;
          const nx = dx / distance;
          const ny = dy / distance;
          a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
          b.x += nx * overlap / 2; b.y += ny * overlap / 2;
          const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (closing < 0) {
            const impulse = -0.75 * closing;
            a.vx -= impulse * nx; a.vy -= impulse * ny;
            b.vx += impulse * nx; b.vy += impulse * ny;
          }
        }
      }
    }

    for (const ball of this.balls) {
      ball.vx *= 0.995;
      ball.spin += (ball.vx * dt) / BALL_R;
      ball.view.setPosition(ball.x, ball.y);
      ball.view.setRotation(ball.spin);
    }
  }

  tween(config) {
    return new Promise((resolve) => this.tweens.add({ ...config, onComplete: resolve }));
  }

  wait(ms) {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }

  // Plays the whole pull and resolves when the capsule has opened.
  async playPull(rarity) {
    await this.ready;
    const colour = RARITY_COLOUR[rarity] ?? RARITY_COLOUR.common;

    if (this.reducedMotion) {
      this.dial.setAngle(this.dial.angle + 90);
      await this.wait(120);
      return;
    }

    this.shakeUntil = this.time.now + 1150;
    await this.tween({ targets: this.dial, angle: this.dial.angle + 360, duration: 650, ease: 'Cubic.easeInOut' });
    await this.wait(500);

    const prize = this.makeCapsule(colour, 22).setDepth(60).setPosition(CHUTE.x, CHUTE.y - 30).setAlpha(0);
    await this.tween({ targets: prize, y: CHUTE.y + 8, alpha: 1, duration: 420, ease: 'Bounce.easeOut' });
    await this.wait(160);

    this.tweens.add({ targets: this.veil, alpha: 0.92, duration: 450 });
    await this.tween({ targets: prize, x: 300, y: 300, scale: 4, duration: 560, ease: 'Back.easeOut' });

    const label = this.add.text(300, 440, rarity.toUpperCase(), {
      fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '20px',
      color: `#${colour.toString(16).padStart(6, '0')}`,
    }).setOrigin(0.5).setDepth(61).setAlpha(0);
    label.setLetterSpacing?.(6);
    this.tweens.add({ targets: label, alpha: 1, duration: 250 });

    await this.tween({ targets: prize, angle: { from: -9, to: 9 }, duration: 90, yoyo: true, repeat: rarity === 'common' ? 2 : 4 });
    prize.setAngle(0);

    const halo = this.add.circle(300, 300, 60).setStrokeStyle(3, colour, 1).setDepth(59);
    this.tweens.add({ targets: halo, scale: rarity === 'legendary' ? 5 : 3.2, alpha: 0, duration: 520, ease: 'Cubic.easeOut' });
    prize.parts.outline.setVisible(false);
    this.tweens.add({ targets: prize.parts.top, y: -26, alpha: 0, duration: 380, ease: 'Cubic.easeOut' });
    await this.tween({ targets: prize.parts.bottom, y: 26, alpha: 0, duration: 380, ease: 'Cubic.easeOut' });

    this.time.delayedCall(350, () => {
      this.tweens.add({ targets: [this.veil, label], alpha: 0, duration: 300 });
      this.time.delayedCall(320, () => { prize.destroy(); halo.destroy(); label.destroy(); });
    });
  }
}
