const path = require("path");
const fs = require("fs");
const archiver = require("archiver");

const outputPath = path.join(__dirname, "kaun-karega-website.zip");
const output = fs.createWriteStream(outputPath);
const archive = archiver("zip", { zlib: { level: 9 } });

output.on("close", () => {
  console.log("ZIP created successfully:", `${archive.pointer()} total bytes`);
});

archive.on("warning", (err) => {
  if (err.code === "ENOENT") {
    console.warn(err.message);
  } else {
    throw err;
  }
});

archive.on("error", (err) => {
  throw err;
});

archive.pipe(output);

archive.glob("**/*", {
  ignore: ["node_modules/**", ".next/**", "kaun-karega-website.zip"],
});

archive.finalize();