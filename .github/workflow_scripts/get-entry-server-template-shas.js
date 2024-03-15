let fs = require("fs");
let { spawnSync } = require("child_process");
let { createHash } = require("crypto");

let results = {};

function hash(entryServerPath, commitId) {
  let entryServerContents = fs.readFileSync(entryServerPath, "utf8");
  let sha = createHash("sha256").update(entryServerContents).digest("hex");

  if (!results[sha]) {
    results[sha] = {
      templates: [],
      commits: [],
    };
  }

  if (!results[sha].templates.includes(entryServerPath)) {
    results[sha].templates.push(entryServerPath);
  }
  if (!results[sha].commits.includes(commitId)) {
    results[sha].commits.push(commitId);
  }
}

async function main() {
  let r = spawnSync(
    "git",
    [
      "log",
      '--pretty=format:"%h"',
      "templates/*/app/entry.server.*",
      "packages/remix-dev/config/defaults/entry.server.*",
    ],
    {
      shell: true,
    }
  );
  let commitIds = r.stdout.toString("utf8").trim().split("\n");

  for (let commitId of commitIds) {
    console.log({ commitId });
    spawnSync("git", ["checkout", commitId]);

    // find templates
    for (let template of fs.readdirSync("templates")) {
      // skip dotfiles
      if (template.startsWith(".")) continue;

      let entryServerName = fs
        .readdirSync(`templates/${template}/app`)
        .find((f) => f.startsWith("entry.server."));
      if (!entryServerName) {
        continue;
      }

      let entryServerPath = `templates/${template}/app/${entryServerName}`;
      hash(entryServerPath, commitId);
    }

    // find defaults
    try {
      for (let def of fs.readdirSync("packages/remix-dev/config/defaults")) {
        if (!def.startsWith("entry.server.")) continue;
        hash(`packages/remix-dev/config/defaults/${def}`, commitId);
      }
    } catch (err) {
      // `entry.server` was required at some point, so there were no defaults
      if (err.code !== "ENOENT") throw err;
    }
  }

  console.log(results);
  fs.writeFileSync(
    "entry-server-shas.json",
    JSON.stringify(results, null, 2) + "\n"
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
