import { bicubicGray } from "./img.js";
const g = new Float32Array(90 * 80).fill(100);
const o = bicubicGray(g, 90, 80, 103, 92, -0.5);
let mn = 1e9, mx = -1e9;
for (let i = 0; i < o.length; i++) { if (o[i] < mn) mn = o[i]; if (o[i] > mx) mx = o[i]; }
console.log("const range", mn, mx);
