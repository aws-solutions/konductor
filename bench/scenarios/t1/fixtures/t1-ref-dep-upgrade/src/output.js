function writeLines(lines, write = process.stdout.write.bind(process.stdout)) {
  write(lines.filter((line) => line !== undefined).join('\n'));
}

module.exports = { writeLines };
