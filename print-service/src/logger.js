'use strict';

function write(level, scope, message, details) {
  const suffix = details === undefined ? '' : ` ${typeof details === 'string' ? details : JSON.stringify(details)}`;
  const line = `${new Date().toISOString()} [${scope}] ${message}${suffix}`;
  (level === 'error' ? console.error : console.log)(line);
}

module.exports = {
  info: (scope, message, details) => write('info', scope, message, details),
  error: (scope, message, details) => write('error', scope, message, details),
};

