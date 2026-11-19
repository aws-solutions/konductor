class Scheduler {
  constructor(onRun) {
    this.onRun = onRun;
    this.timer = null;
    this.running = false;
  }

  start(delayMs = 0) {
    if (this.running) return false;
    this.running = true;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.running = false;
      this.onRun();
    }, delayMs);
    return true;
  }

  stop() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.running = false;
  }

  isRunning() {
    return this.running;
  }
}

module.exports = { Scheduler };
