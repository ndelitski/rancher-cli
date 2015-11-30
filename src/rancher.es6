import axios from 'axios';
import assert from 'assert';
import {merge, omit, find} from 'lodash';
import $url from 'url';
import {info, debug, error} from './log';
import {json} from './helpers';
import path from 'path';
import {execSync, execFileSync, spawnSync} from 'child_process';
import fs from 'fs';

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


