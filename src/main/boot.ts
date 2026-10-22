if (process.argv.includes('--updater'))
    require('./updaterGui').main();
else
    require('./index');
