import fs from 'fs';
import path from 'path';
import {info, debug, error} from './log';
import {merge, assign} from 'lodash';

const DEFAULT_CONFIG_PATH = path.resolve(home(), '.rancher');

export default class Config {
  constructor({filePath = DEFAULT_CONFIG_PATH} = {}) {
    this._filePath = filePath;
  }

  save({url, accessKey, secretKey, project, profileName}) {
    let config = this.load();
    config = merge(config, {
      selectedProfile: profileName || config.selectedProfile,
      profiles: {
        [profileName]: {
          url: url,
          auth: {accessKey, secretKey},
          project
        }
      }
    });
    fs.writeFileSync(this._filePath, JSON.stringify(config, null, 4), 'utf8');
  }

  load() {
    this._loaded = {profiles: {}};
    if (fs.existsSync(this._filePath)) {
      const content = fs.readFileSync(this._filePath, 'utf8');
      try {
        this._loaded = JSON.parse(content);
      } catch(err) {
        throw new Error(`failed to parse json from ${this._filePath}:\n${content}`);
      }
    }
    return this._loaded;
  }

  getProfileName() {
    return (this._loaded || this.load()).selectedProfile;
  }

  profile(profileName) {
    const config = this._loaded || this.load();
    const profile = profileName || config.selectedProfile;
    if (profile) {
      if (config.profiles[profile]) {
        return assign({profileName: profile}, config.profiles[profile]);
      }
    }
  }
}

function home() {
  return process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
}
