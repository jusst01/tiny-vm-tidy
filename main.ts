'use strict';
const fs = require('fs');
const path = require('path');

// Per-opcode tables built once at load: immediate length (bytes), pops, pushes.
// An immediate length of -1 marks a byte that is not an opcode at all.
const IL = new Int8Array(256).fill(-1);
const POP = new Int8Array(256);
const PSH = new Int8Array(256);
function op(code, il, pops, pushes) {
  IL[code] = il; POP[code] = pops; PSH[code] = pushes;
}
op(0x00, 0, 0, 0); op(0x01, 1, 0, 1); op(0x02, 4, 0, 1);
op(0x03, 0, 1, 0); op(0x04, 0, 1, 2); op(0x05, 0, 2, 2);
op(0x06, 0, 2, 3); op(0x07, 0, 3, 3);
const BIN = [0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x18, 0x19, 0x1a,
  0x1c, 0x1d, 0x1e, 0x20, 0x21, 0x22];
for (const c of BIN) op(c, 0, 2, 1);
op(0x17, 0, 1, 1); // NEG, unary
op(0x1b, 0, 1, 1); // NOT, unary
op(0x30, 2, 0, 0); op(0x31, 2, 1, 0); op(0x32, 2, 1, 0);
op(0x33, 2, 0, 0); op(0x34, 0, 0, 0);
op(0x40, 0, 1, 1); op(0x41, 0, 2, 0);
op(0x50, 0, 1, 0); op(0x51, 0, 1, 0); op(0x52, 0, 0, 1); op(0x53, 0, 1, 0);

