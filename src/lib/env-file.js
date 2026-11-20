'use strict';

const fs = require('node:fs');

/**
 * Load a small, dependency-free .env file.
 *
 * Existing process environment variables always win, matching the behaviour of
 * common Node.js dotenv implementations. Values are not interpolated.
 *
 * @returns {string[]} names of variables that were added
 */
function loadEnvFile(filePath, options = {}) {
  const env = options.env || process.env;
  let source;

  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  if (source.charCodeAt(0) === 0xfeff) {
    source = source.slice(1);
  }

  const loaded = [];

  source.split(/\r?\n/).forEach((rawLine, index) => {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      return;
    }

    if (line.startsWith('export ')) {
      line = line.slice(7).trim();
    }

    const separator = line.indexOf('=');
    if (separator <= 0) {
      throw new Error(`Invalid .env entry at ${filePath}:${index + 1}`);
    }

    const name = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`Invalid .env variable name at ${filePath}:${index + 1}`);
    }

    let value = line.slice(separator + 1).trim();
    const quote = value[0];

    if (quote === '"' || quote === "'") {
      const quoted = new RegExp(
        `^${quote}([\\s\\S]*)${quote}\\s*(?:#.*)?$`,
      ).exec(value);
      if (!quoted) {
        throw new Error(`Unclosed quoted value at ${filePath}:${index + 1}`);
      }

      // Quote characters are removed, but the content is kept literally. This
      // keeps Windows paths such as C:\temp\tasks.json intact.
      value = quoted[1];
    } else {
      // Allow inline comments such as: PORT=3000 # local port
      const comment = value.search(/\s#/);
      if (comment !== -1) {
        value = value.slice(0, comment).trim();
      }
    }

    if (!Object.prototype.hasOwnProperty.call(env, name)) {
      env[name] = value;
      loaded.push(name);
    }
  });

  return loaded;
}

module.exports = { loadEnvFile };
