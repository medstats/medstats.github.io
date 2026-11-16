import { bilinearRGB } from "./img.js";
const a = new Uint8Array(100 * 100 * 3);
for (let y = 0; y < 100; y++) for (let x = 50; x < 100; x++) { const i = (y * 100 + x) * 3; a[i] = a[i + 1] = a[i + 2] = 255; }
const o = bilinearRGB(a, 100, 100, 17, 17);
const row = [];
for (let x = 0; x < 17; x++) row.push(o[(8 * 17 + x) * 3]);
console.log("mine", row.join(" "));
