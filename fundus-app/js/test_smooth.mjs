import { readFileSync } from "node:fs";
import { bicubicGray } from "./img.js";
function loadF32(path) {
  const b = readFileSync(path);
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
}
const inp = loadF32("./tmp/smooth_in.raw");
const rb = readFileSync("./tmp/smooth_ref.png");
const { execSync } = await import("node:child_process");
