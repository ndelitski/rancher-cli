import {info, debug, error} from './log';
import {Command} from 'commander';
import Rancher from './rancher';
import assert from 'assert';
import prompt from './prompt';
import Config from './config';
import {pick} from 'lodash';
import stringTable from 'string-table';
import {json} from './helpers';

Command.prototype.actionAsync = function (fnAsync) {
  return this.action((...args) => {
    fnAsync(...args)
      .catch((err) => {
        error(`Failed to execute programm action ${fnAsync.name || ''}: ${err}`);
        error(err);
        error(err.stack);
        process.exit(1);
      });
  });
}

const program = new Command();

const {
  RANCHER_ACCESS_KEY,
  CATTLE_ACCESS_KEY,
  RANCHER_SECRET_KEY,
  CATTLE_SECRET_KEY,
  RANCHER_PROJECT,
  RANCHER_ADDRESS
} = process.env;

const configFile = new Config();

program
  .version('0.0.1')
  .option('--access-key [accessKey]', 'Rancher API access key', RANCHER_ACCESS_KEY || CATTLE_ACCESS_KEY)
  .option('--secret-key [secretKey]', 'Rancher API secret key', RANCHER_SECRET_KEY || CATTLE_SECRET_KEY)
  .option('--projectId [projectId]', 'Id of Rancher project', RANCHER_PROJECT)
  .option('-u, --url [url]', 'Rancher url to project API', RANCHER_ADDRESS);

program
  .command('init')
  .description('Init Rancher CLI')
  .actionAsync(async () => {
    const validate = (v) => !!v;
    const {url, accessKey, secretKey, profileName} = await prompt([{
      type: 'input',
      name: 'url',
      message: 'Rancher public url (ex: rancher.domain.com):',
      validate
    }, {
      type: 'input',
      name: 'accessKey',
      message: 'Rancher API access key:',
      validate
    }, {
      type: 'input',
      name: 'secretKey',
      message: 'Rancher API secret key:',
      validate
    }, {
      type: 'input',
      name: 'profileName',
      message: 'Name of Rancher profile settings(ex: local, production):',
      validate
    }]);

    const client = new Rancher({address: url, auth: {secretKey, accessKey}});
    let projectName, projectId;

    try {
      const visibleProjects = await client.getProjects();
      projectName = visibleProjects[0].name;
      projectId = visibleProjects[0].id;
    } catch (err) {
      error(json`invalid data, response from rancher:\n${err.response}`);
      process.exit(1);
    }

    //let profile;
    //if (!configFile.profile()) {
    //  profile = `${url}@${projectId}`;
    //}

    configFile.save({url, accessKey, secretKey, project: {name: projectName, id: projectId}, profileName});
  });

program
  .command('profile')
  .alias('switch')
  .alias('sw')
  .description('Select Rancher CLI profile')
  .actionAsync(async () => {
    const profiles = Object.keys(configFile.load().profiles);
    const {selected} = await prompt([{
      type: "list",
      name: "selected",
      message: "Select profile",
      choices: profiles
    }]);

    configFile.save({profileName: selected});
    info(`you selected ${selected} profile`);
  });

program.parse(process.argv);

function client() {
  let {
    accessKey,
    secretKey,
    projectId,
    url
    } = program;

  const config = configFile.profile();
  if (config) {
    accessKey || (accessKey = config.auth.accessKey);
    secretKey || (secretKey = config.auth.secretKey);
    url || (url = config.url);
    projectId || (projectId = config.project.id);
  }

  return new Rancher({address: url, projectId, auth: {secretKey, accessKey}});
}

program
  .option('-r, --rancher <path>', 'Path to `rancher-compose` file')
  .option('-f, --file <path>', 'Path to `docker-compose` file');

program
  .command('scale <stack> <service> <scale>')
  .description('Setup scale for service')
  .actionAsync(async (stack, service, scale, {file, rancher}) => {
    await client().scale({stack, service, scale, dockerComposeFile: file || findDockerCompose()});
  });

program
  .command('update <stack> <service>')
  .description('Create or upgrade service')
  .actionAsync(async (stack, service, {file, rancher}) => {
    await client().update({stack, service, dockerComposeFile: file || findDockerCompose(), rancherComposeFile: rancher});
  });

import fs from 'fs';
import path from 'path';

function findDockerCompose(profileName = configFile.getProfileName()) {
  const cwd = process.cwd();

  for (let file of fs.readdirSync(cwd)) {
    if (file.match(new RegExp(`compose(@${profileName})?`))) {
      return file;
    }
  }
}

program
  .command('list [filter]')
  .alias('ls')
  .description('list all services in an environment')
  .actionAsync(async (filter) => {
    const results = await client().list({filter});
    const table = stringTable.create(results.map((stack) => pick(stack, 'name', 'state', 'created', 'id')));
    console.log(table);
  });

program
  .command('logs <stack> <service>')
  .alias('lg')
  .description('Fetch logs from service')
  .actionAsync(async (stack, service) => {
    await client().logs({stack, service});
  });

program.parse(process.argv);
