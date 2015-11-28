# rancher-cli

Quick commands over `rancher-compose` and Rancher API interface helping me in devops
  
## Profile-based approach. 
Profile is a combination of API endpoint, environment, access keys with a symbolic name. Use `rancher profile [profile_name]` for quick switching profiles
Every profile is stored in `~/.rancher` file. CLI will search this file in a working directory and in the home one.
Compose files are separated with `@[profile_name]`

## Install
Project is written in NodeJS, so you have to [install NodeJS](https://nodejs.org) first.
```
    npm -g i rancher-cli
```
Then create your first profile: `$ rancher init`

## Usage in CI
I am using `rancher-cli` container to process deploy operations to many environments from CI side. Every project has different `compose@[qa|staging|production|local].yml` files in VCS. `.rancher` file is mounted from a CI agent container.

## Commands

### init
### up
If service is not created - trigger launch, otherwise `upgrade` command will be used.
### ls
List services and stacks in environment
### compose
Fallback to `rancher-compose commands`
### ssh [AWS EC2-only] (not impl)
Similar to my [ssh2ec2](https://github.com/ndelitski/ssh2ec2) project.
Will launch ssh to EC2 instance where service container is running and then be forwarded to the container.
