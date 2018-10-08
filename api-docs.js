const exec = require('child_process').execSync;
const exists = require('fs').existsSync;
const resolve = require('path').resolve;
const cwd = process.cwd();

const [core, rpc] = [
    resolve(`${cwd}/../core`),
    resolve(`${cwd}/../rpc`)
];
const [pkgCore, pkgRpc] = [
    require(`${core}/package.json`),
    require(`${rpc}/package.json`)
];

exec(`cd ${core} && npm run doc`);
exec(`cd ${rpc} && npm run doc`);
if (!exists(`${cwd}/api/core/${pkgCore.version}`)) {
    exec(`mkdir ${cwd}/api/core/${pkgCore.version}`);
}
if (!exists(`${cwd}/api/rpc/${pkgRpc.version}`)) {
    exec(`mkdir ${cwd}/api/rpc/${pkgRpc.version}`);
}
exec(`cp -r ${core}/docs/* ${cwd}/api/core/${pkgCore.version}`);
exec(`cp -r ${rpc}/docs/* ${cwd}/api/rpc/${pkgRpc.version}`);
console.log('Done!');