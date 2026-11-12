// A flat local frame around the departure airport: east/north metres from an
// origin latitude/longitude. Good for a few hundred kilometres of flying.
export const R_EARTH = 6371008.8;
const RAD = Math.PI / 180;

export class Geo {
  constructor(lat0, lon0) {
    this.lat0 = lat0; this.lon0 = lon0;
    this.cos0 = Math.cos(lat0 * RAD);
  }
  toLocal(lat, lon) {
    return { e: (lon - this.lon0) * RAD * R_EARTH * this.cos0, n: (lat - this.lat0) * RAD * R_EARTH };
  }
  lat(n) { return this.lat0 + n / R_EARTH / RAD; }
  lon(e) { return this.lon0 + e / (R_EARTH * this.cos0) / RAD; }
  // global web-mercator coordinates in [0,1)
  mercX(e) { return (this.lon(e) + 180) / 360; }
  mercY(n) {
    const phi = this.lat(n) * RAD;
    return (1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2;
  }
  // inverse: mercator -> local metres
  eOfMercX(mx) { return (mx * 360 - 180 - this.lon0) * RAD * R_EARTH * this.cos0; }
  nOfMercY(my) {
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) / RAD;
    return (lat - this.lat0) * RAD * R_EARTH;
  }
}
