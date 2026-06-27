"use strict";

const path = require("node:path");
const Mocha = require("mocha");

async function run() {
  const mocha = new Mocha({
    color: true,
    timeout: 180000,
    ui: "tdd",
  });

  mocha.addFile(path.resolve(__dirname, "tag-bench.test.cjs"));

  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} test(s) failed`));
        return;
      }
      resolve();
    });
  });
}

module.exports = { run };
