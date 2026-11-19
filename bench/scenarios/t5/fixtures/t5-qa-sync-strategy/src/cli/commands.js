const { loadConfig } = require('../config');
const { makePlan } = require('../migration/plan');

async function runCommand(args, io = console) {
  const command = args[0] || 'help';
  if (command === 'plan') {
    const plan = makePlan({ sourceCount: Number(args[1] || 0), batchSize: loadConfig().batchSize });
    io.log(JSON.stringify(plan));
    return plan;
  }
  if (command === 'help') { io.log('commands: plan, migrate, resume, verify'); return null; }
  throw new Error(`unknown command: ${command}`);
}
module.exports = { runCommand };
