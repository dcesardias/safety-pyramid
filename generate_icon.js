/**
 * Gera assets/icon.png  (20×20 RGBA) — pirâmide de 5 cores
 * node generate_icon.js
 */
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

const W = 20, H = 20;

// Cores por nível (topo → base)
const COLORS = [
    [183,  28,  28, 255],  // ápice — vermelho escuro
    [230,  74,  25, 255],  // laranja
    [249, 168,  37, 255],  // âmbar
    [ 56, 142,  60, 255],  // verde
    [ 21, 101, 192, 255],  // azul (base)
];

// Pixels RGBA
const pixels = new Uint8Array(W * H * 4); // transparente por padrão

for (let y = 0; y < H; y++) {
    // Meia-largura do triângulo cresce de 0 (topo) a 9 (base)
    const halfW = Math.round(9 * y / (H - 1));
    const left  = 10 - halfW - 1;
    const right = 10 + halfW;

    const levelIdx = Math.min(4, Math.floor(y * 5 / H));
    const [r, g, b, a] = COLORS[levelIdx];

    // Linha de separação entre níveis (pixel mais escuro)
    const isSep = (y > 0 && Math.floor((y-1) * 5 / H) !== levelIdx);

    for (let x = left; x <= right && x < W; x++) {
        const idx = (y * W + x) * 4;
        pixels[idx]   = isSep ? Math.max(0, r - 40) : r;
        pixels[idx+1] = isSep ? Math.max(0, g - 40) : g;
        pixels[idx+2] = isSep ? Math.max(0, b - 40) : b;
        pixels[idx+3] = a;
    }
}

// ── PNG encoding ─────────────────────────────────────────────────────────────
function crc32(buf) {
    const table = [];
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[i] = c >>> 0;
    }
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const lenBuf  = Buffer.alloc(4); lenBuf.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, 'ascii');
    const body    = Buffer.concat([typeBuf, data]);
    const crcBuf  = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(body));
    return Buffer.concat([lenBuf, body, crcBuf]);
}

// Scanlines: 1 byte de filtro (0 = None) + dados RGBA
const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 4)] = 0;
    for (let x = 0; x < W; x++) {
        const src = (y * W + x) * 4;
        const dst = y * (1 + W * 4) + 1 + x * 4;
        raw.set(pixels.subarray(src, src + 4), dst);
    }
}

const idat = zlib.deflateSync(raw, { level: 9 });

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // RGBA
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),  // PNG signature
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, 'assets', 'icon.png');
fs.writeFileSync(out, png);
console.log(`✓ Ícone gerado: ${out}  (${png.length} bytes)`);
