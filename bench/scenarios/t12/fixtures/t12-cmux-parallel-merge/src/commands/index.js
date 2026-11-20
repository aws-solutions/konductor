'use strict';

// Every command of the CLI, by name. A command is (args, store) => the text it prints.
module.exports = {
  add: require('./add.js'),
  list: require('./list.js'),
  done: require('./done.js'),
};
