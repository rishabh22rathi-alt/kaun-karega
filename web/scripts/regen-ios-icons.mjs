import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SOURCE = path.join(ROOT, "public", "icons", "icon-512-v2.png");
const APPLE_ICON = path.join(ROOT, "app", "apple-icon.png");
const ICON = path.join(ROOT, "app", "icon.png");
const FAVICON = path.join(ROOT, "app", "favicon.ico");

const source = await readFile(SOURCE);

await sharp(source)
  .resize(180, 180, { fit: "cover" })
  .png({ compressionLevel: 9 })
  .toFile(APPLE_ICON);

await sharp(source)
  .resize(512, 512, { fit: "cover" })
  .png({ compressionLevel: 9 })
  .toFile(ICON);

const FAVICON_SIZES = [16, 32, 48];
const pngs = await Promise.all(
  FAVICON_SIZES.map((size) =>
    sharp(source)
      .resize(size, size, { fit: "cover" })
      .png({ compressionLevel: 9 })
      .toBuffer()
  )
);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(FAVICON_SIZES.length, 4);

const dirEntries = [];
let dataOffset = 6 + 16 * FAVICON_SIZES.length;
for (let i = 0; i < FAVICON_SIZES.length; i++) {
  const size = FAVICON_SIZES[i];
  const png = pngs[i];
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size === 256 ? 0 : size, 0);
  entry.writeUInt8(size === 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(dataOffset, 12);
  dirEntries.push(entry);
  dataOffset += png.length;
}

const ico = Buffer.concat([header, ...dirEntries, ...pngs]);
await writeFile(FAVICON, ico);

const fmt = (label, buf) => `  ${label}: ${buf.length} bytes`;
const appleBuf = await readFile(APPLE_ICON);
const iconBuf = await readFile(ICON);
const favBuf = await readFile(FAVICON);
console.log("Regenerated:");
console.log(fmt("apple-icon.png (180x180)", appleBuf));
console.log(fmt("icon.png (512x512)", iconBuf));
console.log(fmt(`favicon.ico (multi-res ${FAVICON_SIZES.join(",")})`, favBuf));
