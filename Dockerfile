FROM node:4.2.1

ENV COMPOSE_VERSION v0.5.2
ENV RANCHER_BINARY_PATH /usr/bin/rancher-compose
RUN curl -SsL "https://github.com/rancher/rancher-compose/releases/download/${COMPOSE_VERSION}/rancher-compose-linux-amd64-${COMPOSE_VERSION}.tar.gz" | tar -xz -C /tmp \
    && mv /tmp/rancher-compose-${COMPOSE_VERSION}/rancher-compose $RANCHER_BINARY_PATH

WORKDIR /compose-templates
COPY . /opt/rancher
RUN npm -g i /opt/rancher

ENTRYPOINT ["rancher"]



