const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'test-fixture/performance-test');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const packages = {};
for (let i = 0; i < 500; i++) {
  packages[`node_modules/pkg-${i}`] = {
    version: '1.0.0',
    resolved: `https://registry.npmjs.org/pkg-${i}/-/pkg-${i}-1.0.0.tgz`
  };
}

// Add some known vulnerable ones too
packages["node_modules/express"] = { version: "4.17.1" };
packages["node_modules/lodash"] = { version: "4.17.20" };

const lockfile = {
  name: "performance-test",
  version: "1.0.0",
  lockfileVersion: 3,
  packages
};

fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(lockfile, null, 2));
console.log('Created performance-test/package-lock.json with 500+ packages');