function run(prog, input) {
  const plen = prog.length;
  const stk = new Int32Array(256); // data stack, top at stk[sp-1]
  const mem = new Int32Array(256);
  const calls = [];               // return addresses
  const chunks = [];              // output fragments, joined at the end
  let sp = 0, outBytes = 0, inPos = 0, pc = 0, steps = 0;
  let exit = null;                // null while running; code once set

  while (exit === null) {
    if (steps >= 1000000) { exit = 10; continue; }
    if (pc < 0 || pc >= plen) { exit = 9; continue; }
    const opc = prog[pc];
    const il = IL[opc];
    if (il === -1) { exit = 5; continue; }
    if (pc + il >= plen) { exit = 9; continue; }
    steps++;

    const pops = POP[opc];
    if (sp < pops) { exit = 2; continue; }
    if (sp - pops + PSH[opc] > 256) { exit = 3; continue; }

    if (opc === 0x00) {
      exit = 0;
    } else if (opc === 0x01) {
      const v = prog[pc + 1];
      stk[sp++] = v & 0x80 ? v - 0x100 : v;
      pc += 2;
    } else if (opc === 0x02) {
      stk[sp++] = prog[pc + 1] | (prog[pc + 2] << 8) |
        (prog[pc + 3] << 16) | (prog[pc + 4] << 24);
      pc += 5;
    } else if (opc === 0x03) {
      sp--; pc++;
    } else if (opc === 0x04) {
      stk[sp] = stk[sp - 1]; sp++; pc++;
    } else if (opc === 0x05) {
      const t = stk[sp - 1]; stk[sp - 1] = stk[sp - 2]; stk[sp - 2] = t; pc++;
    } else if (opc === 0x06) {
      stk[sp] = stk[sp - 2]; sp++; pc++;
    } else if (opc === 0x07) {
      const a = stk[sp - 3];
      stk[sp - 3] = stk[sp - 2]; stk[sp - 2] = stk[sp - 1]; stk[sp - 1] = a;
      pc++;
    } else if (opc >= 0x10 && opc <= 0x22) {
      if (opc === 0x1b || opc === 0x17) {
        stk[sp - 1] = opc === 0x1b ? ~stk[sp - 1] : (-stk[sp - 1]) | 0;
      } else {
        const b = stk[--sp], a = stk[--sp];
        let r = 0;
        switch (opc) {
          case 0x10: r = (a + b) | 0; break;
          case 0x11: r = (a - b) | 0; break;
          case 0x12: r = Math.imul(a, b); break;
          case 0x13: if (b === 0) exit = 4;
            else r = a === -2147483648 && b === -1 ? -2147483648 : (a / b) | 0;
            break;
          case 0x14: if (b === 0) exit = 4; else r = (a % b) | 0; break;
          case 0x15: if (b === 0) exit = 4; else r = ((a >>> 0) / (b >>> 0)) | 0; break;
          case 0x16: if (b === 0) exit = 4; else r = ((a >>> 0) % (b >>> 0)) | 0; break;
          case 0x18: r = a & b; break;
          case 0x19: r = a | b; break;
          case 0x1a: r = a ^ b; break;
          case 0x1c: r = a << (b & 31); break;
          case 0x1d: r = a >> (b & 31); break;
          case 0x1e: r = (a >>> (b & 31)) | 0; break;
          case 0x20: r = a === b ? 1 : 0; break;
          case 0x21: r = a < b ? 1 : 0; break;
          case 0x22: r = (a >>> 0) < (b >>> 0) ? 1 : 0; break;
        }
        if (exit === null) stk[sp++] = r;
      }
      pc++;
    } else if (opc === 0x30) {
      let off = prog[pc + 1] | (prog[pc + 2] << 8);
      if (off & 0x8000) off -= 0x10000;
      pc = pc + 3 + off;
    } else if (opc === 0x31 || opc === 0x32) {
      let off = prog[pc + 1] | (prog[pc + 2] << 8);
      if (off & 0x8000) off -= 0x10000;
      const v = stk[--sp];
      const take = opc === 0x31 ? v === 0 : v !== 0;
      pc = take ? pc + 3 + off : pc + 3;
    } else if (opc === 0x33) {
      if (calls.length >= 64) { exit = 7; }
      else { calls.push(pc + 3); pc = prog[pc + 1] | (prog[pc + 2] << 8); }
    } else if (opc === 0x34) {
      if (calls.length === 0) { exit = 8; } else { pc = calls.pop(); }
    } else if (opc === 0x40) {
      const addr = stk[sp - 1];
      if (addr < 0 || addr > 255) { exit = 6; } else { stk[sp - 1] = mem[addr]; pc++; }
    } else if (opc === 0x41) {
      const addr = stk[sp - 1];
      if (addr < 0 || addr > 255) { exit = 6; }
      else { mem[addr] = stk[sp - 2]; sp -= 2; pc++; }
    } else if (opc === 0x50) {
      const s = '' + stk[sp - 1];
      if (outBytes + s.length > 65536) { exit = 11; }
      else { chunks.push(Buffer.from(s, 'ascii')); outBytes += s.length; sp--; pc++; }
    } else if (opc === 0x51) {
      if (outBytes >= 65536) { exit = 11; }
      else { chunks.push(Buffer.from([stk[sp - 1] & 255])); outBytes++; sp--; pc++; }
    } else if (opc === 0x52) {
      stk[sp++] = inPos < input.length ? input[inPos++] : -1; pc++;
    } else if (opc === 0x53) {
      exit = stk[sp - 1] & 255; sp--;
    }
  }

  return { out: Buffer.concat(chunks), code: exit };
}

function main() {
  const inDir = process.env.MAKEFUN_INPUT_DIR || '/input';
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
  const ids = fs.readdirSync(inDir, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const id of ids) {
    const prog = fs.readFileSync(path.join(inDir, id, 'program.bin'));
    const input = fs.readFileSync(path.join(inDir, id, 'input.bin'));
    const res = run(prog, input);
    const od = path.join(outDir, id);
    fs.mkdirSync(od, { recursive: true });
    fs.writeFileSync(path.join(od, 'stdout.bin'), res.out);
    fs.writeFileSync(path.join(od, 'exit.txt'), res.code + '\n');
  }
}

main();
