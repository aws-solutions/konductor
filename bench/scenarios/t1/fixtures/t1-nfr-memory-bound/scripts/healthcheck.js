const major = Number(process.versions.node.split('.')[0]);
if (major < 24) {
  console.error('Node.js 24 or newer is required');
  process.exitCode = 1;
} else {
  console.log('ok');
}
