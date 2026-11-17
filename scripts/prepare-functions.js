const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.join(root, '.firebase-functions');
const files = [
  'functions.js', 'server.js', 'attachments.js', 'security.js', 'validation.js',
  'multipart.js', 'pdfSafety.js', 'browserOptions.js', 'dinasIssuance.js',
  'pdfGenerator.js', 'pdfCutiGenerator.js', 'pdfDinasGenerator.js',
  'repositories/index.js', 'repositories/firestore.js', 'firebase/admin.js',
  'assets/header.png', 'assets/footer.png', 'assets/header_new.png', 'assets/footer_new.png',
];
// Rebuild an allowlisted source directory: no MySQL .env, uploads, private keys,
// db.js, deployment scripts, or unrelated files enter the Firebase source bundle.
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
for (const file of files) {
  const destination = path.join(target, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(root, file), destination);
}
// Only this reviewed, non-secret configuration is read by the Firebase CLI.
fs.copyFileSync(path.join(root, 'firebase/functions.env'), path.join(target, '.env'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const staged = {
  name: 'glink-firebase-functions', version: pkg.version, private: true,
  main: 'functions.js', type: 'commonjs', engines: { node: '22' },
  dependencies: pkg.dependencies,
};
lock.name = staged.name;
lock.packages[''] = { ...lock.packages[''], name: staged.name, engines: staged.engines };
fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify(staged, null, 2) + '\n');
fs.writeFileSync(path.join(target, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
console.log('Firebase source prepared: ' + files.length + ' allowlisted files; MySQL and local secrets excluded.');
