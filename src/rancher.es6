import axios from 'axios';
import assert from 'assert';
import _, {merge, omit, find} from 'lodash';
import $url from 'url';
import {info, debug, error} from './log';
import {json} from './helpers';
import path from 'path';
import {execSync, execFileSync, spawnSync} from 'child_process';
import fs from 'fs';
import B from 'bluebird';
import WebSocket from 'ws';
import Deferred from './deferred';

const RANCHER_BINARY_PATH = process.env.RANCHER_BINARY_PATH || path.join(__dirname, '../bin/rancher-compose');

export default class RancherClient {
  constructor({address, projectId, auth}) {
    assert(address, '`address` is missing');

    if (auth) {
      assert(auth.accessKey, '`auth.accessKey` is missing');
      assert(auth.secretKey, '`auth.secretKey` is missing');
    }

    if (!address.match(/^http/)) {
      address = 'http://' + address;
    }

    this.address = address;
    this.projectId = projectId;
    this.auth = auth;
    debug(json`rancher client inited with ${arguments[0]}`);
  }

  exec(cmd) {
    const url = `${this.address}/v1/projects/${this.projectId}`;
    const args = `--access-key ${this.auth.accessKey} --secret-key ${this.auth.secretKey} --url ${url}`.split(/\s+/g).concat(cmd.split(/\s+/g)).filter((a)=>a);
    info(`executing ${RANCHER_BINARY_PATH} ${args.join(' ')}`);

    spawnSync(RANCHER_BINARY_PATH, args, {env: process.env, stdio: 'inherit'});
  }

  async request(options) {
    assert(options.url, 'request `url` is missing');

    try {
      const res = await axios(merge(options, {
        url: $url.resolve(this.address, options.url),
        headers: this.auth ? {
          'Authorization': 'Basic ' + new Buffer(this.auth.accessKey + ':' + this.auth.secretKey).toString('base64')
        } : {},
        responseType: 'json'
      }));
      return res.data
    }
    catch (resp) {
      const err = new Error('RancherClientError: non-200 code response ' + JSON.stringify(resp, null, 4));
      err.response = resp;
      throw err;
    }
  }
  async requestProjects(path) {
    assert(this.projectId, '`projectId` is missing');

    return (await this.request({url: `/v1/projects/${this.projectId}${path}`})).data;
  }

  async list() {
    return await this.getStacks();
  }

  async logs() {
    this._throwNotImplemented();
  }

  async scale({stack, service, scale, dockerComposeFile}) {
    info('invoking scale', stack, service, scale);
    this.exec(`-f ${dockerComposeFile || 'docker-compose.yml'} -p ${stack} scale ${service}=${scale}`);
  }

  async create({
    stack,
    rancherComposeFile,
    dockerComposeFile,
  }) {
    this.exec(`-f ${dockerComposeFile || 'docker-compose.yml'} ${rancherComposeFile ? '-r '+rancherComposeFile : ''} -p ${stack} up -d`);
  }

  async compose(cmd, {
    stack,
    rancherComposeFile,
    dockerComposeFile,
    forceUpdate, confirmUpdate, update, pull
    }) {
    const args = [];
    pull && args.push('--pull');
    forceUpdate && args.push('--force-recreate');
    update && args.push('--force-upgrade');
    confirmUpdate && args.push('--confirm-upgrade');
    this.exec(`-f ${dockerComposeFile || 'docker-compose.yml'} ${rancherComposeFile ? '-r '+rancherComposeFile : ''} -p ${stack} up -d ${args.join(' ')}`);
  }

  async up({
    stack,
    rancherComposeFile,
    dockerComposeFile,
  }) {
    info('invoking up', stack);
    this.exec(`-f ${dockerComposeFile || 'docker-compose.yml'} ${rancherComposeFile ? '-r '+rancherComposeFile : ''} -p ${stack} up -d`);
  }

  async update({
    stack,
    service,
    rancherComposeFile,
    dockerComposeFile,
  }) {
    info('invoking update', stack, service);
    this.exec(`-f ${dockerComposeFile || 'docker-compose.yml'} ${rancherComposeFile ? '-r '+rancherComposeFile : ''} -p ${stack} up -d`);
    //debug(`looking for a service: ${stack}/${service}`);
    //const serviceInfo = await this.getService({stack, service});
    //if (serviceInfo && ['removed', 'purged'].indexOf(serviceInfo.state) < 0) {
    //  debug(json`service found:\n${serviceInfo}`);
    //  this.exec(`-f ${dockerComposeFile || 'docker-compose.yml'} -p ${stack} upgrade ${service} ${service} --scale=${serviceInfo.scale} -w`);
    //  const upgradedServiceInfo = await this.getServiceById(serviceInfo.id);
    //  if (upgradedServiceInfo.scale !== serviceInfo.scale) {
    //    await this.scale({stack, service, dockerComposeFile, scale: serviceInfo.scale})
    //  }
    //} else {
    //  await this.create({stack, dockerComposeFile, rancherComposeFile});
    //}
  }

  async execServicesActionAsync(services, actionName) {
    const responses = await B.all(services).map((s) => this.request({method: 'POST', url: $url.parse(s.actions[actionName]).path}));
  }

