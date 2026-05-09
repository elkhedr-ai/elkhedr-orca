#!/usr/bin/env node
const { orchestrate } = require('./core.js');

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length > 0) {
        orchestrate(args.join(' ')).then(console.log);
    } else {
        const { interactiveSession } = require('./tui.js');
        interactiveSession().catch(console.error);
    }
}

module.exports = { orchestrate };
