import {info, debug, error} from './log';
import {Command} from 'commander';
import Rancher from './rancher';
import assert from 'assert';
import prompt from './prompt';
import Config from './config';
import _, {pick} from 'lodash';
import stringTable from 'string-table';
import {json} from './helpers';
import Deferred from './deferred';
import B from 'bluebird';

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
};

Command.prototype.composeOptions = function() {
  return this
    .option('-p, --profile [profile]', 'Override .rancher profile', RANCHER_PROFILE)
    .option('-r, --rancher [rancher-compose]', 'Path to `rancher-compose` file [default: cwd/rancher-compose.yml]')
    .option('-f, --file [docker-compose]', 'Path to `docker-compose` file [default: cwd/docker-compose.yml]')
    .option('-s, --stack [stack-name]', 'Override stack name [default: directory-name]')
    .option('-d, --dir [directory]', 'Directory where to search *compose files [default: cwd]', process.cwd());
};

const program = new Command();

const {
  RANCHER_ACCESS_KEY,
  CATTLE_ACCESS_KEY,
  RANCHER_SECRET_KEY,
  CATTLE_SECRET_KEY,
  RANCHER_PROJECT,
  RANCHER_ADDRESS,
  RANCHER_PROFILE
} = process.env;

const configFile = new Config();

program
  .version(require('../package.json').version)
  .option('-D, --debug', 'Enable debug mode', () => {
    process.env.LOG_LEVEL='debug';
  })
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

    configFile.save({url, accessKey, secretKey, project: {name: projectName, id: projectId}, profileName});
  });

program
  .command('profile [name]')
  .alias('switch')
  .alias('sw')
  .description('Select Rancher CLI profile')
  .actionAsync(async (name) => {
    if (!name) {
      const profiles = Object.keys(configFile.load().profiles);
      const {selected} = await prompt([{
        type: "list",
        name: "selected",
        message: "Select profile",
        choices: profiles
      }]);
      name = selected;
    }

    configFile.save({profileName: name});
    info(`you selected ${name} profile`);
  });

program
  .command('list [filter]')
  .alias('ls')
  .description('list all services in an environment')
  .actionAsync(async (filter, {profile}) => {
    const results = await client(profile).list({filter});
    const table = stringTable.create(results.map((stack) => pick(stack, 'name', 'state', 'created', 'id')));
    console.log(table);
  });

program
  .command('up')
  .composeOptions()
  .option('--pull', 'Before doing the upgrade do an image pull on all hosts that have the image already')
  .option('--update', 'Upgrade if service has changed')
  .option('--force-update', 'Upgrade regardless if service has changed')
  .option('--confirm-update', 'Confirm that the upgrade was success and delete old containers')
  .description('Pass to rancher-compose')
  .actionAsync(async ({file, confirmUpdate, forceUpdate, update, pull, dir, rancher, profile, stack}) => {
    const stackName = stack || path.basename(dir);
    const dockerComposeFile =  file || await findDockerCompose({dir, profile});
    const rancherComposeFile = rancher || findRancherCompose({profile, dir});
    await client(profile).compose('up', {dir, forceUpdate, confirmUpdate, update, pull, stack: stackName, dockerComposeFile , rancherComposeFile});
  });

program
  .command('stop [regexp]')
  .composeOptions()
  .description('Stop running services by regexp')
  .actionAsync(async (re, {profile}) => {
    await client(profile).stopByRegExpAsync(new RegExp(re), async () => (await prompt({
      type: 'confirm',
      name: 'isConfirmed',
      message: 'Proceed?'
    })).isConfirmed);
  });

program
  .command('start <regexp>')
  .composeOptions()
  .description('Start stopped services by regexp')
  .actionAsync(async (re, {profile}) => {
    await client(profile).startByRegExpAsync(new RegExp(re), async () => (await prompt({
      type: 'confirm',
      name: 'isConfirmed',
      message: 'Proceed?'
    })).isConfirmed);
  });
program
  .command('logs <containerIdOrStackName>')
  .option('-l, --lines [lines]', 'Number of lines to prefetch', 100)
  .option('-f, --follow', 'Follow logs')
  .composeOptions()
  .description('Start stopped services by regexp')
  .actionAsync(async (containerIdOrStackName, {profile, lines, follow}) => {
    let containerId;
    const cl = client(profile);
    if (containerIdOrStackName.slice(0, 2) == '1i') {
      containerId = containerIdOrStackName;
    }

    if (!containerId) {
      const services = await cl.findServiceByRegExpAsync(new RegExp(`${containerIdOrStackName}[^\\.]*\\.\\S+`));

      const containers = _.flatten(await B.all(services).map(async (s) => {
        const list = await cl.getServiceContainers(s.id);
        for (let c of list) {
          c.serviceName = s.name;
          c.stackName = s.stackName;
        }
        return list;
      }));

      const choices = containers.map((c) => `${c.stackName}/${c.serviceName}/${c.name} [${c.id}]`);
      const {selected} = await prompt([{
        type: "list",
        name: "selected",
        message: "Select container",
        choices: choices
      }]);

      containerId = selected.match(/\[(\S+)\]$/)[1];
      if (!containerId) {
        throw new Error('failed to match containeriD from ' + selected);
      }
    }

    const cancellation = new Deferred();

    process.on('SIGINT', () => {
      info('cancelling');
      cancellation.resolve();
    });

    await cl.followLogsAsync({containerId, follow: !!follow, lines, cancellation: cancellation.promise});
  });

program.parse(process.argv);

import fs from 'fs';
import path from 'path';

async function findDockerCompose({profile, dir}) {
  const config = configFile.profile(profile);
  let environment;
  if (config) {
    environment = config.project.name;
  }
  const ignored = [];
  let found;
  for (let file of fs.readdirSync(dir)) {
    if (file.match(new RegExp(`docker-compose(@${environment})?\\.yml$`))) {
      found = path.join(path.resolve(dir), file);
      break;
    }
    ignored.push(file);
  }
  if (!found) {
    throw new Error(`no docker-compose found in ${dir}, these files were ignored:\n - ${ignored.join('\n - ')}`);
  } else {
    const tmpFile = require('tmp').fileSync({prefix: path.basename(found).replace(/yml$/, ''), postfix: '.yml'});
    const transformed = await require('rancher-compose-extra')({filePath: found});
    fs.writeFileSync(tmpFile.name, transformed, 'utf8');
    debug(`transformed ${found} to temp file ${tmpFile.name}:\n${transformed}`);
    return tmpFile.name;
  }
}

function findRancherCompose({profile, dir}) {
  const config = configFile.profile(profile);
  let environment;
  if (config) {
    environment = config.project.name;
  }
  for (let file of fs.readdirSync(dir)) {
    if (file.match(new RegExp(`rancher-compose(@${environment})?\\.yml$`))) {
      return path.join(path.resolve(dir), file);
    }
  }
}

function client(profileName) {
  let {
    accessKey,
    secretKey,
    projectId,
    url
    } = program;

  const config = configFile.profile(profileName);
  if (config) {
    accessKey || (accessKey = config.auth.accessKey);
    secretKey || (secretKey = config.auth.secretKey);
    url || (url = config.url);
    projectId || (projectId = config.project.id);
  }

  return new Rancher({address: url, projectId, auth: {secretKey, accessKey}});
}

