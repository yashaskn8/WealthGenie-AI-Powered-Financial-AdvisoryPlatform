import axios from 'axios';

export default class MarketDataProvider {
  constructor({ providerName, httpClient = axios, clock = () => new Date() }) {
    if (!providerName) throw new TypeError('providerName is required.');
    this.providerName = providerName;
    this.httpClient = httpClient;
    this.clock = clock;
  }

  nowIso() {
    return this.clock().toISOString();
  }
}
