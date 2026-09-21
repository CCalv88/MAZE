# Deploys MAZE to the stegopets droplet and installs it as a tab on the homepage.
# Uploads the release to /tmp/maze-release, runs deploy/setup.sh as root, then checks
# the live URLs. Safe to re-run; it also serves as the update script.
$ErrorActionPreference = 'Stop'
$remoteHost = 'root@178.62.127.10'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

Write-Output '--- local tests ---'
npm test --silent
if ($LASTEXITCODE -ne 0) { throw 'tests failed; not deploying' }

Write-Output '--- upload ---'
ssh $remoteHost 'rm -rf /tmp/maze-release && mkdir -p /tmp/maze-release/deploy'
scp -r server.js core.js index.html package.json package-lock.json js css "${remoteHost}:/tmp/maze-release/"
scp deploy/maze.service deploy/caddy-maze.conf deploy/setup.sh "${remoteHost}:/tmp/maze-release/deploy/"

Write-Output '--- remote setup ---'
ssh $remoteHost 'bash /tmp/maze-release/deploy/setup.sh'
if ($LASTEXITCODE -ne 0) { throw 'remote setup failed' }

Write-Output '--- live relay check ---'
node deploy/test-live.js
if ($LASTEXITCODE -ne 0) { throw 'live check failed' }
