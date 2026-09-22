export class RealClock {
  now() { return new Date(); }
  async sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
}

export class VirtualClock {
  constructor(start = '2026-01-01T00:00:00.000Z') {
    this.current = new Date(start);
    if (Number.isNaN(this.current.getTime())) throw new Error('VirtualClock start must be a valid date.');
    this.queue = [];
  }

  now() { return new Date(this.current); }

  schedule(delayMs, callback, label = 'scheduled') {
    if (!Number.isFinite(delayMs) || delayMs < 0 || typeof callback !== 'function') throw new Error('Invalid virtual schedule.');
    const item = { at: this.current.getTime() + delayMs, callback, label, sequence: this.queue.length + 1 };
    this.queue.push(item);
    this.queue.sort((a, b) => a.at - b.at || a.sequence - b.sequence);
    return item;
  }

  advanceBy(hours) { return this.advanceTo(new Date(this.current.getTime() + (Number(hours) * 3600000))); }

  advanceTo(target) {
    const end = new Date(target);
    if (Number.isNaN(end.getTime()) || end < this.current) throw new Error('VirtualClock cannot move backwards.');
    while (this.queue[0] && this.queue[0].at <= end.getTime()) {
      const item = this.queue.shift();
      this.current = new Date(item.at);
      item.callback(this.now(), item.label);
    }
    this.current = end;
    return this.now();
  }

  runUntilIdle() {
    while (this.queue[0]) this.advanceTo(new Date(this.queue[0].at));
    return this.now();
  }
}
