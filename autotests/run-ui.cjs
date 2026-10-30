// Usage: node autotests/run-ui.cjs <playwright-cli.js> [http://localhost:3002]
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {execFileSync} = require("node:child_process");
const [cliPath, baseUrl = "http://localhost:3002"] = process.argv.slice(2);
if (!cliPath) throw new Error("Укажите путь к playwright-cli.js из установленного @playwright/cli.");
const origin = new URL(baseUrl).origin;
const code = require("./ui-party-settings.cjs").toString().replace(JSON.stringify("__BASE_URL__"), JSON.stringify(origin));
const outputDir = process.env.CITADELS_TEST_OUTPUT
    ? path.resolve(process.env.CITADELS_TEST_OUTPUT)
    : fs.mkdtempSync(path.join(os.tmpdir(), "citadels-run-ui-"));
fs.mkdirSync(outputDir, {recursive: true});
console.log("Test artifacts: " + outputDir);
const session = "citadels-ui-" + Date.now();
const cli = (...args) => {
    try {
        return execFileSync(process.execPath, [path.resolve(cliPath), "-s=" + session, ...args],
            {cwd: outputDir, encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024});
    } catch (error) {
        throw new Error(error.stdout || error.stderr || "Не удалось запустить Playwright CLI.");
    }
};
try {
    cli("open", "about:blank");
    const result = cli("run-code", code);
    const summary = result.split("### Ran Playwright code")[0];
    process.stdout.write(summary);
    fs.writeFileSync(path.join(outputDir, "party-settings-result.txt"), result);
    // The CLI prints browser-code exceptions but may still exit successfully.
    if (!summary.includes("CASE 1 PASS") || !summary.includes("CASE 2 PASS"))
        throw new Error("Один из двух браузерных сценариев не завершился успешно.");
} finally {
    cli("close");
}
