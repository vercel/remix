const fs = require("fs");
const path = require("path");

module.exports = async ({ github, context }, versionPostfix) => {
  const packagesDir = path.join(__dirname, "..", "..", "packages");
  const devPackageJSONPath = path.join(
    packagesDir,
    "remix-dev",
    "package.json"
  );
  const vercelPackageJSONPath = path.join(
    packagesDir,
    "vercel-remix",
    "package.json"
  );

  const devPackageJSON = JSON.parse(
    fs.readFileSync(devPackageJSONPath, "utf-8")
  );

  devPackageJSON.name = "@vercel/remix-run-dev";

  if (versionPostfix !== "") {
    if (!/[a-z]+\.\d+/.test(versionPostfix)) {
      throw new Error(
        `version-postfix, '${versionPostfix}', is invalid. Must be a word and a number seperated by a '.' character. Example: 'patch.1'`
      );
    }
    devPackageJSON.version = `${devPackageJSON.version}-${versionPostfix}`;

    const vercelPackageJSON = JSON.parse(
      fs.readFileSync(vercelPackageJSONPath, "utf-8")
    );
    vercelPackageJSON.version = `${vercelPackageJSON.version}-${versionPostfix}`;
    fs.writeFileSync(
      vercelPackageJSONPath,
      JSON.stringify(vercelPackageJSON, null, 2) + "\n"
    );
  }

  fs.writeFileSync(
    devPackageJSONPath,
    JSON.stringify(devPackageJSON, null, 2) + "\n"
  );

  return devPackageJSON.version;
};
