'use strict';

const VERSION = '2.4.0';
const REPORT_HEADER = 'Atlas report';
const COMMANDS = ['check', 'format', 'inspect', 'stats', 'report', 'list'];
const DEFAULT_CONFIG = Object.freeze({ mode: 'safe', color: false, root: '.' });

module.exports = { VERSION, REPORT_HEADER, COMMANDS, DEFAULT_CONFIG };
