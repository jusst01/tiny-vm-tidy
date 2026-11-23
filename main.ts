const fs = require('fs');

const IL = new Int8Array(256).fill(-1), POP = new Int8Array(256), PSH = new Int8Array(256);
const op = (c, l, p, u) => { IL[c] = l; POP[c] = p; PSH[c] = u; };
op(0, 0, 0, 0); op(1, 1, 0, 1); op(2, 4, 0, 1); op(3, 0, 1, 0); op(4, 0, 1, 2); op(5, 0, 2, 2); op(6, 0, 2, 3); op(7, 0, 3, 3);
for (const c of [16, 17, 18, 19, 20, 21, 22, 24, 25, 26, 28, 29, 30, 32, 33, 34]) op(c, 0, 2, 1);
op(23, 0, 1, 1); op(27, 0, 1, 1);
op(48, 2, 0, 0); op(49, 2, 1, 0); op(50, 2, 1, 0); op(51, 2, 0, 0); op(52, 0, 0, 0);
op(64, 0, 1, 1); op(65, 0, 2, 0);
op(80, 0, 1, 0); op(81, 0, 1, 0); op(82, 0, 0, 1); op(83, 0, 1, 0);

function run(prog, input) {
  const n = prog.length, D = new Int32Array(256), M = new Int32Array(256), C = [], chunks = [];
  let sp = 0, ob = 0, ip = 0, pc = 0, st = 0, x = null;
  while (x === null) {
    if (st >= 1000000) { x = 10; continue; }
    if (pc < 0 || pc >= n) { x = 9; continue; }
    const o = prog[pc], l = IL[o];
    if (l < 0) { x = 5; continue; }
    if (pc + l >= n) { x = 9; continue; }
    st++;
    if (sp < POP[o]) { x = 2; continue; }
    if (sp - POP[o] + PSH[o] > 256) { x = 3; continue; }
    const q = pc + 1 + l;
    pc = q;
    if (o === 0) { x = 0; }
    else if (o === 1) { const v = prog[q - 1]; D[sp++] = v & 128 ? v - 256 : v; }
    else if (o === 2) { D[sp++] = prog[q - 4] | prog[q - 3] << 8 | prog[q - 2] << 16 | prog[q - 1] << 24; }
    else if (o === 3) { sp--; }
    else if (o === 4) { D[sp] = D[sp - 1]; sp++; }
    else if (o === 5) { const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; }
    else if (o === 6) { D[sp] = D[sp - 2]; sp++; }
    else if (o === 7) { const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a; }
    else if (o >= 16 && o <= 34) {
      if (o === 23 || o === 27) { D[sp - 1] = o === 27 ? ~D[sp - 1] : -D[sp - 1] | 0; }
      else {
        const b = D[--sp], a = D[--sp];
        let r = 0;
        switch (o) {
          case 16: r = a + b | 0; break;
          case 17: r = a - b | 0; break;
          case 18: r = Math.imul(a, b); break;
          case 19: if (b === 0) x = 4; else r = a === -2147483648 && b === -1 ? -2147483648 : (a / b) | 0; break;
          case 20: if (b === 0) x = 4; else r = (a % b) | 0; break;
          case 21: if (b === 0) x = 4; else r = ((a >>> 0) / (b >>> 0)) | 0; break;
          case 22: if (b === 0) x = 4; else r = ((a >>> 0) % (b >>> 0)) | 0; break;
          case 24: r = a & b; break;
          case 25: r = a | b; break;
          case 26: r = a ^ b; break;
          case 28: r = a << (b & 31); break;
          case 29: r = a >> (b & 31); break;
          case 30: r = (a >>> (b & 31)) | 0; break;
          case 32: r = a === b ? 1 : 0; break;
          case 33: r = a < b ? 1 : 0; break;
          case 34: r = (a >>> 0) < (b >>> 0) ? 1 : 0; break;
        }
        if (x === null) D[sp++] = r;
      }
    }
    else if (o === 48) { pc = q + ((prog[q - 2] | prog[q - 1] << 8) << 16 >> 16); }
    else if (o === 49 || o === 50) {
      const f = (prog[q - 2] | prog[q - 1] << 8) << 16 >> 16;
      const v = D[--sp];
      if (o === 49 ? v === 0 : v !== 0) pc = q + f;
    }
    else if (o === 51) { if (C.length >= 64) x = 7; else { C.push(q); pc = prog[q - 2] | prog[q - 1] << 8; } }
    else if (o === 52) { if (C.length === 0) x = 8; else pc = C.pop(); }
    else if (o === 64) { const a = D[sp - 1]; if (a < 0 || a > 255) x = 6; else D[sp - 1] = M[a]; }
    else if (o === 65) { const a = D[sp - 1]; if (a < 0 || a > 255) x = 6; else { M[a] = D[sp - 2]; sp -= 2; } }
    else if (o === 80) { const s = '' + D[sp - 1]; if (ob + s.length > 65536) x = 11; else { chunks.push(Buffer.from(s, 'ascii')); ob += s.length; sp--; } }
    else if (o === 81) { if (ob >= 65536) x = 11; else { chunks.push(Buffer.from([D[sp - 1] & 255])); ob++; sp--; } }
    else if (o === 82) { D[sp++] = ip < input.length ? input[ip++] : -1; }
    else if (o === 83) { x = D[sp - 1] & 255; sp--; }
  }
  return { out: Buffer.concat(chunks), code: x };
}

function main() {
  const i = process.env.MAKEFUN_INPUT_DIR || '/input', o = process.env.MAKEFUN_OUTPUT_DIR || '/output';
  for (const id of fs.readdirSync(i, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const r = run(fs.readFileSync(i + '/' + id + '/program.bin'), fs.readFileSync(i + '/' + id + '/input.bin')), d = o + '/' + id;
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(d + '/stdout.bin', r.out);
    fs.writeFileSync(d + '/exit.txt', r.code + '\n');
  }
}

main();
