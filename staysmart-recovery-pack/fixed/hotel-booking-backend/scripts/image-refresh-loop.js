/**
 * Runs the photo pipeline in the background, then keeps growing the photo
 * pool once an hour (Unsplash allows 50 API calls/hour) so representative
 * photos repeat less and less. Each round re-assigns photos and self-hosts any
 * new Wikimedia images.
 *
 * Usage: node scripts/image-refresh-loop.js [rounds=6]
 */
const { spawnSync } = require("child_process");
const path = require("path");

const rounds = Number(process.argv[2] || 6);
const script = path.join(__dirname, "fetch-hotel-images.js");
const run = (...stages) => {
  console.log(`\n[${new Date().toLocaleTimeString()}] stages: ${stages.join(" ")}`);
  spawnSync(process.execPath, [script, ...stages], { stdio: "inherit", env: process.env });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  run("media", "commons", "assign", "media");
  for (let i = 1; i <= rounds; i += 1) {
    console.log(`\n[${new Date().toLocaleTimeString()}] waiting an hour for the Unsplash quota (round ${i}/${rounds})`);
    await sleep(62 * 60 * 1000);
    run("pool", "assign", "media");
  }
  console.log("\nimage refresh loop finished");
})();
