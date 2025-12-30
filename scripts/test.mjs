import { spawn, spawnSync } from "node:child_process";

const testCommand = "vitest run";

const run = (command, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: "inherit",
      ...options
    });

    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed: ${command}`));
    });
  });

const isCommandAvailable = (command) => {
  const checker = process.platform === "win32" ? "where" : "which";
  const res = spawnSync(checker, [command], { stdio: "ignore" });
  return res.status === 0;
};

const shouldUseXvfb =
  process.platform === "linux" && !process.env.DISPLAY && isCommandAvailable("xvfb-run");

const maybeWrapWithXvfb = (command) => {
  if (!shouldUseXvfb) return command;
  return `xvfb-run --auto-servernum --server-args='-screen 0 1280x720x24' ${command}`;
};

try {
  await run("node scripts/build.mjs");
  await run(maybeWrapWithXvfb(testCommand));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
