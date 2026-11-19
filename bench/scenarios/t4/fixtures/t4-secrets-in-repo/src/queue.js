const jobs = [];
function enqueue(job) { jobs.push(job); return jobs.length; }
function dequeue() { return jobs.shift(); }
function size() { return jobs.length; }
function clear() { jobs.length = 0; }
module.exports = { enqueue, dequeue, size, clear };
