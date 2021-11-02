import { getInput } from '@actions/core';
import { exec } from 'child_process';
import { fetch } from 'cross-fetch';

(async () => {
  try {
    const urlPrefix = getInput('url-prefix', { required: true });
    const zoneID = getInput('zone-id', { required: true });

    const apiToken = getInput('api-token');
    const apiKey = getInput('api-key');
    const email = getInput('email');

    if (!apiToken && (!apiKey || !email)) {
      throw('either the API Token or API Key and Email are required for auth')
    }

    const fromCommit = getInput('from-commit') || 'HEAD~1';
    const toCommit = getInput('to-commit') || 'HEAD';
    const gitPath = process.env.GITHUB_WORKSPACE || '.';

    const diffFiles: String[] = await new Promise((resolve, reject) => {
      exec(`git diff --name-only ${fromCommit} ${toCommit}`, { cwd: gitPath },
        (error, stdout, stderr) => {
          if (error) {
            reject('exec error:' + error.message)
          }
          if (stderr) {
            reject('error running git diff: ' + stderr);
          }

          const diffFiles = stdout.split('\n').filter((x) => x.length)
          resolve(diffFiles);
        }
      );
    })

    const fileURLs: string[] = diffFiles.map(filePath => {
      console.log(filePath);
      return (urlPrefix.endsWith('/') ? urlPrefix : urlPrefix + '/') + filePath.replace('public/', ''); // Remove public prefix
    })
    console.log("Changed files:", JSON.stringify(fileURLs, null, 2));

    const chunks = chunk(fileURLs, 30);
    const requests = chunks.map((chunk) => {
      return fetch(`https://api.cloudflare.com/client/v4/zones/${zoneID}/purge_cache`, {
        method: 'POST',
        headers: Object.assign({
          'Content-Type': 'application/json',
        }, (apiToken ?
          { 'Authorization': `Bearer ${apiToken}` } :
          {
            'X-Auth-Key': apiKey,
            'X-Auth-Email': email,
          })
        ),
        redirect: 'follow',
        body: JSON.stringify({'files': chunk}),
      })
    })
    for (let i = 0; i < requests.length; i++) {
      const resp = await requests[i];
      if (resp.status !== 200) {
        throw(`CF response code ${resp.status}, body: ${await resp.text()}`)
      }
    }
  } catch (error) {
    console.error('Error: ', error);
    process.exit(1);
  }
})()

function chunk<T>(arr: T[], max: number): T[][] {
  var chunks = [];
  while (arr.length > max) {
    chunks = [...chunks, arr.slice(0, max)];
    arr = arr.slice(max);
  }
  if (arr.length != 0) {
    chunks = [...chunks, arr];
  }
  return chunks;
}