  async findServiceByRegExpAsync(re, predicate) {
    debug(`searching services to match RegExp: ${re}`);
    assert(!predicate || _.isFunction(predicate), '`predicate` should be a Function');

    const [stacks, services] = await Promise.all([
      await this.getStacks(),
      await this.getServices()
    ]);

    const servicesIndex = _.indexBy(services, 'id');
    const stacksIndex = _.indexBy(stacks, 'id');
    const matched = [];

    for (let s of services) {
      const stackName = stacksIndex[s.environmentId].name;
      s.stackName = stackName;
      s.fullName = `${stackName}.${s.name}`;
      if (re.test(s.fullName)) {
        if (!predicate || predicate(s)) {
          matched.push(s);
        } else {
          debug(`${s.fullName} is not active - ignoring`);
        }
      }
    }

    return matched;
  }

  async _issueLogsTokenAsync({containerId, lines, follow}) {
    debug(`requesting logs lines=${lines}, follow=${follow}`);
    const {token, url} = await this.request({
      method: 'POST',
      url: '/v1/containers/' + containerId,
      params: {action: 'logs'},
      data: {
        follow,
        lines
      }
    });

    return {token, url};
  }

  async pollContainerActionBecomeAvailableAsync({containerId, action, interval = 2000}) {
    const poll = async () => {
      const {actions} = await this.request({url: '/v1/projects/1a74/containers/' + containerId});
      return !actions[action];
    }

    while(await poll()) {
      await B.delay(interval);
    }
  }

  async followLogsAsync({containerId, cancellation, lines, follow}={}) {
    await this.pollContainerActionBecomeAvailableAsync({containerId, action: 'logs'});
    const {url, token} = await this._issueLogsTokenAsync({containerId, lines, follow});
    const wsUrl = url + '?token=' + token;
    const completion = new Deferred();
    let isOpened;

    //assert(cancellation.isPending(), 'cancelled');
    const onCancelled = (err) => {
      cancelledByUser = true;
      err ? completion.reject(err) : completion.resolve();
      ws.close()
    }

    cancellation.then(onCancelled, onCancelled);

    var ws = new WebSocket(wsUrl);

    ws.on('open', function open() {
      isOpened = true;
      debug(`websocket opened by ${wsUrl}`);
    });

    ws.on('message', function (data, flags) {
      !flags.masked && process.stdout.write(flags.buffer);
      // flags.binary will be set if a binary data is received.
      // flags.masked will be set if the data was masked.
    });

    let cancelledByUser;

    ws.on('close', () => {
      if (follow && !cancelledByUser) {
        debug(`reconnecting`);
        setTimeout(() => {
          this.followLogsAsync({containerId, cancellation, lines: 0})
            .then(() => cancellation.resolve(), (err) => cancellation.reject(err));
        }, 5000);
      } else {
        completion.resolve();
      }

      debug(`websocket closed`);
    });



    await completion.promise;
  }

  async _waitConfirm(confirmFn) {
    assert(_.isFunction(confirmFn), 'confirm should be a async function');
    await confirmFn();
    //try {
    //  await B.resolve(confirmFn()).timeout(10000);
    //} catch (err) {
    //  if (err instanceof B.TimeoutError) {
    //    console.log('\nSorry you are late!');
    //    process.exit(1);
    //  }
    //  throw err;
    //}
  }

  async stopByRegExpAsync(re, confirmFn) {
    const matched = await this.findServiceByRegExpAsync(re, (s) => s.state == 'active');

    if (matched.length) {
      info(`these ${matched.length} sevices will be stopped:\n${_.pluck(matched, 'fullName').join('\n')}`);
    } else {
      info('no services will be stopped');
      return;
    }

    confirmFn && await this._waitConfirm(confirmFn);

    await this.execServicesActionAsync(matched, 'deactivate');
  }

  async startByRegExpAsync(re, confirmFn) {
    const matched = await this.findServiceByRegExpAsync(re, (s) => s.state == 'inactive');

    if (matched.length) {
      info(`these ${matched.length} sevices will be started:\n${_.pluck(matched, 'fullName').join('\n')}`);
    } else {
      info('no services will be started');
      return;
    }

    confirmFn && await this._waitConfirm(confirmFn);

    await this.execServicesActionAsync(matched, 'activate');
  }

  _throwNotImplemented() {
    throw new Error('method not implemented yet');
  }

  async getServices() {
    return await this.requestProjects('/services');
  }

  async getStacks() {
    assert(this.projectId, '`projectId` is missing');

    return (await this.request({
      url: `/v1/projects/${this.projectId}/environments`
    })).data;
  }

  async getProjects() {
    return (await this.request({
      url: `/v1/projects`
    })).data;
  }

  async getService({stack, service}) {
    const stackId = (await this.getStackByName(stack)).id;
    const services = await this.requestProjects(`/environments/${stackId}/services`);
    return find(services, {name: service});
  }

  async getServiceById(serviceId) {
    assert(this.projectId, '`projectId` is missing');

    return await this.request({
      url: `/v1/projects/${this.projectId}/services/${serviceId}`
    });
  }

  async getStackByName(stackName) {
    const stacks = await this.requestProjects('/environments');
    return find(stacks, {name: stackName});
  }

  async getServiceContainers(serviceId) {
    assert(this.projectId, '`projectId` is missing');

    return (await this.request({
      url: `/v1/projects/${this.projectId}/services/${serviceId}/instances`
    })).data;
  }

  buildUrl(path) {
    return $url.resolve(this.address, path);
  }

}


