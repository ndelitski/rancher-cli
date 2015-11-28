# rancher-cli

Quick commands over `rancher-compose` and Rancher API interface helping me in devops
  
## Profile-based approach. 
Profile is a combination of API endpoint, environment, access keys with a symbolic name. Use `rancher profile [profile_name]` for quick switching profiles
Every profile is stored in `~/.rancher` file. CLI will search this file in a working directory and in the home one.
Compose files are separated with `@[profile_name]`

## Install
Project is written in NodeJS, so you have to (install NodeJS)[https://nodejs.org] first.
```
    npm -g i rancher-cli
```
Then create your first profile: `$ rancher init`

## Usage in CI
I am using `rancher-cli` container to make deploy operations from CI. Every projects have different `compose@[qa|staging|production|local].yml` files and `.rancher` file with rancher-cli profiles on the host. CI agent pick one depending on build environment
